import unittest
from pathlib import Path


class ImageEditWheelZoomGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.javascript = Path("static/js/smart-canvas.js").read_text(encoding="utf-8")

    def test_modal_cancels_default_wheel_behavior(self):
        start = self.javascript.index("imageEditModal.addEventListener('wheel'")
        end = self.javascript.index("lightingModal?.addEventListener('pointerdown'", start)
        handler = self.javascript[start:end]
        self.assertIn("event.preventDefault();", handler)
        self.assertIn("event.stopPropagation();", handler)
        self.assertIn("{passive:false}", handler)

    def test_edit_modes_zoom_only_the_image_work_area(self):
        start = self.javascript.index("document.getElementById('imageEditStage').addEventListener('wheel'")
        end = self.javascript.index("window.addEventListener('resize'", start)
        handler = self.javascript[start:end]
        self.assertIn("if(!cropState) return;", handler)
        self.assertIn("imageEditZoom = Math.max(0.15, Math.min(6.0", handler)
        self.assertIn("applyImageEditZoom(scale);", handler)
        self.assertIn("stage.scrollLeft = contentX * scale - mouseX;", handler)
        self.assertIn("stage.scrollTop = contentY * scale - mouseY;", handler)
        self.assertNotIn("viewport.scale", handler)
        self.assertNotIn("imageEditModal.style", handler)

    def test_preview_mode_keeps_its_existing_media_navigation(self):
        start = self.javascript.index("document.getElementById('imageEditStage').addEventListener('wheel'")
        end = self.javascript.index("window.addEventListener('resize'", start)
        handler = self.javascript[start:end]
        self.assertIn("seekPreviewVideoFrames", handler)
        self.assertIn("applyPreviewTransform();", handler)


if __name__ == "__main__":
    unittest.main()
