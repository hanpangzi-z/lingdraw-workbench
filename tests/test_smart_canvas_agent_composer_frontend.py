import unittest
from pathlib import Path


class SmartCanvasAgentComposerFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = Path("static/smart-canvas.html").read_text(encoding="utf-8")
        cls.source = Path("static/js/smart-canvas-agent.js").read_text(encoding="utf-8")
        cls.core = Path("static/js/agent-workbench-core.js").read_text(encoding="utf-8")
        cls.canvas = Path("static/js/smart-canvas.js").read_text(encoding="utf-8")
        cls.styles = Path("static/css/smart-canvas-agent.css").read_text(encoding="utf-8")

    def test_composer_has_image_prompt_model_and_size_controls(self):
        self.assertIn('id="smartAgentImageBtn"', self.html)
        self.assertIn('id="smartAgentImageInput" type="file" accept="image/*"', self.html)
        self.assertIn('id="smartAgentPromptBtn"', self.html)
        self.assertIn('id="smartAgentPromptPreview"', self.html)
        self.assertIn('id="smartAgentPromptClose"', self.html)
        self.assertIn('id="smartAgentPromptList"', self.html)
        self.assertIn('id="smartAgentModePicker" class="smart-agent-mode-picker" data-mode="image"', self.html)
        self.assertIn('id="smartAgentImageModelPicker"', self.html)
        self.assertIn('data-agent-image-model="自动选择"', self.html)
        self.assertIn('id="smartAgentSizePicker"', self.html)

    def test_composer_exposes_only_the_fixed_image_mode(self):
        self.assertIn('aria-label="图片模式"', self.html)
        self.assertIn('<span id="smartAgentModeLabel">图片</span>', self.html)
        self.assertNotIn('data-agent-mode="agent"', self.html)
        self.assertNotIn('data-agent-mode="video"', self.html)
        self.assertNotIn('id="smartAgentModeMenu"', self.html)

    def test_uploaded_images_are_references_and_can_be_removed(self):
        self.assertIn("fetch('/api/ai/upload', {method:'POST', body:form})", self.source)
        self.assertIn("window.LingDrawImageUpload.optimizeFiles(images)", self.source)
        self.assertIn('state.uploadedReferences = uniqueReferences', self.source)
        self.assertIn('data-agent-reference-remove', self.source)
        self.assertIn('state.uploadedReferences = state.uploadedReferences.filter', self.source)

    def test_clipboard_images_are_supported_in_both_canvas_and_agent_panel(self):
        self.assertIn("panel.addEventListener('paste'", self.source)
        self.assertIn('clipboardImageFiles(event.clipboardData)', self.source)
        self.assertIn('void uploadReferenceImages(images)', self.source)
        self.assertIn(".filter(item => item.kind === 'file')", self.canvas)
        self.assertIn('smartImageFilesFromDataTransfer(e.clipboardData)', self.canvas)
        self.assertIn("e.target.closest?.('#smartAgentPanel')", self.canvas)

    def test_selected_prompt_can_be_previewed_and_inserted(self):
        self.assertIn("core.api('/api/prompt-libraries')", self.source)
        self.assertIn('data-agent-prompt-template', self.source)
        self.assertIn('function setPromptLibraryOpen(open)', self.source)
        self.assertIn('inputEl.value = promptTemplateText(item)', self.source)
        self.assertIn("el.addEventListener('pointerdown'", self.canvas)
        self.assertIn("activatePromptNode();", self.canvas)
        self.assertNotIn("if(selectedId === node.id && selectedIds.length === 0) return;", self.canvas)
        self.assertIn("promptAssets:smartCanvasAgentPromptAssets()", self.canvas)
        self.assertIn("textEl.addEventListener('focus'", self.canvas)
        self.assertIn("syncSelectionUi();", self.canvas)
        self.assertIn('.smart-agent-prompt-list', self.styles)

    def test_new_turns_are_forced_through_the_image_execution_path(self):
        self.assertIn("state.session.composer.mode_hint = 'image'", self.source)
        self.assertIn("const modeHint = MODE_META[turn.mode_hint] ? turn.mode_hint : 'image'", self.source)
        self.assertIn("if(modeHint === 'image')", self.source)
        self.assertIn("route:'direct_generate'", self.source)
        self.assertIn("mode_hint:composerMode()", self.source)

    def test_image_model_selection_is_persisted_and_auto_respects_list_order(self):
        self.assertIn("image_model:'自动选择'", self.core)
        self.assertIn('core.availableImageModelOptions', self.source)
        self.assertIn('core.resolveGenerationRoute(result, selectedImageModel())', self.source)
        self.assertIn('state.session.composer.image_model = valid ? requested', self.source)
        self.assertIn('const selectedImageModel = exactImage?.model || imageModels[0]', self.core)
        self.assertNotIn('gpt-image-2/i.test', self.core)
        self.assertIn('.smart-agent-analysis-model-menu', self.styles)
        self.assertIn("state.imageModelLoading = true", self.source)
        self.assertIn("state.imageModelError = httpStatus", self.source)
        self.assertIn('data-agent-image-retry', self.source)

    def test_image_model_menu_is_viewport_anchored_and_cache_busted(self):
        self.assertIn('function positionImageModelMenu()', self.source)
        self.assertIn("position: fixed;", self.styles)
        self.assertIn('--smart-agent-model-left', self.styles)
        self.assertIn('选择生图模型', self.source)
        self.assertIn('/static/css/smart-canvas-agent.css?v=2026.08.25.4', self.html)
        self.assertIn('/static/js/smart-canvas-agent.js?v=2026.08.25.4', self.html)

    def test_video_route_and_canvas_result_preserve_media_kind(self):
        self.assertIn("video_provider:String(videoProvider.id", self.core)
        self.assertIn("video_model:String(videoModels[0]", self.core)
        self.assertIn("const kind = payload?.kind === 'video' ? 'video' : 'image'", self.canvas)
        self.assertIn("kind:'video', url:urls[0]", self.source)
        self.assertIn('<video src=', self.source)


if __name__ == "__main__":
    unittest.main()
