"""Isolated 60s proxy timeout / 70s image completion fixture; no provider calls."""
import json
import threading
import time
import uuid
from urllib.parse import urlparse
import browser_drawing_hd_server as drawing


class RecoveryHandler(drawing.Handler):
    def do_POST(self):
        if urlparse(self.path).path != '/api/chat/agent':
            return super().do_POST()
        payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        drawing.GENERATIONS.append(payload)
        conversation = drawing.base.CONVERSATIONS[payload['conversation_id']]
        request_id = payload['request_id']
        user = {'id':uuid.uuid4().hex, 'role':'user', 'mode':'agent', 'content':payload['message'],
                'attachments':payload['reference_images'], 'request_id':request_id,
                'created_at':int(time.time()*1000),
                'request_context':{'request_mode':payload['mode'], 'generation_status':'running'}}
        conversation['messages'].append(user)

        def complete():
            time.sleep(70)
            user['request_context']['generation_status'] = 'succeeded'
            conversation['messages'].append({'id':uuid.uuid4().hex,'role':'assistant','type':'image',
                'content':'超时恢复验收成功（模拟结果，无积分消耗）', 'image_url':'/assets/qa-original.png',
                'model':'mock-image','provider':'mock','request_id':request_id})
        threading.Thread(target=complete,daemon=True).start()
        time.sleep(60)
        body = b'<html><h1>504 Gateway Time-out</h1></html>'
        self.send_response(504)
        self.send_header('Content-Type','text/html')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass


if __name__ == '__main__':
    drawing.Handler = RecoveryHandler
    drawing.main()
