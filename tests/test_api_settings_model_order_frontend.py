import unittest
from pathlib import Path


class ApiSettingsModelOrderFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = Path("static/js/api-settings.js").read_text(encoding="utf-8")
        cls.styles = Path("static/css/api-settings.css").read_text(encoding="utf-8")

    def test_each_model_row_has_accessible_move_controls(self):
        self.assertIn('class="model-order-actions"', self.source)
        self.assertIn("moveModel('${kind}', ${index}, -1)", self.source)
        self.assertIn("moveModel('${kind}', ${index}, 1)", self.source)
        self.assertIn('title="上移" aria-label="上移"', self.source)
        self.assertIn('title="下移" aria-label="下移"', self.source)
        self.assertIn('.model-order-actions', self.styles)

    def test_reordering_swaps_the_persisted_array_and_requires_save(self):
        self.assertIn('function moveModel(kind, index, direction)', self.source)
        self.assertIn('[models[from], models[to]] = [models[to], models[from]]', self.source)
        self.assertIn("item[key] = models", self.source)
        self.assertIn('自动选择会优先使用排在前面的模型', self.source)


if __name__ == "__main__":
    unittest.main()
