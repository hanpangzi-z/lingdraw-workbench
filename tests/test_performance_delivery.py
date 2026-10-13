import asyncio
import json
import time
import unittest
from pathlib import Path

import main


class _FakeWebSocket:
    def __init__(self):
        self.messages = []

    async def send_text(self, value):
        self.messages.append(json.loads(value))


class QueueStatusPushTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.original_queue = list(main.QUEUE)
        main.QUEUE[:] = [
            {"task_id": 1, "client_id": "same", "owner_user_id": 11},
            {"task_id": 2, "client_id": "same", "owner_user_id": 22},
            {"task_id": 3, "client_id": "other", "owner_user_id": 11},
        ]

    def tearDown(self):
        main.QUEUE[:] = self.original_queue

    async def test_queue_snapshot_uses_both_user_and_client_identity(self):
        self.assertEqual(main.queue_status_snapshot("same", 11), {"total": 3, "position": 1})
        self.assertEqual(main.queue_status_snapshot("same", 22), {"total": 3, "position": 2})

    async def test_broadcast_sends_personalized_queue_positions(self):
        manager = main.ConnectionManager()
        first = _FakeWebSocket()
        second = _FakeWebSocket()
        manager.active_connections = [first, second]
        manager.connection_clients = {first: "same", second: "same"}
        manager.connection_user_ids = {first: 11, second: 22}

        await manager.broadcast_queue_status()

        self.assertEqual(first.messages, [{"type": "queue_status", "total": 3, "position": 1}])
        self.assertEqual(second.messages, [{"type": "queue_status", "total": 3, "position": 2}])


class MediaPreviewSingleFlightTests(unittest.IsolatedAsyncioTestCase):
    async def test_concurrent_preview_builds_share_one_worker(self):
        main.MEDIA_PREVIEW_INFLIGHT.clear()
        calls = 0

        def builder():
            nonlocal calls
            calls += 1
            time.sleep(0.05)
            return "preview.webp", "image/webp"

        results = await asyncio.gather(
            main.build_media_preview_once("same-key", builder),
            main.build_media_preview_once("same-key", builder),
            main.build_media_preview_once("same-key", builder),
        )

        self.assertEqual(calls, 1)
        self.assertEqual(results, [("preview.webp", "image/webp")] * 3)
        self.assertNotIn("same-key", main.MEDIA_PREVIEW_INFLIGHT)


class StaticDeliveryContractTests(unittest.TestCase):
    def test_nginx_direct_static_gzip_and_stream_exceptions(self):
        config = Path("ops/nginx/lingdraw.example.conf").read_text(encoding="utf-8")
        self.assertIn("root /srv/linghui/app;", config)
        self.assertIn("location ^~ /static/", config)
        self.assertIn("try_files $uri =404;", config)
        self.assertIn("gzip_comp_level 6;", config)
        self.assertIn("application/javascript", config)
        self.assertIn("application/json", config)
        self.assertIn("image/svg+xml", config)
        self.assertIn("location = /api/chat/stream", config)
        self.assertIn("location ~ ^/api/agent/runs/[^/]+/events$", config)
        self.assertIn("location = /api/download-output", config)
        ordinary = config[config.rindex("    location / {"):]
        self.assertIn("proxy_buffering on;", ordinary)
        self.assertNotIn("proxy_set_header Upgrade", ordinary)

    def test_tailwind_is_fixed_and_iframes_remain_lazy(self):
        pages = [
            "angle.html", "api-settings.html", "canvas-list.html", "canvas.html",
            "comfyui-settings.html", "enhance.html", "gpt-chat.html", "index.html",
            "klein.html", "online.html", "zimage.html",
        ]
        for page in pages:
            source = Path("static", page).read_text(encoding="utf-8")
            self.assertIn('href="https://cdn.tailwindcss.com" crossorigin', source)
            self.assertIn('src="https://cdn.tailwindcss.com/3.4.17"', source)
            self.assertNotIn("tailwindcss-cdn.js", source)
        index = Path("static/index.html").read_text(encoding="utf-8")
        self.assertEqual(index.count('data-src="/static/'), 11)
        self.assertEqual(index.count('loading="lazy"></iframe>'), 12)

    def test_canvas_feature_chunks_are_not_eager(self):
        canvas_html = Path("static/canvas.html").read_text(encoding="utf-8")
        smart_html = Path("static/smart-canvas.html").read_text(encoding="utf-8")
        canvas_core = Path("static/js/canvas.js").read_text(encoding="utf-8")
        smart_core = Path("static/js/smart-canvas.js").read_text(encoding="utf-8")
        self.assertNotIn("ltx-director-timeline.js", canvas_html)
        self.assertNotIn("function openImageEditor(", canvas_core)
        self.assertNotIn("function openImageEditor(", smart_core)
        self.assertNotIn("function openVideoEditor(", smart_core)
        self.assertIn("/static/js/features/canvas-image-editor.js", canvas_core)
        self.assertIn("/static/js/features/smart-canvas-image-editor.js", smart_core)
        self.assertIn("/static/js/features/smart-canvas-media-tools.js", smart_core)


if __name__ == "__main__":
    unittest.main()
