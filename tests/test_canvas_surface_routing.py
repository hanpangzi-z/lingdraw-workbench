import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

import main
from agent_service.api import transient_workbench_error
from agent_service.workbench_analysis import WorkbenchReviewRequest, review_user_message


class CanvasSurfaceRoutingTests(unittest.TestCase):
    def test_classic_canvas_stays_in_infinite_canvas(self):
        canvas = {"kind": "classic", "nodes": [{"id": "node-1"}]}
        self.assertEqual(main.canvas_surfaces(canvas), ["infinite_canvas"])

    def test_legacy_smart_nodes_remain_openable_in_infinite_canvas(self):
        canvas = {"kind": "smart", "nodes": [{"id": "legacy-node"}]}
        self.assertEqual(main.canvas_surfaces(canvas), ["infinite_canvas"])

    def test_empty_legacy_smart_canvas_remains_in_infinite_canvas(self):
        canvas = {"kind": "smart", "nodes": []}
        self.assertEqual(main.canvas_surfaces(canvas), ["infinite_canvas"])

    def test_design_document_is_isolated_to_design_agent(self):
        canvas = {
            "kind": "smart",
            "nodes": [],
            "document": main.empty_smart_canvas_document(),
        }
        self.assertEqual(main.canvas_surfaces(canvas), ["design_agent"])

    def test_mixed_legacy_and_design_data_is_available_on_both_surfaces(self):
        canvas = {
            "kind": "smart",
            "nodes": [{"id": "legacy-node"}],
            "document": main.empty_smart_canvas_document(),
        }
        self.assertEqual(
            main.canvas_surfaces(canvas),
            ["infinite_canvas", "design_agent"],
        )

    def test_api_payload_does_not_mutate_stored_canvas(self):
        canvas = {"kind": "classic", "nodes": []}
        payload = main.canvas_api_payload(canvas)
        self.assertNotIn("surfaces", canvas)
        self.assertEqual(payload["surfaces"], ["infinite_canvas"])

    def test_smart_canvas_created_from_infinite_canvas_has_no_design_document(self):
        with patch.object(main, "save_canvas"):
            canvas = main.new_canvas(kind="smart", surface="infinite_canvas")
        self.assertNotIn("document", canvas)
        self.assertEqual(main.canvas_surfaces(canvas), ["infinite_canvas"])

    def test_smart_canvas_created_from_design_agent_has_design_document(self):
        with patch.object(main, "save_canvas"):
            canvas = main.new_canvas(kind="smart", surface="design_agent")
        self.assertIn("document", canvas)
        self.assertEqual(main.canvas_surfaces(canvas), ["design_agent"])

    def test_infinite_canvas_routes_classic_and_smart_to_distinct_editors(self):
        source = Path("static/js/canvas-list.js").read_text(encoding="utf-8")
        self.assertIn("/static/canvas.html?id=", source)
        self.assertIn("/static/smart-canvas.html?id=", source)

    def test_canvas_editor_redirects_design_documents_to_design_agent(self):
        source = Path("static/js/canvas.js").read_text(encoding="utf-8")
        self.assertIn("if(isInfiniteCanvasRecord(canvas)) openSmartCanvasPage", source)
        self.assertIn("else openDesignAgentPage", source)

    def test_smart_node_canvas_embeds_only_the_scoped_agent_chat(self):
        html = Path("static/smart-canvas.html").read_text(encoding="utf-8")
        design_html = Path("design-agent-ui/index.html").read_text(encoding="utf-8")
        agent_source = Path("static/js/smart-canvas-agent.js").read_text(
            encoding="utf-8"
        )
        self.assertIn('id="smartAgentPanel"', html)
        self.assertIn("/static/js/agent-workbench-core.js", html)
        self.assertIn("/static/js/agent-workbench-core.js", design_html)
        self.assertIn("/static/js/smart-canvas-agent.js", html)
        self.assertNotIn("design-agent-app/index.html", html)
        self.assertIn("surface:'design_agent'", agent_source)
        self.assertIn("context_id:state.canvasId", agent_source)
        self.assertIn("/api/agent/workbench/plan", agent_source)
        self.assertIn("/api/agent/workbench/review", agent_source)
        self.assertIn("/agent-session", agent_source)
        self.assertNotIn("/document", agent_source)

    def test_smart_agent_routes_every_panel_turn_before_generation(self):
        source = Path("static/js/smart-canvas-agent.js").read_text(encoding="utf-8")
        self.assertIn("async function processAttempt", source)
        self.assertIn("/api/agent/workbench/plan", source)
        self.assertIn("decision.route === 'clarify'", source)
        self.assertIn("await executeGeneration(turn, attempt, decision, route)", source)
        self.assertIn("prior_turns:core.summarizePriorTurns", source)

    def test_smart_agent_persistence_stops_for_deleted_or_logged_out_canvas(self):
        source = Path("static/js/smart-canvas-agent.js").read_text(encoding="utf-8")
        self.assertIn("setTimeout(saveSession, 800)", source)
        self.assertIn("error.status === 401", source)
        self.assertIn("error.status === 404", source)
        self.assertIn("state.saveStopped = 'auth'", source)
        self.assertIn("state.saveStopped = 'missing'", source)
        self.assertIn("core.mergeSessions", source)

    def test_smart_agent_save_response_cannot_replace_newer_in_memory_progress(self):
        source = Path("static/js/smart-canvas-agent.js").read_text(encoding="utf-8")
        self.assertIn(
            "state.session = core.mergeSessions(result.agent_session, state.session, canvasId)",
            source,
        )

    def test_new_smart_agent_conversation_hides_previous_thread_turns(self):
        source = Path("static/js/smart-canvas-agent.js").read_text(encoding="utf-8")
        self.assertIn("state.session.composer.thread_start_sequence = state.session.next_sequence", source)
        self.assertIn("turn.sequence || 0) >= firstSequence", source)
        self.assertNotIn(
            "state.session = core.normalizeSession(result.agent_session, canvasId)",
            source,
        )

    def test_agent_images_require_explicit_add_to_node_canvas(self):
        source = Path("static/js/smart-canvas-agent.js").read_text(encoding="utf-8")
        canvas_source = Path("static/js/smart-canvas.js").read_text(encoding="utf-8")
        self.assertIn("data-agent-add-image", source)
        self.assertIn("window.addSmartCanvasAgentImage", source)
        self.assertIn("window.addSmartCanvasAgentImage = payload =>", canvas_source)
        self.assertIn("source:'design-agent'", canvas_source)
        self.assertIn("agentLineage", canvas_source)
        self.assertIn("addConnection(anchor.id, node.id, 'agent-result')", canvas_source)
        self.assertIn("result.added_node_id = nodeId", source)
        self.assertIn("Boolean(result.added_node_id)", source)

    def test_shared_agent_core_supports_both_agent_run_schemas(self):
        source = Path("static/js/agent-workbench-core.js").read_text(encoding="utf-8")
        design_source = Path("design-agent-ui/src/App.tsx").read_text(encoding="utf-8")
        self.assertIn("run.route || run.executionRoute", source)
        self.assertIn("run.clarification_answers || run.clarificationAnswers", source)
        self.assertIn("run.result || (run.imageUrl", source)
        self.assertIn("message?.type !== 'error'", source)
        self.assertIn("sharedAgentWorkbench", design_source)
        self.assertIn("shared.mergeSessions", design_source)
        self.assertIn("shared.summarizePriorTurns", design_source)


class WorkbenchTransientErrorTests(unittest.TestCase):
    def test_review_accepts_partial_plan_context_from_direct_route(self):
        payload = WorkbenchReviewRequest(
            request_id="review-partial-plan-1",
            message="生成一张中秋海报",
            image_url="/assets/output/result.png",
            plan={"title": "中秋海报", "route": "direct_generate"},
        )
        self.assertEqual(payload.plan["route"], "direct_generate")
        self.assertIn('"approved_plan": {', review_user_message(payload))

    def test_upstream_request_failure_uses_existing_bounded_retry(self):
        error = HTTPException(
            status_code=502,
            detail="请求上游接口失败：Server disconnected without sending a response.",
        )
        self.assertTrue(transient_workbench_error(error))

    def test_validation_error_is_not_retried(self):
        error = HTTPException(status_code=502, detail="模型返回的结构不完整")
        self.assertFalse(transient_workbench_error(error))


if __name__ == "__main__":
    unittest.main()
