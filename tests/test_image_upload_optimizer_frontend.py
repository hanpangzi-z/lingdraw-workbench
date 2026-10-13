import unittest
from pathlib import Path


class ImageUploadOptimizerFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gpt = Path("static/gpt-chat.html").read_text(encoding="utf-8")
        cls.canvas_html = Path("static/canvas.html").read_text(encoding="utf-8")
        cls.canvas = (
            Path("static/js/canvas.js").read_text(encoding="utf-8")
            + "\n"
            + Path("static/js/features/canvas-image-editor.js").read_text(encoding="utf-8")
        )
        cls.smart_html = Path("static/smart-canvas.html").read_text(encoding="utf-8")
        cls.smart = (
            Path("static/js/smart-canvas.js").read_text(encoding="utf-8")
            + "\n"
            + Path("static/js/features/smart-canvas-image-editor.js").read_text(encoding="utf-8")
        )
        cls.smart_agent = Path("static/js/smart-canvas-agent.js").read_text(encoding="utf-8")
        cls.asset_html = Path("static/asset-manager.html").read_text(encoding="utf-8")
        cls.asset = Path("static/js/asset-manager.js").read_text(encoding="utf-8")
        cls.design_html = Path("design-agent-ui/index.html").read_text(encoding="utf-8")
        cls.design = Path("design-agent-ui/src/App.tsx").read_text(encoding="utf-8")

    def test_all_user_upload_surfaces_load_the_shared_optimizer(self):
        script = "/static/js/image-upload-optimizer.js?v=2026.08.14.1"
        for page in (self.gpt, self.canvas_html, self.smart_html, self.asset_html, self.design_html):
            self.assertIn(script, page)

    def test_user_selected_uploads_are_optimized(self):
        self.assertIn("window.LingDrawImageUpload.optimizeFiles(selected)", self.gpt)
        self.assertIn("window.LingDrawImageUpload.optimizeFiles(supported)", self.canvas)
        self.assertIn("window.LingDrawImageUpload.optimizeFiles(supported)", self.smart)
        self.assertIn("window.LingDrawImageUpload.optimizeFiles(images)", self.smart_agent)
        self.assertIn("window.LingDrawImageUpload.optimizeFiles(list)", self.asset)
        self.assertIn("optimizeUserUploadFiles(Array.from(files))", self.design)
        self.assertIn("optimizeUserUploadFiles(selectedFiles)", self.design)

    def test_exact_internal_edit_blobs_are_not_recompressed(self):
        canvas_crop = self.canvas[self.canvas.index("async function uploadCroppedBlob"):self.canvas.index("async function applyImageCrop")]
        smart_crop = self.smart[self.smart.index("async function uploadCroppedBlob"):self.smart.index("function replaceEditedImage")]
        self.assertNotIn("LingDrawImageUpload", canvas_crop)
        self.assertNotIn("LingDrawImageUpload", smart_crop)


if __name__ == "__main__":
    unittest.main()
