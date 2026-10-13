import unittest
from pathlib import Path


class SmartCanvasImageBrushFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (
            Path("static/js/smart-canvas.js").read_text(encoding="utf-8")
            + "\n"
            + Path("static/js/features/smart-canvas-image-editor.js").read_text(encoding="utf-8")
        )
        start = cls.source.index("async function applyImageBrush(){")
        end = cls.source.index("async function applyImageGridSplit(){", start)
        cls.brush = cls.source[start:end]

    def test_brush_creates_a_new_image_node_and_keeps_source(self):
        self.assertIn("createImageNodeAt(", self.brush)
        self.assertIn("selectedImage = {nodeId:outputNode.id, index:0}", self.brush)
        self.assertNotIn("replaceEditedImage(file)", self.brush)
        self.assertNotIn("node.images[index] =", self.brush)

    def test_brush_output_preserves_exported_dimensions(self):
        self.assertIn("natural_w:canvasEl.width", self.brush)
        self.assertIn("natural_h:canvasEl.height", self.brush)

    def test_brush_edit_is_one_undoable_canvas_action(self):
        self.assertEqual(self.brush.count("pushUndo();"), 1)
        self.assertIn("{select:true, skipUndo:true}", self.brush)


if __name__ == "__main__":
    unittest.main()
