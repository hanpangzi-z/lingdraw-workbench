import unittest
from pathlib import Path


class SmartCanvasNodeDeleteFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = Path("static/js/smart-canvas.js").read_text(encoding="utf-8")
        cls.styles = Path("static/css/smart-canvas.css").read_text(encoding="utf-8")

    def test_non_empty_nodes_render_only_the_floating_delete_button(self):
        render_start = self.source.index("function render(){")
        render_end = self.source.index("function measureSmartNodeImages", render_start)
        render_source = self.source[render_start:render_end]
        self.assertIn("const deleteBtn = isEmpty && !isGroup ?", render_source)
        self.assertIn("${!isEmpty && !isGroup ? `<div class=\"floating-node-actions\">", render_source)

    def test_delete_is_committed_on_pointerdown_with_click_fallback(self):
        bind_start = self.source.index("function bindNodeEvents(){")
        bind_end = self.source.index("function rectOverlapNode", bind_start)
        bind_source = self.source[bind_start:bind_end]
        self.assertIn("btn.addEventListener('pointerdown'", bind_source)
        self.assertIn("if(e.button !== 0) return;", bind_source)
        self.assertIn("if(nodes.some(node => node.id === id)) deleteNodeFromButton(id);", bind_source)
        self.assertIn("btn.addEventListener('click'", bind_source)
        self.assertIn("let deleteHandledOnPointerDown = false;", bind_source)
        self.assertIn("if(deleteHandledOnPointerDown){", bind_source)

    def test_image_node_delete_clears_media_then_deletes_empty_node(self):
        clear_start = self.source.index("function clearNodeMediaBeforeDelete(id){")
        delete_start = self.source.index("function deleteNodeFromButton(id){")
        delete_end = self.source.index("function disconnectConnection", delete_start)
        clear_source = self.source[clear_start:delete_start]
        delete_source = self.source[delete_start:delete_end]
        self.assertIn("isSmartImageNode(node) || isSmartGroupNode(node)", clear_source)
        self.assertIn("node.images = [];", clear_source)
        self.assertIn("clearSmartNodeBusyState(node);", clear_source)
        self.assertIn("locallyClearedNodeMediaIds.add(id);", clear_source)
        self.assertIn("node._mediaGenerationEpoch = Number(node._mediaGenerationEpoch || 0) + 1;", clear_source)
        self.assertIn("if(clearNodeMediaBeforeDelete(id)) return;", delete_source)
        self.assertIn("deleteNode(id);", delete_source)

    def test_cleared_media_is_not_revived_by_stale_remote_state(self):
        merge_start = self.source.index("function mergeSmartNode(local, remote){")
        merge_end = self.source.index("function mergeSmartNodeLists", merge_start)
        merge_source = self.source[merge_start:merge_end]
        self.assertIn("locallyClearedNodeMediaIds.has(local.id)", merge_source)
        self.assertIn("images:localImages", merge_source)

    def test_clearing_pending_media_prevents_late_task_result_from_reappearing(self):
        resume_start = self.source.index("async function resumeSmartPendingNode")
        resume_end = self.source.index("function resumeSmartPendingTasks", resume_start)
        resume_source = self.source[resume_start:resume_end]
        self.assertIn("const stillPending = current && smartPendingTasks(current).some", resume_source)
        self.assertIn("if(!stillPending) return;", resume_source)

    def test_late_synchronous_result_is_ignored_after_media_clear(self):
        finalize_start = self.source.index("function finalizePendingNode")
        finalize_end = self.source.index("function restoreFromExtraction", finalize_start)
        finalize_source = self.source[finalize_start:finalize_end]
        self.assertIn("if(!smartMediaRunIsCurrent(pendingNode)) return false;", finalize_source)
        self.assertIn("beginSmartMediaRun(pendingNode);", self.source)

    def test_deleted_nodes_are_not_revived_by_stale_remote_state(self):
        merge_start = self.source.index("function mergeSmartNodeLists")
        merge_end = self.source.index("function mergeSmartConnections", merge_start)
        merge_source = self.source[merge_start:merge_end]
        delete_start = self.source.index("function deleteNode(id){")
        delete_end = self.source.index("function deleteNodeFromButton", delete_start)
        delete_source = self.source[delete_start:delete_end]
        self.assertIn("locallyDeletedNodeIds.has(id)", merge_source)
        self.assertIn("locallyDeletedNodeIds.add(nodeId)", delete_source)
        self.assertIn("locallyDeletedNodeIds.delete(node.id)", self.source)

    def test_canvas_saves_are_serialized_and_queue_newer_state(self):
        save_start = self.source.index("function scheduleSave(")
        save_end = self.source.index("function imageMetaFromNode", save_start)
        save_source = self.source[save_start:save_end]
        self.assertIn("if(saveInFlight)", save_source)
        self.assertIn("saveQueued = true;", save_source)
        self.assertIn("saveInFlight = true;", save_source)
        self.assertIn("saveInFlight = false;", save_source)
        self.assertIn("scheduleSave(300);", save_source)

    def test_node_controls_keep_original_hover_behavior(self):
        self.assertIn(".image-node:hover .floating-node-actions { opacity:1; pointer-events:auto; }", self.styles)
        self.assertIn(".image-node:hover .node-resize-handle { opacity:1; }", self.styles)
        self.assertIn(".image-node:hover .node-port", self.styles)
        self.assertIn(".thumb-item:hover .mini-x, .image-wrap:hover .mini-x", self.styles)

    def test_generation_parameter_popovers_require_click(self):
        self.assertIn(".smart-control.pinned .smart-popover { opacity:1; visibility:visible; pointer-events:auto;", self.styles)
        self.assertIn(".size-picker-control.pinned .smart-popover { transform:translate(-50%, 0); }", self.styles)
        self.assertNotIn(".smart-control:hover .smart-popover", self.styles)
        self.assertNotIn(".smart-control:focus-within .smart-popover", self.styles)
        self.assertNotIn(".smart-control.interacting .smart-popover", self.styles)
        self.assertNotIn(".size-picker-control:hover .smart-popover", self.styles)
        self.assertNotIn(".size-picker-control:focus-within .smart-popover", self.styles)


if __name__ == "__main__":
    unittest.main()
