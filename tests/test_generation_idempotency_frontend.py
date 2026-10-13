import unittest
from pathlib import Path


class GenerationIdempotencyFrontendTests(unittest.TestCase):
    def test_online_and_angle_keep_stable_request_ids(self):
        online = Path("static/online.html").read_text(encoding="utf-8")
        angle = Path("static/angle.html").read_text(encoding="utf-8")
        self.assertIn("online_generation_request_id", online)
        self.assertIn("request_id:requestId", online)
        self.assertIn("angle_generation_request_id", angle)
        self.assertIn("request_id: requestId", angle)
        self.assertIn("再次生成（并行）", online)
        self.assertIn("再次生成（并行）", angle)

    def test_canvas_requests_have_ids_and_no_two_second_unlock(self):
        canvas = Path("static/js/canvas.js").read_text(encoding="utf-8")
        smart = Path("static/js/smart-canvas.js").read_text(encoding="utf-8")
        self.assertGreaterEqual(canvas.count("payload.request_id = uid('req')"), 2)
        self.assertIn("smartStableGenerationRequestId(runSettings, `image-${index + 1}`) || uid('req')", smart)
        self.assertNotIn("setTimeout(() => { gen.running = false; refreshRunNodes", canvas)
        self.assertNotIn("setTimeout(() => { node.running = false; refreshRunNodes", canvas)

    def test_online_and_angle_use_persistent_tasks_and_safe_json_parsing(self):
        online = Path("static/online.html").read_text(encoding="utf-8")
        angle = Path("static/angle.html").read_text(encoding="utf-8")
        self.assertIn("onlineApiJson('/api/canvas-image-tasks'", online)
        self.assertIn("/api/generation-tasks/by-request/", online)
        self.assertIn("await response.text()", online)
        self.assertNotIn("fetch('/api/online-image'", online)
        self.assertIn("apiJson('/api/canvas-image-tasks'", angle)
        self.assertIn("/api/generation-tasks/by-request/", angle)
        self.assertIn("await response.text()", angle)
        self.assertIn("服务器返回了无法识别的响应", angle)
        self.assertNotIn("fetch('/api/online-image'", angle)

    def test_queue_status_polling_backs_off_after_server_errors(self):
        index = Path("static/index.html").read_text(encoding="utf-8")
        self.assertIn("statusSyncDelay = Math.min(30000", index)
        self.assertIn("contentType.includes('application/json')", index)
        self.assertNotIn("setInterval(syncStatus, 2000)", index)

    def test_smart_cascade_retries_only_request_id_fingerprint_conflicts(self):
        smart = Path("static/js/smart-canvas.js").read_text(encoding="utf-8")
        self.assertIn("async function createSmartApiImageTask(payload, requestId)", smart)
        self.assertIn("if(response.status === 409)", smart)
        self.assertIn("error?.detail?.code === 'request_id_conflict'", smart)
        self.assertIn("submit(smartConflictRetryRequestId(requestId))", smart)
        self.assertIn("createSmartApiImageTask(\n        payload,", smart)


if __name__ == "__main__":
    unittest.main()
