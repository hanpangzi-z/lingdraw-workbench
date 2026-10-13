import unittest
from pathlib import Path


class GptChatModeSwitchFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = Path("static/gpt-chat.html").read_text(encoding="utf-8")

    def test_composer_shows_auto_chat_and_image_modes(self):
        self.assertIn('id="modeSwitch" class="mode-switch"', self.source)
        self.assertIn('id="agentModeBtn"', self.source)
        self.assertIn('id="chatModeBtn"', self.source)
        self.assertIn('id="imageModeBtn"', self.source)
        self.assertIn('>对话模式</button>', self.source)
        self.assertIn('>图像模式</button>', self.source)

    def test_active_mode_is_visible_and_accessible(self):
        self.assertIn("button?.classList.toggle('active', active)", self.source)
        self.assertIn("button?.setAttribute('aria-pressed', String(active))", self.source)
        self.assertIn("document.getElementById('modeSwitch')?.setAttribute('data-mode', mode)", self.source)

    def test_mode_selection_drives_existing_send_behavior(self):
        self.assertIn("const useStreaming = requestOptions.mode === 'chat'", self.source)
        self.assertIn("} else if(requestOptions.mode === 'agent') {", self.source)
        self.assertIn("document.getElementById('imageControls')?.classList.toggle('hidden', mode === 'chat')", self.source)

    def test_selected_mode_persists_across_refreshes(self):
        self.assertIn("let mode = ['agent','chat','image'].includes(savedChatSettings.mode) ? savedChatSettings.mode : 'agent'", self.source)
        self.assertIn("mode,", self.source)

    def test_image_count_is_explicit_accessible_and_persisted(self):
        self.assertIn('id="imageCountControl" class="image-count-control" role="group" aria-label="生成数量"', self.source)
        self.assertEqual(self.source.count('data-image-count="'), 4)
        self.assertIn("let imageCount = [1,2,3,4].includes(Number(savedChatSettings.imageCount))", self.source)
        self.assertIn("function setImageCount(value, persist = true)", self.source)
        self.assertIn("button.setAttribute('aria-pressed', String(active))", self.source)
        self.assertIn("imageCount,", self.source)

    def test_custom_resolution_controls_are_removed(self):
        self.assertNotIn('id="resolutionScopeCustom"', self.source)
        self.assertNotIn('id="resolutionCustomPane"', self.source)
        self.assertNotIn('function applyCustomResolution()', self.source)
        self.assertIn("['auto','1k','2k','4k'].includes(savedChatSettings.chatResolution)", self.source)

    def test_selected_image_count_is_sent_and_deduplicated_as_request_input(self):
        self.assertIn("image_count: requestOptions.imageCount", self.source)
        self.assertGreaterEqual(self.source.count("image_count:requestOptions.imageCount"), 2)

    def test_each_send_has_a_stable_client_request_id(self):
        self.assertIn("function createChatRequestId()", self.source)
        self.assertGreaterEqual(self.source.count("request_id: requestId"), 2)
        self.assertIn("request_id: requestOptions.requestId", self.source)

    def test_image_tasks_use_the_concurrency_safe_agent_endpoint(self):
        self.assertGreaterEqual(self.source.count("fetch('/api/chat/agent'"), 2)

    def test_same_inflight_task_is_deduplicated_without_blocking_other_tasks(self):
        self.assertIn("const activeSendKeys = new Set()", self.source)
        self.assertIn("if(activeSendKeys.has(sendKey)){", self.source)
        self.assertIn("相同任务正在处理中，请勿重复发送", self.source)
        self.assertNotIn("btn.disabled = true", self.source)

    def test_generated_images_offer_inline_regeneration_with_original_inputs(self):
        self.assertIn("regenerate.className = 'generated-regenerate'", self.source)
        self.assertIn("item.append(img, loadError, regenerate, share, download)", self.source)
        self.assertIn("function sourceUserMessageForImage(msg, context={})", self.source)
        self.assertIn("requestContext.generation_prompt", self.source)
        self.assertIn("requestContext.requested_count", self.source)
        self.assertIn("await sendMessage(regeneration)", self.source)

    def test_remote_generated_images_use_same_origin_proxy_and_keep_failure_space(self):
        self.assertIn("function chatMediaDisplayUrl(value, name='', provider='')", self.source)
        self.assertIn("return `/api/download-output?${params.toString()}`", self.source)
        self.assertIn("params.set('provider_id', provider)", self.source)
        self.assertIn("item.className = 'generated-item is-loading'", self.source)
        self.assertIn("item.classList.add('load-failed')", self.source)
        self.assertIn("图片加载失败，可点击下载稍后重试", self.source)

    def test_regeneration_uses_a_new_request_id_and_blocks_repeat_clicks(self):
        self.assertIn("const activeRegenerateKeys = new Set()", self.source)
        self.assertIn("if(!regeneration || !key || activeRegenerateKeys.has(key)) return", self.source)
        self.assertIn("async function sendMessage(overrides=null)", self.source)
        self.assertIn("const requestId = createChatRequestId()", self.source)
        self.assertIn("agent_plan:requestOptions.agentPlan", self.source)

    def test_parallel_first_messages_share_one_created_conversation(self):
        self.assertIn("let conversationCreationPromise = null", self.source)
        self.assertIn("async function ensureConversationForSend()", self.source)
        self.assertIn("if(!conversationCreationPromise)", self.source)

    def test_concurrent_completion_does_not_overwrite_another_conversation(self):
        self.assertIn("const activeRequests = new Map()", self.source)
        self.assertIn("function activeConversationRequests(conversationId)", self.source)
        self.assertIn("currentConversation?.id === conversationId", self.source)

    def test_active_requests_render_immediately_after_switching_history(self):
        self.assertIn("function renderActiveConversationRequests(conversation)", self.source)
        self.assertIn("attachments:request.attachments || []", self.source)
        self.assertIn("renderConversationState(currentConversation)", self.source)
        self.assertNotIn("hasActiveConversationRequest(conversationId)", self.source)

    def test_pending_image_indicator_survives_concurrent_conversation_renders(self):
        self.assertIn("const requestsById = new Map()", self.source)
        self.assertIn("ACTIVE_GENERATION_STATUSES.has(generationStatus)", self.source)
        self.assertIn("pendingRequestRecords().forEach(record =>", self.source)
        self.assertIn("activeConversationRequests(conversationId).forEach", self.source)
        self.assertIn("pending.bubble.classList.add('streaming')", self.source)
        self.assertIn("content:pendingText, request_id:requestId", self.source)

    def test_non_streaming_generation_refresh_restarts_durable_recovery(self):
        refresh_start = self.source.index("async function refreshConversationAfterRequests(conversationId)")
        refresh_end = self.source.index("async function resumePendingRequest(record)", refresh_start)
        refresh_source = self.source[refresh_start:refresh_end]
        self.assertIn("restorePendingRequestsFromConversation(currentConversation)", refresh_source)
        self.assertIn("resumePendingRequests()", refresh_source)
        self.assertLess(
            refresh_source.index("resumePendingRequests()"),
            refresh_source.index("renderConversationState(currentConversation)"),
        )

    def test_pending_request_record_keeps_content_and_mode_for_recovery(self):
        self.assertIn("message:String(message.content || '')", self.source)
        self.assertIn("attachments:Array.isArray(message.attachments) ? message.attachments : []", self.source)
        self.assertIn("pendingText:pendingTextForMode(requestMode)", self.source)
        self.assertIn("mode:requestOptions.mode,\n                        message,\n                        attachments:pendingRefs", self.source)

    def test_completion_rerenders_when_original_pending_bubble_was_replaced(self):
        self.assertIn("function showRequestResult(data, assistantBubble, conversationId)", self.source)
        self.assertIn("renderConversationState(currentConversation);", self.source)
        self.assertIn("eagerImages:index >= Math.max(0, messages.length - 2)", self.source)
        self.assertIn("if(context.eagerImages) scrollBottom()", self.source)
        self.assertIn("message,\n                    attachments:pendingRefs", self.source)

    def test_inflight_agent_tasks_persist_and_resume_after_refresh(self):
        self.assertIn("const CHAT_PENDING_REQUESTS_KEY = 'gpt_chat_pending_requests_v1'", self.source)
        self.assertIn("persistPendingRequest({", self.source)
        self.assertIn("/api/chat/agent/requests/${encodeURIComponent(requestId)}?surface=gpt_chat", self.source)
        self.assertIn("resumePendingRequests();", self.source)

    def test_server_persisted_inflight_tasks_restore_without_local_storage(self):
        self.assertIn("function restorePendingRequestsFromConversation(conversation)", self.source)
        self.assertIn("message?.request_context?.generation_status", self.source)
        self.assertIn("restoredFromServer:true", self.source)
        self.assertIn("restorePendingRequestsFromConversation(currentConversation)", self.source)

    def test_new_and_switched_conversations_ignore_stale_async_responses(self):
        self.assertIn("let conversationViewRevision = 0", self.source)
        self.assertIn("const revision = ++conversationViewRevision", self.source)
        self.assertIn("if(revision !== conversationViewRevision) return null", self.source)
        self.assertIn("renderMessages([]);\n            toggleHistory(false);", self.source)
        self.assertIn("loadConversations({openInitial:false, expectedRevision:revision})", self.source)

    def test_enter_ignores_ime_composition_and_key_repeat(self):
        self.assertIn("if(e.isComposing || e.repeat) return", self.source)

    def test_scaled_chat_locks_root_viewport_scroll(self):
        self.assertIn("html { width:100%; height:100%; overflow:hidden !important; }", self.source)
        self.assertIn(".messages { width:min(var(--chat-width),calc(100% - 60px));", self.source)
        self.assertIn("overflow-y:auto", self.source)


if __name__ == "__main__":
    unittest.main()
