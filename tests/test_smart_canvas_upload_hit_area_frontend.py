import unittest
from pathlib import Path


class SmartCanvasUploadHitAreaFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = Path("static/js/smart-canvas.js").read_text(encoding="utf-8")
        cls.styles = Path("static/css/smart-canvas.css").read_text(encoding="utf-8")

    def test_empty_upload_node_uses_a_dedicated_button_for_file_picker(self):
        body_start = self.source.index("function nodeBodyHtml(node, layout){")
        body_end = self.source.index("function jimengPendingBodyHtml", body_start)
        body_source = self.source[body_start:body_end]
        self.assertIn('<div class="node-drop">', body_source)
        self.assertIn('class="upload-node-trigger"', body_source)
        self.assertIn('data-upload-action="files"', body_source)
        self.assertNotIn('<div class="node-drop" data-upload-action="files">', body_source)

    def test_file_picker_is_bound_only_to_upload_trigger(self):
        bind_start = self.source.index("function bindNodeEvents(){")
        bind_end = self.source.index("function rectOverlapNode", bind_start)
        bind_source = self.source[bind_start:bind_end]
        self.assertIn("const uploadTrigger = el.querySelector('.upload-node-trigger');", bind_source)
        self.assertIn("uploadTrigger?.addEventListener('click'", bind_source)
        self.assertNotIn("nodeDrop?.addEventListener('click'", bind_source)
        self.assertNotIn("nodeDrop?.addEventListener('mousedown'", bind_source)

    def test_upload_trigger_matches_the_icon_and_title_region(self):
        self.assertIn(".upload-node-trigger { display:flex; flex-direction:column; align-items:center;", self.styles)
        self.assertIn(".upload-node-trigger:focus-visible", self.styles)

    def test_upload_trigger_has_hover_and_pressed_feedback(self):
        self.assertIn(".upload-node-trigger:hover .upload-node-main", self.styles)
        self.assertIn("transform:translateY(-2px) scale(1.045)", self.styles)
        self.assertIn(".upload-node-trigger:hover .upload-node-title", self.styles)
        self.assertIn(".upload-node-trigger:active .upload-node-main", self.styles)


if __name__ == "__main__":
    unittest.main()
