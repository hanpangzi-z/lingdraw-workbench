import argparse
import json
import mimetypes
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
LOCK = threading.Lock()
CONVERSATION = {
    "id": "qa-concurrent-chat",
    "title": "并发验收",
    "messages": [],
    "surface": "gpt_chat",
    "context_id": "",
}
CONVERSATIONS = {CONVERSATION["id"]: CONVERSATION}
REQUESTS = []
ACTIVE = 0
MAX_ACTIVE = 0


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        return

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/config":
            return self.send_json({
                "chat_model": "mock-chat",
                "image_model": "mock-image",
                "chat_models": ["mock-chat"],
                "image_models": ["mock-image"],
                "api_providers": [{
                    "id": "mock",
                    "name": "Mock",
                    "chat_models": ["mock-chat"],
                    "image_models": ["mock-image"],
                }],
            })
        if path == "/api/conversations":
            with LOCK:
                summaries = [{
                    **conversation,
                    "last_message": (conversation["messages"][-1]["content"] if conversation["messages"] else ""),
                } for conversation in reversed(list(CONVERSATIONS.values()))]
            return self.send_json({"conversations": summaries})
        if path.startswith("/api/conversations/"):
            conversation_id = path.rsplit("/", 1)[-1]
            with LOCK:
                conversation = json.loads(json.dumps(CONVERSATIONS.get(conversation_id) or {}))
            if not conversation:
                return self.send_json({"detail": "conversation not found"}, 404)
            return self.send_json({"conversation": conversation})
        if path.startswith("/api/chat/agent/requests/"):
            request_id = path.rsplit("/", 1)[-1]
            with LOCK:
                matching = [
                    item for conversation in CONVERSATIONS.values()
                    for item in conversation["messages"]
                    if item.get("request_id") == request_id
                ]
                assistant = next((item for item in reversed(matching) if item.get("role") == "assistant"), None)
                conversation = next((
                    item for item in CONVERSATIONS.values()
                    if any(message.get("request_id") == request_id for message in item["messages"])
                ), CONVERSATION)
            return self.send_json({
                "status": "succeeded" if assistant else "running",
                "request_id": request_id,
                "conversation": {"id": conversation["id"]},
                "message": assistant,
            })
        if path == "/__qa/status":
            with LOCK:
                return self.send_json({
                    "request_count": len(REQUESTS),
                    "request_ids": [item["request_id"] for item in REQUESTS],
                    "messages": [item["message"] for item in REQUESTS],
                    "max_active": MAX_ACTIVE,
                })
        if path.startswith("/static/"):
            target = (ROOT / path.lstrip("/")).resolve()
            static_root = (ROOT / "static").resolve()
            if static_root not in target.parents or not target.is_file():
                return self.send_error(404)
            body = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_error(404)

    def do_POST(self):
        global ACTIVE, MAX_ACTIVE
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        payload = json.loads(self.rfile.read(length) or b"{}")
        if path == "/api/conversations":
            conversation = {
                "id": f"qa-chat-{uuid.uuid4().hex[:10]}",
                "title": str(payload.get("title") or "新对话"),
                "messages": [],
                "surface": "gpt_chat",
                "context_id": "",
            }
            with LOCK:
                CONVERSATIONS[conversation["id"]] = conversation
            return self.send_json({"conversation": conversation})
        if path != "/api/chat/agent":
            return self.send_json({"detail": "unexpected endpoint"}, 404)

        request_id = str(payload.get("request_id") or "")
        message = str(payload.get("message") or "")
        conversation_id = str(payload.get("conversation_id") or CONVERSATION["id"])
        with LOCK:
            conversation = CONVERSATIONS.get(conversation_id) or CONVERSATION
            REQUESTS.append({"request_id": request_id, "message": message})
            ACTIVE += 1
            MAX_ACTIVE = max(MAX_ACTIVE, ACTIVE)
            conversation["messages"].append({
                "id": f"user-{request_id}",
                "role": "user",
                "content": message,
                "request_id": request_id,
            })
        delay = 3.0 if message.startswith("[slow]") else (0.4 if message.startswith("[fast]") else 1.5)
        time.sleep(delay)
        assistant = {
            "id": f"assistant-{request_id}",
            "role": "assistant",
            "content": f"模拟完成：{message}",
            "request_id": request_id,
        }
        with LOCK:
            conversation["messages"].append(assistant)
            ACTIVE -= 1
            response_conversation = json.loads(json.dumps(conversation))
        self.send_json({"conversation": response_conversation, "message": assistant, "agent": {"action": "chat"}})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
