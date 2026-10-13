import unittest
from copy import deepcopy
from pathlib import Path

from agent_service.canvas_bridge import (
    append_canvas_bundle,
    append_canvas_pending_placements,
    build_canvas_bundle,
    empty_smart_canvas_document,
    ensure_smart_canvas_document,
    find_blank_origin,
)
from agent_service.domain import PlanStepSpec, QualityResult, RunPlan
from agent_service.service import AgentService


class QualityGateTests(unittest.TestCase):
    def test_quality_gate_requires_no_hard_issue_and_thresholds(self):
        passed = QualityResult.normalize({
            "hard_issues": [],
            "scores": {"brand": 80, "product_fidelity": 75, "clarity": 90},
            "overall_score": 82,
        })
        self.assertTrue(passed.passed)

        self.assertFalse(QualityResult.normalize({
            "hard_issues": ["logo is distorted"],
            "scores": {"brand": 90, "product_fidelity": 90, "clarity": 90},
            "overall_score": 95,
        }).passed)

    def test_plan_requires_roles_unique_ids_and_an_acyclic_graph(self):
        valid = RunPlan(objective="Launch", steps=[
            PlanStepSpec(id="art", role="Art Director", title="Art", instruction="Generate"),
            PlanStepSpec(id="fidelity", role="Product Fidelity", title="Check", instruction="Check", depends_on=["art"]),
            PlanStepSpec(id="critic", role="Quality Critic", title="Review", instruction="Review", depends_on=["fidelity"]),
        ])
        self.assertTrue(AgentService._valid_plan(valid))
        cyclic = RunPlan(objective="Launch", steps=[
            PlanStepSpec(id="art", role="Art Director", title="Art", instruction="Generate", depends_on=["critic"]),
            PlanStepSpec(id="fidelity", role="Product Fidelity", title="Check", instruction="Check", depends_on=["art"]),
            PlanStepSpec(id="critic", role="Quality Critic", title="Review", instruction="Review", depends_on=["fidelity"]),
        ])
        self.assertFalse(AgentService._valid_plan(cyclic))
        self.assertFalse(QualityResult.normalize({
            "hard_issues": [],
            "scores": {"brand": 69, "product_fidelity": 90, "clarity": 90},
            "overall_score": 90,
        }).passed)


class CanvasBridgeTests(unittest.TestCase):
    def test_empty_fabric_document_includes_recoverable_agent_session(self):
        document = empty_smart_canvas_document()
        self.assertEqual(document["schema_version"], 2)
        self.assertEqual(document["engine"], "fabric")
        self.assertEqual(document["agent_session"]["schema_version"], 1)
        self.assertEqual(document["agent_session"]["messages"], [])
        self.assertIsNone(document["agent_session"]["run"])
        self.assertEqual(document["agent_session"]["composer"]["mode"], "agent")

    def test_legacy_tldraw_document_is_preserved_for_frontend_migration(self):
        legacy_document = {
            "schema_version": 1,
            "engine": "tldraw",
            "snapshot": {"store": {"shape:legacy": {"typeName": "shape", "type": "text"}}},
            "pending_placements": [],
            "applied_placement_ids": [],
        }
        canvas = {"kind": "smart", "document": deepcopy(legacy_document)}

        document = ensure_smart_canvas_document(canvas)

        self.assertEqual(document["engine"], "tldraw")
        self.assertEqual(document["schema_version"], 1)
        self.assertEqual(document["snapshot"], legacy_document["snapshot"])
        self.assertIn("agent_session", document)

    def test_pending_placements_are_idempotent_and_keep_legacy_nodes(self):
        canvas = {
            "kind": "smart",
            "nodes": [{"id": "legacy", "type": "smart-text", "text": "keep"}],
            "connections": [{"from": "legacy", "to": "legacy"}],
            "document": empty_smart_canvas_document(),
        }
        run = {"id": "run_1"}
        assets = [{
            "id": "asset_1", "step_id": "step_1", "url": "/assets/result.png",
            "name": "Result", "media_type": "image", "model": "image-model",
            "params_json": {"prompt": "blue product poster"},
        }]

        first = append_canvas_pending_placements(canvas, run, assets, {"objective": "fallback"})
        second = append_canvas_pending_placements(canvas, run, assets, {"objective": "fallback"})

        self.assertEqual(first["placement_ids"], ["agent:run_1:asset_1"])
        self.assertEqual(second["placement_ids"], [])
        self.assertEqual(canvas["nodes"][0]["id"], "legacy")
        self.assertEqual(canvas["connections"][0]["from"], "legacy")
        placement = canvas["document"]["pending_placements"][0]
        self.assertEqual(placement["prompt"], "blue product poster")
        self.assertEqual(placement["generated_asset_id"], "asset_1")

    def test_bundle_is_placed_after_existing_nodes_and_keeps_traceability(self):
        existing = [{"id": "old", "x": 100, "y": 60, "w": 500, "h": 200}]
        self.assertEqual(find_blank_origin(existing), (760.0, 80.0))
        asset = {
            "id": "asset_1",
            "step_id": "step_art",
            "url": "/output/result.png",
            "name": "Result",
            "media_type": "image",
        }
        bundle = build_canvas_bundle(
            {"id": "run_1"}, [asset], {"objective": "Launch visual"}, existing
        )
        self.assertEqual(len(bundle["nodes"]), 3)
        self.assertEqual(len(bundle["connections"]), 2)
        image_node = bundle["nodes"][2]
        self.assertEqual(image_node["agentRunId"], "run_1")
        self.assertEqual(image_node["agentStepId"], "step_art")
        self.assertEqual(image_node["generatedAssetId"], "asset_1")
        self.assertEqual(image_node["images"][0]["url"], "/output/result.png")
        self.assertNotIn("old", {node["id"] for node in bundle["nodes"]})

        extension = build_canvas_bundle(
            {"id": "run_1"}, [{**asset, "id": "asset_2"}], {"objective": "Launch visual"},
            [*existing, *bundle["nodes"]], existing_group_id=bundle["group_id"], anchor_node_id=image_node["id"],
        )
        self.assertEqual(len(extension["nodes"]), 1)
        self.assertEqual(extension["connections"][0]["from"], image_node["id"])
        self.assertEqual(extension["nodes"][0]["generatedAssetId"], "asset_2")

    def test_append_preserves_existing_nodes_and_is_idempotent(self):
        old_node = {"id": "old", "type": "smart-text", "x": 10, "y": 20, "text": "keep me"}
        old_connection = {"from": "old-a", "to": "old-b", "kind": "flow"}
        canvas = {"nodes": [old_node], "connections": [old_connection]}
        first_asset = {
            "id": "asset_1", "step_id": "step_art", "url": "/output/one.png",
            "name": "One", "media_type": "image",
        }
        first = append_canvas_bundle(canvas, {"id": "run_1"}, [first_asset], {"objective": "Launch"})
        self.assertEqual(first["appended_asset_ids"], ["asset_1"])
        self.assertIs(canvas["nodes"][0], old_node)
        self.assertIs(canvas["connections"][0], old_connection)
        group = next(node for node in canvas["nodes"] if node.get("type") == "smart-group")
        image = next(node for node in canvas["nodes"] if node.get("generatedAssetId") == "asset_1")
        self.assertIn(image["id"], group["items"])

        after_first = deepcopy(canvas)
        duplicate = append_canvas_bundle(canvas, {"id": "run_1"}, [first_asset], {"objective": "Launch"})
        self.assertEqual(duplicate["appended_asset_ids"], [])
        self.assertEqual(canvas, after_first)

        second = append_canvas_bundle(canvas, {"id": "run_1"}, [
            {**first_asset, "id": "asset_2", "url": "/output/two.png", "name": "Two"}
        ], {"objective": "Launch"})
        self.assertEqual(second["group_id"], first["group_id"])
        self.assertEqual(second["appended_asset_ids"], ["asset_2"])
        self.assertEqual(canvas["nodes"][0], old_node)
        self.assertEqual(
            {node.get("generatedAssetId") for node in canvas["nodes"] if node.get("generatedAssetId")},
            {"asset_1", "asset_2"},
        )

    def test_parent_shell_contract_contains_safe_design_agent_bridge(self):
        root = Path(__file__).resolve().parent.parent
        html = (root / "static" / "index.html").read_text(encoding="utf-8")
        translations = (root / "static" / "js" / "i18n" / "common.js").read_text(encoding="utf-8")
        self.assertIn("switchUI(this, 'design-agent')", html)
        self.assertIn('id="frame-design-agent"', html)
        self.assertIn('/static/design-agent-app/index.html?v=2026.08.14.5', html)
        self.assertIn("/static/design-agent-app/index.html", html)
        self.assertIn("event.origin !== window.location.origin", html)
        self.assertIn("event.source !== agentFrame.contentWindow", html)
        self.assertIn("lingdraw:open-smart-canvas", html)
        self.assertIn('"nav.designAgent"', translations)
        self.assertNotIn("switchUI(this, 'online')", html)
        self.assertNotIn('id="frame-online"', html)
        self.assertNotIn("/static/online.html", html)
        self.assertNotIn('"nav.online"', translations)
        self.assertLess(
            html.index("switchUI(this, 'design-agent')"),
            html.index("switchUI(this, 'gpt-chat')"),
        )


if __name__ == "__main__":
    unittest.main()
