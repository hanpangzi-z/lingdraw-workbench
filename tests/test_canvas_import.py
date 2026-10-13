import json
import tempfile
import unittest
import zipfile
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

import main


class CanvasImportTests(unittest.TestCase):
    def test_json_import_gets_new_identity_and_target_project(self):
        source = {
            "id": "old-id",
            "title": "产品构思",
            "kind": "classic",
            "project": "old-project",
            "deleted_at": 123,
            "nodes": [{"id": "node-1"}],
            "connections": [],
            "viewport": {"x": 10, "y": 20, "scale": 1.2},
        }

        parsed, mapping, import_dir = main.parse_canvas_import_package(
            json.dumps(source).encode("utf-8"),
            "canvas.json",
        )
        imported = main.prepare_imported_canvas(parsed, "target-project", 320, 180, mapping)

        self.assertNotEqual(imported["id"], "old-id")
        self.assertEqual(imported["project"], "target-project")
        self.assertEqual(imported["board_x"], 320)
        self.assertEqual(imported["board_y"], 180)
        self.assertNotIn("deleted_at", imported)
        self.assertEqual(import_dir, "")

    def test_zip_import_restores_packaged_resources(self):
        canvas = {
            "title": "带资源画布",
            "kind": "classic",
            "nodes": [{"id": "node-1", "image": "/assets/original.png"}],
            "connections": [],
        }
        manifest = {
            "resources": [
                {
                    "url": "/assets/original.png",
                    "file": "resources/original.png",
                    "size": 7,
                }
            ]
        }
        package = BytesIO()
        with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("canvas.json", json.dumps(canvas))
            archive.writestr("resources-manifest.json", json.dumps(manifest))
            archive.writestr("resources/original.png", b"pngdata")

        with tempfile.TemporaryDirectory() as temp_dir, patch.object(main, "ASSETS_DIR", temp_dir):
            parsed, mapping, import_dir = main.parse_canvas_import_package(package.getvalue(), "canvas.zip")
            imported = main.prepare_imported_canvas(parsed, "default", resource_mapping=mapping)

            restored_url = imported["nodes"][0]["image"]
            self.assertTrue(restored_url.startswith("/assets/imports/"))
            restored_path = Path(temp_dir) / restored_url.removeprefix("/assets/")
            self.assertEqual(restored_path.read_bytes(), b"pngdata")
            self.assertTrue(Path(import_dir).is_dir())

    def test_rejects_non_canvas_json(self):
        with self.assertRaises(HTTPException) as raised:
            main.parse_canvas_import_package(b'{"hello":"world"}', "not-a-canvas.json")
        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("nodes", str(raised.exception.detail))


if __name__ == "__main__":
    unittest.main()
