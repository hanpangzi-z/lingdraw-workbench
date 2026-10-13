import asyncio
import base64
import hashlib
import json
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from PIL import Image, ImageDraw
from fastapi import HTTPException
import main


class DrawingHdTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)/'original.png'
        image = Image.new('RGB',(4096,2304),'white')
        draw = ImageDraw.Draw(image)
        for y in range(20,500,20):
            draw.text((20,y),'Small text, texture and fine lines: ABCDEFG 123456789',fill='black')
            draw.line((700,y,3500,y),fill='green',width=1)
        image.save(self.path)
        self.raw = self.path.read_bytes()
        self.ref = {'url':'/assets/original.png','kind':'image','role':'sketch'}
        self.file_patch = patch.object(main,'output_file_from_url',return_value=str(self.path))
        self.file_patch.start()

    def tearDown(self):
        self.file_patch.stop()
        self.temp.cleanup()

    def assertOriginal(self, value):
        self.assertEqual(base64.b64decode(value.split(',',1)[1]),self.raw)

    def test_all_drawing_roles_preserve_exact_bytes_while_ordinary_uploads_keep_existing_behavior(self):
        for role in ('sketch','annotation','source'):
            ref = {**self.ref,'role':role,'annotation_group':'pair'}
            self.assertOriginal(main.reference_to_data_url(ref,max_size=1536))
        ordinary = main.reference_to_data_url({**self.ref,'role':''},max_size=1536)
        self.assertEqual(Image.open(BytesIO(base64.b64decode(ordinary.split(',',1)[1]))).size,(1536,864))

    def test_gemini_volcengine_and_modelscope_converters_preserve_pixels_and_mime(self):
        gemini = main.gemini_reference_part(self.ref)['inlineData']
        self.assertEqual(gemini['mimeType'],'image/png')
        self.assertEqual(base64.b64decode(gemini['data']),self.raw)
        self.assertOriginal(main.volcengine_image_payload(self.ref))
        self.assertOriginal(main.modelscope_image_url(self.ref))

    def test_responses_base64_fallback_does_not_drop_reference_role(self):
        with patch.object(main,'upload_local_video_to_cloud',AsyncMock(side_effect=HTTPException(503,'mock unavailable'))):
            value = asyncio.run(main.responses_input_image_url(self.ref))
        self.assertOriginal(value)

    def test_volcengine_keeps_drawing_size_without_implicit_size_normalization(self):
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.post.return_value = httpx.Response(200,json={'data':[{'url':'https://example.invalid/result.png'}]},request=httpx.Request('POST','https://example.invalid'))
        with patch.object(main.httpx,'AsyncClient',return_value=client), patch.object(main,'api_headers',return_value={}):
            asyncio.run(main.generate_volcengine_provider_image('修改','1280x720','mock-image',[self.ref],{'id':'qa','base_url':'https://example.invalid'}))
        self.assertEqual(client.post.call_args.kwargs['json']['size'],'1280x720')
        self.assertOriginal(client.post.call_args.kwargs['json']['image'][0])

    def test_explicit_size_survives_ratio_and_size_mentions_in_text_or_planner(self):
        for message in ('按 1:1 参考图改图','请保留原图上的 1024x1024 字样'):
            payload = main.ChatRequest(message=message,size='4096x2304',size_is_explicit=True)
            self.assertEqual(main.resolve_chat_image_size(payload,'生成 2:3 海报','512x512',True),'4096x2304')
            self.assertEqual(main.resolve_chat_image_size(payload),'4096x2304')
        ordinary = main.ChatRequest(message='生成 1024x1024 图片',size='4096x2304')
        self.assertEqual(main.resolve_chat_image_size(ordinary),'1024x1024')

    def test_request_fingerprints_distinguish_locked_size_and_remain_compatible_when_false(self):
        payload = main.ChatRequest(message='修改',size='4096x2304')
        data = payload.model_dump(mode='json')
        for key in ('conversation_id','request_id','session_id','turn_id','parent_turn_id','size_is_explicit'):
            data.pop(key,None)
        old = hashlib.sha256(json.dumps(data,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        self.assertEqual(main.chat_request_fingerprint(payload),old)
        self.assertNotEqual(main.chat_request_fingerprint(payload.model_copy(update={'size_is_explicit':True})),old)

    def test_json_and_apimart_request_bodies_keep_original_bytes(self):
        for request_mode,apimart in [('openai-json',False),('multipart',True)]:
            with self.subTest(mode=request_mode,apimart=apimart):
                client = AsyncMock()
                client.__aenter__.return_value = client
                response = httpx.Response(200,json={'data':[{'url':'https://example.invalid/result.png'}]},request=httpx.Request('POST','https://example.invalid'))
                captured = {}
                async def request(*args,**kwargs):
                    captured.update(kwargs)
                    return response
                provider = {'id':'qa','base_url':'https://example.invalid/v1','protocol':'openai'}
                with patch.object(main,'get_api_provider',return_value=provider), patch.object(main,'api_headers',return_value={}), patch.object(main,'effective_image_request_mode',return_value=request_mode), patch.object(main,'is_apimart_provider',return_value=apimart), patch.object(main.httpx,'AsyncClient',return_value=client), patch.object(main,'httpx_request_with_transient_retries',side_effect=request):
                    asyncio.run(main.generate_ai_image('修改','4096x2304','high','mock-image',[self.ref]))
                body = captured['json']
                self.assertOriginal(body['image_urls'][0] if apimart else body['extra_body']['image'][0])
                self.assertEqual(captured['attempts'],1)

    def test_rejected_hd_edit_does_not_retry_with_json_or_downscale(self):
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.post.return_value = httpx.Response(413,text='image too large',request=httpx.Request('POST','https://example.invalid'))
        provider = {'id':'qa','base_url':'https://example.invalid/v1','protocol':'openai'}
        with patch.object(main,'get_api_provider',return_value=provider), patch.object(main,'api_headers',return_value={}), patch.object(main,'effective_image_request_mode',return_value='multipart'), patch.object(main.httpx,'AsyncClient',return_value=client), patch.object(main,'httpx_request_with_transient_retries',AsyncMock()) as fallback, self.assertRaises(HTTPException) as caught:
            asyncio.run(main.generate_ai_image('修改','4096x2304','high','mock-image',[self.ref]))
        self.assertIn('未自动压缩或再次提交',caught.exception.detail)
        client.post.assert_awaited_once()
        fallback.assert_not_awaited()

    def test_responses_rejection_has_no_automatic_paid_resubmission(self):
        client = AsyncMock()
        response = httpx.Response(400,text='unsupported size',request=httpx.Request('POST','https://example.invalid'))
        client.post.return_value = response
        with patch.object(main,'post_openai_responses_stream',AsyncMock()) as stream:
            result = asyncio.run(main.post_openai_responses(client,'https://example.invalid',{}, {},allow_fallback=False))
        self.assertIs(result,response)
        client.post.assert_awaited_once()
        stream.assert_not_awaited()
