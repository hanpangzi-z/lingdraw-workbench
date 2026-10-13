import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignHorizontalSpaceAround, Aperture, ArrowDownToLine, Bot, Box, Check, ChevronDown,
  CheckCircle2, CircleAlert, CircleHelp, Clock3, Copy, Crop, Download, Eraser, Frame, Group, History, Image as ImageIcon,
  Expand, ImagePlus, Layers3, Lightbulb, LoaderCircle, Maximize, MessageSquare, Minus, MousePointer2,
  Palette, PanelRightClose, PanelRightOpen, PenLine, Plus, Redo2, RefreshCw, Search, Send, Shapes, Trash2,
  ShieldCheck, Sparkles, Square, Target, TextCursorInput, Type, Undo2, Upload, WandSparkles, X, ZoomIn, ZoomOut,
} from 'lucide-react'
import {
  createShapeId,
  FabricCanvas,
  getSnapshot,
  loadSnapshot,
  upgradeFabricSnapshotFromLegacy,
  type Editor,
  type TLShape,
  type TLShapeId,
} from './fabricCanvas'
import { ApiError, api } from './api'
import {
  discardAgentSessionDraft,
  readAgentSessionDraft,
  rebaseOrClearAgentSessionDraft,
  restoreAgentSessionDraft,
  saveAgentSessionDraft,
} from './agentSessionDraft'
import {
  appendPromptInstruction,
  IMAGE_EDIT_ESTIMATED_COST,
  QUICK_EDIT_PRESETS,
} from './agentInteractions'
import {
  decideCanvasDocumentRestore,
  discardCanvasDocumentDraft,
  readCanvasDocumentDraft,
  rebaseOrClearCanvasDocumentDraft,
  saveCanvasDocumentDraft,
} from './canvasDocumentDraft'
import {
  type DesignGeneratorShape,
  type DesignImageShape,
  type DesignMarkerShape,
} from './canvasShapes'
import { createDocumentSaveQueue, type DocumentSaveQueue } from './documentSaveQueue'
import {
  chooseExpansionOutput,
  computeExpansionGeometryFromPadding,
  expansionPaddingForAspectRatio,
  expansionPreviewRect,
  resizeExpansionPadding,
  type ExpansionHandle,
  type ExpansionPadding,
  type ExpansionResolutionScale,
} from './imageExpansion'
import { computeImageOverlayPlacement } from './imageOverlay'

type Lang = 'zh' | 'en'
type SaveState = 'loading' | 'saved' | 'saving' | 'offline' | 'error' | 'auth-required' | 'conflict'
type CanvasSummary = {
  id: string
  title: string
  kind: 'classic' | 'smart'
  updated_at: number
  surfaces?: string[]
}
type PendingPlacement = {
  id: string
  kind: 'design-image'
  url: string
  name: string
  media_type: string
  generated_asset_id: string
  parent_generated_asset_id: string
  agent_run_id: string
  agent_step_id: string
  model: string
  provider: string
  prompt: string
  created_at: number
}
type SmartCanvasDocument = {
  schema_version: 1 | 2
  engine: 'tldraw' | 'fabric'
  snapshot: unknown
  legacy_tldraw_snapshot?: unknown
  pending_placements: PendingPlacement[]
  applied_placement_ids: string[]
  brand_kit?: BrandKit
  agent_session?: AgentSessionV1 | AgentSessionV2
}
export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  type?: string
  image_url?: string
  image_urls?: string[]
  agent_action?: string
  model?: string
  provider?: string
  request_id?: string
  status?: string
  error_code?: string
  retryable?: boolean
}
type AgentComposer = {
  prompt: string
  mode: 'agent' | 'image' | 'video'
  active_skill: string
  image_model?: string
  image_aspect?: ImageAspectRatio
  analysis_model?: string
  pending_references?: ReferenceImage[]
  parent_turn_id?: string
  mode_hint?: string
  thread_start_sequence?: number
}
type AgentAttempt = {
  id: string
  request_id: string
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'recovering'
  run: AgentRunView | null
  assistant_messages: ChatMessage[]
  created_at: number
  updated_at: number
}
export type AgentTurn = {
  id: string
  sequence: number
  parent_turn_id?: string
  user_message: ChatMessage
  references: ReferenceImage[]
  attempts: AgentAttempt[]
  active_attempt_id: string
  created_at: number
  updated_at: number
}
type AgentSessionV1 = {
  schema_version?: 1
  updated_at?: number
  conversation_id: string
  messages: ChatMessage[]
  run: AgentRunView | null
  composer?: AgentComposer
}
export type AgentSessionV2 = {
  schema_version: 2
  session_id: string
  conversation_id: string
  active_turn_id: string | null
  next_sequence: number
  turns: AgentTurn[]
  composer: AgentComposer
  updated_at: number
}
type AgentSession = AgentSessionV2
type PendingDocumentSave = { canvas_id: string; base_updated_at: number; document: SmartCanvasDocument }
type ReferenceImage = { url: string; name: string; role: string; kind: string; mime: string }
type UploadedReference = { url?: string; name?: string; kind?: string; mime?: string }
type ImageUploadOptimizer = { optimizeFiles: (files: File[]) => Promise<File[]> }
declare global { interface Window { LingDrawImageUpload?: ImageUploadOptimizer } }
type SendPromptOptions = {
  referenceMode?: 'append' | 'replace'
  requestedSize?: string
  modeHint?: string
  directCanvasTool?: boolean
  showInAgentPanel?: boolean
  resultName?: string
  markerTargetId?: string
}
type ExpansionAspect = 'custom' | 'original' | '1:1' | '3:4' | '2:3' | '9:16' | '4:3' | '3:2' | '16:9' | '4:5' | '5:4'
type WorkflowAspectRatio = '1:1' | '4:5' | '3:4' | '2:3' | '9:16' | '5:4' | '4:3' | '3:2' | '16:9'
type WorkflowCopyMode = 'with_copy' | 'without_copy'
type ImageAspectRatio = 'auto' | WorkflowAspectRatio
type ConflictPayload = { document: SmartCanvasDocument; updated_at: number; message?: string; draft_client_id?: string }
type BrandKit = { name: string; tone: string; colors: string }
type ConversationSummary = { id: string; title: string; updated_at: number; last_message?: string }
type PromptTemplate = { id: string; name: string; positive: string; scene?: string }
export type CanvasMarkerContext = {
  number: number
  label: string
  targetName: string
  xPercent?: number
  yPercent?: number
}

export function shouldShowInAgentPanel(options: Pick<SendPromptOptions, 'showInAgentPanel'> = {}) {
  return options.showInAgentPanel !== false
}

export function shouldAnalyzeComposerMode(mode: AgentComposer['mode']) {
  return mode === 'agent'
}

const AGENT_REFERENCE_MAX = 8
const AGENT_REFERENCE_MAX_BYTES = 50 * 1024 * 1024
const IMAGE_FILE_EXTENSION = /\.(?:png|jpe?g|webp|gif)$/i

function isImageFile(file: File) {
  return String(file.type || '').startsWith('image/') || IMAGE_FILE_EXTENSION.test(file.name || '')
}

export async function optimizeUserUploadFiles(files: File[]) {
  if (!window.LingDrawImageUpload) return files
  try {
    return await window.LingDrawImageUpload.optimizeFiles(files)
  } catch {
    return files
  }
}

export function validateAgentReferenceFiles(files: File[], existingCount = 0) {
  if (!files.length) return ''
  const invalid = files.find(file => !isImageFile(file))
  if (invalid) return `“${invalid.name || '该文件'}”不是支持的图片格式`
  const oversized = files.find(file => file.size > AGENT_REFERENCE_MAX_BYTES)
  if (oversized) return `“${oversized.name || '该图片'}”超过 50MB，无法上传`
  if (existingCount + files.length > AGENT_REFERENCE_MAX) {
    return `最多引用 ${AGENT_REFERENCE_MAX} 张图片，当前已有 ${existingCount} 张`
  }
  return ''
}

export function clipboardImageFiles(clipboardData: Pick<DataTransfer, 'items' | 'files'> | null | undefined) {
  const itemFiles = Array.from(clipboardData?.items || [])
    .filter(item => item.kind === 'file' && String(item.type || '').startsWith('image/'))
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null && isImageFile(file))
  const directFiles = Array.from(clipboardData?.files || []).filter(isImageFile)
  return uniqueFilesByUploadIdentity([...itemFiles, ...directFiles])
}

export function fileUploadIdentity(file: Pick<File, 'name' | 'type' | 'size' | 'lastModified'>) {
  return `${file.name}:${file.type}:${file.size}:${file.lastModified}`
}

export function uniqueFilesByUploadIdentity(files: File[]) {
  const seen = new Set<string>()
  return files.filter(file => {
    const key = fileUploadIdentity(file)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function uniqueReferenceImages(references: ReferenceImage[]) {
  return references.filter((reference, index, items) =>
    Boolean(reference.url) && items.findIndex(candidate => candidate.url === reference.url) === index)
}

export function prepareAgentReferences({
  previousReferences,
  pendingReferences = [],
  canvasReferences = [],
  markerReferences = [],
  extraReferences = [],
  replace = false,
}: {
  previousReferences?: ReferenceImage[]
  pendingReferences?: ReferenceImage[]
  canvasReferences?: ReferenceImage[]
  markerReferences?: ReferenceImage[]
  extraReferences?: ReferenceImage[]
  replace?: boolean
}) {
  if (previousReferences) return uniqueReferenceImages(previousReferences)
  if (replace) return uniqueReferenceImages(extraReferences)
  return uniqueReferenceImages([
    ...pendingReferences,
    ...canvasReferences,
    ...markerReferences,
    ...extraReferences,
  ])
}

export function shouldHideCanvasToolTurn(promptText: string) {
  const prompt = String(promptText || '').trim()
  return [
    '按用户设定的边界扩展当前图片',
    '使用蒙版精确移除透明标记区域',
    '只修复输入图像中的透明缺口',
  ].some(prefix => prompt.startsWith(prefix))
}

export function displayCanvasResultName(name: string, fallback = '图片') {
  return shouldHideCanvasToolTurn(name) ? fallback : name
}

export function nextCanvasMarkerNumber(numbers: number[]) {
  return numbers.length ? Math.max(...numbers) + 1 : 1
}

export const MAX_CANVAS_MARKERS = 10

export function canvasMarkerLimitReached(count: number) {
  return count >= MAX_CANVAS_MARKERS
}

export function markerReferenceGridRows(count: number) {
  return Math.ceil(Math.max(0, count) / 3)
}

export function markerPreviewGeometry(
  sourceWidth: number,
  sourceHeight: number,
  xRatio: number,
  yRatio: number,
  viewportWidth = 102,
  viewportHeight = 126,
  zoom = 1.7,
) {
  const safeWidth = Math.max(1, sourceWidth)
  const safeHeight = Math.max(1, sourceHeight)
  const clampedX = Math.min(1, Math.max(0, xRatio))
  const clampedY = Math.min(1, Math.max(0, yRatio))
  const coverScale = Math.max(viewportWidth / safeWidth, viewportHeight / safeHeight)
  const renderedWidth = safeWidth * coverScale * zoom
  const renderedHeight = safeHeight * coverScale * zoom
  const markerX = clampedX * renderedWidth
  const markerY = clampedY * renderedHeight
  const left = Math.min(0, Math.max(viewportWidth - renderedWidth, viewportWidth / 2 - markerX))
  const top = Math.min(0, Math.max(viewportHeight - renderedHeight, viewportHeight / 2 - markerY))
  return {
    imageWidth: renderedWidth,
    imageHeight: renderedHeight,
    imageLeft: left,
    imageTop: top,
    pinLeft: markerX + left,
    pinTop: markerY + top,
  }
}

export function markerRecognitionCropSide(width: number, height: number) {
  const shortestSide = Math.max(1, Math.min(width, height))
  return Math.min(shortestSide, Math.max(128, Math.round(shortestSide * .64)))
}

export function isSingleCjkMarkerLabel(label: string) {
  return /^[\u3400-\u9fff]$/.test(label.trim())
}

export function markerPhraseFromDescription(description: string) {
  const quoted = description.match(/[“「『"]([^”」』"]{2,20})[”」』"]/)
  return quoted?.[1]?.trim() || ''
}

export function isCanvasTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function appendCanvasMarkerContext(message: string, markers: CanvasMarkerContext[]) {
  if (!markers.length) return message
  const lines = markers
    .slice()
    .sort((left, right) => left.number - right.number)
    .map(marker => {
      const target = marker.targetName ? `，目标“${marker.targetName}”` : ''
      const position = typeof marker.xPercent === 'number' && typeof marker.yPercent === 'number'
        ? `，位置为目标内横向 ${marker.xPercent}%、纵向 ${marker.yPercent}%`
        : ''
      return `#${marker.number}「${marker.label}」${target}${position}`
    })
  return `${message}\n\n画布标记上下文：\n${lines.join('\n')}\n请严格按编号理解用户指向的位置；标记仅用于定位，不要把编号画进结果图。`
}
export type ApiProvider = {
  id: string
  name: string
  enabled?: boolean
  primary?: boolean
  protocol?: string
  has_key?: boolean
  image_models?: string[]
  chat_models?: string[]
}

type GenerationRoute = {
  provider: string
  chat_model: string
  allow_chat_fallback: boolean
  image_provider: string
  image_model: string
}

export type ImageModelOption = {
  value: string
  model: string
  providerId: string
  providerName: string
}

export type AnalysisModelOption = ImageModelOption

type WorkbenchPlanSection = {
  kind: 'positioning' | 'audience' | 'layout' | 'color' | 'typography' | 'lighting' | 'fidelity' | 'other'
  title: string
  summary: string
  details: string[]
  colors: Array<{ name: string; value: string }>
}
type WorkbenchDesignPlan = {
  acknowledgement: string
  title: string
  sections: WorkbenchPlanSection[]
  generation_prompt: string
}
type WorkbenchExecutionRoute = 'clarify' | 'plan_and_generate' | 'direct_generate' | 'edit_image' | 'specialist_workflow'
type WorkbenchWorkflowModule = {
  id: string
  name: string
  purpose: string
  content: string
  generation_prompt: string
  estimated_generation_count: number
  estimated_points: number
}
type WorkbenchWorkflowPlan = {
  skill_slug: string
  workflow_version: number
  title: string
  summary: string
  modules: WorkbenchWorkflowModule[]
  estimated_generation_count: number
  estimated_points: number
}
type AgentWorkflowModuleStatus = 'pending' | 'running' | 'reviewing' | 'completed' | 'review_failed' | 'failed' | 'cancelled'
type WorkflowModuleEditableFields = Pick<WorkbenchWorkflowModule, 'name' | 'purpose' | 'content' | 'generation_prompt'>
type WorkflowModuleRevision = {
  status: 'optimizing' | 'confirming' | 'accepted' | 'failed'
  attempt: number
  requestId: string
  submitted: WorkflowModuleEditableFields
  optimized?: WorkbenchWorkflowModule
  summary?: string
  cautions?: string[]
  error?: string
}
type AgentWorkflowModule = WorkbenchWorkflowModule & {
  selected: boolean
  status: AgentWorkflowModuleStatus
  requestId?: string
  attempt?: number
  reviewAttempt?: number
  imageUrl?: string
  imageName?: string
  messageId?: string
  review?: WorkbenchResultReview
  revision?: WorkflowModuleRevision
  error?: string
}
type WorkflowIdentityAnchorStatus = 'required' | 'generating' | 'confirming' | 'confirmed' | 'failed'
type WorkflowIdentityAnchor = {
  status: WorkflowIdentityAnchorStatus
  requestId?: string
  attempt?: number
  imageUrl?: string
  imageName?: string
  messageId?: string
  error?: string
  confirmedAt?: number
}
type WorkbenchClarificationOption = { id: string; label: string; description: string }
type WorkbenchClarificationQuestion = {
  id: string
  question: string
  description: string
  selection: 'single' | 'multiple'
  required: boolean
  options: WorkbenchClarificationOption[]
  recommended_option_id: string
}
type WorkbenchClarification = {
  id: string
  introduction: string
  questions: WorkbenchClarificationQuestion[]
}
type WorkbenchReferenceAnalysis = {
  reference_index: number
  subject_name: string
  relationship: 'independent_subject' | 'same_subject_view' | 'style_reference' | 'layout_reference'
  grouped_with_reference_index?: number | null
  must_appear: boolean
  evidence: string
}
type WorkbenchRoutingDecision = {
  status: 'needs_clarification' | 'ready'
  route: WorkbenchExecutionRoute
  reason: string
  acknowledgement: string
  clarification?: WorkbenchClarification | null
  plan?: WorkbenchDesignPlan | null
  generation_prompt: string
  reference_analysis?: WorkbenchReferenceAnalysis[]
  workflow_plan?: WorkbenchWorkflowPlan | null
}
type WorkbenchResultReview = {
  title: string
  summary: string
  overall_score: number
  passed: boolean
  highlights: Array<{ title: string; detail: string }>
  checks: Array<{ label: string; passed: boolean; score: number; detail: string }>
  reference_checks?: Array<{
    reference_index: number
    verdict: 'present' | 'same_subject_view_covered' | 'missing' | 'unclear' | 'not_required'
    evidence: string
  }>
  conclusion: string
  suggestions: Array<{ label: string; instruction: string }>
}
type WorkbenchMarkerRecognition = {
  label: string
  description: string
}
type AgentRunPhase = 'analyzing' | 'clarifying' | 'confirming' | 'confirming_identity' | 'generating' | 'reviewing' | 'completed' | 'failed'
type InlineEditKind = 'quick'
type AgentRunRequestContext = {
  mode: 'agent' | 'image'
  route: GenerationRoute
  referenceImages: ReferenceImage[]
  sourceShapeId?: string
  imageAspect?: ImageAspectRatio
  requestedSize?: string
}

export type AgentRunView = {
  id: string
  phase: AgentRunPhase
  prompt: string
  skill: string
  model: string
  startedAt: number
  imageUrl?: string
  imageName?: string
  messageId?: string
  plan?: WorkbenchDesignPlan
  referenceAnalysis?: WorkbenchReferenceAnalysis[]
  executionRoute?: Exclude<WorkbenchExecutionRoute, 'clarify'>
  workflowPlan?: WorkbenchWorkflowPlan
  workflowModules?: AgentWorkflowModule[]
  workflowAspectRatio?: WorkflowAspectRatio
  workflowCopyMode?: WorkflowCopyMode
  workflowReviewDecision?: 'pending' | 'accepted'
  identityAnchor?: WorkflowIdentityAnchor
  routingReason?: string
  generationPrompt?: string
  clarification?: WorkbenchClarification
  clarificationAnswers?: Record<string, string[]>
  clarificationSkipped?: boolean
  review?: WorkbenchResultReview
  analysisModel?: string
  reviewModel?: string
  failedStage?: Exclude<AgentRunPhase, 'completed' | 'failed'>
  error?: string
  upstreamOutcome?: string
  reviewWarning?: string
  regenerationCount?: number
  generationRequestId?: string
  requestContext?: AgentRunRequestContext
}

export function workflowNeedsIdentityAnchor(run: AgentRunView) {
  return run.executionRoute === 'specialist_workflow'
    && !(run.requestContext?.referenceImages || []).length
    && run.identityAnchor?.status !== 'confirmed'
}

export function workflowIdentityReferences(run: AgentRunView, fallback: ReferenceImage[] = []) {
  const original = run.requestContext?.referenceImages?.length
    ? run.requestContext.referenceImages
    : fallback
  const anchor = run.identityAnchor?.status === 'confirmed' && run.identityAnchor.imageUrl
    ? [{
        url: run.identityAnchor.imageUrl,
        name: run.identityAnchor.imageName || '已确认产品母图',
        role: 'product_identity',
        kind: 'image',
        mime: 'image/png',
      }]
    : []
  return uniqueReferenceImages([...anchor, ...original])
}

export function workflowModuleExecutionIds(
  modules: AgentWorkflowModule[],
  requestedModuleIds: string[],
  mode: 'initial' | 'retry' | 'resume' | 'review',
) {
  const requested = new Set(requestedModuleIds)
  return modules.filter(module => requested.has(module.id)).map(module => module.id)
}

export function workflowReviewReferenceImages(modules: AgentWorkflowModule[], currentModuleId: string) {
  return modules
    .filter(module => module.id !== currentModuleId && Boolean(module.imageUrl))
    .map(module => ({ url: module.imageUrl as string, name: module.imageName || module.name }))
}

export const WORKFLOW_ASPECT_OPTIONS: Array<{ value: WorkflowAspectRatio; label: string }> = [
  { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' },
  { value: '3:4', label: '3:4' },
  { value: '2:3', label: '2:3' },
  { value: '9:16', label: '9:16' },
  { value: '5:4', label: '5:4' },
  { value: '4:3', label: '4:3' },
  { value: '3:2', label: '3:2' },
  { value: '16:9', label: '16:9' },
]

export const IMAGE_ASPECT_OPTIONS: Array<{ value: ImageAspectRatio; label: string }> = [
  { value: 'auto', label: '自动' },
  ...WORKFLOW_ASPECT_OPTIONS,
]

export function workflowImageSizeForAspect(aspect: WorkflowAspectRatio = '1:1') {
  return ({
    '1:1': '1440x1440',
    '4:5': '1152x1440',
    '3:4': '1080x1440',
    '2:3': '960x1440',
    '9:16': '810x1440',
    '5:4': '1440x1152',
    '4:3': '1440x1080',
    '3:2': '1440x960',
    '16:9': '1440x810',
  } as Record<WorkflowAspectRatio, string>)[aspect]
}

export function imageComposerSizeForAspect(aspect: ImageAspectRatio = 'auto') {
  return aspect === 'auto' ? '1024x1024' : workflowImageSizeForAspect(aspect)
}

export function workflowCopyInstruction(mode: WorkflowCopyMode = 'with_copy') {
  return mode === 'without_copy'
    ? '文案模式：无文案。忽略上述模块要求中新增营销文案、标题安全区和后期加字的要求，生成纯视觉成图；画面不得添加主标题、副标题、卖点、参数、徽章、促销标签、水印、二维码或无关字符。商品包装上原本存在的商标和标签按参考图保留，不要主动抹除或改写。'
    : '文案模式：有文案。这是一张完整营销设计，不是纯产品摄影。画面必须包含清晰可读的中文文案层级；若模块已给出确切主标题、副标题或卖点，必须逐字排版。若模块只写了“预留文案区”或“标题安全区”，则依据用户已确认的商品名称、品类和真实卖点生成简短主标题与副标题，不得继续输出空白无文案图片；不得把模块名称、内部说明、“待补充”或占位符画进画面，也不得虚构参数、认证、销量、优惠、功效或绝对化承诺。'
}

const MAX_AUTOMATIC_REGENERATIONS = 1

export function shouldAutoRegenerateReview(review: WorkbenchResultReview, regenerationCount = 0) {
  return !review.passed && regenerationCount < MAX_AUTOMATIC_REGENERATIONS
}

export function automaticRegenerationRequestId(runId: string, regenerationCount: number) {
  return `${runId}-regenerate-${regenerationCount}`
}

export function automaticRegenerationPrompt(
  originalPrompt: string,
  review: WorkbenchResultReview,
  referenceCount: number,
) {
  const failedChecks = review.checks
    .filter(check => !check.passed)
    .map(check => `${check.label}：${check.detail}`)
  const unresolvedReferences = (review.reference_checks || [])
    .filter(check => check.verdict === 'missing' || check.verdict === 'unclear')
    .map(check => `参考图${check.reference_index}：${check.evidence}`)
  const suggestions = review.suggestions.map(item => `${item.label}：${item.instruction}`)
  const fixes = [...unresolvedReferences, ...failedChecks, ...suggestions]
  return [
    `基于上一版成图重新生成并修正，不要照搬失败版本。原始需求：${originalPrompt}`,
    `上一版复核结论：${review.conclusion || review.summary}`,
    fixes.length ? `必须修正：${fixes.join('；')}` : '必须修正所有未通过项，并保持已通过部分不变。',
    referenceCount > 0
      ? `重新逐项核对并覆盖全部 ${referenceCount} 张原始参考图；不得遗漏、合并或替换其中的独立主体。`
      : '',
    '输出一张可直接再次复核的完整成图。',
  ].filter(Boolean).join('\n')
}

export function shouldResumeLegacyReview(run?: AgentRunView | null) {
  return Boolean(run?.phase === 'completed' && run.imageUrl && run.reviewWarning)
}

type ClarificationContinuation = {
  run: AgentRunView
  answers: Record<string, string[]>
  skip: boolean
}

export function timelineOwnsMessage(
  messageId: string,
  run?: { messageId?: string; imageUrl?: string; workflowModules?: Array<{ messageId?: string; imageUrl?: string }> } | null,
) {
  return Boolean(
    (run?.imageUrl && run.messageId === messageId)
    || run?.workflowModules?.some(module => module.imageUrl && module.messageId === messageId),
  )
}

export function mergeAgentAttemptMessages(items: ChatMessage[], userMessage: ChatMessage, recovering: boolean) {
  const withoutPriorFailure = recovering
    ? items.filter(item => !(item.role === 'assistant' && item.type === 'error' && item.request_id === userMessage.request_id))
    : items
  if (withoutPriorFailure.some(item => item.role === 'user' && item.request_id === userMessage.request_id)) {
    return withoutPriorFailure
  }
  return [...withoutPriorFailure, userMessage]
}

function agentAttemptStatus(run: AgentRunView | null): AgentAttempt['status'] {
  if (!run) return 'pending'
  if (run.phase === 'completed') return 'succeeded'
  if (run.phase === 'failed') return 'failed'
  return 'running'
}

function freshAgentSession(): AgentSessionV2 {
  return {
    schema_version: 2,
    session_id: crypto.randomUUID(),
    conversation_id: '',
    active_turn_id: null,
    next_sequence: 1,
    turns: [],
    composer: {
      prompt: '', mode: 'agent', active_skill: '', image_model: '自动选择',
      image_aspect: 'auto', analysis_model: '自动选择', pending_references: [],
    },
    updated_at: Date.now(),
  }
}

function stableLegacyToken(...values: unknown[]) {
  const source = values.map(value => String(value ?? '')).join('|')
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function activeAttempt(turn?: AgentTurn | null) {
  if (!turn) return null
  return turn.attempts.find(attempt => attempt.id === turn.active_attempt_id)
    || turn.attempts[turn.attempts.length - 1]
    || null
}

export function visibleAttemptsForTurn(turn: AgentTurn, liveRun?: AgentRunView | null) {
  const attempt = activeAttempt(turn)
  if (!attempt) return []
  if (!liveRun || (attempt.id !== liveRun.id && attempt.request_id !== liveRun.id)) {
    return [attempt]
  }
  return [{ ...attempt, run: liveRun, status: agentAttemptStatus(liveRun) }]
}

export function migrateAgentSessionV2(
  source?: AgentSessionV1 | AgentSessionV2 | null,
): AgentSessionV2 {
  if (source?.schema_version === 2 && Array.isArray(source.turns)) {
    const turns = [...source.turns]
      .map(turn => ({
        ...turn,
        references: Array.isArray(turn.references) ? turn.references : [],
        attempts: Array.isArray(turn.attempts) ? turn.attempts : [],
      }))
      .sort((left, right) => left.sequence - right.sequence)
    return {
      ...freshAgentSession(),
      ...source,
      turns,
      next_sequence: Math.max(
        Number(source.next_sequence || 1),
        turns.reduce((value, turn) => Math.max(value, turn.sequence + 1), 1),
      ),
      composer: {
        ...(source.composer || {}),
        prompt: source.composer?.prompt || '',
        mode: source.composer?.mode || 'agent',
        active_skill: source.composer?.active_skill || '',
        image_model: source.composer?.image_model || '自动选择',
        image_aspect: source.composer?.image_aspect || 'auto',
        analysis_model: source.composer?.analysis_model || '自动选择',
        pending_references: Array.isArray(source.composer?.pending_references)
          ? source.composer.pending_references
          : [],
      },
    }
  }

  const legacy = source as AgentSessionV1 | undefined
  const messages = Array.isArray(legacy?.messages) ? legacy.messages : []
  const legacyUpdatedAt = Math.max(1, Number(legacy?.updated_at || 0))
  const turns: AgentTurn[] = []
  const requestTurns = new Map<string, AgentTurn>()
  let latestTurn: AgentTurn | null = null
  const ensureAttempt = (turn: AgentTurn, requestId: string, run: AgentRunView | null = null) => {
    let attempt = turn.attempts.find(item => item.request_id === requestId)
    if (!attempt) {
      const timestamp = Number(run?.startedAt || turn.created_at || legacyUpdatedAt)
      attempt = {
        id: String(run?.id || requestId || crypto.randomUUID()),
        request_id: String(requestId || run?.id || crypto.randomUUID()),
        status: agentAttemptStatus(run),
        run,
        assistant_messages: [],
        created_at: timestamp,
        updated_at: timestamp,
      }
      turn.attempts.push(attempt)
      turn.active_attempt_id = attempt.id
    }
    return attempt
  }

  for (const [messageIndex, message] of messages.entries()) {
    const requestId = String(message.request_id || '').trim()
    const messageTimestamp = Number(
      (message as ChatMessage & { created_at?: number }).created_at
      || legacyUpdatedAt + messageIndex,
    )
    if (message.role === 'user') {
      const existingTurn = requestId ? requestTurns.get(requestId) : null
      if (existingTurn) {
        const attempt = ensureAttempt(existingTurn, requestId)
        if (!attempt.assistant_messages.some(item => item.id === message.id)) {
          attempt.assistant_messages.push(message)
        }
        existingTurn.updated_at = Math.max(
          existingTurn.updated_at,
          messageTimestamp,
        )
        latestTurn = existingTurn
        continue
      }
      const stableId = requestId || message.id || `legacy-${stableLegacyToken(
        legacy?.conversation_id, messageIndex, message.role, message.content,
      )}`
      const turn: AgentTurn = {
        id: `turn-${stableId}`,
        sequence: turns.length + 1,
        user_message: message,
        references: [],
        attempts: [],
        active_attempt_id: '',
        created_at: messageTimestamp,
        updated_at: messageTimestamp,
      }
      ensureAttempt(turn, stableId)
      turns.push(turn)
      latestTurn = turn
      if (requestId) requestTurns.set(requestId, turn)
      continue
    }
    let targetTurn: AgentTurn | null | undefined = (requestId && requestTurns.get(requestId)) || latestTurn
    if (!targetTurn) {
      const stableId = requestId || message.id || `legacy-${stableLegacyToken(
        legacy?.conversation_id, messageIndex, message.role, message.content,
      )}`
      const synthetic: ChatMessage = {
        id: `legacy-user-${stableId}`,
        role: 'user',
        content: '历史设计任务',
        request_id: stableId,
      }
      targetTurn = {
        id: `turn-${stableId}`,
        sequence: turns.length + 1,
        user_message: synthetic,
        references: [],
        attempts: [],
        active_attempt_id: '',
        created_at: messageTimestamp,
        updated_at: messageTimestamp,
      }
      ensureAttempt(targetTurn, stableId)
      turns.push(targetTurn)
      latestTurn = targetTurn
    }
    const attempt = ensureAttempt(
      targetTurn,
      requestId || targetTurn.user_message.request_id || targetTurn.id,
    )
    if (!attempt.assistant_messages.some(item => item.id === message.id)) {
      attempt.assistant_messages.push(message)
    }
  }

  const legacyRun = legacy?.run || null
  if (legacyRun) {
    const matched = turns.find(turn =>
      turn.user_message.request_id === legacyRun.id
      || turn.attempts.some(attempt =>
        attempt.request_id === legacyRun.id
        || attempt.assistant_messages.some(message => message.id === legacyRun.messageId),
      ),
    ) || turns[turns.length - 1]
    if (matched) {
      const attempt = ensureAttempt(matched, legacyRun.id, legacyRun)
      attempt.run = legacyRun
      attempt.status = agentAttemptStatus(legacyRun)
      attempt.updated_at = Math.max(
        attempt.updated_at,
        Number(legacyRun.startedAt || legacyUpdatedAt),
      )
      matched.active_attempt_id = attempt.id
      matched.updated_at = attempt.updated_at
    }
  }

  return {
    schema_version: 2,
    session_id: `legacy-${legacy?.conversation_id || turns[0]?.id || stableLegacyToken('empty-session')}`,
    conversation_id: legacy?.conversation_id || '',
    active_turn_id: turns[turns.length - 1]?.id || null,
    next_sequence: turns.length + 1,
    turns,
    composer: {
      prompt: '',
      mode: 'agent',
      active_skill: '',
      image_model: legacy?.composer?.image_model || '自动选择',
      image_aspect: legacy?.composer?.image_aspect || 'auto',
      analysis_model: legacy?.composer?.analysis_model || '自动选择',
      ...(legacy?.composer || {}),
      pending_references: Array.isArray(legacy?.composer?.pending_references)
        ? legacy.composer.pending_references
        : [],
    },
    updated_at: legacyUpdatedAt,
  }
}

function mergeAttempts(server: AgentAttempt[], local: AgentAttempt[]) {
  const merged = new Map<string, AgentAttempt>()
  for (const attempt of [...server, ...local]) {
    const current = merged.get(attempt.id)
    const messages = [...(current?.assistant_messages || []), ...(attempt.assistant_messages || [])]
      .filter((message, index, items) => items.findIndex(item => item.id === message.id) === index)
    const winner = !current || attempt.updated_at >= current.updated_at ? attempt : current
    const assistantMessages = winner.status !== 'failed' && winner.run?.phase !== 'failed'
      ? messages.filter(message => message.type !== 'error')
      : messages
    merged.set(attempt.id, { ...winner, assistant_messages: assistantMessages })
  }
  return [...merged.values()].sort((left, right) => left.created_at - right.created_at)
}

type SharedAgentWorkbench = {
  mergeSessions?: (serverSource: unknown, localSource: unknown) => AgentSessionV2
  summarizePriorTurns?: (session: AgentSessionV2, beforeSequence?: number) => Array<Record<string, unknown>>
}

function sharedAgentWorkbench() {
  return (window as typeof window & { LingDrawAgentWorkbench?: SharedAgentWorkbench }).LingDrawAgentWorkbench
}

export function mergeAgentSessionsByTurnId(
  serverSource?: AgentSessionV1 | AgentSessionV2 | null,
  localSource?: AgentSessionV1 | AgentSessionV2 | null,
) {
  const shared = sharedAgentWorkbench()
  if (shared?.mergeSessions) {
    return shared.mergeSessions(serverSource, localSource)
  }
  const server = migrateAgentSessionV2(serverSource)
  const local = migrateAgentSessionV2(localSource)
  const mergedTurns = new Map<string, AgentTurn>()
  for (const turn of [...server.turns, ...local.turns]) {
    const current = mergedTurns.get(turn.id)
    if (!current) {
      mergedTurns.set(turn.id, turn)
      continue
    }
    const winner = turn.updated_at >= current.updated_at ? turn : current
    const attempts = mergeAttempts(current.attempts, turn.attempts)
    mergedTurns.set(turn.id, {
      ...winner,
      attempts,
      active_attempt_id: attempts.some(item => item.id === winner.active_attempt_id)
        ? winner.active_attempt_id
        : attempts[attempts.length - 1]?.id || '',
    })
  }
  const turns = [...mergedTurns.values()]
    .sort((left, right) =>
      left.sequence - right.sequence
      || left.created_at - right.created_at
      || left.id.localeCompare(right.id),
    )
    .map((turn, index) => ({ ...turn, sequence: index + 1 }))
  const newest = local.updated_at >= server.updated_at ? local : server
  return {
    ...newest,
    schema_version: 2 as const,
    turns,
    active_turn_id: turns.some(turn => turn.id === newest.active_turn_id)
      ? newest.active_turn_id
      : turns[turns.length - 1]?.id || null,
    next_sequence: turns.length + 1,
    updated_at: Math.max(server.updated_at, local.updated_at),
  }
}

function flattenAgentMessages(session: AgentSessionV2) {
  return session.turns
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .flatMap(turn => [
      turn.user_message,
      ...turn.attempts.flatMap(attempt => attempt.assistant_messages),
    ])
}

export function summarizePriorTurns(session: AgentSessionV2, excludeTurnId = '') {
  const shared = sharedAgentWorkbench()
  if (shared?.summarizePriorTurns) {
    const excluded = session.turns.find(turn => turn.id === excludeTurnId)
    return shared.summarizePriorTurns(session, excluded?.sequence ?? Number.POSITIVE_INFINITY)
  }
  if (session.composer.mode_hint === 'new_session') return []
  const firstSequence = Math.max(1, Number(session.composer.thread_start_sequence || 1))
  return session.turns
    .filter(turn => turn.id !== excludeTurnId && turn.sequence >= firstSequence)
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-6)
    .map(turn => {
      const attempt = activeAttempt(turn)
      const run = attempt?.run
      return {
        turn_id: turn.id,
        parent_turn_id: turn.parent_turn_id || '',
        user_request: turn.user_message.content,
        route: run?.executionRoute || '',
        confirmed_answers: run?.clarificationAnswers || {},
        plan: run?.plan || null,
        result: run?.imageUrl ? {
          url: run.imageUrl,
          name: run.imageName || '',
          request_id: attempt?.request_id || '',
        } : null,
        quality: run?.review ? {
          passed: run.review.passed,
          score: run.review.overall_score,
          conclusion: run.review.conclusion,
        } : null,
      }
    })
}

export function focusPlacedResults(
  mountedEditor: Pick<Editor, 'select' | 'zoomToSelectionIfOffscreen'>,
  shapeIds: TLShapeId[],
) {
  if (!shapeIds.length) return
  mountedEditor.select(...shapeIds)
  mountedEditor.zoomToSelectionIfOffscreen(72, { inset: 96, animation: { duration: 180 } })
}

export function clarificationAnswersComplete(
  clarification: WorkbenchClarification,
  answers: Record<string, string[]>,
) {
  return clarification.questions.every(question => !question.required || Boolean(answers[question.id]?.length))
}

function clarificationAnswerPayload(
  clarification: WorkbenchClarification,
  answers: Record<string, string[]>,
) {
  return clarification.questions.flatMap(question => {
    const optionIds = answers[question.id] || []
    if (!optionIds.length) return []
    const selected = optionIds
      .map(optionId => question.options.find(option => option.id === optionId))
      .filter((option): option is WorkbenchClarificationOption => Boolean(option))
    return [{
      question_id: question.id,
      question: question.question,
      option_ids: selected.map(option => option.id),
      values: selected.map(option => option.description ? `${option.label}：${option.description}` : option.label),
    }]
  })
}

type AgentResponse = { conversation: { id: string }; message: ChatMessage }
type AgentRequestStatus = {
  status: 'running' | 'succeeded' | 'failed' | 'outcome_unknown'
  request_id: string
  conversation: { id: string }
  message: ChatMessage | null
  detail?: unknown
  upstream_task_id?: string
}

class AgentRequestStillRunningError extends Error {
  status: AgentRequestStatus

  constructor(status: AgentRequestStatus) {
    super('原任务仍在后台运行，正在继续查询，不会重复提交。')
    this.name = 'AgentRequestStillRunningError'
    this.status = status
  }
}

export async function pollAgentRequest(
  requestId: string,
  attempts = 600,
  delayMs = 2000,
  shouldContinue: () => boolean = () => true,
  scope: { surface?: 'gpt_chat' | 'design_agent'; contextId?: string } = {},
) {
  let latest: AgentRequestStatus | null = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!shouldContinue()) return null
    let status: AgentRequestStatus
    try {
      const query = new URLSearchParams()
      if (scope.surface) query.set('surface', scope.surface)
      if (scope.contextId) query.set('context_id', scope.contextId)
      const suffix = query.size ? `?${query.toString()}` : ''
      status = await api<AgentRequestStatus>(`/api/chat/agent/requests/${encodeURIComponent(requestId)}${suffix}`)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
    latest = status
    if (status.status !== 'running') return status
    if (attempt < attempts - 1) {
      const backoff = Math.min(10_000, Math.round(delayMs * (1.12 ** Math.min(attempt, 16))))
      await new Promise(resolve => window.setTimeout(resolve, backoff))
    }
  }
  return latest || {
    status: 'running',
    request_id: requestId,
    conversation: { id: '' },
    message: null,
  } satisfies AgentRequestStatus
}

export async function replayableWorkbenchRequest<T>(
  path: string,
  body: Record<string, unknown>,
  shouldContinue: () => boolean = () => true,
  attempts = 420,
  delayMs = 1000,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!shouldContinue()) throw new Error('设计场景已切换，已停止恢复原分析任务。')
    try {
      return await api<T>(path, { method: 'POST', body: JSON.stringify(body) })
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'workbench_request_in_progress') throw error
      if (attempt >= attempts - 1) throw new Error('设计分析仍在后台运行，请稍后再次打开此设计。')
      await new Promise(resolve => window.setTimeout(resolve, delayMs))
    }
  }
  throw new Error('设计分析恢复超时。')
}

function outcomeIsUnknown(error: unknown) {
  const recoveryOutcome = error && typeof error === 'object'
    ? String((error as { upstreamOutcome?: string }).upstreamOutcome || '')
    : ''
  return error instanceof ApiError
    ? error.upstreamOutcome === 'unknown' || error.code === 'generation_outcome_unknown'
    : recoveryOutcome === 'unknown'
      || /可能已经|可能已完成|没有自动重试|供应商操作日志|连接中断/.test(error instanceof Error ? error.message : String(error))
}

function appendFailureMessage(items: ChatMessage[], error: unknown, requestId: string) {
  const apiError = error instanceof ApiError ? error : null
  const stableRequestId = apiError?.requestId || requestId
  if (items.some(item => item.role === 'assistant' && item.request_id === stableRequestId)) return items
  const failure: ChatMessage = {
    id: `error-${stableRequestId}`,
    role: 'assistant',
    type: 'error',
    status: apiError?.upstreamOutcome === 'unknown' ? 'outcome_unknown' : 'failed',
    content: error instanceof Error ? error.message : String(error),
    request_id: stableRequestId,
    error_code: apiError?.code,
    retryable: apiError?.retryable,
  }
  return [...items, failure]
}

const INLINE_EDIT_TITLES: Record<InlineEditKind, string> = {
  quick: '快速编辑',
}

const SKILL_LABELS_ZH: Record<string, string> = {
  'Art Director': '艺术指导',
  'Creative Director': '创意总监',
  'Product Fidelity': '产品还原',
  'Quality Critic': '质量评审',
  'Instagram Post': '社媒海报',
  'Design Agent': '设计智能体',
  'Product Detail Page': '商品详情页',
}

function displaySkillName(name: string, lang: Lang) {
  return lang === 'zh' ? (SKILL_LABELS_ZH[name] || name) : name
}

function displayAgentAction(action: string, lang: Lang) {
  if (lang !== 'zh') return action.replaceAll('_', ' ')
  return ({
    generate_image: '生成图片',
    edit_image: '修改图片',
    chat: '方案分析',
  } as Record<string, string>)[action] || action.replaceAll('_', ' ')
}

function executionSystemPrompt(route: AgentRunView['executionRoute'] | undefined, skill: string) {
  if (route === 'edit_image') return `使用「${skill}」基于参考图完成指定修改，创建新版本，不覆盖原图。`
  if (route === 'direct_generate') return `使用「${skill}」按需求路由器整理后的完整提示词直接生成可交付图片。`
  return `使用「${skill}」完成可交付设计，严格执行已批准方案并调用图片生成能力，不要只回复文字。`
}

export function availableImageModelOptions(providers: ApiProvider[]): ImageModelOption[] {
  const keylessProtocols = new Set(['codex', 'gemini-cli'])
  const enabled = providers.filter(provider => provider.enabled !== false)
  const usableImages = enabled.filter(provider =>
    (provider.image_models?.length || 0) > 0
    && (provider.has_key || keylessProtocols.has(String(provider.protocol || '').toLowerCase())),
  )
  return usableImages.flatMap(provider => (provider.image_models || []).map(model => ({
    value: `${provider.id}::${model}`,
    model,
    providerId: provider.id,
    providerName: provider.name || provider.id,
  })))
}

export function availableAnalysisModelOptions(providers: ApiProvider[]): AnalysisModelOption[] {
  const keylessProtocols = new Set(['codex', 'gemini-cli'])
  return providers
    .filter(provider => provider.enabled !== false)
    .filter(provider =>
      (provider.chat_models?.length || 0) > 0
      && (provider.has_key || keylessProtocols.has(String(provider.protocol || '').toLowerCase())),
    )
    .flatMap(provider => (provider.chat_models || []).map(model => ({
      value: `${provider.id}::${model}`,
      model,
      providerId: provider.id,
      providerName: provider.name || provider.id,
    })))
}

export function resolveGenerationRoute(
  providers: ApiProvider[],
  requestedModel = '自动选择',
  requestedAnalysisModel = '自动选择',
) {
  const keylessProtocols = new Set(['codex', 'gemini-cli'])
  const enabled = providers.filter(provider => provider.enabled !== false)
  const usableImages = enabled.filter(provider =>
    (provider.image_models?.length || 0) > 0
    && (provider.has_key || keylessProtocols.has(String(provider.protocol || '').toLowerCase())),
  )
  const requested = String(requestedModel || '').trim()
  const separator = requested.indexOf('::')
  const requestedProviderId = separator > 0 ? requested.slice(0, separator) : ''
  const requestedModelName = separator > 0 ? requested.slice(separator + 2) : requested
  const exactProvider = usableImages.find(provider =>
    (!requestedProviderId || provider.id === requestedProviderId)
    && provider.image_models?.some(model => model.toLowerCase() === requestedModelName.toLowerCase()),
  )
  const wantsGptImage = /gpt\s*-?\s*image/i.test(requestedModelName)
  const gptImageProvider = wantsGptImage
    ? usableImages.find(provider => provider.image_models?.some(model => /gpt-image/i.test(model)))
    : undefined
  const imageProvider = exactProvider
    || gptImageProvider
    || usableImages.find(provider => provider.primary)
    || usableImages[0]
  const imageModel = exactProvider
    ? exactProvider.image_models?.find(model => model.toLowerCase() === requestedModelName.toLowerCase())
    : wantsGptImage
    ? imageProvider?.image_models?.find(model => /gpt-image/i.test(model))
    : imageProvider?.image_models?.[0]
  const usableChats = enabled.filter(provider =>
    (provider.chat_models?.length || 0) > 0
    && (provider.has_key || keylessProtocols.has(String(provider.protocol || '').toLowerCase())),
  )
  const requestedAnalysis = String(requestedAnalysisModel || '').trim()
  const analysisSeparator = requestedAnalysis.indexOf('::')
  const requestedAnalysisProviderId = analysisSeparator > 0
    ? requestedAnalysis.slice(0, analysisSeparator)
    : ''
  const requestedAnalysisModelName = analysisSeparator > 0
    ? requestedAnalysis.slice(analysisSeparator + 2)
    : requestedAnalysis
  const hasExplicitAnalysisRequest = Boolean(requestedAnalysis && requestedAnalysis !== '自动选择')
  const exactChatRoute = hasExplicitAnalysisRequest
    ? usableChats.flatMap(provider => (provider.chat_models || []).map(model => ({ provider, model })))
      .find(candidate =>
        (!requestedAnalysisProviderId || candidate.provider.id === requestedAnalysisProviderId)
        && candidate.model.toLowerCase() === requestedAnalysisModelName.toLowerCase(),
      )
    : undefined
  const defaultChatProvider = usableChats.find(provider => provider.primary) || usableChats[0]
  const chatRoute = exactChatRoute || (!hasExplicitAnalysisRequest && defaultChatProvider
    ? { provider: defaultChatProvider, model: defaultChatProvider.chat_models?.[0] || '' }
    : undefined)
  return {
    provider: chatRoute?.provider.id || requestedAnalysisProviderId || imageProvider?.id || 'comfly',
    chat_model: chatRoute?.model || (hasExplicitAnalysisRequest ? requestedAnalysisModelName : ''),
    allow_chat_fallback: !hasExplicitAnalysisRequest,
    image_provider: imageProvider?.id || 'comfly',
    image_model: imageModel || '',
  }
}

const emptyDocument = (): SmartCanvasDocument => ({
  schema_version: 2,
  engine: 'fabric',
  snapshot: null,
  pending_placements: [],
  applied_placement_ids: [],
  agent_session: freshAgentSession(),
})

function isSupportedCanvasDocument(value: unknown): value is SmartCanvasDocument {
  if (!value || typeof value !== 'object') return false
  const document = value as Partial<SmartCanvasDocument>
  return (document.engine === 'fabric' && document.schema_version === 2)
    || (document.engine === 'tldraw' && document.schema_version === 1)
}

class DocumentConflictError extends Error {}

class AuthenticationRequiredError extends Error {
  constructor(message = '登录已失效') {
    super(message)
    this.name = 'AuthenticationRequiredError'
  }
}

export function classifyDocumentRequestError(error: unknown): 'auth-required' | 'offline' | 'error' {
  if (error instanceof AuthenticationRequiredError) return 'auth-required'
  if (error instanceof ApiError) {
    if (error.status === 401) return 'auth-required'
    if (error.status === 408 || error.status === 429 || error.status >= 500) return 'offline'
    return 'error'
  }
  return error instanceof TypeError ? 'offline' : 'error'
}

export function isUnavailableCanvasDocumentError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 404
}

// Localhost-only visual/test fixture. Production Agent runs never read this data.
const LOCAL_QA_ONLY_PLAN: WorkbenchDesignPlan = {
  acknowledgement: '已结合端午礼盒、社媒发布规格和品牌资料完成任务分析。',
  title: '端午礼盒社媒视觉方案（测试夹具）',
  sections: [
    { kind: 'positioning', title: '测试定位', summary: '面向节日送礼场景突出礼盒质感。', details: ['强调礼盒与粽子主体'], colors: [] },
    { kind: 'audience', title: '测试受众', summary: '聚焦年轻家庭与企业礼赠用户。', details: ['优先保证移动端识别'], colors: [] },
    { kind: 'layout', title: '测试构图', summary: '建立标题、礼盒与食品的清晰阅读顺序。', details: ['为标题保留安全区'], colors: [] },
    { kind: 'color', title: '测试配色', summary: '以品牌绿和暖金建立节庆质感。', details: [], colors: [{ name: '品牌绿', value: '#245C3A' }, { name: '暖金', value: '#D9B56D' }] },
  ],
  generation_prompt: '生成一张端午礼盒社媒主视觉，突出礼盒、粽子和清晰标题安全区。',
}

const LOCAL_QA_ONLY_REVIEW: WorkbenchResultReview = {
  title: '测试成图复盘',
  summary: '礼盒主体清楚，标题区域仍有优化空间。',
  overall_score: 84,
  passed: true,
  highlights: [
    { title: '礼盒识别清楚', detail: '包装和粽子形成明确的前后层次。' },
    { title: '节庆氛围自然', detail: '绿色与暖金符合端午礼赠语境。' },
  ],
  checks: [
    { label: '规格', passed: true, score: 94, detail: '符合方形社媒交付尺寸。' },
    { label: '标题安全区', passed: false, score: 68, detail: '标题上方留白偏紧。' },
    { label: '主体清晰度', passed: true, score: 90, detail: '礼盒与粽子边缘清楚。' },
    { label: '品牌一致性', passed: true, score: 86, detail: '主色和礼赠气质一致。' },
  ],
  conclusion: '成图可用于内部评审，建议先增加标题留白再发布。',
  suggestions: [
    { label: '增加标题留白', instruction: '将标题区域向下移动并增加顶部留白，保持礼盒和粽子主体不变。' },
    { label: '生成竖版延展', instruction: '基于当前图片生成 4:5 竖版延展，保持品牌配色和主体层级。' },
  ],
}

const clientId = `design-agent-${crypto.randomUUID()}`

function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise(resolve => {
    const image = new Image()
    image.onload = () => {
      const ratio = Math.min(900 / image.naturalWidth, 620 / image.naturalHeight, 1)
      resolve({ w: Math.max(160, image.naturalWidth * ratio), h: Math.max(120, image.naturalHeight * ratio) })
    }
    image.onerror = () => resolve({ w: 640, h: 420 })
    image.src = url
  })
}

function shapeLineage(shape: TLShape | undefined) {
  if (!shape || (shape.type !== 'design-image' && shape.type !== 'design-generator')) return null
  try {
    return JSON.parse((shape as DesignImageShape | DesignGeneratorShape).props.lineage) as Record<string, unknown>
  } catch {
    return null
  }
}

function downloadUrl(url: string, name: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name || 'lingdraw-image.png'
  anchor.target = '_blank'
  anchor.rel = 'noreferrer'
  anchor.click()
}

function canvasPngBlob(canvas: HTMLCanvasElement, errorMessage: string) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error(errorMessage)), 'image/png')
  })
}

function loadEditableImage(url: string) {
  return fetch(url, { credentials: 'same-origin' }).then(async response => {
    if (!response.ok) throw new Error(`无法读取原图（HTTP ${response.status}）`)
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('原图无法解码，不能创建编辑蒙版'))
        image.src = objectUrl
      })
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  })
}

async function createMarkerRegionUpload(url: string, xRatio: number, yRatio: number, baseName: string) {
  const source = await loadEditableImage(url)
  const width = Math.max(1, source.naturalWidth)
  const height = Math.max(1, source.naturalHeight)
  const side = markerRecognitionCropSide(width, height)
  const centerX = Math.round(Math.max(0, Math.min(1, xRatio)) * width)
  const centerY = Math.round(Math.max(0, Math.min(1, yRatio)) * height)
  const sourceX = Math.max(0, Math.min(width - side, Math.round(centerX - side / 2)))
  const sourceY = Math.max(0, Math.min(height - side, Math.round(centerY - side / 2)))
  const cropWidth = Math.min(side, width)
  const cropHeight = Math.min(side, height)
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 512
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建标记识别图')
  context.fillStyle = '#f5f6f8'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const overviewScale = Math.min(248 / width, 488 / height)
  const overviewWidth = width * overviewScale
  const overviewHeight = height * overviewScale
  context.drawImage(source, 8 + (248 - overviewWidth) / 2, 12 + (488 - overviewHeight) / 2, overviewWidth, overviewHeight)
  context.fillStyle = 'rgba(255,255,255,.94)'
  context.fillRect(256, 0, 1024, 512)
  context.drawImage(source, sourceX, sourceY, cropWidth, cropHeight, 256, 0, 512, 512)
  context.drawImage(source, sourceX, sourceY, cropWidth, cropHeight, 768, 0, 512, 512)
  context.strokeStyle = 'rgba(25,31,44,.18)'
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(255.5, 0)
  context.lineTo(255.5, 512)
  context.moveTo(767.5, 0)
  context.lineTo(767.5, 512)
  context.stroke()
  const markerX = 768 + Math.max(0, Math.min(512, ((centerX - sourceX) / cropWidth) * 512))
  const markerY = Math.max(0, Math.min(canvas.height, ((centerY - sourceY) / cropHeight) * canvas.height))
  context.save()
  context.strokeStyle = '#1677ff'
  context.lineWidth = 4
  context.shadowColor = 'rgba(255,255,255,.95)'
  context.shadowBlur = 3
  context.beginPath()
  context.arc(markerX, markerY, 26, 0, Math.PI * 2)
  context.stroke()
  context.beginPath()
  context.moveTo(markerX - 40, markerY)
  context.lineTo(markerX - 30, markerY)
  context.moveTo(markerX + 30, markerY)
  context.lineTo(markerX + 40, markerY)
  context.moveTo(markerX, markerY - 40)
  context.lineTo(markerX, markerY - 30)
  context.moveTo(markerX, markerY + 30)
  context.lineTo(markerX, markerY + 40)
  context.stroke()
  context.restore()
  const blob = await canvasPngBlob(canvas, '无法创建标记识别图')
  const form = new FormData()
  form.append('files', new File([blob], `${baseName}-marker-region.png`, { type: 'image/png' }))
  const response = await fetch('/api/ai/upload', { method: 'POST', credentials: 'same-origin', body: form })
  const payload = await response.json()
  if (!response.ok) throw new Error(String(payload.detail || '标记识别图上传失败'))
  const file = payload.files?.[0]
  if (!file?.url) throw new Error('标记识别图上传后没有返回地址')
  return String(file.url)
}

function fitComposerTextarea(element: HTMLTextAreaElement) {
  element.style.height = '0px'
  element.style.height = `${Math.min(180, Math.max(56, element.scrollHeight))}px`
}

export function updateRunningCanvasIds(
  current: readonly string[],
  canvasId: string,
  running: boolean,
) {
  if (!canvasId) return [...current]
  if (running) return current.includes(canvasId) ? [...current] : [...current, canvasId]
  return current.filter(id => id !== canvasId)
}

export function agentRunStageCopy(
  phase: 'analyzing' | 'generating' | 'reviewing',
  elapsedSeconds: number,
  lang: Lang = 'zh',
): readonly [string, string] {
  if (lang === 'en') {
    if (phase === 'analyzing') return ['Analyzing the request', 'The Agent is combining the brief, skills, brand context, and references into a design plan.']
    if (phase === 'reviewing') return ['Reviewing the generated result', 'The image is ready and the Agent is running its quality review.']
    if (elapsedSeconds >= 300) return ['Generating canvas results', `The image provider is still working after ${Math.floor(elapsedSeconds / 60)} minutes. You can switch or create a design; this task will keep running in the background.`]
    if (elapsedSeconds >= 90) return ['Generating canvas results', 'The image provider is still working. You can switch or create a design; this task will keep running in the background.']
    return ['Generating canvas results', 'The plan is ready and the image provider is generating the result.']
  }
  if (phase === 'analyzing') return ['正在分析需求', 'Agent 正在结合 Brief、Skill、品牌资料与参考素材形成设计方案']
  if (phase === 'reviewing') return ['正在复盘生成结果', '图片已落位，Agent 正在查看实际成图并执行质量检查']
  if (elapsedSeconds >= 300) return ['正在生成画布成果', `上游图片仍在生成（已等待 ${Math.floor(elapsedSeconds / 60)} 分钟）；多图或复杂任务可能耗时较长。可以切换或新建设计，任务会继续在后台运行`]
  if (elapsedSeconds >= 90) return ['正在生成画布成果', '上游图片仍在生成；可以切换或新建设计，当前任务会继续在后台运行']
  return ['正在生成画布成果', '已完成方案分析，正在按真实方案调用图片生成能力']
}

export default function App() {
  const qaState = new URLSearchParams(location.search).get('qa_state')
  const localQaState = ['localhost', '127.0.0.1'].includes(location.hostname)
    && ['analyzing', 'clarifying', 'generating', 'reviewing', 'completed'].includes(qaState || '')
  const [lang, setLang] = useState<Lang>('zh')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('studio_theme') === 'dark' || localStorage.getItem('canvas_theme') === 'dark'
        ? 'dark'
        : 'light'
    } catch {
      return 'light'
    }
  })
  const [canvases, setCanvases] = useState<CanvasSummary[]>([])
  const [canvasId, setCanvasId] = useState('')
  const [canvasTitle, setCanvasTitle] = useState('Untitled')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [selectedShapes, setSelectedShapes] = useState<TLShape[]>([])
  const [zoom, setZoom] = useState(100)
  const [cameraKey, setCameraKey] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('loading')
  const [canvasReady, setCanvasReady] = useState(false)
  const [unavailableCanvasId, setUnavailableCanvasId] = useState('')
  const [documentState, setDocumentState] = useState<SmartCanvasDocument>(emptyDocument)
  const [conflict, setConflict] = useState<ConflictPayload | null>(null)
  const [rightOpen, setRightOpen] = useState(true)
  const [drawer, setDrawer] = useState<'layers' | 'assets' | ''>('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversationId, setConversationId] = useState('')
  const [agentSession, setAgentSession] = useState<AgentSessionV2>(freshAgentSession)
  const [prompt, setPrompt] = useState('')
  const [runningCanvasIds, setRunningCanvasIds] = useState<string[]>([])
  const [chatError, setChatError] = useState('')
  const [composerMode, setComposerMode] = useState<'agent' | 'image' | 'video'>('agent')
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [selectedImageModel, setSelectedImageModel] = useState('自动选择')
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false)
  const [selectedImageAspect, setSelectedImageAspect] = useState<ImageAspectRatio>('auto')
  const [analysisModelMenuOpen, setAnalysisModelMenuOpen] = useState(false)
  const [selectedAnalysisModel, setSelectedAnalysisModel] = useState('自动选择')
  const [activeSkill, setActiveSkill] = useState('')
  const [inlineEditOpen, setInlineEditOpen] = useState(false)
  const [inlineEditKind, setInlineEditKind] = useState<InlineEditKind>('quick')
  const [inlineEditPrompt, setInlineEditPrompt] = useState('')
  const [eraserOpen, setEraserOpen] = useState(false)
  const [eraserBrushSize, setEraserBrushSize] = useState(36)
  const [eraserStrokeCount, setEraserStrokeCount] = useState(0)
  const [maskUploading, setMaskUploading] = useState(false)
  const [expansionOpen, setExpansionOpen] = useState(false)
  const [expansionAspect, setExpansionAspect] = useState<ExpansionAspect>('original')
  const [expansionScale, setExpansionScale] = useState<ExpansionResolutionScale>(1)
  const [expansionPreset, setExpansionPreset] = useState('general')
  const [customExpansionPadding, setCustomExpansionPadding] = useState<ExpansionPadding | null>(null)
  const [expansionUploading, setExpansionUploading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [referenceUploading, setReferenceUploading] = useState(false)
  const [referenceDragActive, setReferenceDragActive] = useState(false)
  const [pendingReferences, setPendingReferences] = useState<ReferenceImage[]>([])
  const [notice, setNotice] = useState('')
  const [skills, setSkills] = useState<Array<{ id: string; name: string }>>([])
  const [points, setPoints] = useState(0)
  const [imageEditCost, setImageEditCost] = useState(IMAGE_EDIT_ESTIMATED_COST)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingDeleteCanvas, setPendingDeleteCanvas] = useState<CanvasSummary | null>(null)
  const [activeTool, setActiveTool] = useState('select')
  const [markerMode, setMarkerMode] = useState(false)
  const [markerQuickPrompt, setMarkerQuickPrompt] = useState('')
  const [markerQuickEditorOpen, setMarkerQuickEditorOpen] = useState(false)
  const [markerHover, setMarkerHover] = useState<{ targetId: string; x: number; y: number } | null>(null)
  const [focusedMarkerId, setFocusedMarkerId] = useState('')
  const [markerFocusSequence, setMarkerFocusSequence] = useState(0)
  const [markerPreviewVisible, setMarkerPreviewVisible] = useState(false)
  const [markerPreviewAnchor, setMarkerPreviewAnchor] = useState<number | null>(null)
  const [agentOverlay, setAgentOverlay] = useState<'' | 'history' | 'help' | 'prompts'>('')
  const [conversationHistory, setConversationHistory] = useState<ConversationSummary[]>([])
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([])
  const [apiProviders, setApiProviders] = useState<ApiProvider[]>([])
  const [agentRun, setAgentRun] = useState<AgentRunView | null>(null)
  const [showLatestButton, setShowLatestButton] = useState(false)
  const [composerHeight, setComposerHeight] = useState(132)
  const [selectedPixelSize, setSelectedPixelSize] = useState<{ w: number; h: number } | null>(null)
  const [imageContextBarSize, setImageContextBarSize] = useState({ width: 720, height: 44 })

  const fileInputRef = useRef<HTMLInputElement>(null)
  const agentFileInputRef = useRef<HTMLInputElement>(null)
  const referenceUploadKeysRef = useRef(new Set<string>())
  const referenceUploadCountRef = useRef(0)
  const hydratedRef = useRef(false)
  const documentRef = useRef(documentState)
  const updatedAtRef = useRef(0)
  const activeCanvasRef = useRef('')
  const loadEpochRef = useRef(0)
  const saveTimerRef = useRef<number | null>(null)
  const saveQueueRef = useRef<DocumentSaveQueue<PendingDocumentSave> | null>(null)
  const authenticationRequiredRef = useRef(false)
  const switchingCanvasRef = useRef(false)
  const unavailableRecoveryRef = useRef(false)
  const recoveredRunsRef = useRef(new Set<string>())
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const markerQuickPromptRef = useRef<HTMLTextAreaElement>(null)
  const markerPreviewTimerRef = useRef<number | null>(null)
  const canvasStageRef = useRef<HTMLElement>(null)
  const agentMessagesRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const imageContextBarRef = useRef<HTMLDivElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const maskDrawingRef = useRef(false)
  const maskLastPointRef = useRef<{ x: number; y: number } | null>(null)
  const expansionDragRef = useRef<{
    pointerId: number
    handle: ExpansionHandle
    startX: number
    startY: number
    padding: ExpansionPadding
    pixelScaleX: number
    pixelScaleY: number
  } | null>(null)
  const processingPlacementsRef = useRef(false)
  const activeDraftClientRef = useRef(clientId)
  const agentSessionRef = useRef(agentSession)
  const activeTurnIdRef = useRef<string | null>(null)
  const workflowPauseRequestsRef = useRef(new Set<string>())
  const stickToBottomRef = useRef(true)
  const runningCanvasIdsRef = useRef(new Set<string>())
  const localQaCanvasIdRef = useRef('')
  const sending = Boolean(canvasId && runningCanvasIds.includes(canvasId))

  const beginCanvasRun = useCallback((id: string) => {
    if (!id || runningCanvasIdsRef.current.has(id)) return false
    runningCanvasIdsRef.current.add(id)
    setRunningCanvasIds(current => updateRunningCanvasIds(current, id, true))
    return true
  }, [])

  const finishCanvasRun = useCallback((id: string) => {
    runningCanvasIdsRef.current.delete(id)
    setRunningCanvasIds(current => updateRunningCanvasIds(current, id, false))
  }, [])

  const abandonUnavailableCanvas = useCallback((id: string) => {
    if (!id || activeCanvasRef.current !== id) return false
    hydratedRef.current = false
    loadEpochRef.current += 1
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    saveQueueRef.current?.reset()
    activeCanvasRef.current = ''
    discardCanvasDocumentDraft(id, clientId)
    discardAgentSessionDraft(id, clientId)
    try {
      if (localStorage.getItem('design_agent_canvas') === id) {
        localStorage.removeItem('design_agent_canvas')
      }
    } catch {
      // Stopping the in-memory save loop does not depend on browser storage.
    }
    setCanvases(items => items.filter(item => item.id !== id))
    setConflict(null)
    setCanvasReady(false)
    setSaveState('loading')
    setUnavailableCanvasId(id)
    return true
  }, [])

  const syncAgentSessionMirrors = (session: AgentSessionV2) => {
    agentSessionRef.current = session
    setAgentSession(session)
    activeTurnIdRef.current = session.active_turn_id
    setConversationId(session.conversation_id || '')
    setMessages(flattenAgentMessages(session))
    const currentTurn = session.turns.find(turn => turn.id === session.active_turn_id)
      || session.turns[session.turns.length - 1]
    setAgentRun(activeAttempt(currentTurn)?.run || null)
    setPrompt(session.composer?.prompt || '')
    setComposerMode(session.composer?.mode || 'agent')
    setActiveSkill(session.composer?.active_skill || '')
    setSelectedImageModel(session.composer?.image_model || '自动选择')
    setSelectedImageAspect(session.composer?.image_aspect || 'auto')
    setSelectedAnalysisModel(session.composer?.analysis_model || '自动选择')
    setPendingReferences(session.composer?.pending_references || [])
  }

  if (!saveQueueRef.current) {
    saveQueueRef.current = createDocumentSaveQueue(async attempt => {
      const response = await fetch(`/api/canvases/${encodeURIComponent(attempt.canvas_id)}/document`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document: attempt.document,
          base_updated_at: attempt.canvas_id === activeCanvasRef.current
            ? updatedAtRef.current
            : attempt.base_updated_at,
          client_id: clientId,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (response.status === 401) {
        throw new AuthenticationRequiredError(String(result.detail || '登录已失效'))
      }
      if (response.status === 404) {
        abandonUnavailableCanvas(attempt.canvas_id)
        return
      }
      if (response.status === 409) {
        if (attempt.canvas_id === activeCanvasRef.current) {
          const detail = result.detail || {}
          const serverDocument = (isSupportedCanvasDocument(detail.document)
            ? detail.document
            : emptyDocument()) as SmartCanvasDocument
          const mergedSession = mergeAgentSessionsByTurnId(
            serverDocument.agent_session,
            attempt.document.agent_session,
          )
          const mergedServerDocument = { ...serverDocument, agent_session: mergedSession }
          const rebasePendingSession = () => saveQueueRef.current?.rebaseLatest(pending => {
            if (pending.canvas_id !== attempt.canvas_id) return pending
            const rebasedSession = mergeAgentSessionsByTurnId(
              mergedSession,
              pending.document.agent_session,
            )
            if (
              JSON.stringify(rebasedSession) === JSON.stringify(pending.document.agent_session)
            ) return pending
            return {
              ...pending,
              document: { ...pending.document, agent_session: rebasedSession },
            }
          })
          const localComparable = { ...attempt.document, agent_session: undefined }
          const serverComparable = { ...serverDocument, agent_session: undefined }
          if (JSON.stringify(localComparable) === JSON.stringify(serverComparable)) {
            const retryResponse = await fetch(`/api/canvases/${encodeURIComponent(attempt.canvas_id)}/document`, {
              method: 'PUT',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                document: mergedServerDocument,
                base_updated_at: Number(detail.updated_at || 0),
                client_id: clientId,
              }),
            })
            const retryResult = await retryResponse.json().catch(() => ({}))
            if (retryResponse.status === 401) {
              throw new AuthenticationRequiredError(String(retryResult.detail || '登录已失效'))
            }
            if (retryResponse.status === 404) {
              abandonUnavailableCanvas(attempt.canvas_id)
              return
            }
            if (retryResponse.ok) {
              const savedUpdatedAt = Number(retryResult.updated_at || 0)
              updatedAtRef.current = savedUpdatedAt
              documentRef.current = mergedServerDocument
              syncAgentSessionMirrors(mergedSession)
              setDocumentState(mergedServerDocument)
              rebasePendingSession()
              setConflict(null)
              setSaveState('saved')
              rebaseOrClearAgentSessionDraft(attempt.canvas_id, clientId, mergedSession, savedUpdatedAt)
              rebaseOrClearCanvasDocumentDraft(attempt.canvas_id, clientId, mergedServerDocument, savedUpdatedAt)
              return
            }
            if (retryResponse.status !== 409) {
              throw new ApiError(retryResponse.status, retryResult)
            }
          }
          documentRef.current = { ...attempt.document, agent_session: mergedSession }
          syncAgentSessionMirrors(mergedSession)
          setDocumentState(documentRef.current)
          rebasePendingSession()
          setConflict({
            document: mergedServerDocument,
            updated_at: Number(detail.updated_at || 0),
            message: detail.message,
            draft_client_id: activeDraftClientRef.current,
          })
          setSaveState('conflict')
        }
        throw new DocumentConflictError('canvas document conflict')
      }
      if (!response.ok) throw new ApiError(response.status, result)
      if (attempt.canvas_id !== activeCanvasRef.current) return
      authenticationRequiredRef.current = false
      const savedUpdatedAt = Number(result.updated_at || 0)
      updatedAtRef.current = savedUpdatedAt
      rebaseOrClearAgentSessionDraft(attempt.canvas_id, clientId, attempt.document.agent_session, savedUpdatedAt)
      rebaseOrClearCanvasDocumentDraft(attempt.canvas_id, clientId, attempt.document, savedUpdatedAt)
      if (activeDraftClientRef.current !== clientId) {
        discardCanvasDocumentDraft(attempt.canvas_id, activeDraftClientRef.current)
        activeDraftClientRef.current = clientId
      }
    })
  }

  useEffect(() => { documentRef.current = documentState }, [documentState])
  useEffect(() => { agentSessionRef.current = agentSession }, [agentSession])

  const updateAgentSession = useCallback((updater: (current: AgentSessionV2) => AgentSessionV2) => {
    setAgentSession(current => {
      const next = updater(current)
      agentSessionRef.current = next
      return next
    })
  }, [])

  const appendTurnAssistant = useCallback((
    turnId: string,
    requestId: string,
    message: ChatMessage,
    status: AgentAttempt['status'],
  ) => {
    updateAgentSession(current => ({
      ...current,
      turns: current.turns.map(turn => {
        if (turn.id !== turnId) return turn
        const attempts = turn.attempts.map(attempt => {
          if (attempt.request_id !== requestId && attempt.id !== requestId) return attempt
          const assistantMessages = attempt.assistant_messages.some(item => item.id === message.id)
            ? attempt.assistant_messages.map(item => item.id === message.id ? message : item)
            : [...attempt.assistant_messages.filter(item => item.type !== 'error'), message]
          return { ...attempt, assistant_messages: assistantMessages, status, updated_at: Date.now() }
        })
        return { ...turn, attempts, updated_at: Date.now() }
      }),
      updated_at: Date.now(),
    }))
  }, [updateAgentSession])

  const updateTurnRun = useCallback((
    turnId: string,
    runId: string,
    updater: (run: AgentRunView) => AgentRunView,
  ) => {
    updateAgentSession(current => ({
      ...current,
      turns: current.turns.map(turn => {
        if (turn.id !== turnId) return turn
        const attempts = turn.attempts.map(attempt => {
          if (attempt.id !== runId && attempt.request_id !== runId) return attempt
          const run = attempt.run ? updater(attempt.run) : attempt.run
          return { ...attempt, run, status: agentAttemptStatus(run), updated_at: Date.now() }
        })
        return { ...turn, attempts, updated_at: Date.now() }
      }),
      updated_at: Date.now(),
    }))
  }, [updateAgentSession])

  useEffect(() => {
    if (!agentRun || !activeTurnIdRef.current) return
    const turnId = activeTurnIdRef.current
    updateAgentSession(current => ({
      ...current,
      active_turn_id: turnId,
      turns: current.turns.map(turn => {
        if (turn.id !== turnId) return turn
        const attempts = turn.attempts.map(attempt =>
          attempt.id === agentRun.id || attempt.request_id === agentRun.id
            ? { ...attempt, run: agentRun, status: agentAttemptStatus(agentRun), updated_at: Date.now() }
            : attempt,
        )
        return {
          ...turn,
          attempts,
          active_attempt_id: attempts.some(attempt => attempt.id === agentRun.id)
            ? agentRun.id
            : turn.active_attempt_id,
          updated_at: Date.now(),
        }
      }),
      updated_at: Date.now(),
    }))
  }, [agentRun, updateAgentSession])

  useEffect(() => {
    updateAgentSession(current => {
      const composer = {
        ...current.composer,
        prompt,
        mode: composerMode,
        active_skill: activeSkill,
        image_model: selectedImageModel,
        image_aspect: selectedImageAspect,
        analysis_model: selectedAnalysisModel,
        pending_references: pendingReferences,
      }
      if (
        current.conversation_id === conversationId
        && JSON.stringify(current.composer) === JSON.stringify(composer)
      ) return current
      return {
        ...current,
        conversation_id: conversationId,
        composer,
        updated_at: Date.now(),
      }
    })
  }, [activeSkill, composerMode, conversationId, pendingReferences, prompt, selectedAnalysisModel, selectedImageAspect, selectedImageModel, updateAgentSession])

  useEffect(() => {
    if (!localQaState) return
    if (editor && saveState !== 'saved') return
    if (!canvasId) return
    if (!localQaCanvasIdRef.current) localQaCanvasIdRef.current = canvasId
    if (localQaCanvasIdRef.current !== canvasId) return
    const promptText = '为端午节粽子礼盒新品发布设计一张 Instagram 方形海报，文字清晰，适合品牌社交媒体发布。'
    const qaUser: ChatMessage = { id: 'qa-user', role: 'user', content: promptText, request_id: 'qa-run' }
    setMessages([qaUser])
    const qaPhase = qaState as Exclude<AgentRunPhase, 'failed'>
    if (['analyzing', 'generating', 'reviewing'].includes(qaPhase)) beginCanvasRun(canvasId)
    else finishCanvasRun(canvasId)
    const hasPlan = ['generating', 'reviewing', 'completed'].includes(qaPhase)
    const hasImage = qaPhase === 'reviewing' || qaPhase === 'completed'
    const qaRun: AgentRunView = {
      id: 'qa-run',
      phase: qaPhase,
      prompt: promptText,
      skill: 'Instagram Post',
      model: 'GPT Image 2',
      startedAt: Date.now() - 27000,
      clarification: qaPhase === 'clarifying' ? {
        id: 'qa-clarification',
        introduction: '用途、视觉方向和文案层级会显著改变最终构图，请先确认最重要的选择。',
        questions: [{
          id: 'qa-style',
          question: '这张端午海报更偏向哪种视觉方向？',
          description: '需求路由器会根据选择决定继续规划还是直接生成。',
          selection: 'single',
          required: true,
          recommended_option_id: 'qa-modern',
          options: [
            { id: 'qa-modern', label: '现代简约', description: '大留白、青绿色调与克制排版' },
            { id: 'qa-traditional', label: '传统国风', description: '书法、纹样与节庆层次' },
            { id: 'qa-commercial', label: '商业促销', description: '突出产品、价格和转化信息' },
          ],
        }],
      } : undefined,
      routingReason: qaPhase === 'clarifying' ? '当前 Brief 尚未确定会显著影响画面的核心视觉方向。' : undefined,
      plan: hasPlan ? LOCAL_QA_ONLY_PLAN : undefined,
      review: qaPhase === 'completed' ? LOCAL_QA_ONLY_REVIEW : undefined,
      imageUrl: hasImage ? '/assets/output/workflow-test_1784617779_bd85ad0854.png' : undefined,
      imageName: '端午礼盒社媒海报',
    }
    setAgentRun(qaRun)
    activeTurnIdRef.current = 'qa-turn'
    updateAgentSession(current => ({
      ...current,
      active_turn_id: 'qa-turn',
      next_sequence: 2,
      turns: [{
        id: 'qa-turn',
        sequence: 1,
        user_message: qaUser,
        references: [],
        attempts: [{
          id: qaRun.id,
          request_id: qaRun.id,
          status: agentAttemptStatus(qaRun),
          run: qaRun,
          assistant_messages: [],
          created_at: qaRun.startedAt,
          updated_at: Date.now(),
        }],
        active_attempt_id: qaRun.id,
        created_at: qaRun.startedAt,
        updated_at: Date.now(),
      }],
      updated_at: Date.now(),
    }))
  }, [beginCanvasRun, canvasId, editor, finishCanvasRun, localQaState, qaState, saveState, updateAgentSession])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const node = agentMessagesRef.current
      if (node && typeof node.scrollTo === 'function' && stickToBottomRef.current) {
        node.scrollTo({ top: node.scrollHeight, behavior: agentRun?.phase === 'completed' ? 'smooth' : 'auto' })
        setShowLatestButton(false)
      } else if (node) {
        setShowLatestButton(true)
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [agentRun?.phase, agentSession.turns, messages.length])

  useEffect(() => {
    const node = composerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const height = Math.ceil(entries[0]?.contentRect.height || node.getBoundingClientRect().height)
      setComposerHeight(Math.max(112, height))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!prompt && promptRef.current) promptRef.current.style.height = '56px'
  }, [prompt])

  const currentCanvas = useMemo(
    () => canvases.find(item => item.id === canvasId),
    [canvases, canvasId],
  )
  const visibleAgentTurns = useMemo(() => {
    const firstSequence = Math.max(1, Number(agentSession.composer.thread_start_sequence || 1))
    return agentSession.turns
      .filter(turn => turn.sequence >= firstSequence && !shouldHideCanvasToolTurn(turn.user_message.content))
      .slice()
      .sort((left, right) => left.sequence - right.sequence)
  }, [agentSession.composer.thread_start_sequence, agentSession.turns])

  const queueDocumentSave = useCallback((next: SmartCanvasDocument, syncState = false) => {
    const activeCanvas = activeCanvasRef.current
    if (!activeCanvas || !editor || !hydratedRef.current) return false
    const payload: SmartCanvasDocument = {
      ...next,
      snapshot: getSnapshot(editor.store).document,
    }
    documentRef.current = payload
    if (syncState) setDocumentState(payload)
    saveCanvasDocumentDraft(activeCanvas, clientId, updatedAtRef.current, payload)
    saveQueueRef.current?.markDirty({
      canvas_id: activeCanvas,
      base_updated_at: updatedAtRef.current,
      document: payload,
    })
    if (!authenticationRequiredRef.current) setSaveState('saving')
    return true
  }, [editor])

  const flushDocumentSaves = useCallback(async () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (authenticationRequiredRef.current) return false
    const queue = saveQueueRef.current
    if (!queue?.getState().dirty) return true
    const flushingCanvas = activeCanvasRef.current
    const flushingGeneration = queue.getState().generation
    try {
      setSaveState('saving')
      await queue.flush()
      const currentState = queue.getState()
      if (
        currentState.generation === flushingGeneration
        && activeCanvasRef.current === flushingCanvas
        && !currentState.dirty
      ) {
        discardCanvasDocumentDraft(flushingCanvas, clientId)
        setSaveState('saved')
      }
      return currentState.generation === flushingGeneration && !currentState.dirty
    } catch (error) {
      if (!(error instanceof DocumentConflictError)) {
        console.error(error)
        const failureState = classifyDocumentRequestError(error)
        if (failureState === 'auth-required') authenticationRequiredRef.current = true
        setSaveState(failureState)
      }
      return false
    }
  }, [])

  const persistDocument = useCallback(async (next: SmartCanvasDocument) => {
    if (!queueDocumentSave(next, true)) return false
    return flushDocumentSaves()
  }, [flushDocumentSaves, queueDocumentSave])

  const scheduleSave = useCallback(() => {
    if (!queueDocumentSave(documentRef.current)) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void flushDocumentSaves()
    }, 800)
  }, [flushDocumentSaves, queueDocumentSave])

  const loadCanvasDocument = useCallback(async (id: string, mountedEditor: Editor) => {
    const loadEpoch = ++loadEpochRef.current
    hydratedRef.current = false
    setCanvasReady(false)
    setSaveState('loading')
    let offlineRecovery = false
    let recoveredDraftClientId = ""
    let result: { canvas?: CanvasSummary; document: SmartCanvasDocument; updated_at: number }
    try {
      result = await api<{ canvas: CanvasSummary; document: SmartCanvasDocument; updated_at: number }>(
        `/api/canvases/${encodeURIComponent(id)}/document`,
      )
    } catch (error) {
      const failureState = classifyDocumentRequestError(error)
      if (failureState === 'auth-required') {
        authenticationRequiredRef.current = true
        throw error
      }
      if (failureState !== 'offline') throw error
      const offlineDraft = readCanvasDocumentDraft<SmartCanvasDocument>(id, clientId)
      if (!offlineDraft) throw error
      offlineRecovery = true
      recoveredDraftClientId = offlineDraft.client_id
      result = {
        document: offlineDraft.document,
        updated_at: offlineDraft.base_updated_at,
      }
    }
    if (activeCanvasRef.current !== id || loadEpochRef.current !== loadEpoch) return
    const rawServerDocument = isSupportedCanvasDocument(result.document) ? result.document : emptyDocument()
    const serverDocument: SmartCanvasDocument = {
      ...rawServerDocument,
      agent_session: migrateAgentSessionV2(rawServerDocument.agent_session),
    }
    const serverUpdatedAt = Number(result.updated_at || 0)
    const rawCanvasDraft = offlineRecovery ? null : readCanvasDocumentDraft<SmartCanvasDocument>(id, clientId)
    const canvasDraft = rawCanvasDraft ? {
      ...rawCanvasDraft,
      document: {
        ...rawCanvasDraft.document,
        agent_session: migrateAgentSessionV2(rawCanvasDraft.document.agent_session),
      },
    } : null
    const canvasRestore = decideCanvasDocumentRestore(serverUpdatedAt, serverDocument, canvasDraft)
    if (
      canvasRestore.status === 'server'
      && canvasDraft
      && JSON.stringify(canvasDraft.document) === JSON.stringify(serverDocument)
    ) {
      discardCanvasDocumentDraft(id, canvasDraft.client_id)
    }
    activeDraftClientRef.current = offlineRecovery
      ? (recoveredDraftClientId || clientId)
      : canvasRestore.status === 'server'
        ? clientId
        : canvasRestore.draft.client_id
    let next = canvasRestore.status === 'conflict'
      ? canvasRestore.local_document
      : canvasRestore.document
    next = { ...next, agent_session: migrateAgentSessionV2(next.agent_session) }
    let shouldResaveLocal = canvasRestore.status === 'local'
    let hasRestoreConflict = canvasRestore.status === 'conflict'
    if (hasRestoreConflict) {
      setConflict({
        document: serverDocument,
        updated_at: serverUpdatedAt,
        draft_client_id: canvasRestore.status === 'conflict' ? canvasRestore.draft.client_id : undefined,
      })
      setSaveState('conflict')
    }

    const localDraft = readAgentSessionDraft<AgentSessionV1 | AgentSessionV2>(id, clientId)
    const restoredDraft = restoreAgentSessionDraft(serverUpdatedAt, next.agent_session, localDraft)
    if (canvasRestore.status === 'server' && localDraft && restoredDraft.stale) {
      const mergedSession = mergeAgentSessionsByTurnId(serverDocument.agent_session, localDraft.agent_session)
      if (JSON.stringify(migrateAgentSessionV2(localDraft.agent_session)) === JSON.stringify(serverDocument.agent_session)) {
        discardAgentSessionDraft(id, clientId)
      } else {
        next = { ...serverDocument, agent_session: mergedSession }
        shouldResaveLocal = true
      }
    } else if (canvasRestore.status === 'server' && restoredDraft.session) {
      next = {
        ...next,
        agent_session: mergeAgentSessionsByTurnId(next.agent_session, restoredDraft.session),
      }
      shouldResaveLocal = restoredDraft.restored
    }
    const legacyTldrawSnapshot = next.engine === 'tldraw' ? next.snapshot : undefined
    if (
      next.engine === 'fabric'
      && next.legacy_tldraw_snapshot
      && Number((next.snapshot as { version?: number } | null)?.version || 0) < 2
    ) {
      next = {
        ...next,
        snapshot: upgradeFabricSnapshotFromLegacy(next.snapshot, next.legacy_tldraw_snapshot),
      }
      shouldResaveLocal = true
    }
    if (next.snapshot) {
      let session: unknown = undefined
      try {
        session = JSON.parse(
          localStorage.getItem(`fabric-session-${id}`)
          || localStorage.getItem(`tldraw-session-${id}`)
          || 'null',
        ) || undefined
      } catch { session = undefined }
      await loadSnapshot(mountedEditor.store, { document: next.snapshot, session })
    } else {
      mountedEditor.deleteShapes(Array.from(mountedEditor.getCurrentPageShapeIds()))
      mountedEditor.selectNone()
    }
    if (next.engine === 'tldraw') {
      next = {
        ...next,
        schema_version: 2,
        engine: 'fabric',
        legacy_tldraw_snapshot: legacyTldrawSnapshot,
        snapshot: getSnapshot(mountedEditor.store).document,
      }
      shouldResaveLocal = true
    }
    let restoredAgentSession = migrateAgentSessionV2(next.agent_session)
    if (!restoredAgentSession.turns.length) {
      const latestResult = [...mountedEditor.getCurrentPageShapes()].reverse().find(shape =>
        (shape.type === 'design-generator' && (shape as DesignGeneratorShape).props.status === 'result' && Boolean((shape as DesignGeneratorShape).props.resultUrl))
        || (shape.type === 'design-image' && ['chat-agent', 'canvas-generator', 'agent-run'].includes(String(shapeLineage(shape)?.source || ''))),
      )
      if (latestResult) {
        const lineage = shapeLineage(latestResult) || {}
        const generator = latestResult.type === 'design-generator' ? latestResult as DesignGeneratorShape : null
        const image = latestResult.type === 'design-image' ? latestResult as DesignImageShape : null
        const restoredPrompt = String(lineage.prompt || generator?.props.prompt || image?.props.name || '画布设计成果')
        const restoredImageUrl = generator?.props.resultUrl || image?.props.url || ''
        const restoredImageName = generator?.props.resultName || image?.props.name || 'Agent 设计成果'
        const restoredRun: AgentRunView = {
            id: String(lineage.agentRunId || lineage.conversationId || latestResult.id),
            phase: 'completed',
            prompt: restoredPrompt,
            skill: String(lineage.skill || 'Design Agent'),
            model: String(lineage.model || generator?.props.model || 'GPT Image'),
            startedAt: Number(lineage.createdAt || Date.now()),
            imageUrl: restoredImageUrl,
            imageName: restoredImageName,
            messageId: String(lineage.messageId || ''),
        }
        const restoredTurnId = String(lineage.agentTurnId || `turn-${restoredRun.id}`)
        const restoredUser: ChatMessage = {
          id: `restored-user-${latestResult.id}`,
          role: 'user',
          content: restoredPrompt,
          request_id: restoredRun.id,
        }
        restoredAgentSession = {
          ...restoredAgentSession,
          conversation_id: String(lineage.conversationId || restoredAgentSession.conversation_id || ''),
          active_turn_id: restoredTurnId,
          next_sequence: Math.max(2, restoredAgentSession.next_sequence),
          turns: [{
            id: restoredTurnId,
            sequence: 1,
            user_message: restoredUser,
            references: [],
            attempts: [{
              id: restoredRun.id,
              request_id: restoredRun.id,
              status: 'succeeded',
              run: restoredRun,
              assistant_messages: [],
              created_at: restoredRun.startedAt,
              updated_at: Date.now(),
            }],
            active_attempt_id: restoredRun.id,
            created_at: restoredRun.startedAt,
            updated_at: Date.now(),
          }],
          updated_at: Date.now(),
        }
      }
    }
    next.agent_session = restoredAgentSession
    updatedAtRef.current = serverUpdatedAt
    documentRef.current = next
    setDocumentState(next)
    agentSessionRef.current = restoredAgentSession
    setAgentSession(restoredAgentSession)
    activeTurnIdRef.current = restoredAgentSession.active_turn_id
    setConversationId(restoredAgentSession?.conversation_id || '')
    setMessages(flattenAgentMessages(restoredAgentSession))
    const restoredTurn = restoredAgentSession.turns.find(turn => turn.id === restoredAgentSession.active_turn_id)
      || restoredAgentSession.turns[restoredAgentSession.turns.length - 1]
    const restoredAttempt = activeAttempt(restoredTurn)
    setAgentRun(restoredAttempt?.run || null)
    setPrompt(restoredAgentSession?.composer?.prompt || '')
    setComposerMode(restoredAgentSession?.composer?.mode || 'agent')
    setActiveSkill(restoredAgentSession?.composer?.active_skill || '')
    setPendingReferences(restoredAgentSession?.composer?.pending_references || [])
    if (result.canvas?.title) setCanvasTitle(result.canvas.title)
    const completedImageUrl = restoredAttempt?.run?.phase === 'completed' ? restoredAttempt.run.imageUrl : ''
    if (completedImageUrl) {
      const completedShape = [...mountedEditor.getCurrentPageShapes()].reverse().find(shape =>
        (shape.type === 'design-image' && (shape as DesignImageShape).props.url === completedImageUrl)
        || (shape.type === 'design-generator' && (shape as DesignGeneratorShape).props.resultUrl === completedImageUrl),
      )
      if (completedShape) {
        mountedEditor.select(completedShape.id)
        window.setTimeout(() => {
          const bounds = mountedEditor.getShapePageBounds(completedShape)
          if (!bounds) return
          const topLeft = mountedEditor.pageToViewport({ x: bounds.minX, y: bounds.minY })
          const bottomRight = mountedEditor.pageToViewport({ x: bounds.maxX, y: bounds.maxY })
          const viewport = mountedEditor.getViewportScreenBounds()
          const isInsideSafeArea = topLeft.x >= 72 && topLeft.y >= 142
            && bottomRight.x <= viewport.w - 72 && bottomRight.y <= viewport.h - 96
          const hasUsefulScale = mountedEditor.getZoomLevel() >= 0.62
          const keepInsideSafeArea = () => {
            const latestBounds = mountedEditor.getShapePageBounds(completedShape)
            if (!latestBounds) return
            const latestTopLeft = mountedEditor.pageToViewport({ x: latestBounds.minX, y: latestBounds.minY })
            const latestBottomRight = mountedEditor.pageToViewport({ x: latestBounds.maxX, y: latestBounds.maxY })
            const latestViewport = mountedEditor.getViewportScreenBounds()
            let shiftX = 0
            let shiftY = 0
            if (latestTopLeft.x < 72) shiftX = 72 - latestTopLeft.x
            else if (latestBottomRight.x > latestViewport.w - 72) shiftX = latestViewport.w - 72 - latestBottomRight.x
            if (latestTopLeft.y < 142) shiftY = 142 - latestTopLeft.y
            else if (latestBottomRight.y > latestViewport.h - 96) shiftY = latestViewport.h - 96 - latestBottomRight.y
            if (!shiftX && !shiftY) return
            const camera = mountedEditor.getCamera()
            mountedEditor.setCamera({ x: camera.x + shiftX / camera.z, y: camera.y + shiftY / camera.z, z: camera.z }, { animation: { duration: 120 } })
          }
          if (!isInsideSafeArea || !hasUsefulScale) {
            mountedEditor.zoomToBounds(bounds, { inset: 220, animation: { duration: 180 } })
            window.setTimeout(keepInsideSafeArea, 200)
          } else {
            keepInsideSafeArea()
          }
        }, 120)
      }
    }
    hydratedRef.current = true
    setCanvasReady(true)
    if (offlineRecovery) {
      saveQueueRef.current?.markDirty({
        canvas_id: id,
        base_updated_at: serverUpdatedAt,
        document: next,
      })
      setSaveState('offline')
    } else {
      if (!hasRestoreConflict) setSaveState(shouldResaveLocal ? 'saving' : 'saved')
      if (shouldResaveLocal) scheduleSave()
    }
  }, [scheduleSave])

  useEffect(() => {
    if (localQaState || !hydratedRef.current || !canvasId || !editor) return
    const currentSession = migrateAgentSessionV2(documentRef.current.agent_session)
    if (JSON.stringify(currentSession) === JSON.stringify(agentSession)) return
    const next: SmartCanvasDocument = {
      ...documentRef.current,
      agent_session: agentSession,
    }
    saveAgentSessionDraft(canvasId, clientId, updatedAtRef.current, next.agent_session as AgentSession)
    documentRef.current = next
    setDocumentState(next)
    scheduleSave()
  }, [agentSession, canvasId, editor, localQaState, scheduleSave])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const requested = params.get('canvas_id') || params.get('id') || localStorage.getItem('design_agent_canvas') || ''
    Promise.all([
      api<{ canvases: CanvasSummary[] }>('/api/canvases'),
      api<{ skills: Array<{ id: string; name: string }> }>('/api/agent/skills').catch(() => ({ skills: [] })),
      api<Record<string, unknown>>('/api/auth/status').catch(() => ({})),
      api<{ providers: ApiProvider[] }>('/api/providers/available').catch(() => ({ providers: [] })),
    ]).then(async ([canvasResult, skillResult, auth, providerResult]) => {
      const authRecord = auth as Record<string, unknown>
      if (authRecord.authenticated === false) {
        throw new AuthenticationRequiredError()
      }
      const smart = canvasResult.canvases.filter(item =>
        Array.isArray(item.surfaces)
          ? item.surfaces.includes('design_agent')
          : item.kind === 'smart'
      )
      setCanvases(smart)
      setSkills(skillResult.skills || [])
      setApiProviders(providerResult.providers || [])
      const authUser = authRecord.user as Record<string, unknown> | undefined
      const pricing = authRecord.pricing as Record<string, unknown> | undefined
      setPoints(Number(authRecord.available_points ?? authRecord.credit_balance ?? authRecord.points ?? authUser?.points ?? 0))
      setImageEditCost(Number(pricing?.image ?? IMAGE_EDIT_ESTIMATED_COST))
      let target = smart.find(item => item.id === requested)
      if (!target) target = smart[0]
      if (!target) {
        const created = await api<{ canvas: CanvasSummary }>('/api/canvases', {
          method: 'POST',
          body: JSON.stringify({
            title: lang === 'zh' ? '未命名设计' : 'Untitled design',
            icon: 'sparkles',
            kind: 'smart',
            surface: 'design_agent',
          }),
        })
        target = created.canvas
        setCanvases([target])
      }
      activeCanvasRef.current = target.id
      saveQueueRef.current?.reset()
      setCanvasId(target.id)
      setCanvasTitle(target.title)
      localStorage.setItem('design_agent_canvas', target.id)
    }).catch(error => {
      setChatError(error instanceof Error ? error.message : String(error))
      const failureState = classifyDocumentRequestError(error)
      if (failureState === 'auth-required') authenticationRequiredRef.current = true
      setSaveState(failureState)
      if (failureState === 'offline' && requested && readCanvasDocumentDraft<SmartCanvasDocument>(requested, clientId)) {
        activeCanvasRef.current = requested
        saveQueueRef.current?.reset()
        setCanvasId(requested)
        setCanvasTitle(lang === 'zh' ? '离线设计' : 'Offline design')
        localStorage.setItem('design_agent_canvas', requested)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || !event.data || typeof event.data.type !== 'string') return
      if (event.data.type === 'studio-lang') setLang(event.data.lang === 'en' ? 'en' : 'zh')
      if (event.data.type === 'studio-theme') setTheme(event.data.theme === 'dark' ? 'dark' : 'light')
      if (event.data.type === 'studio-ui-scale') document.documentElement.style.setProperty('--studio-scale', String(event.data.scale || 1))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    if (!editor || !canvasId) return
    void loadCanvasDocument(canvasId, editor).catch(error => {
      if (activeCanvasRef.current !== canvasId) return
      if (isUnavailableCanvasDocumentError(error)) {
        abandonUnavailableCanvas(canvasId)
        return
      }
      setChatError(error instanceof Error ? error.message : String(error))
      const failureState = classifyDocumentRequestError(error)
      if (failureState === 'auth-required') authenticationRequiredRef.current = true
      setSaveState(failureState)
    })
    let uiFrame = 0
    const refreshCanvasUi = () => {
      uiFrame = 0
      const markerUpdates = editor.getCurrentPageShapes()
        .filter(shape => shape.type === 'design-marker')
        .map(shape => shape as DesignMarkerShape)
        .flatMap(marker => {
          if (!marker.props.targetShapeId) return []
          const target = editor.getShape(marker.props.targetShapeId as TLShapeId)
          const transform = target ? editor.getShapePageTransform(target) : null
          const size = target?.props as { w?: number; h?: number } | undefined
          if (!target || !transform || !size?.w || !size?.h) return []
          const point = transform.applyToPoint({
            x: size.w * marker.props.xRatio,
            y: size.h * marker.props.yRatio,
          })
          const x = point.x - marker.props.w / 2
          const y = point.y - marker.props.h / 2
          if (Math.abs(marker.x - x) < .01 && Math.abs(marker.y - y) < .01) return []
          return [{ id: marker.id, type: marker.type, x, y } as const]
        })
      if (markerUpdates.length) {
        editor.run(() => editor.updateShapes(markerUpdates), {
          history: 'ignore',
          ignoreShapeLock: true,
        })
      }
      setSelectedShapes(editor.getSelectedShapes())
      setZoom(Math.round(editor.getZoomLevel() * 100))
      const camera = editor.getCamera()
      setCameraKey(`${camera.x.toFixed(2)}:${camera.y.toFixed(2)}:${camera.z.toFixed(3)}`)
      setActiveTool(editor.getCurrentToolId())
      const session = getSnapshot(editor.store).session
      localStorage.setItem(`fabric-session-${canvasId}`, JSON.stringify(session))
    }
    const disposeUi = editor.store.listen(() => {
      if (!uiFrame) uiFrame = window.requestAnimationFrame(refreshCanvasUi)
    })
    const disposeDocument = editor.store.listen(scheduleSave, { scope: 'document', source: 'user' })
    return () => {
      disposeUi()
      disposeDocument()
      if (uiFrame) window.cancelAnimationFrame(uiFrame)
      hydratedRef.current = false
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [abandonUnavailableCanvas, canvasId, editor, loadCanvasDocument, scheduleSave])

  useEffect(() => {
    if (saveState !== 'offline' || !editor || !canvasId) return
    const retry = () => {
      if (hydratedRef.current) {
        if (saveQueueRef.current?.getState().dirty) void flushDocumentSaves()
        return
      }
      void loadCanvasDocument(canvasId, editor).catch(() => undefined)
    }
    const timer = window.setInterval(retry, 4000)
    window.addEventListener('online', retry)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', retry)
    }
  }, [canvasId, editor, flushDocumentSaves, loadCanvasDocument, saveState])

  useEffect(() => {
    if (!editor || !apiProviders.length) return
    for (const shape of editor.getCurrentPageShapes()) {
      if (shape.type !== 'design-generator') continue
      const generator = shape as DesignGeneratorShape
      if (generator.props.status !== 'failed' || !/RunningHub/i.test(generator.props.error)) continue
      const route = resolveGenerationRoute(apiProviders, generator.props.model)
      if (route.image_provider === 'runninghub') continue
      const providerName = apiProviders.find(provider => provider.id === route.image_provider)?.name || route.image_provider
      editor.updateShape<DesignGeneratorShape>({
        id: generator.id,
        type: generator.type,
        props: { error: `已切换至 ${providerName}，请点击重试。` },
      })
    }
  }, [apiProviders, editor, saveState])

  const addImage = useCallback(async (
    url: string,
    name: string,
    lineage: Record<string, unknown>,
    position?: { x: number; y: number },
  ) => {
    if (!editor) return null
    const expectedCanvasId = activeCanvasRef.current
    const size = await imageSize(url)
    if (activeCanvasRef.current !== expectedCanvasId) return null
    const viewport = editor.getViewportPageBounds()
    const selected = editor.getSelectedShapes()[0]
    const selectedBounds = selected ? editor.getShapePageBounds(selected) : null
    const x = position?.x ?? (selectedBounds ? selectedBounds.maxX + 72 : viewport.center.x - size.w / 2)
    const y = position?.y ?? (selectedBounds ? selectedBounds.minY : viewport.center.y - size.h / 2)
    const id = createShapeId()
    editor.createShape<DesignImageShape>({
      id,
      type: 'design-image',
      x,
      y,
      props: { ...size, url, name, lineage: JSON.stringify(lineage) },
    })
    editor.select(id)
    return id
  }, [editor])

  useEffect(() => {
    if (!editor || !hydratedRef.current || processingPlacementsRef.current) return
    const pending = documentState.pending_placements || []
    if (!pending.length) return
    processingPlacementsRef.current = true
    void (async () => {
      const applied = [...documentRef.current.applied_placement_ids]
      const existingPlacementIds = new Set(
        editor.getCurrentPageShapes()
          .filter(shape => shape.type === 'design-image')
          .map(shape => String(shapeLineage(shape)?.placementId || ''))
          .filter(Boolean),
      )
      for (const placement of pending) {
        if (applied.includes(placement.id)) continue
        if (existingPlacementIds.has(placement.id)) {
          applied.push(placement.id)
          continue
        }
        await addImage(placement.url, placement.name, {
          placementId: placement.id,
          generatedAssetId: placement.generated_asset_id,
          parentGeneratedAssetId: placement.parent_generated_asset_id,
          agentRunId: placement.agent_run_id,
          agentStepId: placement.agent_step_id,
          model: placement.model,
          provider: placement.provider,
          prompt: placement.prompt,
          source: 'agent-run',
        })
        applied.push(placement.id)
        existingPlacementIds.add(placement.id)
      }
      const next = { ...documentRef.current, pending_placements: [], applied_placement_ids: applied }
      documentRef.current = next
      setDocumentState(next)
      await persistDocument(next)
      setNotice(lang === 'zh' ? `已落位 ${pending.length} 个 Agent 成果` : `${pending.length} Agent results placed`)
      window.setTimeout(() => setNotice(''), 2600)
    })().finally(() => { processingPlacementsRef.current = false })
  }, [addImage, documentState.pending_placements, editor, lang, persistDocument])

  const activateCanvas = useCallback((id: string, title: string) => {
    hydratedRef.current = false
    loadEpochRef.current += 1
    saveQueueRef.current?.reset()
    activeCanvasRef.current = id
    recoveredRunsRef.current.clear()
    setConversationId('')
    setMessages([])
    setAgentRun(null)
    setPrompt('')
    setActiveSkill('')
    setSelectedImageModel('自动选择')
    setSelectedImageAspect('auto')
    setPendingReferences([])
    setComposerMode('agent')
    setCanvasReady(false)
    setCanvasId(id)
    setCanvasTitle(title)
    localStorage.setItem('design_agent_canvas', id)
  }, [])

  const selectCanvas = async (id: string, title?: string) => {
    const target = canvases.find(item => item.id === id)
    setMenuOpen(false)
    if (id === activeCanvasRef.current) {
      if (title || target?.title) setCanvasTitle(title || target?.title || 'Untitled')
      return
    }
    const previousCanvasId = activeCanvasRef.current
    const previousCanvasIsRunning = runningCanvasIdsRef.current.has(previousCanvasId)
    if (switchingCanvasRef.current) return
    switchingCanvasRef.current = true
    try {
      if (hydratedRef.current && !(await flushDocumentSaves())) {
        setNotice(lang === 'zh' ? '当前设计尚未保存，请恢复连接或处理冲突后再切换' : 'Save this design before switching')
        window.setTimeout(() => setNotice(''), 2600)
        return
      }
      activateCanvas(id, title || target?.title || 'Untitled')
      if (previousCanvasIsRunning) {
        setNotice(lang === 'zh'
          ? '原设计仍在后台生成，完成后返回该设计即可查看结果'
          : 'The previous design is still generating in the background; return to it to view the result')
        window.setTimeout(() => setNotice(''), 3200)
      }
    } finally {
      switchingCanvasRef.current = false
    }
  }

  const createCanvas = async () => {
    if (hydratedRef.current && !(await flushDocumentSaves())) return
    const result = await api<{ canvas: CanvasSummary }>('/api/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: lang === 'zh' ? '未命名设计' : 'Untitled design',
        icon: 'sparkles',
        kind: 'smart',
        surface: 'design_agent',
      }),
    })
    setCanvases(items => [result.canvas, ...items])
    await selectCanvas(result.canvas.id, result.canvas.title)
  }

  useEffect(() => {
    if (!unavailableCanvasId || unavailableRecoveryRef.current) return
    const missingCanvasId = unavailableCanvasId
    unavailableRecoveryRef.current = true
    void (async () => {
      const result = await api<{ canvases: CanvasSummary[] }>('/api/canvases')
      let accessible = result.canvases.filter(item =>
        Array.isArray(item.surfaces)
          ? item.surfaces.includes('design_agent')
          : item.kind === 'smart'
      )
      let target = accessible[0]
      if (!target) {
        const created = await api<{ canvas: CanvasSummary }>('/api/canvases', {
          method: 'POST',
          body: JSON.stringify({
            title: lang === 'zh' ? '未命名设计' : 'Untitled design',
            icon: 'sparkles',
            kind: 'smart',
            surface: 'design_agent',
          }),
        })
        target = created.canvas
        accessible = [target]
      }
      setCanvases(accessible)
      setChatError('')
      activateCanvas(target.id, target.title)
      setNotice(lang === 'zh'
        ? '原画布已删除或不可访问，已切换到可用设计'
        : 'The previous canvas is unavailable. Switched to an accessible design.')
      window.setTimeout(() => setNotice(''), 2600)
    })().catch(error => {
      setChatError(lang === 'zh'
        ? '原画布已删除或当前账号无权访问，请刷新后重试'
        : 'The previous canvas was deleted or is not accessible. Refresh and try again.')
      const failureState = classifyDocumentRequestError(error)
      if (failureState === 'auth-required') authenticationRequiredRef.current = true
      setSaveState(failureState)
    }).finally(() => {
      unavailableRecoveryRef.current = false
      setUnavailableCanvasId(current => current === missingCanvasId ? '' : current)
    })
  }, [activateCanvas, lang, unavailableCanvasId])

  const deleteCanvas = async (item: CanvasSummary) => {
    if (runningCanvasIdsRef.current.has(item.id)) {
      setPendingDeleteCanvas(null)
      setNotice(lang === 'zh' ? '该设计仍在生成，完成后再删除' : 'This design is still generating; delete it after the task finishes')
      window.setTimeout(() => setNotice(''), 2600)
      return
    }
    const remaining = canvases.filter(canvas => canvas.id !== item.id)
    if (item.id === canvasId && saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    try {
      await api(`/api/canvases/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      if (item.id !== canvasId) {
        setCanvases(remaining)
      } else if (remaining.length) {
        setCanvases(remaining)
        hydratedRef.current = false
        saveQueueRef.current?.reset()
        activeCanvasRef.current = ''
        await selectCanvas(remaining[0].id, remaining[0].title)
      } else {
        const result = await api<{ canvas: CanvasSummary }>('/api/canvases', {
          method: 'POST',
          body: JSON.stringify({
            title: lang === 'zh' ? '未命名设计' : 'Untitled design',
            icon: 'sparkles',
            kind: 'smart',
            surface: 'design_agent',
          }),
        })
        setCanvases([result.canvas])
        hydratedRef.current = false
        saveQueueRef.current?.reset()
        activeCanvasRef.current = ''
        await selectCanvas(result.canvas.id, result.canvas.title)
      }
      setMenuOpen(false)
      setPendingDeleteCanvas(null)
      setNotice(lang === 'zh' ? '设计已移入回收站' : 'Design moved to recycle bin')
      window.setTimeout(() => setNotice(''), 2200)
    } catch (error) {
      setPendingDeleteCanvas(null)
      setChatError(error instanceof Error ? error.message : String(error))
      if (item.id === canvasId && saveQueueRef.current?.getState().dirty) {
        setSaveState('offline')
        if (!saveTimerRef.current) {
          saveTimerRef.current = window.setTimeout(() => {
            saveTimerRef.current = null
            void flushDocumentSaves()
          }, 800)
        }
      }
    }
  }

  const saveTitle = async () => {
    if (!canvasId || !canvasTitle.trim() || canvasTitle === currentCanvas?.title) return
    await api(`/api/canvases/${encodeURIComponent(canvasId)}/meta`, {
      method: 'POST', body: JSON.stringify({ title: canvasTitle.trim() }),
    })
    setCanvases(items => items.map(item => item.id === canvasId ? { ...item, title: canvasTitle.trim() } : item))
  }

  const selectedImage = selectedShapes.length === 1 && selectedShapes[0].type === 'design-image'
    ? selectedShapes[0] as DesignImageShape
    : null

  const selectedGenerator = selectedShapes.length === 1 && selectedShapes[0].type === 'design-generator'
    ? selectedShapes[0] as DesignGeneratorShape
    : null

  const selectedVisual = selectedImage
    ? { shape: selectedImage as TLShape, url: selectedImage.props.url, name: selectedImage.props.name }
    : selectedGenerator?.props.status === 'result' && selectedGenerator.props.resultUrl
      ? { shape: selectedGenerator as TLShape, url: selectedGenerator.props.resultUrl, name: selectedGenerator.props.resultName }
      : null

  const markerShapes = editor
    ? editor.getCurrentPageShapes()
      .filter(shape => shape.type === 'design-marker')
      .map(shape => shape as DesignMarkerShape)
      .sort((left, right) => left.props.number - right.props.number)
    : []
  const focusedMarker = markerShapes.find(marker => String(marker.id) === focusedMarkerId) || null
  const activeMarkerTargetId = focusedMarker?.props.targetShapeId || [...markerShapes].reverse()
    .find(marker => marker.props.targetShapeId)?.props.targetShapeId || ''
  const activeMarkerShapes = activeMarkerTargetId
    ? markerShapes.filter(marker => marker.props.targetShapeId === activeMarkerTargetId)
    : markerShapes
  const markerQuickEditorStyle = useMemo(() => {
    if (!editor || !activeMarkerTargetId || !activeMarkerShapes.length) return null
    const target = editor.getShape(activeMarkerTargetId as TLShapeId)
    const bounds = target ? editor.getShapePageBounds(target) : null
    if (!bounds) return null
    const topLeft = editor.pageToViewport({ x: bounds.minX, y: bounds.minY })
    const bottomRight = editor.pageToViewport({ x: bounds.maxX, y: bounds.maxY })
    const viewport = editor.getViewportScreenBounds()
    if (bottomRight.x < 0 || topLeft.x > viewport.w || bottomRight.y < 52 || topLeft.y > viewport.h) return null
    const width = Math.min(460, Math.max(320, bottomRight.x - topLeft.x))
    const left = Math.max(16, Math.min(viewport.w - width - 16, topLeft.x))
    const panelHeight = 142 + Math.max(0, markerReferenceGridRows(activeMarkerShapes.length) - 1) * 32
    const top = bottomRight.y + panelHeight + 84 <= viewport.h
      ? bottomRight.y + 10
      : Math.max(62, topLeft.y - panelHeight - 10)
    return { left, top, width }
  }, [activeMarkerShapes.length, activeMarkerTargetId, cameraKey, editor])
  const markerHoverTargetStyle = useMemo(() => {
    if (!editor || !markerMode || !markerHover?.targetId) return null
    const target = editor.getShape(markerHover.targetId as TLShapeId)
    const bounds = target ? editor.getShapePageBounds(target) : null
    if (!bounds) return null
    const topLeft = editor.pageToViewport({ x: bounds.minX, y: bounds.minY })
    const bottomRight = editor.pageToViewport({ x: bounds.maxX, y: bounds.maxY })
    return {
      left: topLeft.x,
      top: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    }
  }, [cameraKey, editor, markerHover?.targetId, markerMode])
  const markerTabHintStyle = useMemo(() => {
    if (!editor || !activeMarkerShapes.length || markerQuickEditorOpen) return null
    const marker = activeMarkerShapes[activeMarkerShapes.length - 1]
    const point = editor.pageToViewport({
      x: marker.x + marker.props.w / 2,
      y: marker.y + marker.props.h / 2,
    })
    const viewport = editor.getViewportScreenBounds()
    if (point.x < 0 || point.x > viewport.w || point.y < 52 || point.y > viewport.h) return null
    return {
      left: Math.max(16, Math.min(viewport.w - 126, point.x + 18)),
      top: Math.max(62, Math.min(viewport.h - 42, point.y - 15)),
    }
  }, [activeMarkerShapes, cameraKey, editor, markerQuickEditorOpen])
  const markerFocusOverlayStyle = useMemo(() => {
    if (!editor || !focusedMarker || !markerPreviewVisible) return null
    const point = editor.pageToViewport({
      x: focusedMarker.x + focusedMarker.props.w / 2,
      y: focusedMarker.y + focusedMarker.props.h / 2,
    })
    const viewport = editor.getViewportScreenBounds()
    if (point.x < 0 || point.x > viewport.w || point.y < 52 || point.y > viewport.h) return null
    return { left: point.x, top: point.y }
  }, [cameraKey, editor, focusedMarker, markerPreviewVisible])
  const markerFocusTargets = useMemo(() => {
    if (!editor || markerMode) return []
    const viewport = editor.getViewportScreenBounds()
    return markerShapes.flatMap(marker => {
      const point = editor.pageToViewport({
        x: marker.x + marker.props.w / 2,
        y: marker.y + marker.props.h / 2,
      })
      if (point.x < 0 || point.x > viewport.w || point.y < 52 || point.y > viewport.h) return []
      return [{ marker, left: point.x, top: point.y }]
    })
  }, [cameraKey, editor, markerMode, markerShapes])
  const focusedMarkerPreview = useMemo(() => {
    if (!editor || !focusedMarker?.props.targetShapeId) return null
    const target = editor.getShape(focusedMarker.props.targetShapeId as TLShapeId)
    const url = target?.type === 'design-image'
      ? (target as DesignImageShape).props.url
      : target?.type === 'design-generator'
        ? (target as DesignGeneratorShape).props.resultUrl
        : ''
    const sourceWidth = target?.type === 'design-image'
      ? (target as DesignImageShape).props.w
      : target?.type === 'design-generator'
        ? (target as DesignGeneratorShape).props.w
        : 1
    const sourceHeight = target?.type === 'design-image'
      ? (target as DesignImageShape).props.h
      : target?.type === 'design-generator'
        ? (target as DesignGeneratorShape).props.h
        : 1
    return url ? {
      url,
      label: focusedMarker.props.label,
      x: Math.round(focusedMarker.props.xRatio * 100),
      y: Math.round(focusedMarker.props.yRatio * 100),
      geometry: markerPreviewGeometry(
        sourceWidth,
        sourceHeight,
        focusedMarker.props.xRatio,
        focusedMarker.props.yRatio,
      ),
    } : null
  }, [editor, focusedMarker])

  useEffect(() => () => {
    if (markerPreviewTimerRef.current) window.clearTimeout(markerPreviewTimerRef.current)
  }, [])

  useEffect(() => {
    setSelectedPixelSize(null)
    if (!selectedVisual?.url) return
    const source = new Image()
    source.onload = () => setSelectedPixelSize({ w: source.naturalWidth, h: source.naturalHeight })
    source.src = selectedVisual.url
    return () => { source.onload = null }
  }, [selectedVisual?.url])

  useEffect(() => {
    setInlineEditOpen(false)
    setEraserOpen(false)
    setExpansionOpen(false)
    setCustomExpansionPadding(null)
  }, [selectedVisual?.shape.id])

  useEffect(() => {
    const element = imageContextBarRef.current
    if (!element || !selectedVisual) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      setImageContextBarSize(current => {
        const width = Math.round(rect.width)
        const height = Math.round(rect.height)
        return current.width === width && current.height === height ? current : { width, height }
      })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [lang, selectedVisual?.shape.id])

  const selectedOverlay = useMemo(() => {
    if (!editor || !selectedVisual) return null
    const bounds = editor.getShapePageBounds(selectedVisual.shape)
    if (!bounds) return null
    const topLeft = editor.pageToViewport({ x: bounds.minX, y: bounds.minY })
    const bottomRight = editor.pageToViewport({ x: bounds.maxX, y: bounds.maxY })
    const viewport = editor.getViewportScreenBounds()
    const placement = computeImageOverlayPlacement({
      image: { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y },
      viewport: { width: viewport.w, height: viewport.h },
      toolbar: imageContextBarSize,
    })
    if (!placement) return null
    const editorWidth = Math.min(570, Math.max(280, viewport.w - 32))
    const editorHeight = 250
    const safeEditorBottom = viewport.h - 86
    const preferredEditorTop = placement.toolbar?.side === 'below'
      ? placement.toolbar.top + imageContextBarSize.height + 8
      : bottomRight.y + 12
    const aboveImageTop = topLeft.y - editorHeight - 12
    const editorTop = preferredEditorTop + editorHeight <= safeEditorBottom
      ? preferredEditorTop
      : aboveImageTop >= 62
        ? aboveImageTop
        : Math.max(62, safeEditorBottom - editorHeight)
    return {
      ...placement,
      image: {
        left: topLeft.x,
        top: topLeft.y,
        width: Math.max(0, bottomRight.x - topLeft.x),
        height: Math.max(0, bottomRight.y - topLeft.y),
      },
      editor: {
        left: Math.max(16, Math.min(topLeft.x, viewport.w - editorWidth - 16)),
        top: editorTop,
        width: editorWidth,
      },
    }
  }, [cameraKey, editor, imageContextBarSize, selectedVisual, zoom])

  const maskPixelWidth = Math.max(1, Math.round(selectedPixelSize?.w || Number((selectedVisual?.shape.props as { w?: number } | undefined)?.w || 1)))
  const maskPixelHeight = Math.max(1, Math.round(selectedPixelSize?.h || Number((selectedVisual?.shape.props as { h?: number } | undefined)?.h || 1)))
  const defaultExpansionPadding = useMemo(
    () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    [],
  )
  const expansionGeometry = useMemo(
    () => computeExpansionGeometryFromPadding(
      maskPixelWidth,
      maskPixelHeight,
      customExpansionPadding || defaultExpansionPadding,
    ),
    [customExpansionPadding, defaultExpansionPadding, maskPixelHeight, maskPixelWidth],
  )
  const expansionOutput = useMemo(
    () => chooseExpansionOutput(expansionGeometry, expansionScale),
    [expansionGeometry, expansionScale],
  )
  const hasExpansionArea = Object.values(expansionGeometry.padding).some(value => value > 0)
  const expansionPreview = useMemo(
    () => selectedOverlay ? expansionPreviewRect(selectedOverlay.image, expansionGeometry) : null,
    [expansionGeometry, selectedOverlay],
  )
  const expansionEditorStyle = useMemo(() => {
    if (!editor || !expansionPreview) return selectedOverlay?.editor
    const viewport = editor.getViewportScreenBounds()
    const width = 190
    const height = 458
    const gap = 12
    const preferredRight = expansionPreview.left + expansionPreview.width + gap
    const left = preferredRight + width <= viewport.w - 12
      ? preferredRight
      : Math.max(12, expansionPreview.left - width - gap)
    return {
      left,
      top: Math.max(12, Math.min(expansionPreview.top, viewport.h - height - 12)),
      width,
    }
  }, [cameraKey, editor, expansionPreview, selectedOverlay?.editor])

  const resetMaskCanvas = useCallback(() => {
    const canvas = maskCanvasRef.current
    if (!canvas) return
    canvas.width = maskPixelWidth
    canvas.height = maskPixelHeight
    const context = canvas.getContext('2d')
    if (!context) return
    context.globalCompositeOperation = 'source-over'
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    setEraserStrokeCount(0)
  }, [maskPixelHeight, maskPixelWidth])

  useEffect(() => {
    if (!eraserOpen || !selectedVisual) return
    resetMaskCanvas()
  }, [eraserOpen, resetMaskCanvas, selectedVisual?.shape.id])

  const maskPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width),
      y: (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height),
    }
  }

  const beginMaskStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const context = canvas.getContext('2d')
    if (!context) return
    event.preventDefault()
    canvas.setPointerCapture(event.pointerId)
    const point = maskPoint(event)
    const rect = canvas.getBoundingClientRect()
    context.globalCompositeOperation = 'destination-out'
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.lineWidth = eraserBrushSize * canvas.width / Math.max(1, rect.width)
    context.beginPath()
    context.moveTo(point.x, point.y)
    context.lineTo(point.x + 0.01, point.y + 0.01)
    context.stroke()
    maskDrawingRef.current = true
    maskLastPointRef.current = point
  }

  const continueMaskStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!maskDrawingRef.current) return
    const context = event.currentTarget.getContext('2d')
    if (!context) return
    const point = maskPoint(event)
    const last = maskLastPointRef.current || point
    context.beginPath()
    context.moveTo(last.x, last.y)
    context.lineTo(point.x, point.y)
    context.stroke()
    maskLastPointRef.current = point
  }

  const finishMaskStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!maskDrawingRef.current) return
    maskDrawingRef.current = false
    maskLastPointRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setEraserStrokeCount(count => count + 1)
  }

  const beginExpansionDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    handle: ExpansionHandle,
  ) => {
    if (!selectedOverlay) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    expansionDragRef.current = {
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      padding: { ...expansionGeometry.padding },
      pixelScaleX: maskPixelWidth / Math.max(1, selectedOverlay.image.width),
      pixelScaleY: maskPixelHeight / Math.max(1, selectedOverlay.image.height),
    }
    setExpansionAspect('custom')
    setCustomExpansionPadding({ ...expansionGeometry.padding })
  }

  const continueExpansionDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = expansionDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    setCustomExpansionPadding(resizeExpansionPadding(
      drag.padding,
      drag.handle,
      (event.clientX - drag.startX) * drag.pixelScaleX,
      (event.clientY - drag.startY) * drag.pixelScaleY,
      maskPixelWidth,
      maskPixelHeight,
    ))
  }

  const finishExpansionDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = expansionDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setCustomExpansionPadding(resizeExpansionPadding(
      drag.padding,
      drag.handle,
      (event.clientX - drag.startX) * drag.pixelScaleX,
      (event.clientY - drag.startY) * drag.pixelScaleY,
      maskPixelWidth,
      maskPixelHeight,
    ))
    expansionDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    event.preventDefault()
    event.stopPropagation()
  }

  const refreshPoints = useCallback(async () => {
    const auth = await api<Record<string, unknown>>('/api/auth/status').catch(() => ({} as Record<string, unknown>))
    const authUser = auth.user as Record<string, unknown> | undefined
    const pricing = auth.pricing as Record<string, unknown> | undefined
    setPoints(Number(auth.available_points ?? auth.credit_balance ?? auth.points ?? authUser?.points ?? 0))
    setImageEditCost(Number(pricing?.image ?? IMAGE_EDIT_ESTIMATED_COST))
  }, [])

  const createGenerator = useCallback(() => {
    if (!editor) return
    const viewport = editor.getViewportPageBounds()
    const id = createShapeId()
    editor.createShape<DesignGeneratorShape>({
      id,
      type: 'design-generator',
      x: viewport.center.x - 260,
      y: viewport.center.y - 260,
      props: {
        w: 520,
        h: 520,
        status: 'configured',
        prompt: '',
        model: 'GPT Image',
        quality: 'auto',
        count: 1,
        cost: 1,
        resultUrl: '',
        resultName: '生成结果',
        lineage: '{}',
        error: '',
      },
    })
    editor.select(id)
  }, [editor])

  const runGenerator = useCallback(async (shapeId: TLShapeId) => {
    if (!editor) return
    const runCanvasId = activeCanvasRef.current
    if (!runCanvasId) return
    const shape = editor.getShape(shapeId)
    if (!shape || shape.type !== 'design-generator') return
    const generator = shape as DesignGeneratorShape
    const message = generator.props.prompt.trim()
    if (!message || generator.props.status === 'running' || !beginCanvasRun(runCanvasId)) return
    const runSessionId = agentSessionRef.current.session_id
    const runConversationId = agentSessionRef.current.conversation_id || conversationId
    const requestId = crypto.randomUUID()
    const previousLineage = shapeLineage(generator) || {}
    const existingTurn = agentSessionRef.current.turns.find(turn =>
      turn.id === String(previousLineage.agentTurnId || ''),
    )
    const turnId = existingTurn?.id || crypto.randomUUID()
    const userMessage: ChatMessage = existingTurn?.user_message || {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      request_id: requestId,
    }
    activeTurnIdRef.current = turnId
    updateAgentSession(current => ({
      ...current,
      active_turn_id: turnId,
      next_sequence: existingTurn ? current.next_sequence : current.next_sequence + 1,
      turns: existingTurn
        ? current.turns.map(turn => turn.id === turnId ? {
          ...turn,
          attempts: [...turn.attempts, {
            id: requestId,
            request_id: requestId,
            status: 'running',
            run: null,
            assistant_messages: [],
            created_at: Date.now(),
            updated_at: Date.now(),
          }],
          active_attempt_id: requestId,
          updated_at: Date.now(),
        } : turn)
        : [...current.turns, {
          id: turnId,
          sequence: current.next_sequence,
          user_message: userMessage,
          references: [],
          attempts: [{
            id: requestId,
            request_id: requestId,
            status: 'running',
            run: null,
            assistant_messages: [],
            created_at: Date.now(),
            updated_at: Date.now(),
          }],
          active_attempt_id: requestId,
          created_at: Date.now(),
          updated_at: Date.now(),
        }],
      updated_at: Date.now(),
    }))
    editor.updateShape<DesignGeneratorShape>({ id: generator.id, type: generator.type, props: { status: 'running', error: '' } })
    setChatError('')
    setMessages(items => [...items, userMessage])
    try {
      const route = resolveGenerationRoute(apiProviders, generator.props.model)
      const executeGenerator = (executionConversationId: string) => api<{
        conversation: { id: string }
        message: ChatMessage
      }>('/api/chat/agent', {
        method: 'POST',
        body: JSON.stringify({
          request_id: requestId,
          conversation_id: executionConversationId,
          surface: 'design_agent',
          context_id: runCanvasId,
          session_id: runSessionId,
          turn_id: turnId,
          message,
          mode: 'image',
          size: '1024x1024',
          quality: generator.props.quality,
          ...route,
          reference_images: [],
        }),
      })
      let result: { conversation: { id: string }; message: ChatMessage }
      try {
        result = await executeGenerator(runConversationId)
      } catch (scopeError) {
        if (
          scopeError instanceof ApiError
          && scopeError.status === 409
          && ['conversation_unavailable', 'conversation_surface_conflict', 'conversation_context_conflict', 'legacy_conversation_ambiguous'].includes(scopeError.code)
        ) {
          if (activeCanvasRef.current !== runCanvasId) return
          result = await executeGenerator('')
        } else {
          throw scopeError
        }
      }
      if (activeCanvasRef.current !== runCanvasId) return
      const url = result.message.image_urls?.[0] || result.message.image_url || ''
      if (!url) throw new Error('模型没有返回图片，请更换描述后重试')
      const size = await imageSize(url)
      if (activeCanvasRef.current !== runCanvasId) return
      const lineage = {
        conversationId: result.conversation.id,
        messageId: result.message.id,
        model: result.message.model || generator.props.model,
        provider: result.message.provider || '',
        requestId,
        agentTurnId: turnId,
        prompt: message,
        agentAction: result.message.agent_action || '',
        source: 'canvas-generator',
      }
      setConversationId(result.conversation.id)
      setMessages(items => [...items, result.message])
      appendTurnAssistant(turnId, requestId, result.message, 'succeeded')
      editor.updateShape<DesignGeneratorShape>({
        id: generator.id,
        type: generator.type,
        props: {
          ...size,
          status: 'result',
          resultUrl: url,
          resultName: message.slice(0, 28) || '生成结果',
          lineage: JSON.stringify(lineage),
          model: result.message.model || generator.props.model,
        },
      })
      await refreshPoints()
    } catch (error) {
      if (activeCanvasRef.current !== runCanvasId) return
      const messageText = error instanceof Error ? error.message : String(error)
      const apiError = error instanceof ApiError ? error : null
      if (apiError?.conversationId) setConversationId(apiError.conversationId)
      setMessages(items => appendFailureMessage(items, error, requestId))
      const failureMessages = appendFailureMessage([], error, requestId)
      if (failureMessages[0]) appendTurnAssistant(turnId, requestId, failureMessages[0], 'failed')
      const previousLineage = shapeLineage(editor.getShape(generator.id)) || {}
      editor.updateShape<DesignGeneratorShape>({
        id: generator.id,
        type: generator.type,
        props: {
          status: 'failed',
          error: messageText,
          lineage: JSON.stringify({
            ...previousLineage,
            requestId: apiError?.requestId || requestId,
            agentTurnId: turnId,
            conversationId: apiError?.conversationId || conversationId,
            upstreamOutcome: outcomeIsUnknown(error) ? 'unknown' : 'failed',
            retryable: apiError?.retryable,
            source: 'canvas-generator',
          }),
        },
      })
      setChatError(messageText)
    } finally {
      finishCanvasRun(runCanvasId)
    }
  }, [apiProviders, appendTurnAssistant, beginCanvasRun, conversationId, editor, finishCanvasRun, refreshPoints, updateAgentSession])

  useEffect(() => {
    const onRunGenerator = (event: Event) => {
      const shapeId = (event as CustomEvent<{ shapeId?: TLShapeId }>).detail?.shapeId
      if (shapeId) void runGenerator(shapeId)
    }
    window.addEventListener('lingdraw:run-generator', onRunGenerator)
    return () => window.removeEventListener('lingdraw:run-generator', onRunGenerator)
  }, [runGenerator])

  const collectReferences = useCallback(async (shapes: TLShape[] = editor?.getSelectedShapes() || []): Promise<ReferenceImage[]> => {
    if (!editor || !shapes.length) return []
    const directReferences = shapes.map(shape => {
      if (shape.type === 'design-image') {
        const image = shape as DesignImageShape
        return { url: image.props.url, name: image.props.name, role: 'reference', kind: 'image', mime: 'image/png' }
      }
      if (shape.type === 'design-generator') {
        const generator = shape as DesignGeneratorShape
        if (generator.props.status === 'result' && generator.props.resultUrl) {
          return { url: generator.props.resultUrl, name: generator.props.resultName, role: 'reference', kind: 'image', mime: 'image/png' }
        }
      }
      return null
    })
    if (directReferences.every((reference): reference is ReferenceImage => Boolean(reference))) {
      return uniqueReferenceImages(directReferences)
    }
    const exportResult = await editor.toImage(shapes.map(shape => shape.id), { format: 'png', background: true, padding: 16 })
    const form = new FormData()
    form.append('files', exportResult.blob, 'canvas-selection.png')
    const response = await fetch('/api/ai/upload', { method: 'POST', credentials: 'same-origin', body: form })
    const payload = await response.json()
    if (!response.ok) throw new Error(String(payload.detail || '选区上传失败'))
    const file = payload.files?.[0]
    return file ? [{ url: file.url, name: file.name, role: 'composition', kind: 'image', mime: file.mime || 'image/png' }] : []
  }, [editor])

  const sendPrompt = useCallback(async (
    override?: string,
    extraReferences: ReferenceImage[] = [],
    recoveringRun?: AgentRunView,
    clarificationContinuation?: ClarificationContinuation,
    forceNewAttempt = false,
    options: SendPromptOptions = {},
  ) => {
    const message = (override ?? prompt).trim()
    const runCanvasId = activeCanvasRef.current
    if (!message || !runCanvasId || runningCanvasIdsRef.current.has(runCanvasId) || !editor) return
    if (!recoveringRun && composerMode === 'video') {
      setChatError('视频模式将在后续阶段接入现有视频能力，当前可使用 Agent 或图片模式。')
      return
    }
    const currentSelection = editor.getSelectedShapes()
    const allCanvasMarkers = editor.getCurrentPageShapes()
      .filter(shape => shape.type === 'design-marker')
      .map(shape => shape as DesignMarkerShape)
      .sort((left, right) => left.props.number - right.props.number)
    const canvasMarkers = options.markerTargetId
      ? allCanvasMarkers.filter(marker => marker.props.targetShapeId === options.markerTargetId)
      : allCanvasMarkers
    const markerTargetShapes = canvasMarkers
      .map(marker => marker.props.targetShapeId
        ? editor.getShape(marker.props.targetShapeId as TLShapeId)
        : undefined)
      .filter((shape): shape is TLShape => Boolean(shape))
      .filter((shape, index, shapes) => shapes.findIndex(candidate => candidate.id === shape.id) === index)
    const markerContexts: CanvasMarkerContext[] = canvasMarkers.map(marker => {
      const target = marker.props.targetShapeId
        ? editor.getShape(marker.props.targetShapeId as TLShapeId)
        : undefined
      return {
        number: marker.props.number,
        label: marker.props.label,
        targetName: marker.props.targetName,
        xPercent: target ? Math.round(marker.props.xRatio * 100) : undefined,
        yPercent: target ? Math.round(marker.props.yRatio * 100) : undefined,
      }
    })
    const requestMessage = options.directCanvasTool
      ? message
      : appendCanvasMarkerContext(message, markerContexts)
    const markerReferences: ReferenceImage[] = options.directCanvasTool ? [] : markerTargetShapes.flatMap(shape => {
      if (shape.type === 'design-image') {
        const image = shape as DesignImageShape
        return [{ url: image.props.url, name: image.props.name, role: 'marked-reference', kind: 'image', mime: 'image/png' }]
      }
      if (shape.type === 'design-generator') {
        const generator = shape as DesignGeneratorShape
        return generator.props.status === 'result' && generator.props.resultUrl
          ? [{ url: generator.props.resultUrl, name: generator.props.resultName, role: 'marked-reference', kind: 'image', mime: 'image/png' }]
          : []
      }
      return []
    })
    const recovering = Boolean(recoveringRun) && !forceNewAttempt
    const continuingClarification = Boolean(clarificationContinuation)
    const showInAgentPanel = shouldShowInAgentPanel(options)
    const previousRun = recoveringRun || clarificationContinuation?.run
    const selectedAssetShapes = [...currentSelection, ...markerTargetShapes]
      .filter((shape, index, shapes) => shapes.findIndex(candidate => candidate.id === shape.id) === index)
    if (!previousRun && selectedAssetShapes.length > AGENT_REFERENCE_MAX) {
      setChatError(`最多引用 ${AGENT_REFERENCE_MAX} 个画布对象，请减少选中内容后重试`)
      return
    }
    let preparedReferences: ReferenceImage[]
    try {
      const canvasReferences = previousRun?.requestContext?.referenceImages || options.referenceMode === 'replace'
        ? []
        : await collectReferences(currentSelection)
      preparedReferences = prepareAgentReferences({
        previousReferences: previousRun?.requestContext?.referenceImages,
        pendingReferences: showInAgentPanel && !options.directCanvasTool ? pendingReferences : [],
        canvasReferences,
        markerReferences,
        extraReferences,
        replace: options.referenceMode === 'replace',
      })
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error))
      return
    }
    if (preparedReferences.length > AGENT_REFERENCE_MAX) {
      setChatError(`最多引用 ${AGENT_REFERENCE_MAX} 张图片，请移除部分附件或取消部分画布选中内容`)
      return
    }
    if (activeCanvasRef.current !== runCanvasId || !beginCanvasRun(runCanvasId)) return
    const currentSession = agentSessionRef.current
    const previousTurn = previousRun
      ? currentSession.turns.find(turn => turn.attempts.some(attempt =>
        attempt.id === previousRun.id || attempt.request_id === previousRun.id,
      ))
      : undefined
    const selectionLineage = shapeLineage(currentSelection[0]) || {}
    const lineageParentTurn = String(selectionLineage.agentTurnId || '')
      || currentSession.turns.find(turn => turn.attempts.some(attempt =>
        attempt.id === String(selectionLineage.agentRunId || ''),
      ))?.id
      || ''
    const startsNewThread = currentSession.composer.mode_hint === 'new_session'
    const parentTurnId = previousTurn
      ? previousTurn.parent_turn_id
      : currentSession.composer.parent_turn_id
        || lineageParentTurn
        || (!startsNewThread ? currentSession.active_turn_id || undefined : undefined)
    setChatError('')
    if (override === undefined && !recovering) setPrompt('')
    const selectedSkill = previousRun
      ? (previousRun.skill === 'Design Agent' ? '' : previousRun.skill)
      : activeSkill
    const requestMode = previousRun?.requestContext?.mode || composerMode
    const requestImageAspect = previousRun?.requestContext?.imageAspect || selectedImageAspect
    const requestedGenerationSize = options.requestedSize
      || previousRun?.requestContext?.requestedSize
      || (requestMode === 'image' ? imageComposerSizeForAspect(requestImageAspect) : '')
    // Agent mode plans and reviews. Explicit image/video modes go straight to
    // their media capability without a separate requirement-analysis request.
    const structuredRun = shouldAnalyzeComposerMode(requestMode)
    const runSkill = previousRun?.skill || selectedSkill || 'Design Agent'
    const visualRun = true
    const route = previousRun?.requestContext?.route
      || resolveGenerationRoute(apiProviders, selectedImageModel, selectedAnalysisModel)
    const runId = forceNewAttempt ? crypto.randomUUID() : previousRun?.id || crypto.randomUUID()
    const turnId = previousTurn?.id || crypto.randomUUID()
    const nextRun: AgentRunView = {
      ...previousRun,
      id: runId,
      phase: options.directCanvasTool || !structuredRun || (previousRun?.plan && recovering) ? 'generating' : 'analyzing',
      prompt: message,
      skill: runSkill,
      model: route.image_model || 'GPT Image',
      startedAt: Date.now(),
      imageUrl: forceNewAttempt ? undefined : previousRun?.imageUrl,
      imageName: forceNewAttempt ? undefined : previousRun?.imageName,
      messageId: forceNewAttempt ? undefined : previousRun?.messageId,
      plan: forceNewAttempt ? undefined : previousRun?.plan,
      executionRoute: forceNewAttempt ? undefined : previousRun?.executionRoute,
      workflowPlan: forceNewAttempt ? undefined : previousRun?.workflowPlan,
      workflowModules: forceNewAttempt ? undefined : previousRun?.workflowModules,
      identityAnchor: forceNewAttempt ? undefined : previousRun?.identityAnchor,
      routingReason: forceNewAttempt ? undefined : previousRun?.routingReason,
      generationPrompt: forceNewAttempt ? undefined : previousRun?.generationPrompt,
      clarification: forceNewAttempt ? undefined : previousRun?.clarification,
      review: forceNewAttempt ? undefined : previousRun?.review,
      analysisModel: forceNewAttempt ? undefined : previousRun?.analysisModel,
      reviewModel: forceNewAttempt ? undefined : previousRun?.reviewModel,
      failedStage: undefined,
      error: undefined,
      upstreamOutcome: undefined,
      reviewWarning: undefined,
      regenerationCount: forceNewAttempt ? 0 : previousRun?.regenerationCount || 0,
      generationRequestId: forceNewAttempt ? undefined : previousRun?.generationRequestId,
      clarificationAnswers: forceNewAttempt
        ? undefined
        : clarificationContinuation?.answers || previousRun?.clarificationAnswers,
      clarificationSkipped: forceNewAttempt
        ? undefined
        : clarificationContinuation?.skip || previousRun?.clarificationSkipped,
      requestContext: {
        mode: requestMode === 'image' ? 'image' : 'agent',
        route,
        referenceImages: previousRun?.requestContext?.referenceImages || [],
        sourceShapeId: previousRun?.requestContext?.sourceShapeId || currentSelection[0]?.id || markerTargetShapes[0]?.id,
        imageAspect: requestMode === 'image' ? requestImageAspect : undefined,
        requestedSize: requestedGenerationSize || undefined,
      },
    }
    if (showInAgentPanel) {
      activeTurnIdRef.current = turnId
      setAgentRun(nextRun)
      if (!recovering && !continuingClarification) setActiveSkill('')
    }
    const existingUserMessage = previousTurn?.user_message
      || messages.find(item => item.role === 'user' && item.request_id === runId)
    const userMessage: ChatMessage = existingUserMessage
      || { id: crypto.randomUUID(), role: 'user', content: message, request_id: runId }
    if (showInAgentPanel) {
      updateAgentSession(current => {
        const existing = current.turns.find(turn => turn.id === turnId)
        if (!existing) {
          const timestamp = Date.now()
          return {
            ...current,
            active_turn_id: turnId,
            next_sequence: current.next_sequence + 1,
            turns: [...current.turns, {
              id: turnId,
              sequence: current.next_sequence,
              parent_turn_id: parentTurnId,
              user_message: userMessage,
              references: preparedReferences,
              attempts: [{
                id: runId,
                request_id: runId,
                status: 'running',
                run: nextRun,
                assistant_messages: [],
                created_at: timestamp,
                updated_at: timestamp,
              }],
              active_attempt_id: runId,
              created_at: timestamp,
              updated_at: timestamp,
            }],
            composer: {
              ...current.composer,
              pending_references: previousRun ? current.composer.pending_references : [],
              parent_turn_id: undefined,
              mode_hint: undefined,
            },
            updated_at: timestamp,
          }
        }
        const attempts = existing.attempts.some(attempt => attempt.id === runId)
          ? existing.attempts.map(attempt => attempt.id === runId ? {
            ...attempt,
            status: recovering ? 'recovering' as const : 'running' as const,
            run: nextRun,
            assistant_messages: recovering
              ? attempt.assistant_messages.filter(item => item.type !== 'error')
              : attempt.assistant_messages,
            updated_at: Date.now(),
          } : attempt)
          : [...existing.attempts, {
            id: runId,
            request_id: runId,
            status: 'running' as const,
            run: nextRun,
            assistant_messages: [],
            created_at: Date.now(),
            updated_at: Date.now(),
          }]
        return {
          ...current,
          active_turn_id: turnId,
          turns: current.turns.map(turn => turn.id === turnId ? {
            ...turn,
            attempts,
            active_attempt_id: runId,
            updated_at: Date.now(),
          } : turn),
          composer: {
            ...current.composer,
            pending_references: previousRun ? current.composer.pending_references : [],
            parent_turn_id: undefined,
            mode_hint: undefined,
          },
          updated_at: Date.now(),
        }
      })
      if (!previousRun) setPendingReferences([])
      setMessages(items => mergeAgentAttemptMessages(items, userMessage, Boolean(previousTurn)))
    }
    const originalSourceId = previousRun?.requestContext?.sourceShapeId
    const source = originalSourceId
      ? editor.getShape(originalSourceId as TLShapeId)
      : currentSelection[0] || markerTargetShapes[0]
    const sourceBounds = source ? editor.getShapePageBounds(source) : null
    const existingPlaceholder = editor.getCurrentPageShapes().find(shape => {
      if (shape.type !== 'generation-placeholder') return false
      const placementId = String((shape.props as { placementId?: string }).placementId || '')
      return placementId === runId || placementId === userMessage.id
    })
    const placeholderId = existingPlaceholder?.id || createShapeId()
    let placementPosition: { x: number; y: number } | undefined
    let placeholderCreated = Boolean(existingPlaceholder)
    let activeStage: Exclude<AgentRunPhase, 'completed' | 'failed'> = options.directCanvasTool || (previousRun?.plan && !forceNewAttempt)
      ? 'generating'
      : structuredRun ? 'analyzing' : 'generating'
    let activePlan: WorkbenchDesignPlan | undefined = forceNewAttempt ? undefined : previousRun?.plan
    let activeReferenceAnalysis: WorkbenchReferenceAnalysis[] = forceNewAttempt ? [] : previousRun?.referenceAnalysis || []
    let activeExecutionRoute = options.directCanvasTool
      ? 'edit_image'
      : forceNewAttempt ? undefined : previousRun?.executionRoute
    let activeRoutingReason = options.directCanvasTool
      ? '用户在画布上明确执行图像编辑工具'
      : forceNewAttempt ? '' : previousRun?.routingReason || ''
    let activeGenerationPrompt = options.directCanvasTool
      ? message
      : forceNewAttempt
      ? ''
      : previousRun?.generationPrompt || activePlan?.generation_prompt || ''
    const createGenerationPlaceholder = () => {
      if (!visualRun) return
      if (existingPlaceholder) {
        placementPosition = { x: existingPlaceholder.x, y: existingPlaceholder.y }
        editor.updateShape({
          id: existingPlaceholder.id,
          type: 'generation-placeholder',
          props: { status: 'generating', label: '生成中', placementId: runId },
        })
        return
      }
      if (placeholderCreated) return
      const viewport = editor.getViewportPageBounds()
      const side = structuredRun ? 640 : 512
      placementPosition = {
        x: sourceBounds ? sourceBounds.maxX + 72 : viewport.center.x - side / 2,
        y: sourceBounds ? sourceBounds.minY : viewport.center.y - side / 2,
      }
      editor.createShape({
        id: placeholderId,
        type: 'generation-placeholder',
        ...placementPosition,
        props: { w: side, h: side, status: 'generating', label: '生成中', placementId: runId },
      })
      placeholderCreated = true
    }
    try {
      const references = preparedReferences
      if (activeCanvasRef.current !== runCanvasId) return
      if (showInAgentPanel) {
        updateAgentSession(current => ({
          ...current,
          turns: current.turns.map(turn => turn.id === turnId
            ? { ...turn, references, updated_at: Date.now() }
            : turn),
          updated_at: Date.now(),
        }))
      }
      if (showInAgentPanel) {
        setAgentRun(run => run?.id === runId ? {
          ...run,
          requestContext: {
            mode: requestMode === 'image' ? 'image' : 'agent',
            route,
            referenceImages: references,
            sourceShapeId: source?.id,
            imageAspect: requestMode === 'image' ? requestImageAspect : undefined,
            requestedSize: requestedGenerationSize || undefined,
          },
        } : run)
      }
      if (structuredRun && !activePlan && !activeExecutionRoute) {
        if (recovering) {
          throw new Error('原任务尚未进入生图阶段，无法无扣费恢复。需求已保留，请确认后重新发送。')
        }
        const priorClarification = clarificationContinuation?.run.clarification
        const parentTurn = parentTurnId
          ? currentSession.turns.find(turn => turn.id === parentTurnId)
          : undefined
        const parentRun = activeAttempt(parentTurn)?.run
        if (!selectedAssetShapes.length && source) selectedAssetShapes.push(source)
        const selectedAssets = selectedAssetShapes.map(shape => {
          const image = shape.type === 'design-image' ? shape as DesignImageShape : null
          const generator = shape.type === 'design-generator' ? shape as DesignGeneratorShape : null
          return {
            id: String(shape.id),
            type: shape.type,
            url: image?.props.url || generator?.props.resultUrl || '',
            name: image?.props.name || generator?.props.resultName || shape.type,
            lineage: shapeLineage(shape) || {},
          }
        })
        const planResult = await replayableWorkbenchRequest<{ analysis: WorkbenchRoutingDecision; model: string }>(
          '/api/agent/workbench/plan', {
            request_id: runId,
            message: requestMessage,
            canvas_id: runCanvasId,
            session_id: currentSession.session_id,
            turn_id: turnId,
            parent_turn_id: parentTurnId || '',
            mode_hint: options.modeHint || currentSession.composer.mode_hint || requestMode,
            skill: runSkill,
            provider: route.provider,
            model: route.chat_model,
            allow_model_fallback: route.allow_chat_fallback,
            reference_images: references.map(reference => ({ url: reference.url, name: reference.name })),
            selected_assets: selectedAssets,
            prior_turns: summarizePriorTurns(currentSession, turnId),
            previous_plan: previousRun?.plan || parentRun?.plan || {},
            previous_review: previousRun?.review || parentRun?.review || {},
            clarification_id: priorClarification?.id || '',
            clarification_answers: priorClarification
              ? clarificationAnswerPayload(priorClarification, clarificationContinuation?.answers || {})
              : [],
            skip_clarification: Boolean(clarificationContinuation?.skip),
          }, () => activeCanvasRef.current === runCanvasId,
        )
        if (activeCanvasRef.current !== runCanvasId) return
        const decision = planResult.analysis
        if (decision.status === 'needs_clarification') {
          if (!decision.clarification) throw new Error('需求路由器没有返回可用的澄清问题')
          setAgentRun(run => run?.id === runId ? {
            ...run,
            phase: 'clarifying',
            clarification: decision.clarification || undefined,
            clarificationAnswers: {},
            clarificationSkipped: false,
            routingReason: decision.reason,
            analysisModel: planResult.model,
          } : run)
          return
        }
        if (decision.route === 'clarify') throw new Error('需求路由器返回了无效的执行路径')
        activeExecutionRoute = decision.route
        activeRoutingReason = decision.reason
        activePlan = decision.plan || parentRun?.plan || undefined
        activeReferenceAnalysis = decision.reference_analysis || []
        activeGenerationPrompt = decision.generation_prompt || activePlan?.generation_prompt || ''
        if (decision.route === 'specialist_workflow') {
          if (!decision.workflow_plan) throw new Error('详情页工作流没有返回可确认的模块清单')
          const workflowModules: AgentWorkflowModule[] = decision.workflow_plan.modules.map(module => ({
            ...module,
            selected: true,
            status: 'pending',
            attempt: 1,
          }))
          activeStage = 'confirming'
          setAgentRun(run => run?.id === runId ? {
            ...run,
            phase: 'confirming',
            plan: activePlan,
            referenceAnalysis: activeReferenceAnalysis,
            executionRoute: activeExecutionRoute,
            workflowPlan: decision.workflow_plan || undefined,
            workflowModules,
            identityAnchor: references.length
              ? { status: 'confirmed', confirmedAt: Date.now() }
              : { status: 'required', attempt: 1 },
            routingReason: decision.reason,
            generationPrompt: activeGenerationPrompt,
            clarification: priorClarification || run.clarification,
            clarificationAnswers: clarificationContinuation?.answers || run.clarificationAnswers,
            clarificationSkipped: Boolean(clarificationContinuation?.skip),
            analysisModel: planResult.model,
          } : run)
          return
        }
        activeStage = 'generating'
        setAgentRun(run => run?.id === runId ? {
          ...run,
          phase: 'generating',
          plan: activePlan,
          referenceAnalysis: activeReferenceAnalysis,
          executionRoute: activeExecutionRoute,
          routingReason: decision.reason,
          generationPrompt: activeGenerationPrompt,
          clarification: priorClarification || run.clarification,
          clarificationAnswers: clarificationContinuation?.answers || run.clarificationAnswers,
          clarificationSkipped: Boolean(clarificationContinuation?.skip),
          analysisModel: planResult.model,
        } : run)
      }
      createGenerationPlaceholder()
      const statusToResult = (status: AgentRequestStatus): AgentResponse => {
        if (status.status === 'succeeded' && status.message) {
          return { conversation: status.conversation, message: status.message }
        }
        if (status.status === 'running') throw new AgentRequestStillRunningError(status)
        const messageText = status.message?.content || '原任务没有可恢复的图片结果。'
        const statusError = new Error(messageText) as Error & { upstreamOutcome?: string }
        statusError.upstreamOutcome = status.status === 'outcome_unknown' ? 'unknown' : status.status
        throw statusError
      }
      const executeGenerationRequest = async (
        generationRequestId: string,
        generationMessage: string,
        generationReferences: ReferenceImage[],
        generationRoute: Exclude<WorkbenchExecutionRoute, 'clarify'> | undefined,
        generationPrompt: string,
        recoverOnly: boolean,
        executionConversationId: string,
      ) => {
        if (recoverOnly) {
          const recovered = await pollAgentRequest(
            generationRequestId,
            600,
            2000,
            () => activeCanvasRef.current === runCanvasId,
            { surface: 'design_agent', contextId: runCanvasId },
          )
          if (activeCanvasRef.current !== runCanvasId) return null
          if (!recovered) throw new Error('未找到原任务记录。为避免重复扣费，系统没有自动创建新任务。')
          return statusToResult(recovered)
        }
        try {
          const executeAgentRequest = (scopedConversationId: string) => api<AgentResponse>('/api/chat/agent', {
            method: 'POST',
            body: JSON.stringify({
              request_id: generationRequestId,
              conversation_id: scopedConversationId,
              surface: 'design_agent',
              context_id: runCanvasId,
              session_id: currentSession.session_id,
              turn_id: turnId,
              parent_turn_id: parentTurnId || '',
              message: generationMessage,
              skill: structuredRun ? runSkill : selectedSkill,
              system_prompt: structuredRun ? executionSystemPrompt(generationRoute, runSkill) : '',
              mode: generationRequestId === runId ? requestMode : 'image',
              size: requestedGenerationSize || (structuredRun ? '1440x1440' : '1024x1024'),
              quality: 'auto',
              ...route,
              model: route.chat_model,
              agent_plan: {
                status: 'ready',
                route: generationRoute || 'direct_generate',
                reason: generationRequestId === runId
                  ? activeRoutingReason
                  : '上一版质量复核未通过，自动按复核意见重新生成',
                generation_prompt: generationPrompt,
                plan: activePlan || null,
                reference_analysis: activeReferenceAnalysis,
              },
              reference_images: generationReferences,
            }),
          })
          try {
            return await executeAgentRequest(executionConversationId)
          } catch (scopeError) {
            if (
              scopeError instanceof ApiError
              && scopeError.status === 409
              && ['conversation_unavailable', 'conversation_surface_conflict', 'conversation_context_conflict', 'legacy_conversation_ambiguous'].includes(scopeError.code)
            ) {
              if (showInAgentPanel) setConversationId('')
              return await executeAgentRequest('')
            }
            throw scopeError
          }
        } catch (requestError) {
          const recovered = await pollAgentRequest(
            generationRequestId,
            600,
            2000,
            () => activeCanvasRef.current === runCanvasId,
            { surface: 'design_agent', contextId: runCanvasId },
          )
          if (activeCanvasRef.current !== runCanvasId) return null
          if (!recovered) throw requestError
          return statusToResult(recovered)
        }
      }

      let regenerationCount = previousRun?.regenerationCount || 0
      let generationRequestId = previousRun?.generationRequestId
        || (regenerationCount > 0 ? automaticRegenerationRequestId(runId, regenerationCount) : runId)
      let priorMessageId = previousRun?.messageId || ''
      let generationMessage = regenerationCount > 0 && previousRun?.review
        ? automaticRegenerationPrompt(requestMessage, previousRun.review, references.length)
        : requestMessage
      let generationReferences = regenerationCount > 0 && previousRun?.imageUrl
        ? uniqueReferenceImages([
          { url: previousRun.imageUrl, name: previousRun.imageName || '上一版成图', role: 'edit-source', kind: 'image', mime: 'image/png' },
          ...references,
        ])
        : references
      let generationRoute = regenerationCount > 0 ? 'edit_image' as const : activeExecutionRoute
      let generationPrompt = regenerationCount > 0
        ? generationMessage
        : activeGenerationPrompt || activePlan?.generation_prompt || requestMessage
      let recoverGeneration = recovering
      let activeConversationId = showInAgentPanel ? conversationId : ''
      let supersededResultIds: TLShapeId[] = []

      while (true) {
        const result = await executeGenerationRequest(
          generationRequestId,
          generationMessage,
          generationReferences,
          generationRoute,
          generationPrompt,
          recoverGeneration,
          activeConversationId,
        )
        if (!result || activeCanvasRef.current !== runCanvasId) return
        activeConversationId = result.conversation.id
        if (showInAgentPanel) setConversationId(activeConversationId)
        if (showInAgentPanel) {
          setAgentRun(run => run?.id === runId ? {
            ...run,
            model: result.message.model || run.model,
            messageId: result.message.id,
            generationRequestId,
            regenerationCount,
          } : run)
        }
        if (showInAgentPanel) {
          setMessages(items => {
            const retained = regenerationCount > 0 && priorMessageId
              ? items.filter(item => item.id !== priorMessageId)
              : items
            return retained.some(item => item.id === result.message.id)
              ? retained.map(item => item.id === result.message.id ? result.message : item)
              : [...retained, result.message]
          })
          if (regenerationCount > 0 && priorMessageId) {
            updateAgentSession(current => ({
              ...current,
              turns: current.turns.map(turn => turn.id === turnId ? {
                ...turn,
                attempts: turn.attempts.map(attempt => attempt.id === runId || attempt.request_id === runId ? {
                  ...attempt,
                  assistant_messages: [
                    ...attempt.assistant_messages.filter(item => item.id !== priorMessageId && item.type !== 'error'),
                    result.message,
                  ],
                  status: 'running',
                  updated_at: Date.now(),
                } : attempt),
                updated_at: Date.now(),
              } : turn),
              updated_at: Date.now(),
            }))
          } else {
            appendTurnAssistant(turnId, runId, result.message, 'running')
          }
        }
        if (editor.getShape(placeholderId)) editor.deleteShape(placeholderId)
        const urls = result.message.image_urls?.length
          ? result.message.image_urls
          : result.message.image_url ? [result.message.image_url] : []
        if (!urls.length) throw new Error('Agent 没有返回可放入画布的图片成果')
        const priorResult = regenerationCount > 0
          ? editor.getCurrentPageShapes().find(shape => {
            if (shape.type !== 'design-image') return false
            const lineage = shapeLineage(shape) || {}
            return String(lineage.agentRunId || '') === runId
              && String(lineage.requestId || '') !== generationRequestId
          })
          : undefined
        const priorBounds = priorResult ? editor.getShapePageBounds(priorResult) : null
        const resultPosition = priorBounds
          ? { x: priorBounds.minX, y: priorBounds.minY }
          : placementPosition
        const placedImageIds: TLShapeId[] = []
        for (let index = 0; index < urls.length; index += 1) {
          const existingResult = editor.getCurrentPageShapes().find(shape => {
            if (shape.type !== 'design-image') return false
            const lineage = shapeLineage(shape) || {}
            return (String(lineage.requestId || '') === generationRequestId || String(lineage.messageId || '') === result.message.id)
              && (shape as DesignImageShape).props.url === urls[index]
          })
          const placedId = existingResult?.id || await addImage(urls[index], `${options.resultName || message.slice(0, 28) || 'Agent 设计'} ${index + 1}`, {
            parentShapeId: source?.id || '',
            parentLineage: shapeLineage(source) || {},
            conversationId: result.conversation.id,
            messageId: result.message.id,
            requestId: generationRequestId,
            agentRunId: runId,
            agentTurnId: turnId,
            parentTurnId: parentTurnId || '',
            model: result.message.model || '',
            provider: result.message.provider || '',
            prompt: generationMessage,
            skill: structuredRun ? runSkill : selectedSkill,
            agentAction: result.message.agent_action || '',
            source: regenerationCount > 0 ? 'chat-agent-regeneration' : 'chat-agent',
            createdAt: Date.now(),
          }, resultPosition ? { x: resultPosition.x + index * 680, y: resultPosition.y } : undefined)
          if (placedId) placedImageIds.push(placedId)
        }
        if (regenerationCount > 0 && placedImageIds.length > 0) {
          supersededResultIds = editor.getCurrentPageShapes()
            .filter(shape => {
              if (shape.type !== 'design-image' || placedImageIds.includes(shape.id)) return false
              const lineage = shapeLineage(shape) || {}
              return String(lineage.agentRunId || '') === runId
                && String(lineage.requestId || '') !== generationRequestId
            })
            .map(shape => shape.id)
          supersededResultIds.forEach(id => editor.getShape(id) && editor.deleteShape(id))
        }
        focusPlacedResults(editor, placedImageIds)
        if (!structuredRun || !showInAgentPanel) {
          if (showInAgentPanel) {
            setAgentRun(run => run?.id === runId ? {
              ...run,
              phase: 'completed',
              imageUrl: urls[0],
              imageName: `${options.resultName || message.slice(0, 28) || 'Agent 设计'}`,
              model: result.message.model || run.model,
              messageId: result.message.id,
              generationRequestId,
              failedStage: undefined,
              error: undefined,
            } : run)
          }
          break
        }

        const imageUrl = urls[0]
        const imageName = `${options.resultName || message.slice(0, 28) || 'Agent 设计'}`
        if (!imageUrl) throw new Error('Agent 没有返回可复盘的图片成果')
        activeStage = 'reviewing'
        setAgentRun(run => run?.id === runId ? {
          ...run,
          phase: 'reviewing',
          imageUrl,
          imageName,
          model: result.message.model || run.model,
          messageId: result.message.id,
          generationRequestId,
          regenerationCount,
        } : run)
        const reviewRequestId = regenerationCount > 0
          ? `${runId}-review-regenerate-${regenerationCount}`
          : `${runId}-review`
        const reviewResult = await replayableWorkbenchRequest<{ analysis: WorkbenchResultReview; model: string }>(
          '/api/agent/workbench/review', {
            request_id: reviewRequestId,
            message: requestMessage,
            skill: runSkill,
            provider: route.provider,
            model: route.chat_model,
            allow_model_fallback: route.allow_chat_fallback,
            image_url: imageUrl,
            image_name: imageName,
            reference_images: references.map(reference => ({ url: reference.url, name: reference.name })),
            plan: activePlan ? { ...activePlan, reference_analysis: activeReferenceAnalysis } : {
              reference_analysis: activeReferenceAnalysis,
            },
          }, () => activeCanvasRef.current === runCanvasId,
        )
        if (activeCanvasRef.current !== runCanvasId) return
        if (!shouldAutoRegenerateReview(reviewResult.analysis, regenerationCount)) {
          setAgentRun(run => run?.id === runId ? {
            ...run,
            phase: 'completed',
            review: reviewResult.analysis,
            reviewModel: reviewResult.model,
            reviewWarning: undefined,
            failedStage: undefined,
            error: undefined,
          } : run)
          break
        }

        regenerationCount += 1
        generationRequestId = automaticRegenerationRequestId(runId, regenerationCount)
        generationMessage = automaticRegenerationPrompt(requestMessage, reviewResult.analysis, references.length)
        generationReferences = uniqueReferenceImages([
          { url: imageUrl, name: `${imageName}（待修正版）`, role: 'edit-source', kind: 'image', mime: 'image/png' },
          ...references,
        ])
        generationRoute = 'edit_image'
        generationPrompt = generationMessage
        recoverGeneration = false
        priorMessageId = result.message.id
        activeStage = 'generating'
        setAgentRun(run => run?.id === runId ? {
          ...run,
          phase: 'generating',
          review: reviewResult.analysis,
          reviewModel: reviewResult.model,
          reviewWarning: undefined,
          regenerationCount,
          generationRequestId,
          failedStage: undefined,
          error: undefined,
          upstreamOutcome: undefined,
        } : run)
      }
      if (!showInAgentPanel) {
        setNotice('已生成新版本并放入画布')
        window.setTimeout(() => setNotice(''), 2200)
      }
    } catch (error) {
      if (activeCanvasRef.current !== runCanvasId) return
      if (error instanceof AgentRequestStillRunningError) {
        if (showInAgentPanel) {
          setAgentRun(run => run?.id === runId ? {
            ...run,
            phase: 'generating',
            failedStage: undefined,
            error: undefined,
            upstreamOutcome: error.status.upstream_task_id ? 'running_known_task' : 'running',
          } : run)
        }
        setChatError('')
        return
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      const apiError = error instanceof ApiError ? error : null
      const failureNotice = apiError?.refundedPoints
        ? `生成失败，已返还 ${apiError.refundedPoints} 积分：${errorMessage}`
        : errorMessage
      if (showInAgentPanel && apiError?.conversationId) setConversationId(apiError.conversationId)
      if (showInAgentPanel) {
        setMessages(items => appendFailureMessage(items, error, runId))
        const failureMessages = appendFailureMessage([], error, runId)
        if (failureMessages[0]) appendTurnAssistant(turnId, runId, failureMessages[0], 'failed')
      }
      const placeholder = editor.getShape(placeholderId)
      if (placeholder) editor.updateShape({
        id: placeholderId,
        type: 'generation-placeholder',
        props: { status: 'failed', label: showInAgentPanel ? '生成失败，请在右侧重试' : '生成失败，请重新使用画布工具' },
      })
      if (showInAgentPanel) setAgentRun(run => run?.id === runId ? {
        ...run,
        phase: 'failed',
        failedStage: activeStage,
        plan: run.plan || activePlan,
        error: errorMessage,
        upstreamOutcome: outcomeIsUnknown(error) ? 'unknown' : 'failed',
        reviewWarning: undefined,
      } : run)
      if (showInAgentPanel) {
        setChatError(failureNotice)
      } else {
        setNotice(apiError?.refundedPoints ? failureNotice : `处理失败：${errorMessage}`)
        window.setTimeout(() => setNotice(''), 3200)
      }
    } finally {
      try {
        await refreshPoints()
      } finally {
        finishCanvasRun(runCanvasId)
      }
    }
  }, [activeSkill, addImage, apiProviders, appendTurnAssistant, beginCanvasRun, collectReferences, composerMode, conversationId, editor, finishCanvasRun, messages, pendingReferences, prompt, refreshPoints, selectedAnalysisModel, selectedImageAspect, selectedImageModel, updateAgentSession])

  const runWorkflowIdentityAnchor = useCallback(async (
    sourceRun: AgentRunView,
    requestedModuleIds: string[],
    mode: 'initial' | 'retry' | 'resume' = 'initial',
  ) => {
    const runCanvasId = activeCanvasRef.current
    if (
      !runCanvasId
      || !editor
      || !sourceRun.workflowPlan
      || !sourceRun.workflowModules?.length
      || !requestedModuleIds.length
      || !beginCanvasRun(runCanvasId)
    ) return

    const workflowPlan = sourceRun.workflowPlan
    const session = agentSessionRef.current
    const turn = session.turns.find(item => item.attempts.some(attempt =>
      attempt.id === sourceRun.id || attempt.request_id === sourceRun.id,
    ))
    const turnId = turn?.id || activeTurnIdRef.current || ''
    if (!turnId) {
      finishCanvasRun(runCanvasId)
      setChatError('工作流所属对话已丢失，无法安全生成产品母图。')
      return
    }
    activeTurnIdRef.current = turnId
    const requested = new Set(requestedModuleIds)
    const route = sourceRun.requestContext?.route || resolveGenerationRoute(apiProviders, selectedImageModel, selectedAnalysisModel)
    const attempt = mode === 'retry'
      ? Math.max(1, Number(sourceRun.identityAnchor?.attempt || 1) + 1)
      : Math.max(1, Number(sourceRun.identityAnchor?.attempt || 1))
    const requestId = mode === 'resume' && sourceRun.identityAnchor?.requestId
      ? sourceRun.identityAnchor.requestId
      : `${sourceRun.id}:identity-anchor:attempt:${attempt}`
    let activeConversationId = session.conversation_id || conversationId
    const anchorGenerationMessage = [
      `产品主体必须是：${sourceRun.prompt}`,
      workflowPlan.summary,
      '在生成详情页各模块前，先生成一张“产品身份母图”，用于锁定后续所有画面的同一商品。',
      '使用中性浅色棚拍背景，完整展示产品本体与必要配件；轮廓、结构、连接方式、颜色、材质、按键/开孔和收纳或充电结构必须清晰且自洽。',
      '产品类型不得替换：不得生成家电、挂烫机、头戴式耳机、入耳式耳机或其他不同品类。',
      '只使用用户明确提供的事实。不要写型号、蓝牙版本、尺寸、重量、单元、认证或其他未提供参数，不要生成规格表。',
      '只输出一张产品母图，不要拼图，不要同时设计多个产品方案。',
    ].join('\n')
    let workingRun: AgentRunView = {
      ...sourceRun,
      phase: 'generating',
      workflowReviewDecision: undefined,
      startedAt: mode === 'resume' ? sourceRun.startedAt : Date.now(),
      error: undefined,
      failedStage: undefined,
      identityAnchor: {
        status: 'generating',
        attempt,
        requestId,
      },
      workflowModules: sourceRun.workflowModules.map(module => {
        if (mode === 'initial' && !requested.has(module.id) && module.status === 'pending') {
          return { ...module, selected: false, status: 'cancelled' as const }
        }
        return requested.has(module.id)
          ? { ...module, selected: true, status: module.status === 'cancelled' ? 'pending' as const : module.status }
          : module
      }),
    }
    const publishRun = (next: AgentRunView) => {
      workingRun = next
      setAgentRun(current => current?.id === next.id ? next : current)
      updateTurnRun(turnId, next.id, () => next)
    }
    const statusToResult = (status: AgentRequestStatus): AgentResponse => {
      if (status.status === 'succeeded' && status.message) return { conversation: status.conversation, message: status.message }
      if (status.status === 'running') throw new AgentRequestStillRunningError(status)
      const error = new Error(status.message?.content || '产品母图任务没有可恢复的图片结果。') as Error & { upstreamOutcome?: string }
      error.upstreamOutcome = status.status === 'outcome_unknown' ? 'unknown' : status.status
      throw error
    }
    const execute = (scopedConversationId: string) => api<AgentResponse>('/api/chat/agent', {
      method: 'POST',
      body: JSON.stringify({
        request_id: requestId,
        conversation_id: scopedConversationId,
        surface: 'design_agent',
        context_id: runCanvasId,
        session_id: session.session_id,
        turn_id: turnId,
        parent_turn_id: turn?.parent_turn_id || '',
        message: anchorGenerationMessage,
        skill: sourceRun.skill,
        system_prompt: executionSystemPrompt('specialist_workflow', sourceRun.skill),
        mode: 'image',
        size: '1440x1440',
        quality: 'auto',
        ...route,
        model: route.chat_model,
        agent_plan: {
          status: 'ready',
          route: 'specialist_workflow',
          reason: '生成并确认产品身份母图后才能执行多模块生成',
          generation_prompt: anchorGenerationMessage,
          workflow_plan: workflowPlan,
          identity_anchor: true,
        },
        reference_images: [],
      }),
    })

    publishRun(workingRun)
    try {
      let result: AgentResponse | null = null
      if (mode === 'resume') {
        const recovered = await pollAgentRequest(
          requestId,
          600,
          2000,
          () => activeCanvasRef.current === runCanvasId,
          { surface: 'design_agent', contextId: runCanvasId },
        )
        if (recovered) result = statusToResult(recovered)
      }
      if (!result) {
        try {
          try {
            result = await execute(activeConversationId)
          } catch (scopeError) {
            if (
              scopeError instanceof ApiError
              && scopeError.status === 409
              && ['conversation_unavailable', 'conversation_surface_conflict', 'conversation_context_conflict', 'legacy_conversation_ambiguous'].includes(scopeError.code)
            ) {
              activeConversationId = ''
              result = await execute('')
            } else {
              throw scopeError
            }
          }
        } catch (requestError) {
          const recovered = await pollAgentRequest(
            requestId,
            600,
            2000,
            () => activeCanvasRef.current === runCanvasId,
            { surface: 'design_agent', contextId: runCanvasId },
          )
          if (!recovered) throw requestError
          result = statusToResult(recovered)
        }
      }
      if (!result || activeCanvasRef.current !== runCanvasId) return
      activeConversationId = result.conversation.id
      setConversationId(activeConversationId)
      const imageUrl = result.message.image_urls?.[0] || result.message.image_url || ''
      if (!imageUrl) throw new Error('产品母图生成完成，但没有返回可用图片。')
      const existing = editor.getCurrentPageShapes().find(shape =>
        shape.type === 'design-image' && String(shapeLineage(shape)?.requestId || '') === requestId,
      )
      if (!existing) {
        const sourceShape = sourceRun.requestContext?.sourceShapeId
          ? editor.getShape(sourceRun.requestContext.sourceShapeId as TLShapeId)
          : undefined
        const sourceBounds = sourceShape ? editor.getShapePageBounds(sourceShape) : null
        const viewport = editor.getViewportPageBounds()
        await addImage(imageUrl, '产品身份母图', {
          parentShapeId: sourceShape?.id || '',
          parentLineage: shapeLineage(sourceShape) || {},
          conversationId: result.conversation.id,
          messageId: result.message.id,
          requestId,
          agentRunId: sourceRun.id,
          agentTurnId: turnId,
          model: result.message.model || '',
          provider: result.message.provider || '',
          prompt: sourceRun.prompt,
          skill: sourceRun.skill,
          agentAction: result.message.agent_action || '',
          source: 'specialist-workflow-identity-anchor',
          createdAt: Date.now(),
        }, {
          x: sourceBounds ? sourceBounds.maxX + 72 : viewport.center.x - 320,
          y: sourceBounds ? sourceBounds.minY : viewport.center.y - 320,
        })
      }
      publishRun({
        ...workingRun,
        phase: 'confirming_identity',
        model: result.message.model || workingRun.model,
        identityAnchor: {
          status: 'confirming',
          attempt,
          requestId,
          imageUrl,
          imageName: '产品身份母图',
          messageId: result.message.id,
        },
      })
      setNotice('请先确认产品母图，确认后才会开始模块生成')
      window.setTimeout(() => setNotice(''), 3000)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      publishRun({
        ...workingRun,
        phase: 'confirming_identity',
        identityAnchor: {
          status: 'failed',
          attempt,
          requestId,
          error: message,
        },
        error: message,
      })
    } finally {
      try {
        await refreshPoints()
      } finally {
        finishCanvasRun(runCanvasId)
      }
    }
  }, [addImage, apiProviders, beginCanvasRun, conversationId, editor, finishCanvasRun, refreshPoints, selectedAnalysisModel, selectedImageModel, updateTurnRun])

  const runWorkflowModules = useCallback(async (
    sourceRun: AgentRunView,
    requestedModuleIds: string[],
    mode: 'initial' | 'retry' | 'resume' | 'review' = 'initial',
  ) => {
    const runCanvasId = activeCanvasRef.current
    if (
      !runCanvasId
      || !editor
      || !sourceRun.workflowPlan
      || !sourceRun.workflowModules?.length
      || !requestedModuleIds.length
      || !beginCanvasRun(runCanvasId)
    ) return

    const session = agentSessionRef.current
    const turn = session.turns.find(item => item.attempts.some(attempt =>
      attempt.id === sourceRun.id || attempt.request_id === sourceRun.id,
    ))
    const turnId = turn?.id || activeTurnIdRef.current || ''
    if (!turnId) {
      finishCanvasRun(runCanvasId)
      setChatError('工作流所属对话已丢失，无法安全提交生成任务。')
      return
    }
    activeTurnIdRef.current = turnId
    const requested = new Set(requestedModuleIds)
    const executionModuleIds = workflowModuleExecutionIds(sourceRun.workflowModules, requestedModuleIds, mode)
    const workflowAspectRatio = sourceRun.workflowAspectRatio || '1:1'
    const workflowCopyMode = sourceRun.workflowCopyMode || 'with_copy'
    const workflowImageSize = workflowImageSizeForAspect(workflowAspectRatio)
    const route = sourceRun.requestContext?.route || resolveGenerationRoute(apiProviders, selectedImageModel, selectedAnalysisModel)
    const references = workflowIdentityReferences(sourceRun, turn?.references || [])
    const generatedIdentityAnchor = Boolean(
      sourceRun.identityAnchor?.status === 'confirmed' && sourceRun.identityAnchor.imageUrl,
    )
    const identityInstruction = generatedIdentityAnchor
      ? '产品身份锁定：参考图1是用户已确认的产品母图。必须保持同一产品的轮廓、结构、连接方式、颜色、材质、按键/开孔位置及收纳或充电结构；只允许改变背景、视角和构图，严禁改成另一款产品。'
      : references.length
        ? '产品身份锁定：严格按照参考图清单和 reference_analysis 保留必须出现的商品轮廓、结构、颜色、材质与配件形态，不得把风格参考误当产品，不得重新设计或切换商品类型。'
        : ''
    let activeConversationId = session.conversation_id || conversationId
    let workingRun: AgentRunView = {
      ...sourceRun,
      phase: mode === 'review' ? 'reviewing' : 'generating',
      startedAt: mode === 'resume' ? sourceRun.startedAt : Date.now(),
      failedStage: undefined,
      error: undefined,
      workflowReviewDecision: undefined,
      workflowModules: sourceRun.workflowModules.map(module => {
        if (!requested.has(module.id)) {
          return mode === 'initial' && module.status === 'pending'
            ? { ...module, selected: false, status: 'cancelled' as const }
            : module
        }
        if (mode === 'retry') {
          return {
            ...module,
            selected: true,
            status: 'pending' as const,
            attempt: Math.max(1, Number(module.attempt || 1) + 1),
            requestId: undefined,
            reviewAttempt: 1,
            review: undefined,
            error: undefined,
            imageUrl: undefined,
            imageName: undefined,
            messageId: undefined,
          }
        }
        if (mode === 'review' && module.imageUrl) {
          return {
            ...module,
            selected: true,
            status: 'reviewing' as const,
            reviewAttempt: Math.max(1, Number(module.reviewAttempt || 1) + 1),
            review: undefined,
            error: undefined,
          }
        }
        return { ...module, selected: true, status: module.status === 'cancelled' ? 'pending' as const : module.status }
      }),
    }
    const publishRun = (next: AgentRunView) => {
      workingRun = next
      setAgentRun(current => current?.id === next.id ? next : current)
      updateTurnRun(turnId, next.id, () => next)
    }
    const updateModule = (moduleId: string, patch: Partial<AgentWorkflowModule>, runPatch: Partial<AgentRunView> = {}) => {
      publishRun({
        ...workingRun,
        ...runPatch,
        workflowModules: (workingRun.workflowModules || []).map(module =>
          module.id === moduleId ? { ...module, ...patch } : module,
        ),
      })
    }
    const statusToResult = (status: AgentRequestStatus): AgentResponse => {
      if (status.status === 'succeeded' && status.message) return { conversation: status.conversation, message: status.message }
      if (status.status === 'running') throw new AgentRequestStillRunningError(status)
      const error = new Error(status.message?.content || '模块任务没有可恢复的图片结果。') as Error & { upstreamOutcome?: string }
      error.upstreamOutcome = status.status === 'outcome_unknown' ? 'unknown' : status.status
      throw error
    }
    const executeModule = async (module: AgentWorkflowModule, requestId: string, generationMessage: string) => {
      const shouldRecover = mode === 'resume' && Boolean(module.requestId)
      if (shouldRecover) {
        const recovered = await pollAgentRequest(
          requestId,
          600,
          2000,
          () => activeCanvasRef.current === runCanvasId,
          { surface: 'design_agent', contextId: runCanvasId },
        )
        if (recovered) return statusToResult(recovered)
      }
      const execute = (scopedConversationId: string) => api<AgentResponse>('/api/chat/agent', {
        method: 'POST',
        body: JSON.stringify({
          request_id: requestId,
          conversation_id: scopedConversationId,
          surface: 'design_agent',
          context_id: runCanvasId,
          session_id: session.session_id,
          turn_id: turnId,
          parent_turn_id: turn?.parent_turn_id || '',
          message: generationMessage,
          skill: sourceRun.skill,
          system_prompt: executionSystemPrompt('specialist_workflow', sourceRun.skill),
          mode: 'image',
          size: workflowImageSize,
          quality: 'auto',
          ...route,
          model: route.chat_model,
          agent_plan: {
            status: 'ready',
            route: 'specialist_workflow',
            reason: `执行已确认模块：${module.name}`,
            generation_prompt: generationMessage,
            workflow_plan: sourceRun.workflowPlan,
            workflow_module: module,
            workflow_output: { aspect_ratio: workflowAspectRatio, size: workflowImageSize, copy_mode: workflowCopyMode },
            reference_analysis: sourceRun.referenceAnalysis || [],
            identity_lock: identityInstruction,
          },
          reference_images: references,
        }),
      })
      try {
        try {
          return await execute(activeConversationId)
        } catch (scopeError) {
          if (
            scopeError instanceof ApiError
            && scopeError.status === 409
            && ['conversation_unavailable', 'conversation_surface_conflict', 'conversation_context_conflict', 'legacy_conversation_ambiguous'].includes(scopeError.code)
          ) {
            activeConversationId = ''
            return await execute('')
          }
          throw scopeError
        }
      } catch (requestError) {
        const recovered = await pollAgentRequest(
          requestId,
          600,
          2000,
          () => activeCanvasRef.current === runCanvasId,
          { surface: 'design_agent', contextId: runCanvasId },
        )
        if (!recovered) throw requestError
        return statusToResult(recovered)
      }
    }

    publishRun(workingRun)
    try {
      const sourceShape = sourceRun.requestContext?.sourceShapeId
        ? editor.getShape(sourceRun.requestContext.sourceShapeId as TLShapeId)
        : undefined
      const sourceBounds = sourceShape ? editor.getShapePageBounds(sourceShape) : null
      const viewport = editor.getViewportPageBounds()
      const origin = {
        x: sourceBounds ? sourceBounds.maxX + 72 : viewport.center.x - 640,
        y: sourceBounds ? sourceBounds.minY : viewport.center.y - 320,
      }
      const modules = workingRun.workflowModules || []
      for (const moduleId of mode === 'review' ? [] : executionModuleIds) {
        if (activeCanvasRef.current !== runCanvasId) return
        if (workflowPauseRequestsRef.current.has(sourceRun.id)) break
        let module = (workingRun.workflowModules || []).find(item => item.id === moduleId)
        if (!module || module.status === 'completed') continue
        if (module.status === 'reviewing' && module.imageUrl) continue
        const currentModuleId = module.id
        const attempt = Math.max(1, Number(module.attempt || 1))
        const requestId = module.requestId || `${sourceRun.id}:module:${module.id}:attempt:${attempt}`
        const generationMessage = [
          sourceRun.prompt,
          sourceRun.workflowPlan.summary,
          `当前模块：${module.name}`,
          `模块目的：${module.purpose}`,
          `主要内容：${module.content}`,
          `生图要求：${module.generation_prompt}`,
          `输出规格：宽高比 ${workflowAspectRatio}，目标尺寸 ${workflowImageSize}（宽×高）。必须保持该方向和比例，不得输出反向比例。`,
          identityInstruction,
          workflowCopyInstruction(workflowCopyMode),
          '事实锁定：只使用用户明确提供的卖点和参数。未提供的型号、蓝牙版本、单元、尺寸、重量、续航拆分、认证和精确规格不得写入画面；规格资料不足时省略未确认字段，不得猜测。',
          '只生成当前模块的一张完整可交付图片，保持与整个详情页视觉体系一致。',
        ].filter(Boolean).join('\n')
        try {
          updateModule(module.id, { status: 'running', requestId, attempt, error: undefined })
          const result = await executeModule(module, requestId, generationMessage)
          if (!result || activeCanvasRef.current !== runCanvasId) return
          activeConversationId = result.conversation.id
          setConversationId(activeConversationId)
          const imageUrl = result.message.image_urls?.[0] || result.message.image_url || ''
          if (!imageUrl) throw new Error('模块生成完成，但没有返回可用图片。')
          const moduleIndex = modules.findIndex(item => item.id === currentModuleId)
          const existing = editor.getCurrentPageShapes().find(shape =>
            shape.type === 'design-image'
            && String(shapeLineage(shape)?.requestId || '') === requestId,
          )
          if (!existing) {
            await addImage(imageUrl, module.name, {
              parentShapeId: sourceShape?.id || '',
              parentLineage: shapeLineage(sourceShape) || {},
              conversationId: result.conversation.id,
              messageId: result.message.id,
              requestId,
              agentRunId: sourceRun.id,
              agentTurnId: turnId,
              model: result.message.model || '',
              provider: result.message.provider || '',
              prompt: generationMessage,
              skill: sourceRun.skill,
              agentAction: result.message.agent_action || '',
              workflowModuleId: module.id,
              source: 'specialist-workflow',
              createdAt: Date.now(),
            }, {
              x: origin.x + (moduleIndex % 3) * 680,
              y: origin.y + Math.floor(moduleIndex / 3) * 680,
            })
          }
          appendTurnAssistant(turnId, sourceRun.id, result.message, 'running')
          updateModule(module.id, {
            status: 'reviewing',
            requestId,
            attempt,
            reviewAttempt: 1,
            imageUrl,
            imageName: module.name,
            messageId: result.message.id,
            error: undefined,
          }, {
            imageUrl: workingRun.imageUrl || imageUrl,
            imageName: workingRun.imageName || module.name,
            messageId: workingRun.messageId || result.message.id,
            model: result.message.model || workingRun.model,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          updateModule(module.id, { status: 'failed', requestId, attempt, error: message })
        }
      }

      const reviewModuleIds = (workingRun.workflowModules || [])
        .filter(module => module.selected && module.status === 'reviewing' && module.imageUrl)
        .map(module => module.id)
      if (reviewModuleIds.length) publishRun({ ...workingRun, phase: 'reviewing' })
      for (const moduleId of reviewModuleIds) {
        if (activeCanvasRef.current !== runCanvasId) return
        const module = (workingRun.workflowModules || []).find(item => item.id === moduleId)
        if (!module?.imageUrl) continue
        const attempt = Math.max(1, Number(module.attempt || 1))
        const reviewAttempt = Math.max(1, Number(module.reviewAttempt || 1))
        const requestId = module.requestId || `${sourceRun.id}:module:${module.id}:attempt:${attempt}`
        const workflowReferenceImages = workflowReviewReferenceImages(
          workingRun.workflowModules || [],
          module.id,
        )
        try {
          const review = await replayableWorkbenchRequest<{ analysis: WorkbenchResultReview; model: string }>(
            '/api/agent/workbench/review', {
              request_id: `${requestId}:review:${reviewAttempt}`,
              message: `${sourceRun.prompt}\n当前复核模块：${module.name}\n${module.purpose}`,
              skill: sourceRun.skill,
              provider: route.provider,
              model: route.chat_model,
              allow_model_fallback: route.allow_chat_fallback,
              image_url: module.imageUrl,
              image_name: module.imageName || module.name,
              reference_images: references.map(reference => ({ url: reference.url, name: reference.name })),
              workflow_reference_images: workflowReferenceImages,
              plan: {
                workflow_plan: sourceRun.workflowPlan,
                workflow_module: module,
                workflow_output: { aspect_ratio: workflowAspectRatio, size: workflowImageSize, copy_mode: workflowCopyMode },
                reference_analysis: sourceRun.referenceAnalysis || [],
                identity_lock: generatedIdentityAnchor
                  ? '参考图1是用户已确认的产品母图，若轮廓、结构、连接方式或产品类型发生变化必须判定不通过。'
                  : identityInstruction,
              },
            }, () => activeCanvasRef.current === runCanvasId,
          )
          updateModule(module.id, {
            status: review.analysis.passed ? 'completed' : 'review_failed',
            reviewAttempt,
            review: review.analysis,
            error: review.analysis.passed ? undefined : review.analysis.conclusion,
          }, { reviewModel: review.model })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          updateModule(module.id, { status: 'review_failed', requestId, attempt, reviewAttempt, error: message })
        }
      }
      const finalModules = workingRun.workflowModules || []
      const failed = finalModules.filter(module => module.status === 'failed' || module.status === 'review_failed')
      const completed = finalModules.filter(module => module.status === 'completed')
      const paused = workflowPauseRequestsRef.current.delete(sourceRun.id)
      if (paused && !failed.length) {
        publishRun({
          ...workingRun,
          phase: 'confirming',
          failedStage: undefined,
          error: undefined,
        })
        setNotice('已停止后续模块，可修改待生成模块；重新确认后再继续')
        window.setTimeout(() => setNotice(''), 3500)
        return
      }
      publishRun({
        ...workingRun,
        phase: 'completed',
        failedStage: undefined,
        workflowReviewDecision: failed.length ? 'pending' : undefined,
        error: undefined,
      })
      setNotice(failed.length
        ? `统一复核完成：${completed.length} 个通过，${failed.length} 个未通过，请选择是否重新生成`
        : `统一复核完成，${completed.length} 个模块全部通过`)
      window.setTimeout(() => setNotice(''), 3000)
    } finally {
      try {
        await refreshPoints()
      } finally {
        finishCanvasRun(runCanvasId)
      }
    }
  }, [addImage, apiProviders, appendTurnAssistant, beginCanvasRun, conversationId, editor, finishCanvasRun, refreshPoints, selectedAnalysisModel, selectedImageModel, updateTurnRun])

  const reviseWorkflowModule = useCallback(async (
    sourceRun: AgentRunView,
    turnId: string,
    moduleId: string,
    draft: WorkflowModuleEditableFields,
  ) => {
    const module = (sourceRun.workflowModules || []).find(item => item.id === moduleId)
    if (!module || module.status !== 'pending' || !sourceRun.workflowPlan) return
    const attempt = Math.max(1, Number(module.revision?.attempt || 0) + 1)
    const requestId = `${sourceRun.id}:module:${module.id}:revision:${attempt}`
    const route = resolveGenerationRoute(apiProviders, selectedImageModel, selectedAnalysisModel)
    const updateModule = (patch: Partial<AgentWorkflowModule>) => {
      const update = (run: AgentRunView): AgentRunView => ({
        ...run,
        workflowModules: (run.workflowModules || []).map(item => item.id === moduleId ? { ...item, ...patch } : item),
      })
      updateTurnRun(turnId, sourceRun.id, update)
      if (turnId === agentSessionRef.current.active_turn_id) {
        setAgentRun(current => current?.id === sourceRun.id ? update(current) : current)
      }
    }
    const submitted: WorkflowModuleEditableFields = {
      name: draft.name.trim(),
      purpose: draft.purpose.trim(),
      content: draft.content.trim(),
      generation_prompt: draft.generation_prompt.trim(),
    }
    updateModule({
      revision: { status: 'optimizing', attempt, requestId, submitted },
      error: undefined,
    })
    try {
      const response = await replayableWorkbenchRequest<{
        analysis: { module: WorkbenchWorkflowModule; summary: string; cautions?: string[] }
        model: string
      }>('/api/agent/workbench/module-revise', {
        request_id: requestId,
        message: sourceRun.prompt,
        skill: sourceRun.skill,
        provider: route.provider,
        model: route.chat_model,
        allow_model_fallback: route.allow_chat_fallback,
        workflow_plan: sourceRun.workflowPlan,
        original_module: {
          id: module.id,
          name: module.name,
          purpose: module.purpose,
          content: module.content,
          generation_prompt: module.generation_prompt,
          estimated_generation_count: module.estimated_generation_count,
          estimated_points: module.estimated_points,
        },
        edited_module: {
          id: module.id,
          ...submitted,
          estimated_generation_count: module.estimated_generation_count,
          estimated_points: module.estimated_points,
        },
      }, () => activeCanvasRef.current === canvasId)
      updateModule({
        revision: {
          status: 'confirming',
          attempt,
          requestId,
          submitted,
          optimized: response.analysis.module,
          summary: response.analysis.summary,
          cautions: response.analysis.cautions || [],
        },
      })
    } catch (error) {
      updateModule({
        revision: {
          status: 'failed',
          attempt,
          requestId,
          submitted,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    } finally {
      await refreshPoints()
    }
  }, [apiProviders, canvasId, refreshPoints, selectedAnalysisModel, selectedImageModel, updateTurnRun])

  useEffect(() => {
    if (localQaState || !hydratedRef.current || !editor || !canvasId || !agentRun || sending) return
    const legacyReviewPending = shouldResumeLegacyReview(agentRun)
    if (!legacyReviewPending && !['analyzing', 'generating', 'reviewing'].includes(agentRun.phase)) return
    const recoveryKey = `${canvasId}:${agentRun.id}:${legacyReviewPending ? 'legacy-review' : agentRun.phase}`
    if (recoveredRunsRef.current.has(recoveryKey)) return
    recoveredRunsRef.current.add(recoveryKey)
    const timer = window.setTimeout(() => {
      if (activeCanvasRef.current !== canvasId) return
      if (legacyReviewPending) {
        const recoveryRun: AgentRunView = {
          ...agentRun,
          phase: 'reviewing',
          reviewWarning: undefined,
          failedStage: undefined,
          error: undefined,
        }
        setAgentRun(recoveryRun)
        void sendPrompt(recoveryRun.prompt, [], recoveryRun)
        return
      }
      if (agentRun.phase === 'analyzing') {
        void sendPrompt(agentRun.prompt, [], undefined, {
          run: agentRun,
          answers: agentRun.clarificationAnswers || {},
          skip: Boolean(agentRun.clarificationSkipped),
        })
        return
      }
      if (agentRun.workflowPlan && agentRun.workflowModules?.length) {
        if (agentRun.identityAnchor?.status === 'generating') {
          const selected = agentRun.workflowModules
            .filter(module => module.selected && module.status !== 'cancelled')
            .map(module => module.id)
          if (selected.length) void runWorkflowIdentityAnchor(agentRun, selected, 'resume')
          return
        }
        if (workflowNeedsIdentityAnchor(agentRun)) return
        const recoverable = agentRun.workflowModules
          .filter(module => module.selected && ['pending', 'running', 'reviewing'].includes(module.status))
          .map(module => module.id)
        if (recoverable.length) void runWorkflowModules(agentRun, recoverable, 'resume')
        return
      }
      void sendPrompt(agentRun.prompt, [], agentRun)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [agentRun, canvasId, editor, localQaState, runWorkflowIdentityAnchor, runWorkflowModules, sendPrompt, sending])

  const uploadCanvasFiles = async (files: FileList | File[] | null) => {
    if (!files?.length) return
    setUploading(true)
    setChatError('')
    try {
      const prepared = await optimizeUserUploadFiles(Array.from(files))
      const form = new FormData()
      prepared.forEach(file => form.append('files', file))
      const response = await fetch('/api/ai/upload', { method: 'POST', credentials: 'same-origin', body: form })
      const result = await response.json()
      if (!response.ok) throw new Error(String(result.detail || '上传失败'))
      for (const file of result.files || []) {
        if (file.kind === 'image' || String(file.mime || '').startsWith('image/')) {
          await addImage(file.url, file.name, { source: 'upload', originalName: file.name, createdAt: Date.now() })
        }
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const uploadAgentReferences = async (files: FileList | File[] | null) => {
    const selectedFiles = uniqueFilesByUploadIdentity(Array.from(files || []))
      .filter(file => !referenceUploadKeysRef.current.has(fileUploadIdentity(file)))
    if (!selectedFiles.length) return
    const validationError = validateAgentReferenceFiles(
      selectedFiles,
      pendingReferences.length + referenceUploadKeysRef.current.size,
    )
    if (validationError) {
      setChatError(validationError)
      if (agentFileInputRef.current) agentFileInputRef.current.value = ''
      return
    }
    const uploadKeys = selectedFiles.map(fileUploadIdentity)
    uploadKeys.forEach(key => referenceUploadKeysRef.current.add(key))
    referenceUploadCountRef.current++
    setReferenceUploading(true)
    setChatError('')
    try {
      const prepared = await optimizeUserUploadFiles(selectedFiles)
      const form = new FormData()
      prepared.forEach(file => form.append('files', file))
      const response = await fetch('/api/ai/upload', { method: 'POST', credentials: 'same-origin', body: form })
      const result = await response.json()
      if (!response.ok) throw new Error(String(result.detail || '参考图上传失败'))
      const references = (result.files || [])
        .filter((file: UploadedReference) => file.kind === 'image' || String(file.mime || '').startsWith('image/'))
        .map((file: UploadedReference): ReferenceImage => ({
          url: String(file.url || ''),
          name: String(file.name || '参考图'),
          role: 'reference',
          kind: 'image',
          mime: String(file.mime || 'image/png'),
        }))
        .filter((file: ReferenceImage) => Boolean(file.url))
      if (references.length !== selectedFiles.length) throw new Error('部分参考图上传后没有返回有效地址')
      setPendingReferences(current => uniqueReferenceImages([...current, ...references]))
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error))
    } finally {
      uploadKeys.forEach(key => referenceUploadKeysRef.current.delete(key))
      referenceUploadCountRef.current = Math.max(0, referenceUploadCountRef.current - 1)
      setReferenceUploading(referenceUploadCountRef.current > 0)
      setReferenceDragActive(false)
      if (agentFileInputRef.current) agentFileInputRef.current.value = ''
    }
  }

  const removePendingReference = (url: string) => {
    setPendingReferences(current => current.filter(reference => reference.url !== url))
  }

  const openInlineEdit = (kind: InlineEditKind, instruction = '') => {
    setEraserOpen(false)
    setExpansionOpen(false)
    setComposerMode('image')
    setInlineEditKind(kind)
    setInlineEditPrompt(instruction)
    setInlineEditOpen(true)
  }

  const openEraser = () => {
    setInlineEditOpen(false)
    setExpansionOpen(false)
    setEraserOpen(true)
    setComposerMode('image')
    setChatError('')
  }

  const openExpansion = () => {
    setInlineEditOpen(false)
    setEraserOpen(false)
    setExpansionAspect('original')
    setExpansionScale(1)
    setExpansionPreset('general')
    setCustomExpansionPadding(null)
    setExpansionOpen(true)
    setComposerMode('image')
    setChatError('')
  }

  const chooseExpansionAspect = (value: ExpansionAspect) => {
    if (value === 'custom') return
    const ratio = value === 'original'
      ? maskPixelWidth / maskPixelHeight
      : Number(value.split(':')[0]) / Number(value.split(':')[1])
    setExpansionAspect(value)
    setCustomExpansionPadding(expansionPaddingForAspectRatio(maskPixelWidth, maskPixelHeight, ratio, 1))
  }

  const prepareFollowUp = (instruction: string, resultUrl = '', parentTurnId = '') => {
    if (sending) return
    if (editor && resultUrl) {
      const resultShape = editor.getCurrentPageShapes().find(shape =>
        (shape.type === 'design-image' && (shape as DesignImageShape).props.url === resultUrl)
        || (shape.type === 'design-generator' && (shape as DesignGeneratorShape).props.resultUrl === resultUrl),
      )
      if (resultShape) editor.select(resultShape.id)
    }
    updateAgentSession(current => ({
      ...current,
      composer: {
        ...current.composer,
        parent_turn_id: parentTurnId || current.active_turn_id || undefined,
        mode_hint: 'image_edit',
      },
      updated_at: Date.now(),
    }))
    setRightOpen(true)
    setPrompt(current => appendPromptInstruction(current, instruction))
    window.setTimeout(() => {
      const textarea = promptRef.current
      if (!textarea) return
      fitComposerTextarea(textarea)
      textarea.focus()
    }, 0)
  }

  const uploadImageEditPair = async (
    sourceCanvas: HTMLCanvasElement,
    editMaskCanvas: HTMLCanvasElement,
    baseName: string,
  ): Promise<ReferenceImage[]> => {
    const [sourceBlob, maskBlob] = await Promise.all([
      canvasPngBlob(sourceCanvas, '无法创建待编辑原图'),
      canvasPngBlob(editMaskCanvas, '无法创建编辑蒙版'),
    ])
    const form = new FormData()
    form.append('files', new File([sourceBlob], `${baseName}_source.png`, { type: 'image/png' }))
    form.append('files', new File([maskBlob], `${baseName}_mask.png`, { type: 'image/png' }))
    const response = await fetch('/api/ai/upload', { method: 'POST', credentials: 'same-origin', body: form })
    const payload = await response.json()
    if (!response.ok) throw new Error(String(payload.detail || '图片编辑素材上传失败'))
    const sourceFile = payload.files?.[0]
    const maskFile = payload.files?.[1]
    if (!sourceFile?.url || !maskFile?.url) throw new Error('原图或蒙版上传后没有返回文件地址')
    return [{
      url: sourceFile.url,
      name: sourceFile.name || `${baseName}_source.png`,
      role: 'reference',
      kind: 'image',
      mime: sourceFile.mime || 'image/png',
    }, {
      url: maskFile.url,
      name: maskFile.name || `${baseName}_mask.png`,
      role: 'mask',
      kind: 'image',
      mime: maskFile.mime || 'image/png',
    }]
  }

  const applyMaskEdit = async () => {
    const canvas = maskCanvasRef.current
    if (!canvas || !selectedVisual || eraserStrokeCount < 1 || maskUploading || sending) return
    setMaskUploading(true)
    setChatError('')
    try {
      const baseName = (selectedVisual.name || 'image').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)
      const sourceImage = await loadEditableImage(selectedVisual.url)
      const width = Math.max(1, sourceImage.naturalWidth)
      const height = Math.max(1, sourceImage.naturalHeight)
      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = width
      sourceCanvas.height = height
      sourceCanvas.getContext('2d')?.drawImage(sourceImage, 0, 0, width, height)
      const normalizedMask = document.createElement('canvas')
      normalizedMask.width = width
      normalizedMask.height = height
      normalizedMask.getContext('2d')?.drawImage(canvas, 0, 0, width, height)
      const sourceContext = sourceCanvas.getContext('2d')
      if (!sourceContext) throw new Error('浏览器无法创建智能橡皮原图')
      sourceContext.globalCompositeOperation = 'destination-in'
      sourceContext.drawImage(normalizedMask, 0, 0, width, height)
      sourceContext.globalCompositeOperation = 'source-over'
      const references = await uploadImageEditPair(sourceCanvas, normalizedMask, baseName)
      setEraserOpen(false)
      await sendPrompt(
        '只修复输入图像中的透明缺口：根据缺口四周紧邻的颜色、纹理、透视和光影延续背景，让缺口自然消失。不要在缺口中恢复原内容或添加新的前景元素；透明缺口之外保持不变。结果创建为子版本，不覆盖原图。',
        references,
        undefined,
        undefined,
        false,
        {
          referenceMode: 'replace',
          requestedSize: `${width}x${height}`,
          modeHint: 'masked_image_edit',
          directCanvasTool: true,
          showInAgentPanel: false,
          resultName: '擦除结果',
        },
      )
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error))
    } finally {
      setMaskUploading(false)
    }
  }

  const applyExpansion = async () => {
    if (!selectedVisual || expansionUploading || sending) return
    setExpansionUploading(true)
    setChatError('')
    try {
      const baseName = (selectedVisual.name || 'image').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)
      const sourceImage = await loadEditableImage(selectedVisual.url)
      const scaleX = sourceImage.naturalWidth / expansionGeometry.sourceWidth
      const scaleY = sourceImage.naturalHeight / expansionGeometry.sourceHeight
      const geometry = computeExpansionGeometryFromPadding(
        sourceImage.naturalWidth,
        sourceImage.naturalHeight,
        {
          left: expansionGeometry.padding.left * scaleX,
          right: expansionGeometry.padding.right * scaleX,
          top: expansionGeometry.padding.top * scaleY,
          bottom: expansionGeometry.padding.bottom * scaleY,
        },
      )
      const output = chooseExpansionOutput(geometry, expansionScale)
      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = output.width
      sourceCanvas.height = output.height
      const sourceContext = sourceCanvas.getContext('2d')
      if (!sourceContext) throw new Error('浏览器无法创建扩展画布')
      sourceContext.clearRect(0, 0, output.width, output.height)
      sourceContext.drawImage(
        sourceImage,
        output.sourceRect.x,
        output.sourceRect.y,
        output.sourceRect.width,
        output.sourceRect.height,
      )

      const expansionMask = document.createElement('canvas')
      expansionMask.width = output.width
      expansionMask.height = output.height
      const maskContext = expansionMask.getContext('2d')
      if (!maskContext) throw new Error('浏览器无法创建扩展蒙版')
      maskContext.clearRect(0, 0, output.width, output.height)
      maskContext.fillStyle = '#ffffff'
      maskContext.fillRect(
        output.sourceRect.x,
        output.sourceRect.y,
        output.sourceRect.width,
        output.sourceRect.height,
      )

      const references = await uploadImageEditPair(sourceCanvas, expansionMask, `${baseName}_expand`)
      const presetInstructions: Record<string, string> = {
        general: '通用自然延展，优先保证透视、纹理和光影连续。',
        product: '延展为干净的产品展示背景，保持主体与品牌视觉不变。',
        portrait: '延展人像周围环境，保持人物五官、身体和服装不变。',
        landscape: '延展风景与空间层次，保持地平线、透视和天气一致。',
      }
      const paddingDescription = [
        `左 ${Math.round(geometry.padding.left / geometry.sourceWidth * 100)}%`,
        `右 ${Math.round(geometry.padding.right / geometry.sourceWidth * 100)}%`,
        `上 ${Math.round(geometry.padding.top / geometry.sourceHeight * 100)}%`,
        `下 ${Math.round(geometry.padding.bottom / geometry.sourceHeight * 100)}%`,
      ].join('、')
      const instruction = [
        `按用户设定的边界扩展当前图片：${paddingDescription}，目标尺寸 ${output.size}。`,
        '只在透明区域自然补全环境、光影、纹理和构图延续，原图所在的不透明区域必须完整保留，不移动、不重绘、不覆盖。',
        presetInstructions[expansionPreset] || presetInstructions.general,
        '扩展内容应延续原画面的主题、透视、色彩和视觉风格。',
        '生成结果必须创建为原图的子版本，不覆盖原图。',
      ].join('\n')
      setExpansionOpen(false)
      await sendPrompt(
        instruction,
        references,
        undefined,
        undefined,
        false,
        {
          referenceMode: 'replace',
          requestedSize: output.size,
          modeHint: 'outpaint',
          directCanvasTool: true,
          showInAgentPanel: false,
          resultName: '扩图结果',
        },
      )
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error))
    } finally {
      setExpansionUploading(false)
    }
  }

  const chooseSkill = (label: string) => {
    setActiveSkill(label)
    setComposerMode('agent')
    setModeMenuOpen(false)
    setPrompt('')
    setRightOpen(true)
    window.setTimeout(() => promptRef.current?.focus(), 0)
  }

  const activateCanvasTool = (tool: 'select' | 'frame' | 'geo' | 'draw' | 'text', label: string) => {
    if (!editor) return
    setMarkerMode(false)
    editor.selectNone()
    editor.setCurrentTool(tool)
    setActiveTool(tool)
    setNotice(tool === 'select' ? '已切换为选择工具' : `已切换为${label}工具，请在空白画布点击或拖动`)
    window.setTimeout(() => setNotice(''), 2200)
  }

  const activateMarkerTool = () => {
    if (!editor) return
    const next = !markerMode
    setMarkerMode(next)
    setMarkerHover(null)
    editor.selectNone()
    editor.setCurrentTool('select')
    setNotice(next ? '标记已开启：悬停图片并点击目标；Shift 可连续添加' : '已退出标记')
    window.setTimeout(() => setNotice(''), 2200)
  }

  const isCanvasMarkerTarget = (shape: TLShape) => shape.type === 'design-image'
    || (shape.type === 'design-generator'
      && (shape as DesignGeneratorShape).props.status === 'result'
      && Boolean((shape as DesignGeneratorShape).props.resultUrl))

  const findCanvasMarkerTarget = (clientX: number, clientY: number) => {
    if (!editor) return null
    const point = editor.screenToPage({ x: clientX, y: clientY })
    const target = editor.getShapesAtPoint(point, { hitInside: true }).find(isCanvasMarkerTarget)
    return target ? { point, target } : null
  }

  const updateMarkerHover = (event: React.PointerEvent<HTMLDivElement>) => {
    const hit = findCanvasMarkerTarget(event.clientX, event.clientY)
    if (!hit) {
      setMarkerHover(null)
      return
    }
    const stageBounds = canvasStageRef.current?.getBoundingClientRect()
    setMarkerHover({
      targetId: String(hit.target.id),
      x: event.clientX - (stageBounds?.left || 0),
      y: event.clientY - (stageBounds?.top || 0),
    })
  }

  const placeCanvasMarkerAt = (clientX: number, clientY: number) => {
    if (!editor) return false
    if (canvasMarkerLimitReached(markerShapes.length)) {
      setNotice(`每次编辑最多添加 ${MAX_CANVAS_MARKERS} 个标记`)
      window.setTimeout(() => setNotice(''), 2200)
      return false
    }
    const hit = findCanvasMarkerTarget(clientX, clientY)
    if (!hit) {
      setNotice('请在图片内容上放置标记')
      window.setTimeout(() => setNotice(''), 1800)
      return false
    }
    const { point, target } = hit
    const number = nextCanvasMarkerNumber(markerShapes.map(marker => marker.props.number))
    const targetName = target?.type === 'design-image'
      ? displayCanvasResultName((target as DesignImageShape).props.name)
      : target?.type === 'design-generator'
        ? displayCanvasResultName((target as DesignGeneratorShape).props.resultName || '图片')
        : '图片'
    const targetTransform = target ? editor.getShapePageTransform(target) : null
    const targetSize = target?.props as { w?: number; h?: number } | undefined
    const localPoint = targetTransform?.clone().invert().applyToPoint(point)
    const xRatio = localPoint && targetSize?.w
      ? Math.max(0, Math.min(1, localPoint.x / targetSize.w))
      : 0
    const yRatio = localPoint && targetSize?.h
      ? Math.max(0, Math.min(1, localPoint.y / targetSize.h))
      : 0
    const id = createShapeId()
    editor.createShape<DesignMarkerShape>({
      id,
      type: 'design-marker',
      x: point.x - 14,
      y: point.y - 17,
      isLocked: true,
      props: {
        w: 28,
        h: 34,
        number,
        label: '识别中…',
        targetShapeId: target ? String(target.id) : '',
        targetName,
        xRatio,
        yRatio,
        recognitionStatus: 'analyzing',
        recognitionDescription: '',
      },
    })
    editor.selectNone()
    setRightOpen(true)
    setMarkerQuickEditorOpen(false)
    setMarkerHover(null)
    setNotice(`已添加标记 ${number}`)
    window.setTimeout(() => setNotice(''), 1500)
    if (target) void recognizeCanvasMarker(id, target, number, targetName, xRatio, yRatio)
    return true
  }

  const placeCanvasMarker = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!editor || !markerMode) return
    placeCanvasMarkerAt(event.clientX, event.clientY)
    event.preventDefault()
    event.stopPropagation()
  }

  const recognizeCanvasMarker = async (
    markerId: TLShapeId,
    target: TLShape,
    number: number,
    targetName: string,
    xRatio: number,
    yRatio: number,
  ) => {
    if (!editor) return
    const visual = target.type === 'design-image'
      ? { url: (target as DesignImageShape).props.url, name: (target as DesignImageShape).props.name }
      : target.type === 'design-generator' && (target as DesignGeneratorShape).props.resultUrl
        ? { url: (target as DesignGeneratorShape).props.resultUrl, name: (target as DesignGeneratorShape).props.resultName }
        : null
    if (!visual?.url) {
      editor.run(() => editor.updateShape<DesignMarkerShape>({
        id: markerId,
        type: 'design-marker',
        props: {
          label: targetName || `标记 ${number}`,
          recognitionStatus: targetName ? 'recognized' : 'failed',
          recognitionDescription: targetName ? `标记位于${targetName}` : '没有可识别的图片内容',
        },
      }), { ignoreShapeLock: true })
      return
    }
    try {
      const route = resolveGenerationRoute(apiProviders, '自动选择', selectedAnalysisModel)
      const regionUrl = await createMarkerRegionUpload(
        visual.url,
        xRatio,
        yRatio,
        (visual.name || `marker-${number}`).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 64),
      )
      let result = await replayableWorkbenchRequest<{ analysis: WorkbenchMarkerRecognition }>(
        '/api/agent/workbench/marker-label',
        {
          request_id: `marker-${canvasId}-${String(markerId).replace(/^shape:/, '')}`,
          image_url: regionUrl,
          target_name: displayCanvasResultName(visual.name || targetName),
          marker_number: number,
          x_percent: Math.round(xRatio * 100),
          y_percent: Math.round(yRatio * 100),
          provider: route.provider,
          model: route.chat_model,
          allow_model_fallback: route.allow_chat_fallback,
        },
        () => activeCanvasRef.current === canvasId && Boolean(editor.getShape(markerId)),
      )
      let label = String(result.analysis?.label || '').trim().replace(/^["“”']+|["“”']+$/g, '').slice(0, 32)
      if (isSingleCjkMarkerLabel(label) && editor.getShape(markerId)) {
        result = await replayableWorkbenchRequest<{ analysis: WorkbenchMarkerRecognition }>(
          '/api/agent/workbench/marker-label',
          {
            request_id: `marker-${canvasId}-${String(markerId).replace(/^shape:/, '')}-phrase`,
            image_url: regionUrl,
            target_name: `${displayCanvasResultName(visual.name || targetName)}；首轮只识别到单字“${label}”，请返回该字所属的完整连续标题或词组`,
            marker_number: number,
            x_percent: Math.round(xRatio * 100),
            y_percent: Math.round(yRatio * 100),
            provider: route.provider,
            model: route.chat_model,
            allow_model_fallback: route.allow_chat_fallback,
          },
          () => activeCanvasRef.current === canvasId && Boolean(editor.getShape(markerId)),
        )
        const retriedLabel = String(result.analysis?.label || '').trim().replace(/^["“”']+|["“”']+$/g, '').slice(0, 32)
        label = isSingleCjkMarkerLabel(retriedLabel)
          ? markerPhraseFromDescription(String(result.analysis?.description || '')) || retriedLabel
          : retriedLabel
      }
      if (!label || /^标记\s*\d*$/i.test(label)) throw new Error('视觉模型没有返回具体区域名称')
      if (!editor.getShape(markerId)) return
      editor.run(() => editor.updateShape<DesignMarkerShape>({
        id: markerId,
        type: 'design-marker',
        props: {
          label,
          recognitionStatus: 'recognized',
          recognitionDescription: String(result.analysis?.description || '').trim(),
        },
      }), { ignoreShapeLock: true })
    } catch (error) {
      if (!editor.getShape(markerId)) return
      editor.run(() => editor.updateShape<DesignMarkerShape>({
        id: markerId,
        type: 'design-marker',
        props: {
          label: `标记 ${number}`,
          recognitionStatus: 'failed',
          recognitionDescription: error instanceof Error ? error.message : String(error),
        },
      }), { ignoreShapeLock: true })
    }
  }

  const removeCanvasMarker = (marker: DesignMarkerShape) => {
    if (!editor) return
    editor.run(() => editor.deleteShape(marker.id), { ignoreShapeLock: true })
    if (String(marker.id) === focusedMarkerId) {
      setFocusedMarkerId('')
      setMarkerPreviewVisible(false)
    }
    if (markerShapes.length <= 1) setMarkerQuickEditorOpen(false)
  }

  const focusCanvasMarker = (marker: DesignMarkerShape, anchor?: HTMLElement | null) => {
    setFocusedMarkerId(String(marker.id))
    setMarkerFocusSequence(sequence => sequence + 1)
    setMarkerPreviewVisible(true)
    setRightOpen(true)
    const composer = composerRef.current
    if (composer) {
      const composerBounds = composer.getBoundingClientRect()
      if (anchor) {
        const anchorBounds = anchor.getBoundingClientRect()
        setMarkerPreviewAnchor(Math.max(58, Math.min(composerBounds.width - 58, anchorBounds.left + anchorBounds.width / 2 - composerBounds.left)))
      } else {
        const markerIndex = Math.max(0, markerShapes.findIndex(item => item.id === marker.id))
        const column = markerIndex % 3
        setMarkerPreviewAnchor(((column + .5) / 3) * composerBounds.width)
      }
    }
    if (markerPreviewTimerRef.current) window.clearTimeout(markerPreviewTimerRef.current)
    markerPreviewTimerRef.current = window.setTimeout(() => {
      setMarkerPreviewVisible(false)
      markerPreviewTimerRef.current = null
    }, 2200)
  }

  const runMarkerQuickEdit = async () => {
    const instruction = markerQuickPrompt.trim()
    if (!instruction || sending) return
    setMarkerMode(false)
    setMarkerQuickEditorOpen(false)
    await sendPrompt(instruction, [], undefined, undefined, false, {
      modeHint: 'marker_edit',
      showInAgentPanel: false,
      resultName: '标记修改结果',
      markerTargetId: activeMarkerTargetId,
    })
    setMarkerQuickPrompt('')
  }

  useEffect(() => {
    if (!editor || !canvasReady) return
    const onMarkerShortcut = (event: KeyboardEvent) => {
      if (isCanvasTextEntryTarget(event.target)) return
      const key = event.key.toLowerCase()
      if (event.key === 'Escape') {
        if (!markerMode && !markerQuickEditorOpen) return
        event.preventDefault()
        setMarkerMode(false)
        setMarkerQuickEditorOpen(false)
        setMarkerHover(null)
        setNotice('已退出标记')
        window.setTimeout(() => setNotice(''), 1500)
        return
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey && key === 'm') {
        event.preventDefault()
        const next = !markerMode
        setMarkerMode(next)
        setMarkerHover(null)
        editor.selectNone()
        editor.setCurrentTool('select')
        setNotice(next ? '标记已开启：悬停图片并点击目标' : '已退出标记')
        window.setTimeout(() => setNotice(''), 1800)
        return
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey && key === 'v') {
        event.preventDefault()
        setMarkerMode(false)
        setMarkerQuickEditorOpen(false)
        setMarkerHover(null)
        editor.setCurrentTool('select')
        setActiveTool('select')
        return
      }
      if (event.key === 'Tab' && activeMarkerShapes.length) {
        event.preventDefault()
        setMarkerMode(false)
        setMarkerQuickEditorOpen(true)
        setRightOpen(true)
        window.setTimeout(() => markerQuickPromptRef.current?.focus(), 0)
      }
    }
    window.addEventListener('keydown', onMarkerShortcut)
    return () => window.removeEventListener('keydown', onMarkerShortcut)
  }, [activeMarkerShapes.length, canvasReady, editor, markerMode, markerQuickEditorOpen])

  const openAgentOverlay = async (kind: 'history' | 'help' | 'prompts') => {
    setModeMenuOpen(false)
    setAgentOverlay(current => current === kind ? '' : kind)
    try {
      if (kind === 'history') {
        setConversationHistory(agentSessionRef.current.turns
          .slice()
          .sort((left, right) => right.sequence - left.sequence)
          .map(turn => ({
            id: turn.id,
            title: `第 ${turn.sequence} 轮`,
            updated_at: turn.updated_at,
            last_message: turn.user_message.content,
          })))
      }
      if (kind === 'prompts') {
        const result = await api<{ library?: { libraries?: Array<{ items?: PromptTemplate[] }> } }>('/api/prompt-libraries')
        setPromptTemplates((result.library?.libraries || []).flatMap(library => library.items || []))
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error))
    }
  }

  const loadConversation = async (id: string) => {
    if (sending) return
    const turn = agentSessionRef.current.turns.find(item => item.id === id)
    if (!turn) return
    const attempt = activeAttempt(turn)
    activeTurnIdRef.current = turn.id
    setAgentRun(attempt?.run || null)
    updateAgentSession(current => ({
      ...current,
      active_turn_id: turn.id,
      composer: {
        ...current.composer,
        parent_turn_id: undefined,
        mode_hint: undefined,
        thread_start_sequence: turn.sequence,
      },
      updated_at: Date.now(),
    }))
    setAgentOverlay('')
    window.setTimeout(() => {
      document.querySelector(`[data-turn-id="${CSS.escape(turn.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }

  const startNewChat = () => {
    if (sending) return
    setConversationId('')
    setAgentRun(null)
    activeTurnIdRef.current = null
    updateAgentSession(current => ({
      ...current,
      active_turn_id: null,
      composer: {
        prompt: '',
        mode: 'agent',
        active_skill: '',
        image_model: current.composer.image_model || selectedImageModel || '自动选择',
        image_aspect: current.composer.image_aspect || selectedImageAspect || 'auto',
        analysis_model: current.composer.analysis_model || selectedAnalysisModel || '自动选择',
        pending_references: [],
        mode_hint: 'new_session',
        thread_start_sequence: current.next_sequence,
      },
      updated_at: Date.now(),
    }))
    setPrompt('')
    setActiveSkill('')
    setPendingReferences([])
    setAgentOverlay('')
  }

  const exportSelection = async () => {
    if (!editor) return
    const selected = editor.getSelectedShapeIds()
    const shapes = selected.length ? selected : Array.from(editor.getCurrentPageShapeIds())
    if (!shapes.length) return
    const result = await editor.toImage(shapes, { format: 'png', background: true, padding: 24, scale: 2 })
    const url = URL.createObjectURL(result.blob)
    downloadUrl(url, `${canvasTitle || 'lingdraw'}.png`)
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const loadLatest = async () => {
    if (!conflict || !editor) return
    const rejectedConflict = conflict
    setCanvasReady(false)
    let latest: { canvas: CanvasSummary; document: SmartCanvasDocument; updated_at: number }
    try {
      latest = await api<{ canvas: CanvasSummary; document: SmartCanvasDocument; updated_at: number }>(
        `/api/canvases/${encodeURIComponent(canvasId)}/document`,
      )
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error))
      setSaveState('offline')
      setCanvasReady(true)
      return
    }
    if (!editor || canvasId !== activeCanvasRef.current) return
    const rawLatestDocument = isSupportedCanvasDocument(latest.document) ? latest.document : emptyDocument()
    const latestSession = mergeAgentSessionsByTurnId(
      rawLatestDocument.agent_session,
      documentRef.current.agent_session,
    )
    let latestDocument: SmartCanvasDocument = {
      ...rawLatestDocument,
      agent_session: latestSession,
    }
    hydratedRef.current = false
    if (latestDocument.snapshot) {
      const legacyTldrawSnapshot = latestDocument.engine === 'tldraw' ? latestDocument.snapshot : undefined
      await loadSnapshot(editor.store, { document: latestDocument.snapshot })
      if (latestDocument.engine === 'tldraw') {
        latestDocument = {
          ...latestDocument,
          schema_version: 2,
          engine: 'fabric',
          legacy_tldraw_snapshot: legacyTldrawSnapshot,
          snapshot: getSnapshot(editor.store).document,
        }
      }
    } else {
      editor.deleteShapes(Array.from(editor.getCurrentPageShapeIds()))
      editor.selectNone()
    }
    documentRef.current = latestDocument
    setDocumentState(latestDocument)
    agentSessionRef.current = latestSession
    setAgentSession(latestSession)
    activeTurnIdRef.current = latestSession.active_turn_id
    setConversationId(latestSession.conversation_id || '')
    setMessages(flattenAgentMessages(latestSession))
    const latestTurn = latestSession.turns.find(turn => turn.id === latestSession.active_turn_id)
      || latestSession.turns[latestSession.turns.length - 1]
    setAgentRun(activeAttempt(latestTurn)?.run || null)
    setPrompt(latestSession.composer?.prompt || '')
    setComposerMode(latestSession.composer?.mode || 'agent')
    setActiveSkill(latestSession.composer?.active_skill || '')
    setPendingReferences(latestSession.composer?.pending_references || [])
    updatedAtRef.current = Number(latest.updated_at || 0)
    if (latest.canvas?.title) setCanvasTitle(latest.canvas.title)
    saveQueueRef.current?.reset()
    setConflict(null)
    hydratedRef.current = true
    setCanvasReady(true)
    const persisted = await persistDocument(latestDocument)
    if (persisted) {
      discardAgentSessionDraft(canvasId, clientId)
      discardCanvasDocumentDraft(canvasId, clientId)
      if (rejectedConflict.draft_client_id && rejectedConflict.draft_client_id !== clientId) {
        discardCanvasDocumentDraft(canvasId, rejectedConflict.draft_client_id)
      }
      if (activeDraftClientRef.current !== clientId) {
        discardCanvasDocumentDraft(canvasId, activeDraftClientRef.current)
      }
      activeDraftClientRef.current = clientId
      setSaveState('saved')
    }
  }

  const saveCopy = async () => {
    if (!editor) return
    const created = await api<{ canvas: CanvasSummary }>('/api/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: `${canvasTitle} 副本`,
        icon: 'sparkles',
        kind: 'smart',
        surface: 'design_agent',
      }),
    })
    const snapshot = { ...documentRef.current, snapshot: getSnapshot(editor.store).document }
    await api(`/api/canvases/${encodeURIComponent(created.canvas.id)}/document`, {
      method: 'PUT', body: JSON.stringify({ document: snapshot, client_id: clientId, base_updated_at: created.canvas.updated_at }),
    })
    discardAgentSessionDraft(canvasId, clientId)
    discardCanvasDocumentDraft(canvasId, clientId)
    const sourceDraftClient = conflict?.draft_client_id || activeDraftClientRef.current
    if (sourceDraftClient && sourceDraftClient !== clientId) {
      discardCanvasDocumentDraft(canvasId, sourceDraftClient)
    }
    activeDraftClientRef.current = clientId
    setCanvases(items => [created.canvas, ...items])
    setConflict(null)
    hydratedRef.current = false
    setCanvasReady(false)
    saveQueueRef.current?.reset()
    activeCanvasRef.current = ''
    await selectCanvas(created.canvas.id, created.canvas.title)
  }

  const saveLabel: Record<SaveState, string> = {
    loading: lang === 'zh' ? '正在载入' : 'Loading',
    saving: lang === 'zh' ? '正在保存' : 'Saving',
    saved: lang === 'zh' ? '已保存' : 'Saved',
    offline: lang === 'zh' ? '保存失败' : 'Save failed',
    error: lang === 'zh' ? '无法保存' : 'Cannot save',
    'auth-required': lang === 'zh' ? '登录已失效' : 'Sign-in required',
    conflict: lang === 'zh' ? '存在冲突' : 'Conflict',
  }

  return (
    <main
      className={`lovart-shell ${rightOpen ? '' : 'right-collapsed'}`}
      onPaste={event => {
        const target = event.target
        if (target instanceof Element && target.closest('.agent-panel')) return
        const images = clipboardImageFiles(event.clipboardData)
        if (!images.length) return
        event.preventDefault()
        event.stopPropagation()
        if (canvasReady) void uploadCanvasFiles(images)
      }}
    >
      <section
        ref={canvasStageRef}
        className="canvas-stage"
        aria-busy={!canvasReady}
        aria-label={lang === 'zh' ? '无限设计场景' : 'Infinite design scene'}
        onPointerDownCapture={event => {
          if (!editor || markerMode || event.button !== 0 || (!event.metaKey && !event.ctrlKey)) return
          if (isCanvasTextEntryTarget(event.target)) return
          const target = event.target
          if (!(target instanceof Element) || !target.closest('.fabric-canvas-shell')) return
          if (placeCanvasMarkerAt(event.clientX, event.clientY)) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
        onDragOver={event => event.preventDefault()}
        onDrop={event => { event.preventDefault(); if (canvasReady) void uploadCanvasFiles(event.dataTransfer.files) }}
      >
        {canvasId ? (
          <FabricCanvas
            key={canvasId}
            onMount={mounted => { mounted.updateInstanceState({ isGridMode: false }); setEditor(mounted) }}
          />
        ) : <div className="stage-loading"><LoaderCircle className="spin" />{lang === 'zh' ? '正在打开设计场景' : 'Opening canvas'}</div>}
        {!canvasReady && canvasId && <div className="canvas-hydration-blocker"><LoaderCircle className="spin" size={20} /><span>{lang === 'zh' ? '正在恢复设计内容…' : 'Restoring design…'}</span></div>}
        {canvasReady && markerMode && <div
          className="canvas-marker-capture"
          role="button"
          tabIndex={0}
          aria-label="在图片上点击放置标记"
          onPointerMove={updateMarkerHover}
          onPointerLeave={() => setMarkerHover(null)}
          onPointerDown={placeCanvasMarker}
        ><span><Target size={14} />悬停识别 · 点击锁定 · Esc 退出</span></div>}
        {markerMode && markerHoverTargetStyle && <div
          className="canvas-marker-hover-target"
          style={markerHoverTargetStyle}
          aria-hidden="true"
        />}
        {markerMode && markerHover && <div
          className="canvas-marker-reticle"
          style={{ left: markerHover.x, top: markerHover.y }}
          aria-hidden="true"
        ><Target size={14} /><span>识别对象</span></div>}
        {!markerMode && markerFocusTargets.map(({ marker, left, top }) => <button
          key={`focus-${marker.id}`}
          className="canvas-marker-focus-hit"
          style={{ left, top }}
          aria-label={`聚焦标记 ${marker.props.number} ${marker.props.label}`}
          onClick={event => {
            event.preventDefault()
            event.stopPropagation()
            focusCanvasMarker(marker)
          }}
        />)}
        {markerFocusOverlayStyle && focusedMarker && <div
          key={`marker-focus-${markerFocusSequence}`}
          className="canvas-marker-focus-effect"
          style={markerFocusOverlayStyle}
          aria-hidden="true"
        ><i /><i /><span>{focusedMarker.props.number}</span></div>}
        {markerTabHintStyle && <button
          className="marker-tab-hint"
          style={markerTabHintStyle}
          onClick={() => {
            setMarkerQuickEditorOpen(true)
            setMarkerMode(false)
            window.setTimeout(() => markerQuickPromptRef.current?.focus(), 0)
          }}
        ><WandSparkles size={13} />快捷编辑 <kbd>Tab</kbd></button>}

        <header className="scene-topbar">
          <div className="project-switcher">
            <button className="lingdraw-dot" aria-label="LingDraw"><Sparkles size={16} /></button>
            <div className="title-wrap">
              <input value={canvasTitle} onChange={event => setCanvasTitle(event.target.value)} onBlur={() => void saveTitle()} aria-label={lang === 'zh' ? '项目标题' : 'Project title'} />
              <button onClick={() => setMenuOpen(value => !value)} aria-label={lang === 'zh' ? '切换设计' : 'Switch design'}><ChevronDown size={14} /></button>
            </div>
            {menuOpen && <div className="canvas-menu">
              {canvases.map(item => <div className="canvas-menu-row" key={item.id}>
                <button className={`canvas-choice ${item.id === canvasId ? 'active' : ''}`} onClick={() => void selectCanvas(item.id, item.title)}><span className="canvas-choice-title">{item.title}{runningCanvasIds.includes(item.id) && <em><LoaderCircle className="spin" size={11} />{lang === 'zh' ? '生成中' : 'Running'}</em>}</span>{item.id === canvasId && <Check size={14} />}</button>
                <button className="delete-canvas" onClick={() => { setPendingDeleteCanvas(item); setMenuOpen(false) }} aria-label={`${lang === 'zh' ? '删除' : 'Delete'} ${item.title}`} title={lang === 'zh' ? '删除设计' : 'Delete design'}><Trash2 size={13} /></button>
              </div>)}
              <button className="new-canvas" onClick={() => void createCanvas()}><Plus size={14} />{lang === 'zh' ? '新建设计' : 'New design'}</button>
            </div>}
          </div>
          <div className="top-meta">
            <span className={`save-state ${saveState}`}><i />{saveLabel[saveState]}</span>
            <span className="points"><Sparkles size={13} />{points}</span>
            <button className="icon-only" onClick={() => setRightOpen(value => !value)} aria-label={rightOpen ? '收起 Agent' : '打开 Agent'}>{rightOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button>
          </div>
        </header>

        {selectedVisual && selectedOverlay && <div className="image-selection-meta" style={selectedOverlay.meta} aria-hidden="true">
          <span>{displayCanvasResultName(selectedVisual.name)}</span>
          <em>{Math.round(selectedPixelSize?.w || Number((selectedVisual.shape.props as { w?: number }).w || 0))} × {Math.round(selectedPixelSize?.h || Number((selectedVisual.shape.props as { h?: number }).h || 0))}</em>
        </div>}

        {selectedVisual && selectedOverlay?.toolbar && <div
          ref={imageContextBarRef}
          className="image-context-bar"
          style={{ left: selectedOverlay.toolbar.left, top: selectedOverlay.toolbar.top }}
          data-side={selectedOverlay.toolbar.side}
          role="toolbar"
          aria-label={lang === 'zh' ? '图片快捷编辑' : 'Image quick edit'}
        >
          <ToolbarButton icon={<WandSparkles />} label="快速编辑" onClick={() => openInlineEdit('quick')} />
          <ToolbarButton icon={<Eraser />} label="橡皮" onClick={openEraser} />
          <ToolbarButton icon={<Expand />} label="扩展" onClick={openExpansion} />
          <ToolbarButton icon={<Trash2 />} label="删除" onClick={() => editor?.deleteShape(selectedVisual.shape.id)} />
          <button className="context-download" onClick={() => downloadUrl(selectedVisual.url, selectedVisual.name)} aria-label="下载"><Download size={16} /></button>
        </div>}

        {selectedVisual && expansionOpen && expansionPreview && <div
          className="image-expansion-preview"
          style={expansionPreview}
          aria-label="拖动边界调整扩展范围"
        >
          <div style={{
            left: `${expansionGeometry.padding.left / expansionGeometry.width * 100}%`,
            top: `${expansionGeometry.padding.top / expansionGeometry.height * 100}%`,
            width: `${expansionGeometry.sourceWidth / expansionGeometry.width * 100}%`,
            height: `${expansionGeometry.sourceHeight / expansionGeometry.height * 100}%`,
          }} />
          <span>{expansionOutput.size}</span>
          {(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as ExpansionHandle[]).map(handle => (
            <button
              key={handle}
              type="button"
              className={`expansion-drag-handle handle-${handle}`}
              aria-label={`拖动${handle}边界`}
              onPointerDown={event => beginExpansionDrag(event, handle)}
              onPointerMove={continueExpansionDrag}
              onPointerUp={finishExpansionDrag}
              onPointerCancel={finishExpansionDrag}
            />
          ))}
        </div>}

        {selectedVisual && selectedOverlay && eraserOpen && <section
          className="image-mask-editor"
          style={selectedOverlay.image}
          aria-label="橡皮蒙版编辑器"
        >
          <canvas
            ref={maskCanvasRef}
            aria-label="在图片上涂抹需要移除的区域"
            onPointerDown={beginMaskStroke}
            onPointerMove={continueMaskStroke}
            onPointerUp={finishMaskStroke}
            onPointerCancel={finishMaskStroke}
            onContextMenu={event => event.preventDefault()}
          />
          <header>
            <strong><Eraser size={15} />智能橡皮</strong>
            <label>笔刷大小<input type="range" min="12" max="120" step="4" value={eraserBrushSize} onChange={event => setEraserBrushSize(Number(event.target.value))} /></label>
            <button disabled={!eraserStrokeCount || maskUploading} onClick={resetMaskCanvas}>清除选区</button>
            <button onClick={() => setEraserOpen(false)}>取消</button>
          </header>
          <footer>
            <span>{eraserStrokeCount ? `已标记 ${eraserStrokeCount} 笔，AI 将移除标记内容并补全背景` : '请在图片上涂抹需要移除的区域'}</span>
            <button disabled={!eraserStrokeCount || maskUploading || sending} onClick={() => void applyMaskEdit()}>{maskUploading ? <LoaderCircle className="spin" size={14} /> : <Eraser size={14} />}{maskUploading ? '正在提交蒙版' : `立即使用 · ${imageEditCost} 积分`}</button>
          </footer>
        </section>}

        {selectedVisual && selectedOverlay && expansionOpen && <section
          className="expansion-editor"
          style={expansionEditorStyle}
          aria-label="图片扩展编辑器"
        >
          <header>
            <strong>扩图</strong>
            <button aria-label="关闭图片扩展编辑器" onClick={() => setExpansionOpen(false)}><X size={15} /></button>
          </header>
          <label className="expansion-select-field">
            <span>缩放比例</span>
            <select value={expansionScale} onChange={event => setExpansionScale(Number(event.target.value) as ExpansionResolutionScale)}>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
            </select>
          </label>
          <label className="expansion-select-field expansion-preset-field">
            <span>预设</span>
            <select value={expansionPreset} onChange={event => setExpansionPreset(event.target.value)}>
              <option value="general">通用</option>
              <option value="product">产品</option>
              <option value="portrait">人像</option>
              <option value="landscape">风景</option>
            </select>
          </label>
          <div className="expansion-aspect-list" role="group" aria-label="扩图比例">
            {([
              ['original', '原始比例'],
              ['1:1', '1:1'],
              ['3:4', '3:4'],
              ['2:3', '2:3'],
              ['9:16', '9:16'],
              ['4:3', '4:3'],
              ['3:2', '3:2'],
              ['16:9', '16:9'],
              ['4:5', '4:5'],
              ['5:4', '5:4'],
            ] as Array<[ExpansionAspect, string]>).map(([value, label]) => (
              <button key={value} className={expansionAspect === value ? 'active' : ''} onClick={() => chooseExpansionAspect(value)}>
                <span className={`aspect-icon aspect-${value.replace(':', '-')}`} />
                {label}
              </button>
            ))}
          </div>
          <small className="expansion-output-note">{hasExpansionArea
            ? `${expansionAspect === 'custom' ? '自定义边界' : '可继续拖动蓝色边框微调'} · ${expansionOutput.size}`
            : '拖动蓝色边界或选择新比例后生成'}</small>
          <footer>
            <button onClick={() => setExpansionOpen(false)}>取消</button>
            <button className="primary" disabled={!hasExpansionArea || expansionUploading || sending} onClick={() => void applyExpansion()}>
              {expansionUploading ? <LoaderCircle className="spin" size={15} /> : <Expand size={15} />}
              {expansionUploading ? '提交中' : <>生成 <Sparkles size={12} />{imageEditCost}</>}
            </button>
          </footer>
        </section>}

        {selectedVisual && selectedOverlay && inlineEditOpen && <section className="inline-image-editor" style={selectedOverlay.editor} aria-label="图片快速编辑器">
          <header><div><WandSparkles size={16} /><strong>{INLINE_EDIT_TITLES[inlineEditKind]}</strong><span><Sparkles size={12} />预计 {imageEditCost} 积分</span></div><button aria-label="关闭图片编辑器" onClick={() => setInlineEditOpen(false)}><X size={15} /></button></header>
          <textarea value={inlineEditPrompt} onChange={event => setInlineEditPrompt(event.target.value)} placeholder="描述你希望如何修改这张图片…" autoFocus />
          {inlineEditKind === 'quick' && <div className="edit-suggestions">
            <span>试试这些</span>
            {QUICK_EDIT_PRESETS.map(preset => <button key={preset.label} onClick={() => setInlineEditPrompt(current => appendPromptInstruction(current, preset.instruction))}>{preset.label}</button>)}
          </div>}
          <div className="inline-edit-actions"><small>{sending ? '正在创建子版本并等待模型返回…' : `发送后预占约 ${imageEditCost} 积分；修改会创建新版本，不覆盖原图`}</small><button disabled={!inlineEditPrompt.trim() || sending} onClick={() => { void sendPrompt(inlineEditPrompt); setInlineEditOpen(false) }}>{sending ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}生成新版本</button></div>
        </section>}

        {markerQuickEditorOpen && markerQuickEditorStyle && <section
          className="marker-quick-editor"
          style={markerQuickEditorStyle}
          aria-label="标记快捷编辑"
        >
          <div className="marker-quick-chips">
            {activeMarkerShapes.map(marker => <div
              className={`marker-reference-chip ${String(marker.id) === focusedMarkerId ? 'focused' : ''}`}
              key={marker.id}
              role="button"
              tabIndex={0}
              onClick={event => {
                if ((event.target as Element).closest('button')) return
                focusCanvasMarker(marker, event.currentTarget)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') focusCanvasMarker(marker, event.currentTarget)
              }}
            >
              <span>{marker.props.number}</span>
              <strong title={marker.props.recognitionDescription || marker.props.label}>{marker.props.label}</strong>
              <button onClick={() => removeCanvasMarker(marker)} aria-label={`移除标记 ${marker.props.number}`}><X size={11} /></button>
            </div>)}
          </div>
          <textarea
            ref={markerQuickPromptRef}
            value={markerQuickPrompt}
            onChange={event => setMarkerQuickPrompt(event.target.value)}
            onKeyDown={event => {
              event.stopPropagation()
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void runMarkerQuickEdit()
              }
            }}
            placeholder="描述要如何修改这些标记位置…"
          />
          <div className="marker-quick-actions">
            <div>
              {[
                ['背景环境', '调整标记位置的背景环境'],
                ['配色方案', '优化标记位置的配色与明暗关系'],
                ['艺术流派', '统一标记位置的艺术风格与质感'],
              ].map(([label, instruction]) => <button
                key={label}
                onClick={() => setMarkerQuickPrompt(current => appendPromptInstruction(current, instruction))}
              >{label}<ChevronDown size={11} /></button>)}
            </div>
            <button className="primary" disabled={!markerQuickPrompt.trim() || sending} onClick={() => void runMarkerQuickEdit()}>
              {sending ? <LoaderCircle className="spin" size={13} /> : '执行'}
              <Sparkles size={11} />{imageEditCost}
            </button>
          </div>
        </section>}

        <nav className="bottom-toolbar" aria-label={lang === 'zh' ? '设计工具' : 'Design tools'}>
          <ToolButton active={activeTool === 'select'} icon={<MousePointer2 />} label="选择" onClick={() => activateCanvasTool('select', '选择')} />
          <ToolButton active={markerMode} icon={<Target />} label="标记" onClick={activateMarkerTool} />
          <span className="tool-separator" />
          <ToolButton loading={uploading} icon={<Upload />} label="上传" onClick={() => fileInputRef.current?.click()} />
          <ToolButton active={activeTool === 'geo'} icon={<Square />} label="形状" onClick={() => activateCanvasTool('geo', '形状')} />
          <ToolButton active={activeTool === 'draw'} icon={<PenLine />} label="绘制" onClick={() => activateCanvasTool('draw', '绘制')} />
          <ToolButton active={activeTool === 'text'} icon={<TextCursorInput />} label="文字" onClick={() => activateCanvasTool('text', '文字')} />
          <span className="tool-separator" />
          <ToolButton accent icon={<ImagePlus />} label="生成图片" onClick={createGenerator} />
          <button className="toolbar-more" onClick={() => void exportSelection()} title="导出 PNG"><ArrowDownToLine size={18} /></button>
        </nav>

        <div className="float-tools">
          <button title="背景" onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}><Palette size={16} /></button>
          <button title="图层与历史" className={drawer === 'layers' ? 'active' : ''} onClick={() => setDrawer(drawer === 'layers' ? '' : 'layers')}><Layers3 size={16} /></button>
          <button title="素材搜索" className={drawer === 'assets' ? 'active' : ''} onClick={() => setDrawer(drawer === 'assets' ? '' : 'assets')}><Search size={16} /></button>
          <button title="适应屏幕" onClick={() => editor?.zoomToFit({ animation: { duration: 180 } })}><Maximize size={16} /></button>
          <div className="zoom-group"><button onClick={() => editor?.zoomOut()}><ZoomOut size={15} /></button><span>{zoom}%</span><button onClick={() => editor?.zoomIn()}><ZoomIn size={15} /></button></div>
        </div>

        {drawer && <CanvasDrawer
          kind={drawer}
          editor={editor}
          shapes={editor ? Array.from(editor.getCurrentPageShapes()) : []}
          onAddAsset={(url, name) => void addImage(url, name, { source: 'asset-library', createdAt: Date.now() })}
          onClose={() => setDrawer('')}
          onSelect={id => editor?.select(id)}
        />}

        <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={event => void uploadCanvasFiles(event.target.files)} />
        <input ref={agentFileInputRef} type="file" accept="image/*" multiple hidden onChange={event => void uploadAgentReferences(event.target.files)} />
        {notice && <div className="toast"><Check size={15} />{notice}</div>}
      </section>

      <aside className="agent-panel" aria-label={lang === 'zh' ? '设计 Agent' : 'Design Agent'} onPaste={event => {
        const images = clipboardImageFiles(event.clipboardData)
        if (images.length) {
          event.preventDefault()
          void uploadAgentReferences(images)
        }
        event.stopPropagation()
      }} onCopy={event => event.stopPropagation()} onCut={event => event.stopPropagation()}>
        <div className="agent-header">
          <button className="agent-title-button" disabled={sending} onClick={startNewChat}><strong>{lang === 'zh' ? '新对话' : 'New chat'}</strong><span>{lang === 'zh' ? '设计 Agent' : 'Design Agent'}</span></button>
          <div><button disabled={sending} className={agentOverlay === 'history' ? 'active' : ''} title="历史" onClick={() => void openAgentOverlay('history')}><Clock3 size={17} /></button><button className={agentOverlay === 'help' ? 'active' : ''} title="帮助" onClick={() => void openAgentOverlay('help')}><CircleHelp size={17} /></button></div>
        </div>
        {agentOverlay && <section className="agent-overlay" aria-label={agentOverlay === 'history' ? '对话历史' : agentOverlay === 'prompts' ? '提示词库' : '使用帮助'}>
          <header><div>{agentOverlay === 'history' ? <Clock3 size={16} /> : agentOverlay === 'prompts' ? <Copy size={16} /> : <CircleHelp size={16} />}<strong>{agentOverlay === 'history' ? '对话历史' : agentOverlay === 'prompts' ? '提示词库' : '使用帮助'}</strong></div><button aria-label="关闭面板" onClick={() => setAgentOverlay('')}><X size={15} /></button></header>
          {agentOverlay === 'history' && <div className="agent-overlay-list">
            {!conversationHistory.length && <p>还没有历史对话，先从一个想法开始吧。</p>}
            {conversationHistory.map(item => <button disabled={sending} key={item.id} onClick={() => void loadConversation(item.id)}><strong>{item.title || '新对话'}</strong><span>{item.last_message || '暂无消息'}</span><small>{item.updated_at ? new Date(item.updated_at).toLocaleString() : ''}</small></button>)}
          </div>}
          {agentOverlay === 'prompts' && <div className="agent-overlay-list prompt-list">
            {!promptTemplates.length && <p>提示词库中还没有可用模板。</p>}
            {promptTemplates.slice(0, 30).map(item => <button key={item.id} onClick={() => { setPrompt(item.positive || item.scene || item.name); setAgentOverlay(''); window.setTimeout(() => promptRef.current?.focus(), 0) }}><strong>{item.name}</strong><span>{item.scene || item.positive}</span></button>)}
          </div>}
          {agentOverlay === 'help' && <div className="agent-help">
            <h3>在画布里直接完成设计</h3>
            <ol><li>点击底部工具后，在空白画布点击或拖动。</li><li>选择图片即可把它作为 Agent 参考，并显示快捷编辑。</li><li>点击“生成图片”创建生成器，填好描述后点击“开始生成”。</li></ol>
            <div><span>上传替代方式</span><p>可以把本地图片直接拖进画布；这在不支持文件弹窗的内置浏览器中也更直观。</p></div>
          </div>}
        </section>}
        <div className="agent-messages" ref={agentMessagesRef} style={{ paddingBottom: composerHeight + 28 }} onScroll={event => {
          const node = event.currentTarget
          const awayFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight > 96
          stickToBottomRef.current = !awayFromBottom
          setShowLatestButton(awayFromBottom)
        }}>
          {!visibleAgentTurns.length && <div className="agent-empty">
            <span className="agent-orb"><Sparkles size={22} /></span>
            <h2>{lang === 'zh' ? '和你的设计 Agent 一起创作' : 'Create with your design agent'}</h2>
            <p>{lang === 'zh' ? '描述想法，或先选中画布上的内容作为参考。结果会自动放在源对象右侧。' : 'Describe an idea or select canvas content as reference. Results land beside the source.'}</p>
            <div className="skill-grid">
              {(skills.length ? [...skills]
                .sort((left, right) => Number(right.name === '商品详情页') - Number(left.name === '商品详情页'))
                .map(skill => skill.name) : ['电商主图', '社媒海报', '品牌视觉', '产品精修', '一键改图', '多角度']).map(skillName => (
                <button key={skillName} onClick={() => chooseSkill(skillName)}><Sparkles size={13} />{displaySkillName(skillName, lang)}</button>
              ))}
            </div>
          </div>}
          {visibleAgentTurns.map(turn => (
            <section className="agent-turn" data-turn-id={turn.id} key={turn.id}>
              <article className="message user">
                <div className="message-avatar">我</div>
                <div className="message-body"><p>{turn.user_message.content}</p>{turn.references.length > 0 && <div className="message-reference-list" aria-label="本次消息参考图">
                  {turn.references.map(reference => <figure key={reference.url}><img src={reference.url} alt="" /><figcaption title={reference.name}>{reference.name}</figcaption></figure>)}
                </div>}</div>
              </article>
              {visibleAttemptsForTurn(
                turn,
                turn.id === agentSession.active_turn_id ? agentRun : null,
              ).map(attempt => {
                const visibleRun = turn.id === agentSession.active_turn_id && agentRun?.id === attempt.id
                  ? agentRun
                  : attempt.run
                return <div className="agent-attempt" data-attempt-id={attempt.id} key={attempt.id}>
                  {attempt.assistant_messages
                    .filter(message =>
                      !timelineOwnsMessage(message.id, visibleRun)
                      && !(visibleRun?.phase === 'failed' && message.type === 'error'),
                    )
                    .map(message => <article key={message.id} className={`message ${message.role}`}>
                      <div className="message-avatar">{message.role === 'user' ? '我' : <Bot size={15} />}</div>
                      <div className="message-body"><p>{message.content}</p>{message.image_url && <img src={message.image_url} alt="Agent result" />}{message.agent_action && <small>{displayAgentAction(message.agent_action, lang)}</small>}</div>
                    </article>)}
                  {visibleRun && <AgentRunTimeline
                    run={visibleRun}
                    lang={lang}
                    onFollowUp={instruction => prepareFollowUp(instruction, visibleRun.imageUrl, turn.id)}
                    onRetry={() => {
                      if (sending) return
                      activeTurnIdRef.current = turn.id
                      updateAgentSession(current => ({ ...current, active_turn_id: turn.id }))
                      setAgentRun(visibleRun)
                      if (visibleRun.failedStage === 'analyzing') {
                        void sendPrompt(visibleRun.prompt, [], visibleRun, undefined, true)
                      } else if (visibleRun.failedStage === 'reviewing' && visibleRun.imageUrl) {
                        void sendPrompt(visibleRun.prompt, [], visibleRun)
                      } else if (visibleRun.upstreamOutcome === 'unknown') {
                        void sendPrompt(visibleRun.prompt, [], visibleRun)
                      } else {
                        void sendPrompt(visibleRun.prompt, [], visibleRun, undefined, true)
                      }
                    }}
                    onClarificationSubmit={(answers, skip) => {
                      if (sending) return
                      activeTurnIdRef.current = turn.id
                      setAgentRun(visibleRun)
                      void sendPrompt(
                        visibleRun.prompt,
                        [],
                        undefined,
                        { run: visibleRun, answers, skip },
                      )
                    }}
                    onClarificationChange={answers => {
                      updateTurnRun(turn.id, visibleRun.id, run => ({ ...run, clarificationAnswers: answers }))
                      if (turn.id === agentSession.active_turn_id) {
                        setAgentRun(run => run?.id === visibleRun.id ? { ...run, clarificationAnswers: answers } : run)
                      }
                    }}
                    onWorkflowSelectionChange={(moduleId, selected) => {
                      const update = (run: AgentRunView) => ({
                        ...run,
                        workflowModules: (run.workflowModules || []).map(module =>
                          module.id === moduleId ? { ...module, selected } : module,
                        ),
                      })
                      updateTurnRun(turn.id, visibleRun.id, update)
                      if (turn.id === agentSession.active_turn_id) {
                        setAgentRun(current => current?.id === visibleRun.id ? update(current) : current)
                      }
                    }}
                    onWorkflowAspectChange={workflowAspectRatio => {
                      const update = (run: AgentRunView): AgentRunView => ({ ...run, workflowAspectRatio })
                      updateTurnRun(turn.id, visibleRun.id, update)
                      if (turn.id === agentSessionRef.current.active_turn_id) {
                        setAgentRun(current => current?.id === visibleRun.id ? update(current) : current)
                      }
                    }}
                    onWorkflowCopyModeChange={workflowCopyMode => {
                      const update = (run: AgentRunView): AgentRunView => ({ ...run, workflowCopyMode })
                      updateTurnRun(turn.id, visibleRun.id, update)
                      if (turn.id === agentSessionRef.current.active_turn_id) {
                        setAgentRun(current => current?.id === visibleRun.id ? update(current) : current)
                      }
                    }}
                    onWorkflowModuleRevise={(moduleId, draft) => {
                      activeTurnIdRef.current = turn.id
                      void reviseWorkflowModule(visibleRun, turn.id, moduleId, draft)
                    }}
                    onWorkflowModuleRevisionConfirm={moduleId => {
                      const update = (run: AgentRunView): AgentRunView => {
                        const target = (run.workflowModules || []).find(module => module.id === moduleId)
                        const optimized = target?.revision?.optimized
                        if (!target || !optimized || target.revision?.status !== 'confirming') return run
                        const accepted = {
                          ...target,
                          name: optimized.name,
                          purpose: optimized.purpose,
                          content: optimized.content,
                          generation_prompt: optimized.generation_prompt,
                          revision: { ...target.revision, status: 'accepted' as const },
                        }
                        return {
                          ...run,
                          workflowPlan: run.workflowPlan ? {
                            ...run.workflowPlan,
                            modules: run.workflowPlan.modules.map(module => module.id === moduleId ? {
                              ...module,
                              name: optimized.name,
                              purpose: optimized.purpose,
                              content: optimized.content,
                              generation_prompt: optimized.generation_prompt,
                            } : module),
                          } : run.workflowPlan,
                          workflowModules: (run.workflowModules || []).map(module => module.id === moduleId ? accepted : module),
                        }
                      }
                      updateTurnRun(turn.id, visibleRun.id, update)
                      if (turn.id === agentSessionRef.current.active_turn_id) {
                        setAgentRun(current => current?.id === visibleRun.id ? update(current) : current)
                      }
                    }}
                    onWorkflowPause={() => {
                      workflowPauseRequestsRef.current.add(visibleRun.id)
                      setNotice('已请求停止后续模块；当前模块完成复核后将返回编辑状态')
                      window.setTimeout(() => setNotice(''), 3500)
                    }}
                    onWorkflowConfirm={moduleIds => {
                      if (sending) return
                      activeTurnIdRef.current = turn.id
                      setAgentRun(visibleRun)
                      if (workflowNeedsIdentityAnchor(visibleRun)) {
                        void runWorkflowIdentityAnchor(visibleRun, moduleIds, 'initial')
                      } else {
                        void runWorkflowModules(visibleRun, moduleIds, 'initial')
                      }
                    }}
                    onWorkflowIdentityConfirm={() => {
                      if (sending || !visibleRun.identityAnchor?.imageUrl) return
                      const confirmedRun: AgentRunView = {
                        ...visibleRun,
                        phase: 'generating',
                        error: undefined,
                        identityAnchor: {
                          ...visibleRun.identityAnchor,
                          status: 'confirmed',
                          confirmedAt: Date.now(),
                        },
                      }
                      const moduleIds = (confirmedRun.workflowModules || [])
                        .filter(module => module.selected && module.status !== 'cancelled')
                        .map(module => module.id)
                      activeTurnIdRef.current = turn.id
                      updateTurnRun(turn.id, visibleRun.id, () => confirmedRun)
                      setAgentRun(confirmedRun)
                      void runWorkflowModules(confirmedRun, moduleIds, 'initial')
                    }}
                    onWorkflowIdentityRetry={() => {
                      if (sending) return
                      const moduleIds = (visibleRun.workflowModules || [])
                        .filter(module => module.selected && module.status !== 'cancelled')
                        .map(module => module.id)
                      activeTurnIdRef.current = turn.id
                      setAgentRun(visibleRun)
                      void runWorkflowIdentityAnchor(visibleRun, moduleIds, 'retry')
                    }}
                    onWorkflowRetry={moduleIds => {
                      if (sending) return
                      activeTurnIdRef.current = turn.id
                      setAgentRun(visibleRun)
                      void runWorkflowModules(visibleRun, moduleIds, 'retry')
                    }}
                    onWorkflowReview={() => {
                      if (sending) return
                      const moduleIds = (visibleRun.workflowModules || [])
                        .filter(module => Boolean(module.imageUrl) && module.status !== 'cancelled')
                        .map(module => module.id)
                      if (!moduleIds.length) return
                      activeTurnIdRef.current = turn.id
                      setAgentRun(visibleRun)
                      void runWorkflowModules(visibleRun, moduleIds, 'review')
                    }}
                    onWorkflowReviewAccept={() => {
                      const update = (run: AgentRunView): AgentRunView => ({ ...run, workflowReviewDecision: 'accepted' })
                      updateTurnRun(turn.id, visibleRun.id, update)
                      if (turn.id === agentSessionRef.current.active_turn_id) {
                        setAgentRun(current => current?.id === visibleRun.id ? update(current) : current)
                      }
                    }}
                    busy={sending}
                  />}
                </div>
              })}
            </section>
          ))}
          {sending && !agentRun && <div className="agent-thinking"><span /><span /><span /> Agent 正在思考与创作</div>}
        </div>
        {showLatestButton && <button className="jump-to-latest" style={{ bottom: composerHeight + 24 }} onClick={() => {
          stickToBottomRef.current = true
          agentMessagesRef.current?.scrollTo({ top: agentMessagesRef.current.scrollHeight, behavior: 'smooth' })
          setShowLatestButton(false)
        }} aria-label={lang === 'zh' ? '回到最新消息' : 'Jump to latest'}><ChevronDown size={16} /></button>}
        {chatError && <div className="chat-error" style={{ bottom: composerHeight + 18 }}><span>{chatError}</span><button onClick={() => setChatError('')}><X size={14} /></button></div>}
        <div
          className={`composer-wrap ${referenceDragActive ? 'reference-drag-active' : ''}`}
          ref={composerRef}
          onDragEnter={event => {
            if (!Array.from(event.dataTransfer.types || []).includes('Files')) return
            event.preventDefault()
            event.stopPropagation()
            setReferenceDragActive(true)
          }}
          onDragOver={event => {
            if (!Array.from(event.dataTransfer.types || []).includes('Files')) return
            event.preventDefault()
            event.stopPropagation()
            event.dataTransfer.dropEffect = 'copy'
          }}
          onDragLeave={event => {
            event.stopPropagation()
            const nextTarget = event.relatedTarget
            if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setReferenceDragActive(false)
          }}
          onDrop={event => {
            event.preventDefault()
            event.stopPropagation()
            setReferenceDragActive(false)
            void uploadAgentReferences(event.dataTransfer.files)
          }}
        >
          {markerPreviewVisible && focusedMarkerPreview && <figure
            key={`marker-preview-${markerFocusSequence}`}
            className="marker-focus-preview"
            style={{ left: markerPreviewAnchor ?? 58 }}
            aria-label={`标记 ${focusedMarker?.props.number} 的局部预览`}
          >
            <div><img
              src={focusedMarkerPreview.url}
              alt=""
              style={{
                width: focusedMarkerPreview.geometry.imageWidth,
                height: focusedMarkerPreview.geometry.imageHeight,
                left: focusedMarkerPreview.geometry.imageLeft,
                top: focusedMarkerPreview.geometry.imageTop,
              }}
            />
              <span
                className="marker-focus-preview-pin"
                style={{
                  left: focusedMarkerPreview.geometry.pinLeft,
                  top: focusedMarkerPreview.geometry.pinTop,
                }}
                aria-hidden="true"
              >
                {focusedMarker?.props.number}
              </span>
            </div>
            <figcaption><span>{focusedMarker?.props.number}</span>{focusedMarkerPreview.label}</figcaption>
          </figure>}
          {activeSkill && <div className="active-skill-chip"><Sparkles size={13} /><span>{displaySkillName(activeSkill, lang)}</span><button onClick={() => setActiveSkill('')}><X size={12} /></button></div>}
          {pendingReferences.length > 0 && <div className="agent-reference-list" aria-label="待发送参考图">
            {pendingReferences.map(reference => <div className="agent-reference-chip" key={reference.url}>
              <img src={reference.url} alt="" />
              <span title={reference.name}>{reference.name}</span>
              <button type="button" onClick={() => removePendingReference(reference.url)} aria-label={`移除参考图 ${reference.name}`}><X size={11} /></button>
            </div>)}
          </div>}
          {markerShapes.length > 0 && <div className="marker-reference-list" aria-label="画布标记引用">
            {markerShapes.map(marker => <div
              className={`marker-reference-chip ${String(marker.id) === focusedMarkerId ? 'focused' : ''}`}
              key={marker.id}
              role="button"
              tabIndex={0}
              onClick={event => {
                if ((event.target as Element).closest('button')) return
                focusCanvasMarker(marker, event.currentTarget)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') focusCanvasMarker(marker, event.currentTarget)
              }}
            >
              <span>{marker.props.number}</span>
              <strong title={marker.props.recognitionDescription || marker.props.label}>{marker.props.label}</strong>
              <button onClick={() => removeCanvasMarker(marker)} aria-label={`移除标记 ${marker.props.number}`}><X size={11} /></button>
            </div>)}
          </div>}
          {selectedShapes.length > 0 && <div className="selection-reference"><div className="selection-thumb">{selectedVisual?.url ? <img src={selectedVisual.url} alt="" /> : <ImageIcon size={15} />}</div><span>{selectedShapes.length === 1 ? (selectedVisual?.name ? displayCanvasResultName(selectedVisual.name) : selectedGenerator ? '图像生成器' : '已选对象') : `已选 ${selectedShapes.length} 个对象`}</span><button onClick={() => editor?.selectNone()}><X size={13} /></button></div>}
          <textarea ref={promptRef} value={prompt} onChange={event => { setPrompt(event.target.value); fitComposerTextarea(event.currentTarget) }} onKeyDown={event => {
            event.stopPropagation()
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendPrompt() }
          }} placeholder={activeSkill ? `好的，你想用「${displaySkillName(activeSkill, lang)}」设计什么主题？` : lang === 'zh' ? '从一个想法开始，输入 @ 可引用…' : 'Start with an idea, type @ to mention…'} />
          <div className="composer-actions">
            <div><button title={referenceUploading ? '参考图上传中' : '上传参考'} disabled={referenceUploading} onClick={() => agentFileInputRef.current?.click()}>{referenceUploading ? <LoaderCircle className="spin" size={16} /> : <Plus size={18} />}</button><button className={agentOverlay === 'prompts' ? 'active' : ''} title="提示库" onClick={() => void openAgentOverlay('prompts')}><Copy size={16} /></button><span className="mode-menu-wrap"><button className="mode-button" onClick={() => { setModeMenuOpen(value => !value); setAnalysisModelMenuOpen(false); setModelMenuOpen(false); setAspectMenuOpen(false) }}>{composerMode === 'agent' ? <Bot size={15} /> : composerMode === 'image' ? <ImageIcon size={15} /> : <Aperture size={15} />}{composerMode === 'agent' ? 'Agent' : composerMode === 'image' ? '图片' : '视频'}<ChevronDown size={13} /></button>{modeMenuOpen && <div className="mode-menu">
              <button className={composerMode === 'agent' ? 'active' : ''} onClick={() => { setComposerMode('agent'); setModeMenuOpen(false) }}><Bot size={16} /><span><strong>Agent</strong><small>规划并完成多步设计任务</small></span>{composerMode === 'agent' && <Check size={14} />}</button>
              <button className={composerMode === 'image' ? 'active' : ''} onClick={() => { setComposerMode('image'); setModeMenuOpen(false) }}><ImageIcon size={16} /><span><strong>图片</strong><small>直接生成或修改图像</small></span>{composerMode === 'image' && <Check size={14} />}</button>
              <button className={composerMode === 'video' ? 'active' : ''} onClick={() => { setComposerMode('video'); setModeMenuOpen(false) }}><Aperture size={16} /><span><strong>视频</strong><small>即将接入现有视频能力</small></span>{composerMode === 'video' && <Check size={14} />}</button>
            </div>}</span>{composerMode === 'agent' && <span className="model-menu-wrap analysis-model-menu-wrap"><button className="model-button" aria-label={`分析模型：${selectedAnalysisModel === '自动选择' ? '自动选择' : selectedAnalysisModel.split('::').pop()}`} onClick={() => { setAnalysisModelMenuOpen(value => !value); setModelMenuOpen(false); setAspectMenuOpen(false); setModeMenuOpen(false) }}><Bot size={14} />{selectedAnalysisModel === '自动选择' ? '分析 · 自动' : selectedAnalysisModel.split('::').pop()}<ChevronDown size={12} /></button>{analysisModelMenuOpen && <div className="model-menu">
              <button className={selectedAnalysisModel === '自动选择' ? 'active' : ''} onClick={() => { setSelectedAnalysisModel('自动选择'); setAnalysisModelMenuOpen(false) }}><span><strong>自动选择</strong><small>按配置选择；失败时可使用备用模型</small></span>{selectedAnalysisModel === '自动选择' && <Check size={14} />}</button>
              {availableAnalysisModelOptions(apiProviders).map(option => <button className={selectedAnalysisModel === option.value ? 'active' : ''} key={`analysis-${option.value}`} onClick={() => { setSelectedAnalysisModel(option.value); setAnalysisModelMenuOpen(false) }}><span><strong>{option.model}</strong><small>{option.providerName} · 固定模型</small></span>{selectedAnalysisModel === option.value && <Check size={14} />}</button>)}
            </div>}</span>}{composerMode !== 'video' && <span className="model-menu-wrap"><button className="model-button" aria-label={`生图模型：${selectedImageModel === '自动选择' ? '自动选择' : selectedImageModel.split('::').pop()}`} onClick={() => { setModelMenuOpen(value => !value); setAnalysisModelMenuOpen(false); setAspectMenuOpen(false); setModeMenuOpen(false) }}><ImageIcon size={14} />{selectedImageModel === '自动选择' ? '生图 · 自动' : selectedImageModel.split('::').pop()}<ChevronDown size={12} /></button>{modelMenuOpen && <div className="model-menu">
              <button className={selectedImageModel === '自动选择' ? 'active' : ''} onClick={() => { setSelectedImageModel('自动选择'); setModelMenuOpen(false) }}><span><strong>自动选择</strong><small>按可用配置选择生图模型</small></span>{selectedImageModel === '自动选择' && <Check size={14} />}</button>
              {availableImageModelOptions(apiProviders).map(option => <button className={selectedImageModel === option.value ? 'active' : ''} key={option.value} onClick={() => { setSelectedImageModel(option.value); setModelMenuOpen(false) }}><span><strong>{option.model}</strong><small>{option.providerName}</small></span>{selectedImageModel === option.value && <Check size={14} />}</button>)}
            </div>}</span>}{composerMode === 'image' && <span className="aspect-menu-wrap"><button className="aspect-button" aria-label={`图片比例：${selectedImageAspect === 'auto' ? '自动' : selectedImageAspect}`} onClick={() => { setAspectMenuOpen(value => !value); setModelMenuOpen(false); setAnalysisModelMenuOpen(false); setModeMenuOpen(false) }}><Crop size={14} />{selectedImageAspect === 'auto' ? '比例 · 自动' : selectedImageAspect}<ChevronDown size={12} /></button>{aspectMenuOpen && <div className="aspect-menu" role="menu" aria-label="图片比例">
              {IMAGE_ASPECT_OPTIONS.map(option => <button className={selectedImageAspect === option.value ? 'active' : ''} key={option.value} role="menuitemradio" aria-checked={selectedImageAspect === option.value} onClick={() => { setSelectedImageAspect(option.value); setAspectMenuOpen(false) }}><strong>{option.label}</strong>{selectedImageAspect === option.value && <Check size={13} />}</button>)}
            </div>}</span>}</div>
            <button className="send-button" disabled={!prompt.trim() || sending || referenceUploading} onClick={() => void sendPrompt()} aria-label="发送"><Send size={17} /></button>
          </div>
        </div>
      </aside>

      {conflict && <div className="modal-backdrop"><section className="conflict-dialog" role="dialog" aria-modal="true" aria-label="保存冲突">
        <div className="conflict-icon"><History size={22} /></div>
        <h2>这个设计已在其他页面更新</h2>
        <p>{conflict.message || '请选择加载最新版，或保留当前内容并另存为副本。'}</p>
        <div><button onClick={loadLatest}>加载最新版</button><button className="primary" onClick={() => void saveCopy()}>另存副本</button></div>
      </section></div>}

      {saveState === 'auth-required' && <div className="modal-backdrop"><section className="conflict-dialog auth-required-dialog" role="dialog" aria-modal="true" aria-label={lang === 'zh' ? '登录已失效' : 'Sign-in required'}>
        <div className="conflict-icon"><ShieldCheck size={22} /></div>
        <h2>{lang === 'zh' ? '登录已失效' : 'Your session has expired'}</h2>
        <p>{lang === 'zh' ? '当前画布草稿已安全保存在本机，系统已停止重复保存。请重新登录，返回设计智能体后会继续恢复草稿。' : 'Your canvas draft is saved locally and repeated saves have stopped. Sign in again to restore and continue saving.'}</p>
        <div><button className="primary" onClick={() => window.top?.location.assign('/login')}>{lang === 'zh' ? '重新登录' : 'Sign in again'}</button></div>
      </section></div>}

      {pendingDeleteCanvas && <div className="modal-backdrop"><section className="delete-canvas-dialog" role="dialog" aria-modal="true" aria-label={lang === 'zh' ? '删除设计' : 'Delete design'}>
        <div className="delete-dialog-icon"><Trash2 size={20} /></div>
        <h2>{lang === 'zh' ? `删除「${pendingDeleteCanvas.title}」？` : `Delete “${pendingDeleteCanvas.title}”?`}</h2>
        <p>{lang === 'zh' ? '设计将移入回收站，管理员之后仍可恢复。' : 'The design will move to the recycle bin and can still be restored by an administrator.'}</p>
        <div><button onClick={() => setPendingDeleteCanvas(null)}>{lang === 'zh' ? '取消' : 'Cancel'}</button><button className="danger" onClick={() => void deleteCanvas(pendingDeleteCanvas)}>{lang === 'zh' ? '移入回收站' : 'Move to recycle bin'}</button></div>
      </section></div>}
    </main>
  )
}

export function AgentRunTimeline({ run, lang, onFollowUp, onRetry, onClarificationSubmit, onClarificationChange, onWorkflowConfirm, onWorkflowIdentityConfirm, onWorkflowIdentityRetry, onWorkflowRetry, onWorkflowReview, onWorkflowReviewAccept, onWorkflowSelectionChange, onWorkflowAspectChange, onWorkflowCopyModeChange, onWorkflowModuleRevise, onWorkflowModuleRevisionConfirm, onWorkflowPause, busy = false }: {
  run: AgentRunView
  lang: Lang
  onFollowUp: (instruction: string) => void
  onRetry: () => void
  onClarificationSubmit?: (answers: Record<string, string[]>, skip: boolean) => void
  onClarificationChange?: (answers: Record<string, string[]>) => void
  onWorkflowConfirm?: (moduleIds: string[]) => void
  onWorkflowIdentityConfirm?: () => void
  onWorkflowIdentityRetry?: () => void
  onWorkflowRetry?: (moduleIds: string[]) => void
  onWorkflowReview?: () => void
  onWorkflowReviewAccept?: () => void
  onWorkflowSelectionChange?: (moduleId: string, selected: boolean) => void
  onWorkflowAspectChange?: (aspect: WorkflowAspectRatio) => void
  onWorkflowCopyModeChange?: (mode: WorkflowCopyMode) => void
  onWorkflowModuleRevise?: (moduleId: string, draft: WorkflowModuleEditableFields) => void
  onWorkflowModuleRevisionConfirm?: (moduleId: string) => void
  onWorkflowPause?: () => void
  busy?: boolean
}) {
  const [now, setNow] = useState(Date.now())
  const [editingWorkflowModuleId, setEditingWorkflowModuleId] = useState('')
  const [workflowModuleDraft, setWorkflowModuleDraft] = useState<WorkflowModuleEditableFields>({
    name: '', purpose: '', content: '', generation_prompt: '',
  })
  const [pauseRequested, setPauseRequested] = useState(false)

  useEffect(() => {
    setEditingWorkflowModuleId('')
    setPauseRequested(false)
  }, [run.id])

  useEffect(() => {
    if (run.phase !== 'generating' && run.phase !== 'reviewing') setPauseRequested(false)
  }, [run.phase])

  useEffect(() => {
    if (!['analyzing', 'generating', 'reviewing'].includes(run.phase)) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [run.id, run.phase])

  const elapsed = Math.max(0, Math.floor((now - run.startedAt) / 1000))
  const elapsedLabel = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  const failedTitle = run.failedStage === 'reviewing'
    ? '图片已生成，质量复盘未完成'
    : run.failedStage === 'generating' ? '图片生成未完成' : '需求分析未完成'
  const outcomeUnknown = run.upstreamOutcome === 'unknown'
    || /可能已经|可能已完成|没有自动重试|供应商操作日志/.test(run.error || '')
  const workflowModules = run.workflowModules || []
  const workflowAspectRatio = run.workflowAspectRatio || '1:1'
  const workflowCopyMode = run.workflowCopyMode || 'with_copy'
  const selectedWorkflowModules = workflowModules.filter(module => module.selected && module.status !== 'cancelled')
  const pendingSelectedWorkflowModules = selectedWorkflowModules.filter(module => module.status === 'pending')
  const completedWorkflowModules = workflowModules.filter(module => module.status === 'completed')
  const failedWorkflowModules = workflowModules.filter(module => module.status === 'failed' || module.status === 'review_failed')
  const reviewableWorkflowModules = workflowModules.filter(module => module.status !== 'cancelled' && Boolean(module.imageUrl))
  const runningWorkflowModules = workflowModules.filter(module => module.status === 'running' || module.status === 'reviewing')
  const unresolvedWorkflowRevisions = pendingSelectedWorkflowModules.filter(module =>
    module.revision && module.revision.status !== 'accepted',
  )
  const selectedGenerationCount = pendingSelectedWorkflowModules.reduce((sum, module) => sum + module.estimated_generation_count, 0)
  const selectedPoints = pendingSelectedWorkflowModules.reduce((sum, module) => sum + module.estimated_points, 0)
  const canEditWorkflowModules = !busy && (
    run.phase === 'confirming'
    || (run.phase === 'confirming_identity' && run.identityAnchor?.status !== 'generating')
  )
  const openWorkflowModuleEditor = (module: AgentWorkflowModule, optimized = false) => {
    const source = optimized && module.revision?.optimized ? module.revision.optimized : module
    setWorkflowModuleDraft({
      name: source.name,
      purpose: source.purpose,
      content: source.content,
      generation_prompt: source.generation_prompt,
    })
    setEditingWorkflowModuleId(module.id)
  }
  const workflowDraftValid = workflowModuleDraft.name.trim().length > 0
    && workflowModuleDraft.purpose.trim().length > 0
    && workflowModuleDraft.content.trim().length > 0
    && workflowModuleDraft.generation_prompt.trim().length >= 20

  return <article className={`agent-run-flow ${run.phase}`} aria-label="Agent 设计执行" aria-live="polite">
    <section className="agent-plan">
      <div className="agent-run-kicker"><WandSparkles size={13} /><span>{lang === 'zh' ? '技能编排' : 'Synthesize Skills'}</span><em>{displaySkillName(run.skill, lang)}</em></div>
      {run.phase === 'clarifying' && run.clarification && <ClarificationCard
        clarification={run.clarification}
        initialAnswers={run.clarificationAnswers || {}}
        busy={busy}
        onChange={answers => onClarificationChange?.(answers)}
        onSubmit={(answers, skip) => onClarificationSubmit?.(answers, skip)}
      />}
      {run.phase !== 'clarifying' && run.clarification && (run.clarificationSkipped || Object.keys(run.clarificationAnswers || {}).length > 0) && <div className="clarification-confirmed">
        <CheckCircle2 size={14} />
        <span><strong>{run.clarificationSkipped ? '已交给 Agent 做专业判断' : '已确认设计方向'}</strong><small>{run.routingReason || '正在按补充信息分配执行流程'}</small></span>
      </div>}
      {run.workflowPlan && <section className="workflow-plan-card" aria-label="多模块工作流">
        <header>
          <span><Layers3 size={15} /><strong>{run.workflowPlan.title}</strong></span>
          <em>{workflowModules.length} 个模块</em>
        </header>
        <p>{run.workflowPlan.summary}</p>
        <section className="workflow-aspect-selector" aria-label="模块输出比例">
          <header><span><Frame size={13} /><strong>模块输出比例</strong></span><small>所有待生成模块统一使用 · {workflowImageSizeForAspect(workflowAspectRatio)}</small></header>
          <div className="workflow-aspect-options" role="group" aria-label="选择模块输出比例">
            {WORKFLOW_ASPECT_OPTIONS.map(option => <button
              type="button"
              key={option.value}
              aria-pressed={workflowAspectRatio === option.value}
              disabled={!canEditWorkflowModules}
              onClick={() => onWorkflowAspectChange?.(option.value)}
            ><span className="workflow-aspect-shape" style={{ aspectRatio: option.value.replace(':', ' / ') }} /><em>{option.label}</em></button>)}
          </div>
        </section>
        <section className="workflow-copy-selector" aria-label="模块文案版本">
          <header><span><Type size={13} /><strong>模块文案版本</strong></span><small>所有待生成模块统一使用</small></header>
          <div role="group" aria-label="选择模块文案版本">
            <button type="button" aria-pressed={workflowCopyMode === 'with_copy'} disabled={!canEditWorkflowModules} onClick={() => onWorkflowCopyModeChange?.('with_copy')}>
              <Type size={14} /><span><strong>有文案</strong><small>排版标题、卖点与信息层级</small></span>
            </button>
            <button type="button" aria-pressed={workflowCopyMode === 'without_copy'} disabled={!canEditWorkflowModules} onClick={() => onWorkflowCopyModeChange?.('without_copy')}>
              <ImageIcon size={14} /><span><strong>无文案</strong><small>仅保留产品与场景视觉</small></span>
            </button>
          </div>
        </section>
        {(run.phase === 'confirming_identity' || run.identityAnchor?.status === 'generating') && run.identityAnchor && <section className={`workflow-identity-anchor ${run.identityAnchor.status}`} aria-label="产品身份母图确认">
          <header><span>{run.identityAnchor.status === 'generating' ? <LoaderCircle className="spin" size={14} /> : <ShieldCheck size={14} />}<strong>{run.identityAnchor.status === 'generating' ? '正在生成产品母图' : '先确认产品母图'}</strong></span><em>未确认前不生成模块</em></header>
          {run.identityAnchor.imageUrl && <img src={run.identityAnchor.imageUrl} alt={run.identityAnchor.imageName || '产品身份母图'} />}
          <p>后续所有模块都会强制引用这张母图，锁定产品轮廓、结构、颜色、材质与配件形态。如果产品不对，请先重新生成母图。</p>
          {run.identityAnchor.error && <small className="workflow-module-error">{run.identityAnchor.error}</small>}
          {run.phase === 'confirming_identity' && <footer>
            <button type="button" className="secondary" disabled={busy} onClick={() => onWorkflowIdentityRetry?.()}><RefreshCw size={13} />重新生成母图</button>
            {run.identityAnchor.imageUrl && <button type="button" disabled={busy || Boolean(editingWorkflowModuleId) || unresolvedWorkflowRevisions.length > 0} onClick={() => onWorkflowIdentityConfirm?.()}><Check size={13} />确认母图并生成模块</button>}
          </footer>}
        </section>}
        <div className="workflow-module-list">
          {workflowModules.map((module, index) => {
            const selectable = (canEditWorkflowModules && module.status === 'pending') || module.status === 'failed' || module.status === 'review_failed'
            const editable = canEditWorkflowModules && module.status === 'pending' && module.revision?.status !== 'optimizing'
            const statusLabel = module.status === 'completed' ? '复核通过'
              : module.status === 'review_failed' ? '复核未通过'
              : module.status === 'failed' ? '生成失败'
              : module.status === 'reviewing' ? (run.phase === 'reviewing' ? '正在复核' : '等待统一复核')
              : module.status === 'running' ? '正在生成'
              : module.status === 'cancelled' ? '已取消'
              : '待生成'
            return <article className={`workflow-module ${module.status}`} key={module.id}>
              <label>
                <input
                  type="checkbox"
                  checked={module.selected && module.status !== 'cancelled'}
                  disabled={busy || !selectable}
                  onChange={event => onWorkflowSelectionChange?.(module.id, event.target.checked)}
                />
                <span>{index + 1}</span>
              </label>
              <div>
                <header><strong>{module.name}</strong><span className="workflow-module-heading-actions"><em>{statusLabel}</em>{editable && <button type="button" aria-label={`修改模块 ${index + 1}`} onClick={() => openWorkflowModuleEditor(module)}><PenLine size={11} />修改</button>}</span></header>
                {editingWorkflowModuleId === module.id ? <section className="workflow-module-editor" aria-label={`编辑模块 ${index + 1}`}>
                  <label><span>模块名称</span><input value={workflowModuleDraft.name} onChange={event => setWorkflowModuleDraft(draft => ({ ...draft, name: event.target.value }))} /></label>
                  <label><span>模块目的</span><input value={workflowModuleDraft.purpose} onChange={event => setWorkflowModuleDraft(draft => ({ ...draft, purpose: event.target.value }))} /></label>
                  <label><span>主要内容</span><textarea rows={3} value={workflowModuleDraft.content} onChange={event => setWorkflowModuleDraft(draft => ({ ...draft, content: event.target.value }))} /></label>
                  <label><span>生图要求</span><textarea rows={5} value={workflowModuleDraft.generation_prompt} onChange={event => setWorkflowModuleDraft(draft => ({ ...draft, generation_prompt: event.target.value }))} /></label>
                  <small>提交后由设计智能体进行文字分析优化（按当前模型单价计分析积分）；确认优化结果后才会开始生图。</small>
                  <footer>
                    <button type="button" className="secondary" onClick={() => setEditingWorkflowModuleId('')}>取消</button>
                    <button type="button" disabled={!workflowDraftValid} onClick={() => {
                      onWorkflowModuleRevise?.(module.id, workflowModuleDraft)
                      setEditingWorkflowModuleId('')
                    }}><Sparkles size={12} />提交并优化</button>
                  </footer>
                </section> : <>
                  <p>{module.purpose}</p>
                  <small>{module.content}</small>
                </>}
                {module.revision?.status === 'optimizing' && <div className="workflow-module-revision optimizing" role="status"><LoaderCircle className="spin" size={13} /><span><strong>正在复核并优化修改</strong><small>不会开始生图，完成后需要你再次确认。</small></span></div>}
                {module.revision?.status === 'failed' && <div className="workflow-module-revision failed" role="alert"><CircleAlert size={13} /><span><strong>修改优化失败</strong><small>{module.revision.error}</small></span></div>}
                {module.revision?.status === 'confirming' && module.revision.optimized && <section className="workflow-module-revision-proposal" aria-label={`确认模块 ${index + 1} 的优化结果`}>
                  <header><span><Sparkles size={13} /><strong>Agent 优化结果</strong></span><em>待你确认</em></header>
                  <p>{module.revision.summary}</p>
                  <dl>
                    <div><dt>名称</dt><dd>{module.revision.optimized.name}</dd></div>
                    <div><dt>目的</dt><dd>{module.revision.optimized.purpose}</dd></div>
                    <div><dt>内容</dt><dd>{module.revision.optimized.content}</dd></div>
                    <div><dt>生图要求</dt><dd>{module.revision.optimized.generation_prompt}</dd></div>
                  </dl>
                  {(module.revision.cautions || []).length > 0 && <ul>{(module.revision.cautions || []).map((item, cautionIndex) => <li key={`${module.id}-caution-${cautionIndex}`}>{item}</li>)}</ul>}
                  <footer>
                    <button type="button" className="secondary" onClick={() => openWorkflowModuleEditor(module, true)}><PenLine size={12} />继续修改</button>
                    <button type="button" onClick={() => onWorkflowModuleRevisionConfirm?.(module.id)}><Check size={12} />确认采用</button>
                  </footer>
                </section>}
                {module.revision?.status === 'accepted' && <div className="workflow-module-revision accepted"><CheckCircle2 size={13} /><span><strong>修改已确认</strong><small>{module.revision.summary || '已采用设计智能体优化后的版本。'}</small></span></div>}
                {module.imageUrl && <img src={module.imageUrl} alt={module.imageName || module.name} />}
                {module.review && <div className={`workflow-module-review ${module.review.passed ? 'passed' : 'failed'}`}>
                  {module.review.passed ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}
                  <span><strong>{module.review.title}</strong><small>{module.review.conclusion}</small></span>
                </div>}
                {module.error && !module.review && <small className="workflow-module-error">{module.error}</small>}
              </div>
              <aside><span>{module.estimated_generation_count} 次</span><span>{module.estimated_points} 积分</span></aside>
            </article>
          })}
        </div>
        {run.phase === 'confirming' && <footer>
          <span>{completedWorkflowModules.length ? `待执行 ${pendingSelectedWorkflowModules.length} 个模块` : `已选 ${pendingSelectedWorkflowModules.length}/${workflowModules.length} 个模块`} · 预计 {selectedGenerationCount} 次生图 · {selectedPoints} 积分{unresolvedWorkflowRevisions.length ? ` · ${unresolvedWorkflowRevisions.length} 个修改待确认` : ''}</span>
          <button type="button" disabled={busy || !pendingSelectedWorkflowModules.length || Boolean(editingWorkflowModuleId) || unresolvedWorkflowRevisions.length > 0} onClick={() => onWorkflowConfirm?.(pendingSelectedWorkflowModules.map(module => module.id))}>
            {busy ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}{completedWorkflowModules.length ? '确认修改并继续' : '确认模块并生成'}
          </button>
        </footer>}
        {run.phase !== 'confirming' && run.phase !== 'confirming_identity' && run.identityAnchor?.status !== 'generating' && <footer>
          <span>{run.phase === 'reviewing'
            ? `正在统一复核 · ${completedWorkflowModules.length}/${workflowModules.filter(module => module.status !== 'cancelled').length} 已完成`
            : failedWorkflowModules.length
              ? `统一复核完成 · ${completedWorkflowModules.length} 个通过 · ${failedWorkflowModules.length} 个未通过`
              : `已完成 ${completedWorkflowModules.length}/${workflowModules.filter(module => module.status !== 'cancelled').length} 个模块`}{runningWorkflowModules.length ? ` · ${runningWorkflowModules.length} 个处理中` : ''}</span>
          {run.phase === 'generating' && (runningWorkflowModules.length > 0 || pendingSelectedWorkflowModules.length > 0) && <button type="button" className="secondary" disabled={pauseRequested} onClick={() => {
            setPauseRequested(true)
            onWorkflowPause?.()
          }}>{pauseRequested ? <LoaderCircle className="spin" size={13} /> : <PenLine size={13} />}{pauseRequested ? '正在停止后续' : '停止后续并修改'}</button>}
          {run.phase === 'completed' && failedWorkflowModules.length > 0 && run.workflowReviewDecision !== 'accepted' && <>
            <button type="button" className="secondary" disabled={busy} onClick={() => onWorkflowReviewAccept?.()}><Check size={13} />保留当前结果</button>
            <button type="button" disabled={busy || !failedWorkflowModules.some(module => module.selected)} onClick={() => onWorkflowRetry?.(failedWorkflowModules.filter(module => module.selected).map(module => module.id))}>
              {busy ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}重新生成未通过模块
            </button>
          </>}
          {run.phase === 'completed' && failedWorkflowModules.length > 0 && run.workflowReviewDecision === 'accepted' && <em className="workflow-review-accepted"><CheckCircle2 size={12} />已选择保留当前结果</em>}
          {run.phase === 'completed' && reviewableWorkflowModules.length > 0 && (failedWorkflowModules.length === 0 || run.workflowReviewDecision === 'accepted') && <button type="button" className="secondary" disabled={busy} onClick={() => onWorkflowReview?.()}>
            {busy ? <LoaderCircle className="spin" size={13} /> : <ShieldCheck size={13} />}重新统一复核
          </button>}
        </footer>}
      </section>}
      {run.plan && <>
        <p className="agent-plan-intro">{run.plan.acknowledgement}</p>
        <h3>{run.plan.title}</h3>
        {(run.referenceAnalysis || []).length > 0 && <>
          <h4>参考图清单</h4>
          <ul className="reference-audit-list">{(run.referenceAnalysis || []).map(item => <li key={item.reference_index}>
            <CheckCircle2 size={13} />
            <span><strong>参考图{item.reference_index} · {item.subject_name}</strong><small>{item.must_appear ? '必须出现在成图中' : '用于辅助判断'} · {item.evidence}</small></span>
          </li>)}</ul>
        </>}
        {run.plan.sections.map((section, index) => <PlanSection key={`${section.kind}-${section.title}-${index}`} section={section} />)}
      </>}
      {!run.plan && run.executionRoute && <div className="route-assignment"><Target size={14} /><span><strong>{run.executionRoute === 'edit_image' ? '已分配：图片修改' : run.executionRoute === 'specialist_workflow' ? '已分配：多模块详情页工作流' : '已分配：直接生成'}</strong><small>{run.routingReason}</small></span></div>}
    </section>

    {(run.phase === 'analyzing' || (!run.workflowPlan && (run.phase === 'generating' || run.phase === 'reviewing'))) && <section className="agent-generation-card">
      <header><span>{run.phase === 'reviewing' ? <ShieldCheck size={13} /> : <ImageIcon size={13} />}{run.phase === 'analyzing' ? (run.analysisModel || 'Design Agent') : run.phase === 'reviewing' ? (run.reviewModel || 'Quality Critic') : (run.model || 'GPT Image')}</span><time>{elapsedLabel}</time></header>
      <strong>{run.phase === 'generating' && (run.regenerationCount || 0) > 0
        ? '复核未通过，正在自动重新生成'
        : agentRunStageCopy(run.phase, elapsed, lang)[0]}</strong>
      <div className="generation-card-preview"><span /><span /><span /></div>
      <p><LoaderCircle className="spin" size={13} />{run.phase === 'generating' && (run.regenerationCount || 0) > 0
        ? '正在按复核意见修正上一版；完成后会自动继续复核。'
        : agentRunStageCopy(run.phase, elapsed, lang)[1]}</p>
    </section>}

    {!run.workflowPlan && (run.phase === 'reviewing' || run.phase === 'completed' || (run.phase === 'failed' && run.imageUrl)) && <section className="agent-result-report">
      {run.imageUrl && <img src={run.imageUrl} alt={run.imageName || 'Agent 生成结果'} />}
      {run.reviewWarning && <div className="review-warning" role="status">
        <CircleAlert size={15} />
        <span><strong>图片已生成，复核暂不可用</strong><p>{run.reviewWarning}</p></span>
      </div>}
      {run.review && <>
        <h3 className={run.review.passed ? '' : 'review-failed'}>{run.review.passed ? <CheckCircle2 size={16} /> : <X size={16} />}{run.review.title}<em>{run.review.overall_score}</em></h3>
        <p className="review-summary">{run.review.summary}</p>
        {run.review.highlights.length > 0 && <><h4>设计亮点</h4><div className="result-highlights">
          {run.review.highlights.map((highlight, index) => <PlanRow key={`${highlight.title}-${index}`} icon={<Sparkles size={14} />} title={highlight.title} text={highlight.detail} />)}
        </div></>}
        {run.review.checks.length > 0 && <><h4>质量检查</h4><ul className="result-checks">{run.review.checks.map((check, index) => <li className={check.passed ? 'passed' : 'failed'} key={`${check.label}-${index}`}>{check.passed ? <CheckCircle2 size={13} /> : <X size={13} />}<span><strong>{check.label}</strong><em>{check.score}</em>{check.detail}</span></li>)}</ul></>}
        {(run.review.reference_checks || []).length > 0 && <><h4>逐图核对</h4><ul className="reference-audit-list">{(run.review.reference_checks || []).map(item => {
          const passed = item.verdict === 'present' || item.verdict === 'same_subject_view_covered' || item.verdict === 'not_required'
          const verdict = item.verdict === 'present' ? '已出现' : item.verdict === 'same_subject_view_covered' ? '同商品视角已覆盖' : item.verdict === 'missing' ? '缺失' : item.verdict === 'unclear' ? '无法确认' : '非必需'
          return <li className={passed ? 'passed' : 'failed'} key={item.reference_index}>{passed ? <CheckCircle2 size={13} /> : <X size={13} />}<span><strong>参考图{item.reference_index} · {verdict}</strong><small>{item.evidence}</small></span></li>
        })}</ul></>}
        <p className={`result-summary ${run.review.passed ? '' : 'failed'}`}><ShieldCheck size={14} />{run.review.conclusion}</p>
        {run.review.suggestions.length > 0 && <div className="result-followups">
          {run.review.suggestions.map((action, index) => <button disabled={busy} key={`${action.label}-${index}`} onClick={() => onFollowUp(action.instruction)}><span>↳</span>{action.label}</button>)}
        </div>}
      </>}
    </section>}

    {run.phase === 'failed' && <section className="agent-run-failed">
      <strong>{failedTitle}</strong>
      <p>{run.error || 'Agent 服务暂时不可用，请稍后重试。'}</p>
      {outcomeUnknown && <small>请先确认供应商记录中没有成图；再次提交会创建一笔新的生成任务。</small>}
      <button disabled={busy} onClick={onRetry}><LoaderCircle size={13} />{run.failedStage === 'analyzing' ? '重试需求分析' : run.failedStage === 'reviewing' && run.imageUrl ? '重新复核' : outcomeUnknown ? '查询原任务结果' : '重新生成'}</button>
    </section>}
  </article>
}

export function ClarificationCard({ clarification, initialAnswers, busy, onChange, onSubmit }: {
  clarification: WorkbenchClarification
  initialAnswers: Record<string, string[]>
  busy: boolean
  onChange?: (answers: Record<string, string[]>) => void
  onSubmit: (answers: Record<string, string[]>, skip: boolean) => void
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>(initialAnswers)
  const complete = clarificationAnswersComplete(clarification, answers)
  const choose = (question: WorkbenchClarificationQuestion, optionId: string) => {
    if (busy) return
    setAnswers(current => {
      const selected = current[question.id] || []
      const next = question.selection === 'single'
        ? [optionId]
        : selected.includes(optionId)
          ? selected.filter(value => value !== optionId)
          : [...selected, optionId]
      const updated = { ...current, [question.id]: next }
      onChange?.(updated)
      return updated
    })
  }

  return <section className="agent-clarification" aria-label="补充设计需求">
    <div className="clarification-heading"><Lightbulb size={16} /><span><strong>先确认几个关键选择</strong><p>{clarification.introduction}</p></span></div>
    {clarification.questions.map((question, questionIndex) => <fieldset key={question.id} className="clarification-question" disabled={busy}>
      <legend><span>{questionIndex + 1}</span>{question.question}{question.selection === 'multiple' && <small>可多选</small>}</legend>
      {question.description && <p>{question.description}</p>}
      <div className="clarification-options">
        {question.options.map(option => {
          const selected = Boolean(answers[question.id]?.includes(option.id))
          return <button key={option.id} type="button" className={selected ? 'selected' : ''} aria-pressed={selected} onClick={() => choose(question, option.id)}>
            <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
            {option.id === question.recommended_option_id && <em>推荐</em>}
            <Check size={14} />
          </button>
        })}
      </div>
    </fieldset>)}
    <div className="clarification-actions">
      <button type="button" className="skip" disabled={busy} onClick={() => onSubmit({}, true)}><WandSparkles size={13} />交给 Agent 判断</button>
      <button type="button" className="confirm" disabled={busy || !complete} onClick={() => onSubmit(answers, false)}>{busy ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}确认并继续</button>
    </div>
  </section>
}

function PlanSection({ section }: { section: WorkbenchPlanSection }) {
  const icons = {
    positioning: <Target size={14} />,
    audience: <Lightbulb size={14} />,
    layout: <Shapes size={14} />,
    color: <Palette size={14} />,
    typography: <Type size={14} />,
    lighting: <Sparkles size={14} />,
    fidelity: <Box size={14} />,
    other: <Sparkles size={14} />,
  }
  return <div className="plan-row"><span>{icons[section.kind]}</span><div><strong>{section.title}</strong><p>{section.summary}</p>
    {section.details.length > 0 && <ul>{section.details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}</ul>}
    {section.colors.length > 0 && <><div className="plan-swatches">{section.colors.map((color, index) => <span key={`${color.name}-${index}`} title={`${color.name} ${color.value}`} style={{ backgroundColor: /^#[0-9a-f]{3,8}$/i.test(color.value) ? color.value : '#d1d5db' }} />)}</div><p>{section.colors.map(color => `${color.name} ${color.value}`).join(' · ')}</p></>}
  </div></div>
}

function PlanRow({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="plan-row"><span>{icon}</span><div><strong>{title}</strong><p>{text}</p></div></div>
}

function ToolButton({ icon, label, onClick, active, accent, loading }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean; accent?: boolean; loading?: boolean }) {
  return <button className={`${active ? 'active' : ''} ${accent ? 'accent' : ''}`} onClick={onClick} title={label}>{loading ? <LoaderCircle className="spin" /> : icon}<span>{label}</span></button>
}

function ToolbarButton({ icon, label, onClick }: { icon: React.ReactElement; label: string; onClick: () => void }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick}>{<span>{icon}</span>}<small>{label}</small></button>
}

function CanvasDrawer({ kind, editor, shapes, onAddAsset, onClose, onSelect }: {
  kind: 'layers' | 'assets'
  editor: Editor | null
  shapes: TLShape[]
  onAddAsset: (url: string, name: string) => void
  onClose: () => void
  onSelect: (id: TLShapeId) => void
}) {
  const [tab, setTab] = useState<'layers' | 'history'>('layers')
  const [assetQuery, setAssetQuery] = useState('')
  const [assetItems, setAssetItems] = useState<Array<{ id: string; name: string; url: string }>>([])

  useEffect(() => {
    if (kind !== 'assets') return
    void api<{ library?: { libraries?: Array<{ categories?: Array<{ items?: Array<{ id?: string; name?: string; url?: string; cover_url?: string; kind?: string }> }> }> } }>('/api/asset-library')
      .then(result => {
        const items = (result.library?.libraries || []).flatMap(library => (library.categories || []).flatMap(category => category.items || []))
          .map((item, index) => ({ id: item.id || `asset-${index}`, name: item.name || '未命名素材', url: item.cover_url || item.url || '' }))
          .filter(item => item.url && /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(item.url))
        setAssetItems(items)
      })
      .catch(() => setAssetItems([]))
  }, [kind])

  const visibleAssets = assetItems.filter(item => item.name.toLowerCase().includes(assetQuery.trim().toLowerCase()))
  return <aside className="canvas-drawer">
    <header><strong>{kind === 'assets' ? '素材搜索' : '画布管理'}</strong><button onClick={onClose}><X size={15} /></button></header>
    {kind === 'layers' && <>
      <nav><button className={tab === 'layers' ? 'active' : ''} onClick={() => setTab('layers')}><Layers3 size={14} />图层</button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><History size={14} />历史</button></nav>
      {tab === 'layers' ? <div className="layer-list">
        {!shapes.length && <p>画布中还没有对象</p>}
        {[...shapes].reverse().map(shape => <button key={shape.id} onClick={() => onSelect(shape.id)}><span>{shape.type === 'design-image' || shape.type === 'design-generator' ? <ImageIcon size={14} /> : shape.type === 'text' ? <TextCursorInput size={14} /> : shape.type === 'frame' ? <Frame size={14} /> : <Shapes size={14} />}</span><b>{shape.type === 'design-image' ? (shape as DesignImageShape).props.name : shape.type === 'design-generator' ? ((shape as DesignGeneratorShape).props.resultName || '图像生成器') : shape.type}</b></button>)}
      </div> : <div className="history-actions"><button onClick={() => editor?.undo()}><Undo2 size={16} />撤销上一步</button><button onClick={() => editor?.redo()}><Redo2 size={16} />重做上一步</button><button disabled={(editor?.getSelectedShapeIds().length || 0) < 2} onClick={() => editor?.groupShapes(editor.getSelectedShapeIds())}><Group size={16} />组合选中对象</button><button disabled={(editor?.getSelectedShapeIds().length || 0) < 2} onClick={() => editor?.alignShapes(editor.getSelectedShapeIds(), 'left')}><AlignHorizontalSpaceAround size={16} />左对齐</button></div>}
    </>}
    {kind === 'assets' && <div className="asset-browser"><div className="asset-search"><Search size={14} /><input value={assetQuery} onChange={event => setAssetQuery(event.target.value)} placeholder="输入关键词搜索素材" /></div><div className="asset-results">{visibleAssets.map(item => <button key={item.id} onClick={() => onAddAsset(item.url, item.name)}><img src={item.url} alt="" /><span>{item.name}</span></button>)}{!visibleAssets.length && <div className="asset-empty"><ImageIcon size={22} /><strong>{assetQuery ? '没有匹配素材' : '素材库中还没有图片'}</strong><p>可以点击底部上传，或把本地图片直接拖进画布。</p></div>}</div></div>}
  </aside>
}
