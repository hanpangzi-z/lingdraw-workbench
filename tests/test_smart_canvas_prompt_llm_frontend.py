import unittest
from pathlib import Path


class SmartCanvasPromptLlmFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = Path("static/js/smart-canvas.js").read_text(encoding="utf-8")
        cls.styles = Path("static/css/smart-canvas.css").read_text(encoding="utf-8")
        start = cls.source.index("function cancelPromptLLMNode(nodeId){")
        end = cls.source.index("function comfyFieldKind(field){", start)
        cls.prompt_run = cls.source[start:end]

    def test_prompt_llm_uses_a_three_minute_cancel_delay(self):
        self.assertIn("const PROMPT_LLM_CANCEL_DELAY_MS = 180000", self.source)
        self.assertIn("controller:new AbortController()", self.prompt_run)
        self.assertIn("signal:runState.controller.signal", self.prompt_run)
        self.assertIn("runState.controller.abort()", self.prompt_run)

    def test_running_button_unlocks_cancel_after_three_minutes(self):
        self.assertIn("{mode:'running', label:tr('common.running')}", self.source)
        self.assertIn("llmRunButton.mode === 'running' ? 'disabled' : ''", self.source)
        self.assertIn("runEl.disabled = mode === 'running'", self.source)
        self.assertIn("cancelAvailable:false", self.prompt_run)
        self.assertIn("runState.cancelAvailable = true", self.prompt_run)
        self.assertIn("syncPromptLLMRunButtonState(nodeId, 'running')", self.prompt_run)
        self.assertIn("syncPromptLLMRunButtonState(nodeId, 'cancel')", self.prompt_run)
        self.assertIn(".prompt-node-run.is-cancel", self.styles)

    def test_all_terminal_paths_restore_and_save_node_state(self):
        self.assertIn("if(runState.cancelledByUser)", self.prompt_run)
        self.assertIn("else if(e?.name === 'AbortError')", self.prompt_run)
        self.assertIn("clearTimeout(runState.cancelTimerId)", self.prompt_run)
        self.assertIn("promptLLMRunControllers.delete(nodeId)", self.prompt_run)
        finally_block = self.prompt_run[self.prompt_run.index("} finally {") :]
        self.assertIn("node.running = false", finally_block)
        self.assertIn("render();", finally_block)
        self.assertIn("scheduleSave();", finally_block)


if __name__ == "__main__":
    unittest.main()
