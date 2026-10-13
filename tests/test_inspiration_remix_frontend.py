import unittest
from pathlib import Path


class InspirationRemixFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = Path("static/js/inspiration.js").read_text(encoding="utf-8")
        cls.styles = Path("static/css/inspiration.css").read_text(encoding="utf-8")
        cls.page = Path("static/inspiration.html").read_text(encoding="utf-8")
        cls.shell = Path("static/index.html").read_text(encoding="utf-8")

    def test_first_click_is_not_interrupted_by_focus_refresh(self):
        self.assertNotIn("window.addEventListener('focus', loadInspirations)", self.source)
        self.assertIn("if(event.data?.type === 'inspiration-refresh') loadInspirations(true);", self.source)

    def test_remix_button_posts_selected_inspiration(self):
        self.assertIn("remix.type = 'button'", self.source)
        self.assertIn("type:'lingdraw:inspiration-remix'", self.source)
        self.assertIn("inspiration_id:item.id", self.source)

    def test_cards_do_not_render_category_badges(self):
        self.assertNotIn("category.className = 'inspiration-category'", self.source)
        self.assertIn("top.append(author)", self.source)

    def test_inspiration_script_cache_bust_is_current(self):
        version = "2026.08.14.2"
        self.assertIn(f"/static/js/inspiration.js?v={version}", self.page)
        self.assertIn(f"/static/inspiration.html?v={version}", self.shell)

    def test_admin_moderation_control_is_permission_gated(self):
        self.assertIn("state.canModerate=data.can_moderate===true", self.source)
        self.assertIn("if(state.canModerate)", self.source)
        self.assertIn("className='inspiration-delete'", self.source)
        self.assertIn("method:'DELETE'", self.source)
        self.assertIn("原始素材不会被删除", self.source)
        self.assertIn(".inspiration-card-actions.has-delete", self.styles)

    def test_gallery_uses_pagination_thumbnails_and_incremental_layout(self):
        self.assertIn("const PAGE_SIZE = 24", self.source)
        self.assertIn("offset=${state.offset}", self.source)
        self.assertIn("new IntersectionObserver", self.source)
        self.assertIn("image.src=item.thumbnail_url||item.image_url", self.source)
        self.assertIn("image.loading=eager?'eager':'lazy'", self.source)
        self.assertIn("image.fetchPriority=eager?'high':'low'", self.source)
        self.assertIn("image.src=item.image_url", self.source)
        self.assertNotIn("image.addEventListener('load', scheduleGalleryLayout", self.source)
        self.assertIn("document.createDocumentFragment()", self.source)
        self.assertIn("const eagerCount=reset?preferredColumnCount():0", self.source)

    def test_gallery_preserves_full_image_aspect_ratio_without_hover_overlay(self):
        self.assertIn("image.naturalWidth / image.naturalHeight", self.source)
        self.assertIn("scheduleRatioLayout()", self.source)
        self.assertIn("object-fit:contain", self.styles)
        self.assertIn(".inspiration-card.is-active .inspiration-card-hover", self.styles)
        self.assertNotIn(".inspiration-card:hover .inspiration-card-hover", self.styles)
        self.assertIn("card.addEventListener('click'", self.source)

    def test_category_changes_abort_stale_requests(self):
        self.assertIn("activeController?.abort()", self.source)
        self.assertIn("if(generation!==state.generation) return", self.source)


if __name__ == "__main__":
    unittest.main()
