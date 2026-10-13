import unittest
from pathlib import Path


class CanvasImageOutpaintFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (
            Path("static/js/canvas.js").read_text(encoding="utf-8")
            + "\n"
            + Path("static/js/features/canvas-image-editor.js").read_text(encoding="utf-8")
        )
        start = cls.source.index("async function applyImageOutpaint(){")
        end = cls.source.index("async function applyImageMask(){", start)
        cls.outpaint = cls.source[start:end]

    def test_large_outpaint_is_scaled_to_four_k_output(self):
        self.assertIn("function fitWithinFourKStandard(width, height)", self.source)
        self.assertIn("fitWithinFourKStandard(requestedW, requestedH)", self.outpaint)
        self.assertIn("canvasEl.width = outputSize.width", self.outpaint)
        self.assertIn("img.naturalWidth * outputSize.scale", self.outpaint)

    def test_outpaint_creates_a_new_image_node_and_keeps_source(self):
        self.assertIn("addGeneratedImageNode(file, node, 'outpaint'", self.outpaint)
        self.assertIn("sourceId:node.id", self.outpaint)
        self.assertNotIn("node.url = file.url", self.outpaint)
        self.assertNotIn("node.name = file.name", self.outpaint)

    def test_apply_button_has_busy_and_error_feedback(self):
        self.assertIn("applyBtn.disabled = true", self.outpaint)
        self.assertIn("applyBtn.disabled = false", self.outpaint)
        self.assertIn("alert('扩图失败：'", self.outpaint)

    def test_upload_failure_is_not_silent(self):
        start = self.source.index("async function uploadCroppedBlob(blob, name){")
        end = self.source.index("async function uploadImageBlobs(blobs){", start)
        upload = self.source[start:end]
        self.assertIn("if(!response.ok)", upload)
        self.assertIn("if(!file?.url)", upload)

    def test_resolution_label_shows_limited_output_size(self):
        start = self.source.index("function updateOutpaintResolutionLabel(){")
        end = self.source.index("function clampOutpaint(){", start)
        label = self.source[start:end]
        self.assertIn("outputSize.limited", label)
        self.assertIn("outputSize.width", label)
        self.assertIn("outputSize.height", label)


if __name__ == "__main__":
    unittest.main()
