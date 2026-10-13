import unittest

import main


class ComfyOutputFilteringTests(unittest.TestCase):
    def test_easy_image_size_metadata_is_not_a_deliverable(self):
        self.assertTrue(main.comfy_class_is_debug_text("easy imageSize"))
        self.assertTrue(main.comfy_output_is_auxiliary("easy imageSize", "text"))

    def test_explicit_saved_text_is_preserved(self):
        for class_type in ("SaveText", "Save Text File", "SaveJSON"):
            with self.subTest(class_type=class_type):
                self.assertFalse(main.comfy_output_is_auxiliary(class_type, "text"))

    def test_preview_image_is_only_suppressed_when_a_primary_image_exists(self):
        self.assertFalse(main.comfy_output_is_auxiliary("PreviewImage", "image", False))
        self.assertTrue(main.comfy_output_is_auxiliary("PreviewImage", "image", True))
        self.assertFalse(main.comfy_output_is_auxiliary("SaveImage", "image", True))

    def test_legacy_canvas_cleanup_uses_history_provenance(self):
        debug_url = "/assets/output/debug.txt"
        saved_text_url = "/assets/output/saved.txt"
        canvas = {
            "nodes": [{
                "type": "output",
                "images": [
                    {"url": "/assets/output/result.png", "kind": "image"},
                    {"url": debug_url, "kind": "text"},
                    {"url": saved_text_url, "kind": "text"},
                ],
            }],
            "logs": [{"outputs": [debug_url, saved_text_url]}],
        }

        removed = main.prune_comfy_auxiliary_urls_from_canvas(canvas, {debug_url})

        self.assertEqual(removed, 2)
        self.assertEqual(
            [item["url"] for item in canvas["nodes"][0]["images"]],
            ["/assets/output/result.png", saved_text_url],
        )
        self.assertEqual(canvas["logs"][0]["outputs"], [saved_text_url])


if __name__ == "__main__":
    unittest.main()
