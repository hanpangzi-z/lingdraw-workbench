import unittest
from pathlib import Path


class SmartCanvasQuickCreateFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = Path("static/js/smart-canvas.js").read_text(encoding="utf-8")
        cls.styles = Path("static/css/smart-canvas.css").read_text(encoding="utf-8")

    def test_hover_menu_contains_the_three_requested_node_types(self):
        start = self.source.index("function smartNodeQuickCreateHtml(node){")
        end = self.source.index("function smartNodeToolbarHtml(node){", start)
        quick_create = self.source[start:end]
        self.assertIn("{key:'upload', icon:'upload-cloud', label:'上传'}", quick_create)
        self.assertIn("{key:'prompt', icon:'text-cursor-input', label:'提示词'}", quick_create)
        self.assertIn("{key:'loop', icon:'repeat-2', label:'循环'}", quick_create)

    def test_menu_is_visible_only_after_hovering_a_node_port(self):
        self.assertIn(".image-node.quick-create-port-hover > .node-quick-create", self.styles)
        self.assertNotIn(".image-node:hover > .node-quick-create", self.styles)
        self.assertNotIn(".image-node.quick-create-dragging > .node-quick-create", self.styles)
        self.assertIn("port.addEventListener('mouseenter', () => openQuickCreate(port.dataset.port))", self.source)

    def test_menu_has_no_nested_plus_trigger(self):
        start = self.source.index("function smartNodeQuickCreateHtml(node){")
        end = self.source.index("function smartNodeToolbarHtml(node){", start)
        quick_create = self.source[start:end]
        self.assertNotIn("node-quick-create-trigger", quick_create)
        self.assertNotIn("data-node-quick-toggle", quick_create)
        self.assertNotIn('data-lucide="plus"', quick_create)

    def test_quick_create_adds_and_connects_an_adjacent_node(self):
        start = self.source.index("function createAdjacentNodeFromQuickMenu(sourceId, type){")
        end = self.source.index("function bindNodeEvents(){", start)
        create_adjacent = self.source[start:end]
        self.assertIn("if(portType === 'in') connectInputNode(created.id, source.id)", create_adjacent)
        self.assertIn("else connectInputNode(source.id, created.id)", create_adjacent)
        self.assertNotIn("pickMediaForSmartNode(created.id)", create_adjacent)
        self.assertIn("createPromptNode(x, y", create_adjacent)
        self.assertIn("createLoopNode(x, y", create_adjacent)


if __name__ == "__main__":
    unittest.main()
