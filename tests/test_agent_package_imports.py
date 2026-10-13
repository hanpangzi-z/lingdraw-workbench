import ast
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class AgentPackageImportTests(unittest.TestCase):
    def test_package_init_does_not_import_api(self):
        tree = ast.parse((PROJECT_ROOT / "agent_service" / "__init__.py").read_text(encoding="utf-8"))

        eager_api_imports = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and node.level == 1 and node.module == "api"
        ]

        self.assertEqual(eager_api_imports, [])

    def test_main_imports_agent_api_explicitly(self):
        source = (PROJECT_ROOT / "main.py").read_text(encoding="utf-8")

        self.assertIn("from agent_service.api import router as agent_router", source)


if __name__ == "__main__":
    unittest.main()
