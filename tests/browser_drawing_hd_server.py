"""Disposable UI fixture for drawing export tests. Never calls an AI provider.

Run: .venv-agent/bin/python tests/browser_drawing_hd_server.py --port 37625
The report at /__qa/status records received pixels, hashes and generation sizes.
"""
import argparse
import hashlib
import json
import tempfile
import uuid
from email import policy
from email.parser import BytesParser
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image, ImageDraw
import browser_mock_chat_server as base

ASSETS = {}
UPLOADS = []
GENERATIONS = []


class Handler(base.Handler):
    def send_bytes(self, body, mime):
        self.send_response(200)
        self.send_header('Content-Type',mime)
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/':
            return self.send_bytes((base.ROOT/'static/index.html').read_bytes(),'text/html; charset=utf-8')
        if path == '/api/auth/status':
            return self.send_json({'authenticated':True,'username':'drawing-qa','user_id':999,'balance':0})
        if path in ASSETS:
            return self.send_bytes(ASSETS[path].read_bytes(),'image/png')
        if path == '/__qa/status':
            return self.send_json({'uploads':UPLOADS,'generations':GENERATIONS})
        if path.startswith('/api/chat/agent/requests/'):
            request_id = path.rsplit('/',1)[-1]
            payload = next((item for item in GENERATIONS if item['request_id'] == request_id),None)
            if not payload:
                return self.send_json({'detail':'unknown test request'},404)
            if '[reject]' in payload['message']:
                return self.send_json({'status':'failed','request_id':request_id})
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == '/api/canvas-assets/check':
            payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            return self.send_json({'exists': {url: url in ASSETS for url in payload['urls']}})
        if path == '/api/ai/upload':
            raw = self.rfile.read(int(self.headers['Content-Length']))
            message = BytesParser(policy=policy.default).parsebytes(('Content-Type: '+self.headers['Content-Type']+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
            files = []
            for part in message.iter_parts():
                content = part.get_payload(decode=True)
                name = part.get_filename()
                if not name:
                    continue
                filename = f'upload-{uuid.uuid4().hex}.png'
                target = self.server.asset_dir/filename
                target.write_bytes(content)
                url = '/assets/'+filename
                ASSETS[url] = target
                with Image.open(target) as image:
                    width,height = image.size
                UPLOADS.append({'name':name,'url':url,'width':width,'height':height,'sha256':hashlib.sha256(content).hexdigest()})
                files.append({'url':url,'name':name,'kind':'image','mime':part.get_content_type()})
            return self.send_json({'files':files})
        if path == '/api/chat/agent':
            payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            GENERATIONS.append(payload)
            if '[reject]' in payload['message']:
                return self.send_json({'detail':'模拟：此模型不支持当前尺寸，请调整尺寸后重试。未自动压缩或重复提交。'},400)
            conversation = base.CONVERSATIONS[payload['conversation_id']]
            context = {'size':payload['size'],'size_is_explicit':payload.get('size_is_explicit',False),'image_provider':'mock','image_model':'mock-image','requested_count':1}
            user = {'id':uuid.uuid4().hex,'role':'user','content':payload['message'],'attachments':payload['reference_images'],'request_id':payload['request_id'],'request_context':context,'mode':'image'}
            assistant = {'id':uuid.uuid4().hex,'role':'assistant','type':'image','content':'模拟完成','image_url':'/assets/qa-original.png','size':payload['size'],'model':'mock-image','provider':'mock','request_id':payload['request_id']}
            conversation['messages'].extend([user,assistant])
            return self.send_json({'conversation':conversation,'message':assistant})
        return super().do_POST()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port',type=int,required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='lingdraw-hd-qa-') as directory:
        asset_dir = Path(directory)
        original = asset_dir/'qa-original.png'
        image = Image.new('RGB',(4096,2304),'#f4f7fb')
        draw = ImageDraw.Draw(image)
        draw.rectangle((160,140,3936,2164),outline='#387ff5',width=8)
        for y in range(260,2000,48):
            draw.text((280,y),'4K QUALITY TEST - 4096 x 2304 - FINE PRINT 0123456789',fill='#25364f',font_size=28)
            draw.line((1400,y,3600,y),fill='#6b89ab',width=1)
        image.save(original)
        ASSETS['/assets/qa-original.png'] = original
        base.CONVERSATION.update({'title':'高清回传验收','messages':[{'id':'qa-result','role':'assistant','type':'image','content':'测试用 4K 原图','image_url':'/assets/qa-original.png','model':'mock-image','provider':'mock'}]})
        server = ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
        server.asset_dir = asset_dir
        print(json.dumps({'port':args.port,'source':str(original),'sha256':hashlib.sha256(original.read_bytes()).hexdigest()}),flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
