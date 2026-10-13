import asyncio
import copy
import unittest
import tempfile
from pathlib import Path
from io import BytesIO
from PIL import Image
import httpx
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
import main
from annotation_edit import prepare_annotation_edit


class AnnotationEditTests(unittest.TestCase):
    def setUp(self):
        self.source = {'url':'/assets/source.jpg','name':'原图.jpg','role':'source','kind':'image','annotation_group':'pair-1'}
        self.guide = {'url':'/assets/guide.png','name':'标注.png','role':'annotation','kind':'image','annotation_group':'pair-1'}
        self.pair = [self.source,self.guide]

    def test_roles_survive_request_parsing(self):
        refs = [ref.model_dump() for ref in main.ChatRequest(message='苹果改绿色',reference_images=self.pair).reference_images]
        self.assertEqual(refs[1]['role'],'annotation')
        self.assertEqual(refs[1]['annotation_group'],'pair-1')
        self.assertEqual(main.image_references(refs),refs)

    def test_pair_moves_before_other_references_without_mutation(self):
        extra = {'url':'/assets/color.png'}
        refs = [extra,self.guide,self.source]
        before = copy.deepcopy(refs)
        prompt, ordered = prepare_annotation_edit('苹果改绿色，保留背景',refs)
        self.assertEqual(ordered,self.pair + [extra])
        self.assertEqual(refs,before)
        self.assertIn('图片1是干净原图',prompt)
        self.assertIn('不得直接绘制进成品',prompt)
        self.assertIn('原图本身已有的文字',prompt)
        self.assertTrue(prompt.endswith('苹果改绿色，保留背景'))

    def test_missing_mismatched_duplicate_pairs_and_masks_fail(self):
        invalid = [[self.source],[self.guide], [self.source,{**self.guide,'annotation_group':'other'}], self.pair * 2, self.pair + [{'url':'/assets/mask.png','role':'mask'}], [self.source,{**self.guide,'url':self.source['url']}]]
        for refs in invalid:
            with self.subTest(refs=refs), self.assertRaises(HTTPException) as caught:
                prepare_annotation_edit('修改',refs)
            self.assertEqual(caught.exception.status_code,400)

    def test_ordinary_references_and_sketches_are_unchanged(self):
        for refs in (None, [], [{'url':'/assets/sketch.png','role':'sketch'}], [{'url':'/assets/photo.png','role':'source'}]):
            self.assertEqual(prepare_annotation_edit('原有需求',refs),('原有需求',refs))

    def test_guide_never_triggers_product_coverage_rule(self):
        self.assertEqual(main.image_reference_coverage_prompt('苹果改绿色',self.pair),'苹果改绿色')
        self.assertIn('2 张原始参考图',main.image_reference_coverage_prompt('商品合照',[{'url':'/assets/a.png'},{'url':'/assets/b.png'}]))

    def test_roles_are_applied_before_provider_dispatch_without_generating_images(self):
        upstream = AsyncMock(return_value=({'type':'url','value':'mock://result'},{}))
        with patch.object(main,'output_file_from_url',return_value=__file__), patch.object(main,'get_api_provider',return_value={'id':'modelscope'}), patch.object(main,'generate_modelscope_provider_image',upstream):
            asyncio.run(main.generate_ai_image('苹果改绿色','1024x1024','auto','mock-image',[self.guide,self.source]))
        args = upstream.await_args.args
        self.assertIn('图片2是带标注的修改示意图',args[0])
        self.assertEqual(args[3],self.pair)

    def test_invalid_pair_fails_before_any_provider_is_called(self):
        with patch.object(main,'get_api_provider') as provider, self.assertRaises(HTTPException):
            asyncio.run(main.generate_ai_image('修改','1024x1024','auto','mock-image',[self.guide]))
        provider.assert_not_called()

    def test_single_image_runninghub_workflow_is_rejected(self):
        with patch.object(main,'runninghub_entry_config_from_model',return_value={'workflowId':'single'}), patch.object(main,'generate_runninghub_entry_image',AsyncMock()) as upstream, self.assertRaises(HTTPException):
            asyncio.run(main.generate_runninghub_provider_image('修改','1024x1024','mock',self.pair,{}))
        upstream.assert_not_called()

    def test_missing_file_fails_before_upstream_request(self):
        with patch.object(main,'output_file_from_url',return_value=None), patch.object(main,'get_api_provider') as provider, self.assertRaises(HTTPException):
            asyncio.run(main.generate_ai_image('修改','1024x1024','auto','mock-image',self.pair))
        provider.assert_not_called()

    def test_gpt_edit_multipart_keeps_original_4k_bytes_and_pair_order(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)/'source.png'
            guide = Path(directory)/'guide.png'
            Image.new('RGB',(4096,2304),'green').save(source)
            Image.new('RGB',(1024,640),'white').save(guide)
            original_bytes = source.read_bytes()
            captured = {}
            async def post(url, **kwargs):
                captured['url'] = url
                captured['prompt'] = kwargs['data']['prompt']
                captured['files'] = [(name,details[0],details[1].read()) for name,details in kwargs['files']]
                return httpx.Response(200,json={'data':[{'url':'https://example.invalid/mock.png'}]},request=httpx.Request('POST',url))
            client = AsyncMock()
            client.__aenter__.return_value = client
            client.post.side_effect = post
            provider = {'id':'qa','base_url':'https://example.invalid/v1','protocol':'openai'}
            files = {self.source['url']:str(source),self.guide['url']:str(guide)}
            with patch.object(main,'output_file_from_url',side_effect=files.get), patch.object(main,'get_api_provider',return_value=provider), patch.object(main,'api_headers',return_value={}), patch.object(main,'effective_image_request_mode',return_value='multipart'), patch.object(main.httpx,'AsyncClient',return_value=client):
                asyncio.run(main.generate_ai_image('标题改为企业团购','4096x2304','high','gpt-image-2',[self.guide,self.source]))
            self.assertTrue(captured['url'].endswith('/images/edits'))
            self.assertEqual([item[1] for item in captured['files']],['source.png','guide.png'])
            self.assertEqual(captured['files'][0][2],original_bytes)
            self.assertEqual(Image.open(BytesIO(captured['files'][0][2])).size,(4096,2304))
            self.assertIn('不得直接绘制进成品',captured['prompt'])
