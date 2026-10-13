import re
import unittest
from pathlib import Path


class CanvasCascadeCompletionFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.smart = Path("static/js/smart-canvas.js").read_text(encoding="utf-8")
        cls.canvas = Path("static/js/canvas.js").read_text(encoding="utf-8")
        cls.smart_html = Path("static/smart-canvas.html").read_text(encoding="utf-8")
        cls.canvas_html = Path("static/canvas.html").read_text(encoding="utf-8")
        cls.canvas_list = Path("static/js/canvas-list.js").read_text(encoding="utf-8")
        cls.canvas_list_html = Path("static/canvas-list.html").read_text(encoding="utf-8")
        cls.index_html = Path("static/index.html").read_text(encoding="utf-8")

    def test_smart_cascade_runs_all_sibling_branches_from_common_root(self):
        graph = re.search(
            r"function smartCascadeGraphForTail\(tail\)\{(?P<body>.*?)\n\}",
            self.smart,
            re.S,
        )
        self.assertIsNotNone(graph)
        self.assertNotIn("upstreamIds", graph.group("body"))
        self.assertIn("const targets = downstreamCascadeTargetsFor(node);", graph.group("body"))

    def test_smart_cascade_uses_target_recipe_and_runs_llm_dependencies(self):
        step = re.search(
            r"async function runCascadeStepIntoNode\(.*?\)\{(?P<body>.*?)\n\}",
            self.smart,
            re.S,
        )
        self.assertIsNotNone(step)
        self.assertIn("const requestNode = targetNode;", step.group("body"))
        self.assertIn("inputRefs?.length ? inputRefs", step.group("body"))
        self.assertIn("await runSmartCascadePromptDependencies(target", self.smart)
        self.assertIn("runPromptLLMNode(promptNode.id, {throwOnError:true", self.smart)

    def test_each_smart_cascade_branch_executes_its_own_recipe(self):
        runner = re.search(
            r"async function runSmartCascade\(targetNode=null, options=\{\}\)\{(?P<body>.*?)\n\}",
            self.smart,
            re.S,
        )
        self.assertIsNotNone(runner)
        body = runner.group("body")
        self.assertNotIn("else if(index === 0)", body)
        self.assertIn("await runCascadeStepIntoNode(source, target", body)

    def test_smart_cascade_fans_out_siblings_and_memoizes_shared_prompts(self):
        self.assertIn("const executedPromptRuns = new Map();", self.smart)
        self.assertIn("executedPromptRuns.get(promptNode.id)", self.smart)
        self.assertIn("executedPromptRuns.set(promptNode.id, task)", self.smart)
        self.assertIn("await runSmartCascadeItemsWithLimit(\n                      targets,", self.smart)
        self.assertIn("await runBranch(target, targetRefs);", self.smart)

    def test_smart_cascade_allows_ten_api_branches_to_start_together(self):
        parallel_limit = re.search(
            r"function smartCascadeParallelLimit\(chain=\[\]\)\{(?P<body>.*?)\n\}",
            self.smart,
            re.S,
        )
        self.assertIsNotNone(parallel_limit)
        self.assertIn(": 10;", parallel_limit.group("body"))

    def test_loop_node_one_click_keeps_original_scheduler(self):
        legacy_limit = re.search(
            r"function smartCascadeLegacyLoopParallelLimit\(chain=\[\]\)\{(?P<body>.*?)\n\}",
            self.smart,
            re.S,
        )
        self.assertIsNotNone(legacy_limit)
        self.assertIn(": 6;", legacy_limit.group("body"))
        self.assertIn("runSmartCascade(tail);", self.smart)
        self.assertNotIn("runSmartCascade(tail, {loopNodeOneClick:true});", self.smart)
        self.assertIn("runSmartCascade(null, {parallelSiblingBranches:true});", self.smart)
        self.assertIn("const legacyLoopOneClick = !enhancedNodeOneClick;", self.smart)
        self.assertIn("const branchParallelLimit = legacyLoopOneClick ? 1 : smartCascadeParallelLimit(targets);", self.smart)
        self.assertIn("legacyLoopOneClick ? null : executedPromptRuns", self.smart)
        self.assertIn("entry_point:runState.entryPoint || 'loop_node'", self.smart)

    def test_smart_cascade_persists_progress_and_stable_branch_request_ids(self):
        self.assertIn("canvas.cascade_run = {", self.smart)
        self.assertIn("branches,", self.smart)
        self.assertIn("failed_node_ids", self.smart)
        self.assertIn("completed_with_failures", self.smart)
        self.assertIn("requestIdBase:`${runState.parentRequestId}:round:${loopIndex}:node:${tail.id}`", self.smart)
        self.assertIn("运行中 ${Math.min(loopRunState.completedSteps", self.smart)
        self.assertIn("resumePersistedSmartCascadeRun", self.smart)

    def test_comfy_normal_run_always_clears_busy_state(self):
        comfy = re.search(
            r"async function runComfyNode\(nodeId, opts=\{\}\)\{(?P<body>.*?)\n\}\nasync function callCanvasLLM",
            self.canvas,
            re.S,
        )
        self.assertIsNotNone(comfy)
        body = comfy.group("body")
        self.assertIn("} finally {", body)
        self.assertIn(
            "if(!opts.cascade){\n            node.running = false;\n            refreshRunNodes(node, out);",
            body,
        )

    def test_changed_scripts_have_new_cache_versions(self):
        self.assertIn('/static/js/smart-canvas.js?v=2026.08.25.3', self.smart_html)
        self.assertIn('/static/smart-canvas.html?id=${enc}&project=${project}&v=2026.08.20.5', self.canvas_list)
        self.assertIn('/static/js/canvas-list.js?v=2026.08.20.5', self.canvas_list_html)
        self.assertIn('/static/canvas-list.html?v=2026.08.20.5', self.index_html)
        self.assertIn("const CANVAS_FRAME_BUILD = '2026.08.20.5';", self.index_html)
        self.assertIn('/static/js/canvas.js?v=2026.08.21.6', self.canvas_html)


if __name__ == "__main__":
    unittest.main()
