import unittest
from pathlib import Path


class PptShellFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parent.parent
        cls.html = (root / "static" / "index.html").read_text(encoding="utf-8")
        cls.i18n_loader = (root / "static" / "js" / "i18n.js").read_text(encoding="utf-8")
        cls.translations = (root / "static" / "js" / "i18n" / "common.js").read_text(encoding="utf-8")

    def test_ppt_navigation_is_between_canvas_and_angle(self):
        canvas = self.html.index("switchUI(this, 'canvas')")
        ppt = self.html.index("switchUI(this, 'ppt')")
        angle = self.html.index("switchUI(this, 'angle')")

        self.assertLess(canvas, ppt)
        self.assertLess(ppt, angle)
        self.assertIn('data-i18n="nav.ppt"', self.html)

    def test_ppt_frame_is_lazy_and_registered_for_page_restore(self):
        self.assertIn(
            'id="frame-ppt" data-src="/ppt/projects" title="PPT工作台" data-i18n-title="nav.ppt" scrolling="yes" loading="lazy"',
            self.html,
        )
        self.assertIn("'canvas','ppt','asset-manager'", self.html)
        self.assertIn("localStorage.setItem(ACTIVE_PAGE_KEY, id)", self.html)
        self.assertIn("type:'studio-activate'", self.html)

    def test_ppt_frame_prewarms_only_after_platform_authentication(self):
        auth_success = self.html.index("if(!response.ok || !status.authenticated)")
        schedule_call = self.html.index("schedulePptPrewarm();")
        self.assertGreater(schedule_call, auth_success)
        self.assertIn("if(!frame || frame.getAttribute('src') || !frame.dataset.src) return", self.html)
        self.assertIn("frame.loading = 'eager'", self.html)
        self.assertIn("requestIdleCallback(prewarmPptFrame", self.html)

    def test_auth_required_message_is_bound_to_the_ppt_frame(self):
        self.assertIn("event.origin !== window.location.origin", self.html)
        self.assertIn("event.data?.type === 'ppt:auth-required'", self.html)
        self.assertIn("event.source !== pptFrame.contentWindow", self.html)
        self.assertIn("window.location.replace('/login')", self.html)

    def test_lazy_frame_receives_the_existing_shell_sync_contract(self):
        self.assertIn("{ type: 'studio-theme', theme }", self.html)
        self.assertIn("{ type: 'studio-ui-scale', mode, scale }", self.html)
        self.assertIn("{ type:'studio-lang', lang:window.StudioI18n.lang() }", self.html)
        self.assertIn("document.querySelectorAll('iframe').forEach(f =>", self.html)
        self.assertIn("f.addEventListener('load', () =>", self.html)

    def test_ppt_ready_replays_sync_after_the_react_bridge_mounts(self):
        self.assertIn("event.data?.type === 'ppt:ready'", self.html)
        ready = self.html.index("event.data?.type === 'ppt:ready'")
        auth = self.html.index("event.data?.type === 'ppt:auth-required'")
        handler = self.html[ready:auth]
        self.assertIn("event.source !== pptFrame.contentWindow", handler)
        self.assertIn("syncThemeToFrame(pptFrame)", handler)
        self.assertIn("syncLanguageToFrame(pptFrame)", handler)
        self.assertIn("syncScaleToFrame(pptFrame)", handler)
        self.assertIn("type:'studio-activate'", handler)
        self.assertIn("window.location.origin", handler)

    def test_ppt_label_is_translated_in_both_languages(self):
        self.assertIn('"nav.ppt": { zh: "PPT工作台", en: "PPT Workspace" }', self.translations)
        self.assertRegex(self.html, r'/static/js/i18n\.js\?v=[^"\s]+')
        self.assertRegex(self.i18n_loader, r"const VERSION = '\d{4}\.\d{2}\.\d{2}\.\d+';")


if __name__ == "__main__":
    unittest.main()
