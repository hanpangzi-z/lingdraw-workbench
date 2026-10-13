import unittest
from pathlib import Path

import main


class CephalonProviderTests(unittest.TestCase):
    def test_event_parser_keeps_final_with_blank_before_data(self):
        payloads = main.cephalon_event_payloads(
            'event: final\n\ndata: {"status":"success","image_urls":["https://example.com/out.png"]}\n'
        )
        self.assertEqual(payloads[-1]["_event"], "final")
        self.assertEqual(payloads[-1]["status"], "success")

    def test_success_payload_is_usable_even_when_event_label_is_lost(self):
        event = {
            "_event": "message",
            "status": "success",
            "image_urls": ["https://example.com/out.png"],
        }
        self.assertEqual(main.extract_image_flexible(event)["value"], "https://example.com/out.png")

    def test_cephalon_object_url_with_image_name_in_query(self):
        url = (
            "https://myelin.cloud/minio/cmcpp/buckets/objects?"
            "prefix=mcp%2Fcomfyui%2F20260819%2Fresult.png&preview=true"
        )
        self.assertEqual(main.extract_image_flexible({"image_urls": [url]})["value"], url)

    def test_default_provider_is_added_to_existing_configuration(self):
        providers = main.merge_default_api_providers([
            {
                "id": "custom",
                "name": "Custom",
                "base_url": "https://example.com/v1",
                "protocol": "openai",
            }
        ], inject_missing=False)

        cephalon = next(item for item in providers if item["id"] == "cephalon")
        self.assertEqual(cephalon["protocol"], "cephalon")
        self.assertEqual(cephalon["image_models"], ["image-upscale"])

    def test_sse_parser_handles_events_keepalive_and_done(self):
        events = main.cephalon_event_payloads(
            ': keepalive\n\n'
            'event: message\n'
            'data: {"status":"running"}\n\n'
            'data: {"result":{"image_url":"https://cdn.example.com/result.png"}}\n\n'
            'data: [DONE]\n\n'
        )

        self.assertEqual(len(events), 2)
        image = main.extract_image_flexible(events[-1])
        self.assertEqual(image["type"], "url")
        self.assertEqual(image["value"], "https://cdn.example.com/result.png")

    def test_final_event_exposes_official_image_urls_field(self):
        events = main.cephalon_event_payloads(
            'event: final\n'
            'data: {"status":"success","image_urls":["https://cdn.example.com/final.png"]}\n\n'
        )

        self.assertEqual(events[0]["_event"], "final")
        image = main.extract_image_flexible(events[0])
        self.assertEqual(image["value"], "https://cdn.example.com/final.png")

    def test_workflow_url_accepts_full_endpoint_or_api_host(self):
        endpoint = "https://prod.unicorn.org.cn/cephalon/user-center/v1/lucy-agent/workflows/run"
        self.assertEqual(main.cephalon_workflow_url({"base_url": endpoint}), endpoint)
        self.assertEqual(
            main.cephalon_workflow_url({"base_url": "https://prod.unicorn.org.cn"}),
            endpoint,
        )

    def test_chat_hides_unsupported_workflow_options_and_forces_one_request(self):
        source = (Path(main.BASE_DIR) / "static" / "gpt-chat.html").read_text(encoding="utf-8")
        self.assertIn("function isCephalonImageProvider", source)
        self.assertIn("resolution.style.display = directWorkflow ? 'none'", source)
        self.assertIn("count.style.display = directWorkflow ? 'none'", source)
        self.assertIn("imageCount:isCephalonImageProvider(activeImageProvider) ? 1 : imageCount", source)


if __name__ == "__main__":
    unittest.main()
