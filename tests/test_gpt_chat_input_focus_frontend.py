import unittest
from pathlib import Path


class GptChatInputFocusFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = Path("static/gpt-chat.html").read_text(encoding="utf-8")

    def test_message_input_suppresses_global_blue_focus_outline(self):
        self.assertIn("#messageInput:focus-visible", self.source)
        self.assertIn("outline:none !important;", self.source)
        self.assertIn("outline-offset:0 !important;", self.source)
        self.assertIn("border-color:transparent !important;", self.source)
        self.assertIn("box-shadow:none !important;", self.source)

    def test_override_is_loaded_after_global_brand_styles(self):
        brand_index = self.source.index('href="/static/css/brand-vi.css')
        override_index = self.source.index("#messageInput:focus-visible")
        self.assertGreater(override_index, brand_index)


if __name__ == "__main__":
    unittest.main()
