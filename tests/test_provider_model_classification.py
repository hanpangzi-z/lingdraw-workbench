import unittest

import main


class ProviderModelClassificationTests(unittest.TestCase):
    def test_seedance_2_is_classified_as_video(self):
        self.assertEqual(main.classify_upstream_model("seedance2.0"), "video")

    def test_provider_model_order_is_preserved_for_default_selection(self):
        provider = main.normalize_provider({
            "id": "ordered-api",
            "name": "Ordered API",
            "base_url": "https://example.com/v1",
            "image_models": ["preferred-image", "fallback-image", "preferred-image"],
            "chat_models": ["preferred-chat", "fallback-chat"],
            "video_models": [],
        })
        self.assertEqual(provider["image_models"], ["preferred-image", "fallback-image"])
        self.assertEqual(provider["chat_models"], ["preferred-chat", "fallback-chat"])


if __name__ == "__main__":
    unittest.main()
