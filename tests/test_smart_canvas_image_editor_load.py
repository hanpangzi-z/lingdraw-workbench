import unittest
from pathlib import Path


class SmartCanvasImageEditorLoadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (
            Path("static/js/smart-canvas.js").read_text(encoding="utf-8")
            + "\n"
            + Path("static/js/features/smart-canvas-image-editor.js").read_text(encoding="utf-8")
        )

    def test_toolbar_mode_is_deferred_until_the_image_loads(self):
        toolbar_start = self.source.index("function runSmartNodeToolbarAction")
        toolbar_end = self.source.index("function smartGroupToolbarHtml", toolbar_start)
        toolbar = self.source[toolbar_start:toolbar_end]
        self.assertIn("openImageEditor(nodeId, index, modeMap[action] || 'preview');", toolbar)
        self.assertNotIn("setImageEditMode(modeMap[action]", toolbar)

    def test_editor_applies_the_requested_mode_after_load(self):
        editor_start = self.source.index("function openImageEditor(nodeId, imageIndex=0, initialMode='preview')")
        editor_end = self.source.index("function closeImageEditor", editor_start)
        editor = self.source[editor_start:editor_end]
        self.assertIn("ensureImageEditBaseSize(true);", editor)
        self.assertIn("applyImageEditZoom();", editor)
        self.assertIn("if(!imageEditModeTouched) setImageEditMode(initialMode);", editor)

    def test_unloaded_image_cannot_seed_a_one_pixel_editor(self):
        size_start = self.source.index("function ensureImageEditBaseSize")
        size_end = self.source.index("function syncImageEditOverflow", size_start)
        size = self.source[size_start:size_end]
        self.assertIn("Number(img?.naturalWidth || 0)", size)
        self.assertIn("Number(img?.naturalHeight || 0)", size)
        self.assertNotIn("img.clientWidth", size)
        self.assertNotIn("img.clientHeight", size)


if __name__ == "__main__":
    unittest.main()
