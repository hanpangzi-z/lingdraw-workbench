import re
import unittest
from pathlib import Path


class SidebarLogoFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = Path("static/index.html").read_text(encoding="utf-8")

    def css_block(self, selector):
        match = re.search(rf"{re.escape(selector)}\s*\{{([^}}]+)\}}", self.source)
        self.assertIsNotNone(match, selector)
        return match.group(1)

    def test_logo_keeps_a_fixed_vertical_footprint_on_sidebar_hover(self):
        base = self.css_block(".logo-ring")
        hover = self.css_block(".sidebar:hover .logo-ring,\n        .sidebar.is-pinned .logo-ring")
        self.assertIn("height: 42px", base)
        self.assertIn("margin-bottom: 36px", base)
        self.assertNotIn("height:", hover)
        self.assertNotIn("margin-bottom:", hover)
        self.assertNotIn("height: 68px", self.source)
        self.assertNotIn("height:59px", self.source)

    def test_logo_image_uses_one_stable_horizontal_anchor(self):
        base = self.css_block(".sidebar-brand-logo")
        expanded = self.css_block(".sidebar:hover .sidebar-brand-logo,\n        .sidebar.is-pinned .sidebar-brand-logo")
        self.assertIn("left: 7px", base)
        self.assertIn("transform: translateY(-50%)", base)
        self.assertNotIn("left:", expanded)
        self.assertNotIn("transform:", expanded)

    def test_hover_does_not_translate_the_logo_button(self):
        hover = self.css_block(".logo-ring:hover,\n        .logo-ring:focus-visible")
        self.assertNotIn("transform:", hover)
        collapsing = self.css_block(".sidebar.is-collapsing:hover .sidebar-brand-logo")
        self.assertNotIn("left:", collapsing)
        self.assertNotIn("transform:", collapsing)


if __name__ == "__main__":
    unittest.main()
