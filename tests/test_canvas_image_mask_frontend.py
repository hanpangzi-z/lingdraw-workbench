import unittest
from pathlib import Path


class CanvasImageMaskFrontendTests(unittest.TestCase):
    def assert_blue_mask_preview(self, path):
        source = Path(path).read_text(encoding="utf-8")
        self.assertIn("const MASK_BRUSH_RGB = [37, 99, 235];", source)
        self.assertIn("data[i] = MASK_BRUSH_RGB[0]", source)
        self.assertIn("data[i + 1] = MASK_BRUSH_RGB[1]", source)
        self.assertIn("data[i + 2] = MASK_BRUSH_RGB[2]", source)

    def assert_transparent_painted_mask(self, path):
        source = Path(path).read_text(encoding="utf-8")
        start = source.index("function maskCanvasFromDrawCanvas(src){")
        end = source.index("\n}", start) + 2
        mask_function = source[start:end]
        self.assertIn("out.data[i + 3] = painted ? 0 : 255", mask_function)
        self.assertNotIn("out.data[i + 3] = 255", mask_function)

    def test_classic_canvas_exports_transparent_edit_area(self):
        self.assert_transparent_painted_mask("static/js/features/canvas-image-editor.js")
        self.assert_blue_mask_preview("static/js/features/canvas-image-editor.js")

    def test_smart_canvas_exports_transparent_edit_area(self):
        self.assert_transparent_painted_mask("static/js/features/smart-canvas-image-editor.js")
        self.assert_blue_mask_preview("static/js/features/smart-canvas-image-editor.js")

    def test_mask_editor_hints_describe_blue_preview(self):
        i18n_source = Path("static/js/i18n/canvas.js").read_text(encoding="utf-8")
        self.assertIn('"canvas.maskHint": { zh: "蓝色区域为要编辑的遮罩"', i18n_source)
        self.assertIn('"canvas.maskHint2": { zh: "在要重绘的位置涂蓝', i18n_source)


if __name__ == "__main__":
    unittest.main()
