import json
import os
import tempfile
import unittest
from unittest.mock import patch

import main


def load_image_node(filename="input.png"):
    return {"class_type": "LoadImage", "inputs": {"image": filename}}


class WorkflowFieldInferenceTests(unittest.TestCase):
    def test_catalog_infers_single_load_image_field_without_sidecar(self):
        with tempfile.TemporaryDirectory() as tmp:
            custom_dir = os.path.join(tmp, main.CUSTOM_WORKFLOW_FOLDER)
            os.makedirs(custom_dir)
            workflow_path = os.path.join(custom_dir, "upscale.json")
            with open(workflow_path, "w", encoding="utf-8") as f:
                json.dump({"203": load_image_node(), "204": {"class_type": "SaveImage", "inputs": {}}}, f)

            with patch.object(main, "WORKFLOW_DIR", tmp):
                catalog = main.workflow_catalog_payload()
                public_item = main.workflow_public_config("custom/upscale.json")

            self.assertEqual(catalog["workflows"][0]["field_count"], 1)
            field = public_item["config"]["fields"][0]
            self.assertEqual(field["node"], "203")
            self.assertEqual(field["input"], "image")
            self.assertEqual(field["type"], "image")

    def test_multiple_load_image_nodes_are_not_guessed(self):
        fields = main.infer_workflow_input_fields({
            "1": load_image_node("first.png"),
            "2": load_image_node("second.png"),
        })
        self.assertEqual(fields, [])

    def test_saved_fields_take_precedence_over_inference(self):
        with tempfile.TemporaryDirectory() as tmp:
            custom_dir = os.path.join(tmp, main.CUSTOM_WORKFLOW_FOLDER)
            os.makedirs(custom_dir)
            workflow_path = os.path.join(custom_dir, "configured.json")
            config_path = os.path.join(custom_dir, "configured.config.json")
            with open(workflow_path, "w", encoding="utf-8") as f:
                json.dump({"203": load_image_node()}, f)
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump({
                    "title": "人工配置",
                    "fields": [{
                        "id": "manual",
                        "node": "203",
                        "input": "image",
                        "name": "产品图",
                        "type": "image",
                    }],
                }, f, ensure_ascii=False)

            with patch.object(main, "WORKFLOW_DIR", tmp):
                config = main.load_workflow_config("custom/configured.json")

            self.assertEqual(config["title"], "人工配置")
            self.assertEqual(config["fields"][0]["id"], "manual")
            self.assertEqual(config["fields"][0]["name"], "产品图")


if __name__ == "__main__":
    unittest.main()
