import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./fabricCanvas', async importOriginal => {
  const actual = await importOriginal<typeof import('./fabricCanvas')>()
  return {
    ...actual,
    FabricCanvas: () => <div data-testid="fabric-canvas" />,
  }
})

import App, {
  AgentRunTimeline,
  agentRunStageCopy,
  automaticRegenerationPrompt,
  automaticRegenerationRequestId,
  availableAnalysisModelOptions,
  availableImageModelOptions,
  appendCanvasMarkerContext,
  canvasMarkerLimitReached,
  ClarificationCard,
  clarificationAnswersComplete,
  clipboardImageFiles,
  displayCanvasResultName,
  focusPlacedResults,
  IMAGE_ASPECT_OPTIONS,
  imageComposerSizeForAspect,
  isCanvasTextEntryTarget,
  isSingleCjkMarkerLabel,
  markerPhraseFromDescription,
  markerPreviewGeometry,
  markerRecognitionCropSide,
  markerReferenceGridRows,
  MAX_CANVAS_MARKERS,
  mergeAgentSessionsByTurnId,
  mergeAgentAttemptMessages,
  migrateAgentSessionV2,
  nextCanvasMarkerNumber,
  optimizeUserUploadFiles,
  pollAgentRequest,
  prepareAgentReferences,
  replayableWorkbenchRequest,
  resolveGenerationRoute,
  shouldAutoRegenerateReview,
  shouldResumeLegacyReview,
  shouldHideCanvasToolTurn,
  shouldAnalyzeComposerMode,
  shouldShowInAgentPanel,
  summarizePriorTurns,
  timelineOwnsMessage,
  uniqueReferenceImages,
  updateRunningCanvasIds,
  validateAgentReferenceFiles,
  visibleAttemptsForTurn,
  workflowIdentityReferences,
  workflowCopyInstruction,
  workflowImageSizeForAspect,
  workflowModuleExecutionIds,
  workflowReviewReferenceImages,
  workflowNeedsIdentityAnchor,
  type AgentRunView,
  type AgentSessionV2,
  type ChatMessage,
  classifyDocumentRequestError,
  isUnavailableCanvasDocumentError,
} from './App'
import { ApiError } from './api'
import { generatorOutcomeIsUnknown } from './canvasShapes'

function jsonResponse(value: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }))
}

describe('Lovart-style design workbench', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      if (path.endsWith('/api/canvases')) return jsonResponse({ canvases: [
        { id: 'smart_1', title: 'Campaign design', kind: 'smart', updated_at: 10 },
        { id: 'classic_1', title: 'Classic canvas', kind: 'classic', updated_at: 9 },
      ] })
      if (path.endsWith('/api/agent/skills')) return jsonResponse({ skills: [{ id: 'skill_1', name: '电商主图' }] })
      if (path.endsWith('/api/auth/status')) return jsonResponse({ points: 88 })
      if (path.endsWith('/api/conversations')) return jsonResponse({ conversations: [{ id: 'chat_1', title: '海报讨论', updated_at: 10, last_message: '继续优化版式' }] })
      if (path.endsWith('/api/prompt-libraries')) return jsonResponse({ library: { libraries: [{ items: [{ id: 'prompt_1', name: '产品三视图', positive: '生成产品正面、侧面和顶面三视图' }] }] } })
      if (path.endsWith('/api/providers/available')) return jsonResponse({ providers: [
        { id: 'custom-api', name: 'Comfly', enabled: true, has_key: true, image_models: ['gpt-image-2', 'nano-banana-pro'], chat_models: ['gemini-3-flash-preview'] },
      ] })
      return jsonResponse({})
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders one infinite scene with a dedicated Agent panel', async () => {
    render(<App />)
    expect(await screen.findByTestId('fabric-canvas')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Campaign design')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '无限设计场景' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '设计 Agent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '生成图片' })).toBeInTheDocument()
    expect(screen.queryByText('Classic canvas')).not.toBeInTheDocument()
    expect(screen.getByText('88')).toBeInTheDocument()
  })

  it('keeps the generic product-detail specialist visible when more than six skills exist', async () => {
    const defaultFetch = vi.mocked(fetch)
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/agent/skills')) return jsonResponse({ skills: [
        { id: 'skill_1', name: '电商主图' },
        { id: 'skill_2', name: '社媒海报' },
        { id: 'skill_3', name: '品牌视觉' },
        { id: 'skill_4', name: '产品精修' },
        { id: 'skill_5', name: '一键改图' },
        { id: 'skill_6', name: '多角度' },
        { id: 'skill_product_detail', name: '商品详情页' },
      ] })
      return defaultFetch(input, init)
    }))

    render(<App />)
    const specialist = await screen.findByRole('button', { name: '商品详情页' })
    fireEvent.click(specialist)
    expect(screen.getByText('商品详情页', { selector: '.active-skill-chip span' })).toBeInTheDocument()
  })

  it('tracks concurrent Agent runs per canvas instead of using a global lock', () => {
    let running: string[] = []
    running = updateRunningCanvasIds(running, 'canvas-a', true)
    running = updateRunningCanvasIds(running, 'canvas-b', true)
    running = updateRunningCanvasIds(running, 'canvas-a', true)
    expect(running).toEqual(['canvas-a', 'canvas-b'])

    running = updateRunningCanvasIds(running, 'canvas-a', false)
    expect(running).toEqual(['canvas-b'])
  })

  it('explains long image waits and keeps canvas navigation available', () => {
    expect(agentRunStageCopy('generating', 30, 'zh')[1]).toContain('图片生成能力')
    expect(agentRunStageCopy('generating', 95, 'zh')[1]).toContain('新建设计')
    expect(agentRunStageCopy('generating', 421, 'zh')[1]).toContain('已等待 7 分钟')
    expect(agentRunStageCopy('generating', 95, 'en')[1]).toContain('keep running in the background')
  })

  it('routes the legacy Comfly display name to its configured provider id', () => {
    expect(resolveGenerationRoute([
      { id: 'runninghub', name: 'RunningHub', enabled: true, has_key: false, image_models: [] },
      { id: 'custom-api', name: 'comfly', enabled: true, has_key: true, image_models: ['gpt-image-2', 'nano-banana-pro'], chat_models: ['gpt-5.5'] },
    ], 'GPT Image')).toEqual({
      provider: 'custom-api',
      chat_model: 'gpt-5.5',
      allow_chat_fallback: true,
      image_provider: 'custom-api',
      image_model: 'gpt-image-2',
    })
  })

  it('keeps the original GPT Image route and preserves explicit choices', () => {
    const providers = [
      { id: 'custom-api', name: 'Comfly', enabled: true, has_key: true, image_models: ['gpt-image-2'], chat_models: ['gemini-3-flash-preview'] },
      { id: 'custom-api-2', name: '云桥', enabled: true, has_key: true, image_models: ['gpt-image-2'] },
    ]
    expect(resolveGenerationRoute(providers)).toMatchObject({
      provider: 'custom-api',
      image_provider: 'custom-api',
      image_model: 'gpt-image-2',
    })
    expect(resolveGenerationRoute(providers, 'gpt-image-2')).toMatchObject({
      image_provider: 'custom-api',
      image_model: 'gpt-image-2',
    })
    expect(resolveGenerationRoute(providers, 'custom-api::gpt-image-2')).toMatchObject({
      image_provider: 'custom-api',
      image_model: 'gpt-image-2',
    })
  })

  it('lists configured image models and routes an exact Agent selection', () => {
    const providers = [
      { id: 'primary', name: 'Primary', enabled: true, has_key: true, image_models: ['gpt-image-2'] },
      { id: 'alternate', name: 'Alternate', enabled: true, has_key: true, image_models: ['nano-banana-pro'] },
    ]
    expect(availableImageModelOptions(providers).map(option => option.value)).toEqual([
      'primary::gpt-image-2',
      'alternate::nano-banana-pro',
    ])
    expect(resolveGenerationRoute(providers, 'alternate::nano-banana-pro')).toMatchObject({
      image_provider: 'alternate',
      image_model: 'nano-banana-pro',
    })
  })

  it('lets the Agent composer select a configured image model', async () => {
    render(<App />)
    const selector = await screen.findByRole('button', { name: '生图模型：自动选择' })
    fireEvent.click(selector)
    fireEvent.click(screen.getByRole('button', { name: /nano-banana-pro/ }))
    expect(screen.getByRole('button', { name: '生图模型：nano-banana-pro' })).toBeInTheDocument()
  })

  it('shows a persistent ratio selector only in image mode', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /^Agent$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^图片 直接生成或修改图像/ }))

    const selector = screen.getByRole('button', { name: '图片比例：自动' })
    fireEvent.click(selector)
    expect(screen.getByRole('menu', { name: '图片比例' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitemradio', { name: '4:5' }))
    expect(screen.getByRole('button', { name: '图片比例：4:5' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^图片$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Agent 规划并完成多步设计任务/ }))
    expect(screen.queryByRole('button', { name: '图片比例：4:5' })).not.toBeInTheDocument()
  })

  it('lists analysis models and pins an explicit choice without silent fallback', () => {
    const providers = [
      { id: 'doubao', name: '豆包', enabled: true, has_key: true, chat_models: ['doubao-seed-2-0-mini-260215'] },
      { id: 'analysis-api', name: 'Analysis API', enabled: true, has_key: true, chat_models: ['gpt-5.6-terra'] },
    ]
    expect(availableAnalysisModelOptions(providers).map(option => option.value)).toEqual([
      'doubao::doubao-seed-2-0-mini-260215',
      'analysis-api::gpt-5.6-terra',
    ])
    expect(resolveGenerationRoute(providers, '自动选择', 'analysis-api::gpt-5.6-terra')).toMatchObject({
      provider: 'analysis-api',
      chat_model: 'gpt-5.6-terra',
      allow_chat_fallback: false,
    })
  })

  it('uses the first configured analysis model in auto mode', () => {
    expect(resolveGenerationRoute([
      { id: 'doubao', name: '豆包', enabled: true, has_key: true, chat_models: ['doubao-seed-2-0-mini-260215'] },
      { id: 'analysis-api', name: 'Analysis API', enabled: true, has_key: true, chat_models: ['gpt-5.6-terra'] },
    ])).toMatchObject({
      provider: 'doubao',
      chat_model: 'doubao-seed-2-0-mini-260215',
      allow_chat_fallback: true,
    })
  })

  it('does not silently replace a previously selected analysis model that is no longer listed', () => {
    expect(resolveGenerationRoute([
      { id: 'analysis-api', name: 'Analysis API', enabled: true, has_key: true, chat_models: ['gpt-5.6-terra'] },
    ], '自动选择', 'removed-api::selected-model')).toMatchObject({
      provider: 'removed-api',
      chat_model: 'selected-model',
      allow_chat_fallback: false,
    })
  })

  it('lets the Agent composer select its analysis model separately', async () => {
    render(<App />)
    const selector = await screen.findByRole('button', { name: '分析模型：自动选择' })
    fireEvent.click(selector)
    fireEvent.click(screen.getByRole('button', { name: /gemini-3-flash-preview/ }))
    expect(screen.getByRole('button', { name: '分析模型：gemini-3-flash-preview' })).toBeInTheDocument()
  })

  it('stops automatic document retries when authentication expires', () => {
    expect(classifyDocumentRequestError(new ApiError(401, { detail: '请先登录' }))).toBe('auth-required')
    expect(classifyDocumentRequestError(new ApiError(403, { detail: '账号已停用' }))).toBe('error')
    expect(classifyDocumentRequestError(new ApiError(503, { detail: '暂时不可用' }))).toBe('offline')
    expect(classifyDocumentRequestError(new ApiError(422, { detail: '文档格式错误' }))).toBe('error')
    expect(classifyDocumentRequestError(new TypeError('Failed to fetch'))).toBe('offline')
  })

  it('treats a missing canvas as an unavailable terminal document target', () => {
    expect(isUnavailableCanvasDocumentError(new ApiError(404, { detail: '画布不存在' }))).toBe(true)
    expect(isUnavailableCanvasDocumentError(new ApiError(401, { detail: '请先登录' }))).toBe(false)
    expect(isUnavailableCanvasDocumentError(new TypeError('Failed to fetch'))).toBe(false)
  })

  it('keeps direct canvas tools out of the Agent panel', () => {
    expect(shouldShowInAgentPanel()).toBe(true)
    expect(shouldShowInAgentPanel({ showInAgentPanel: false })).toBe(false)
    expect(shouldHideCanvasToolTurn('按用户设定的边界扩展当前图片：右 25%')).toBe(true)
    expect(shouldHideCanvasToolTurn('只修复输入图像中的透明缺口：自然补全背景')).toBe(true)
    expect(shouldHideCanvasToolTurn('为端午礼盒设计一张海报')).toBe(false)
    expect(displayCanvasResultName('只修复输入图像中的透明缺口：自然补全背景')).toBe('图片')
  })

  it('serializes fixed canvas markers as numbered Agent context', () => {
    expect(nextCanvasMarkerNumber([])).toBe(1)
    expect(nextCanvasMarkerNumber([1, 3, 2])).toBe(4)
    expect(canvasMarkerLimitReached(MAX_CANVAS_MARKERS - 1)).toBe(false)
    expect(canvasMarkerLimitReached(MAX_CANVAS_MARKERS)).toBe(true)
    expect(appendCanvasMarkerContext('只修改这些位置', [
      { number: 2, label: '龙舟', targetName: '端午海报', xPercent: 51, yPercent: 26 },
      { number: 1, label: '标题', targetName: '端午海报', xPercent: 48, yPercent: 73 },
    ])).toContain('#1「标题」，目标“端午海报”，位置为目标内横向 48%、纵向 73%')
    expect(appendCanvasMarkerContext('保持原样', [])).toBe('保持原样')
    expect(markerReferenceGridRows(3)).toBe(1)
    expect(markerReferenceGridRows(4)).toBe(2)
    expect(markerReferenceGridRows(10)).toBe(4)
    expect(markerRecognitionCropSide(1440, 1440)).toBe(922)
    expect(markerRecognitionCropSide(80, 120)).toBe(80)
    expect(isSingleCjkMarkerLabel('家')).toBe(true)
    expect(isSingleCjkMarkerLabel('家国同庆')).toBe(false)
    expect(markerPhraseFromDescription('点击的是“家国同庆”标题中的家字')).toBe('家国同庆')
  })

  it('does not steal marker shortcuts while the user is typing', () => {
    const textarea = document.createElement('textarea')
    const input = document.createElement('input')
    const canvas = document.createElement('div')
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    expect(isCanvasTextEntryTarget(textarea)).toBe(true)
    expect(isCanvasTextEntryTarget(input)).toBe(true)
    expect(isCanvasTextEntryTarget(editor)).toBe(true)
    expect(isCanvasTextEntryTarget(canvas)).toBe(false)
  })

  it('keeps administrator model order for automatic analysis', () => {
    expect(resolveGenerationRoute([
      { id: 'image-api', name: 'Image API', enabled: true, has_key: true, image_models: ['gpt-image-2'], chat_models: ['gemini-3.1-flash-lite'] },
      { id: 'analysis-api', name: 'Analysis API', enabled: true, has_key: true, image_models: [], chat_models: ['gpt-5.5', 'gemini-3.5-pro', 'gemini-3.6-flash'] },
    ], 'GPT Image')).toMatchObject({
      provider: 'image-api',
      chat_model: 'gemini-3.1-flash-lite',
      image_provider: 'image-api',
      image_model: 'gpt-image-2',
    })
  })

  it('exposes the Lovart-style creation toolbar and working drawers', async () => {
    render(<App />)
    await screen.findByDisplayValue('Campaign design')
    for (const label of ['选择', '标记', '上传', '形状', '绘制', '文字', '生成图片']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Frame' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('图层与历史'))
    expect(screen.getByText('画布管理')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '图层' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '历史' }).length).toBeGreaterThan(0)
  })

  it('turns a published skill into a guided Agent prompt', async () => {
    render(<App />)
    await screen.findByDisplayValue('Campaign design')
    fireEvent.click(screen.getByRole('button', { name: '电商主图' }))
    expect(screen.getByText('电商主图', { selector: '.active-skill-chip span' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('好的，你想用「电商主图」设计什么主题？')).toBeInTheDocument()
  })

  it('offers explicit Agent, image and video modes', async () => {
    expect(shouldAnalyzeComposerMode('agent')).toBe(true)
    expect(shouldAnalyzeComposerMode('image')).toBe(false)
    expect(shouldAnalyzeComposerMode('video')).toBe(false)
    render(<App />)
    await screen.findByDisplayValue('Campaign design')
    fireEvent.click(screen.getByRole('button', { name: /^Agent$/ }))
    expect(screen.getByRole('button', { name: /图片 直接生成或修改图像/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /视频 即将接入现有视频能力/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /图片 直接生成或修改图像/ }))
    expect(screen.getByRole('button', { name: /^图片$/ })).toBeInTheDocument()
  })

  it('opens the formerly inactive history, help and prompt-library controls', async () => {
    const fetchMock = vi.mocked(fetch)
    render(<App />)
    await screen.findByDisplayValue('Campaign design')
    fireEvent.click(screen.getByTitle('历史'))
    expect(await screen.findByRole('region', { name: '对话历史' })).toBeInTheDocument()
    expect(await screen.findByText('还没有历史对话，先从一个想法开始吧。')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/conversations'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '关闭面板' }))
    fireEvent.click(screen.getByTitle('帮助'))
    expect(screen.getByRole('region', { name: '使用帮助' })).toBeInTheDocument()
    expect(screen.getByText('在画布里直接完成设计')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭面板' }))
    fireEvent.click(screen.getByTitle('提示库'))
    expect(await screen.findByRole('region', { name: '提示词库' })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /产品三视图/ }))
    expect(screen.getByDisplayValue('生成产品正面、侧面和顶面三视图')).toBeInTheDocument()
  })

  it('creates a smart design when no smart canvas exists', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
      const path = String(input)
      if (path.endsWith('/api/canvases') && options?.method === 'POST') return jsonResponse({
        canvas: { id: 'smart_new', title: '未命名设计', kind: 'smart', updated_at: 20 },
      })
      if (path.endsWith('/api/canvases')) return jsonResponse({ canvases: [] })
      if (path.endsWith('/api/agent/skills')) return jsonResponse({ skills: [] })
      if (path.endsWith('/api/auth/status')) return jsonResponse({ points: 0 })
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    expect(await screen.findByDisplayValue('未命名设计')).toBeInTheDocument()
    await waitFor(() => expect(localStorage.getItem('design_agent_canvas')).toBe('smart_new'))
    const createCall = fetchMock.mock.calls.find(call => String(call[0]).endsWith('/api/canvases') && call[1]?.method === 'POST')
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({ kind: 'smart', icon: 'sparkles' })
  })

  it('soft-deletes the current design and switches to the remaining design', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
      const path = String(input)
      if (path.endsWith('/api/canvases/smart_1') && options?.method === 'DELETE') return jsonResponse({ ok: true })
      if (path.endsWith('/api/canvases')) return jsonResponse({ canvases: [
        { id: 'smart_1', title: 'Campaign design', kind: 'smart', updated_at: 10 },
        { id: 'smart_2', title: 'Backup design', kind: 'smart', updated_at: 9 },
      ] })
      if (path.endsWith('/api/agent/skills')) return jsonResponse({ skills: [] })
      if (path.endsWith('/api/auth/status')) return jsonResponse({ points: 0 })
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await screen.findByDisplayValue('Campaign design')
    fireEvent.click(screen.getByRole('button', { name: '切换设计' }))
    fireEvent.click(screen.getByRole('button', { name: '删除 Campaign design' }))
    expect(screen.getByRole('dialog', { name: '删除设计' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))

    expect(await screen.findByDisplayValue('Backup design')).toBeInTheDocument()
    expect(localStorage.getItem('design_agent_canvas')).toBe('smart_2')
    expect(fetchMock).toHaveBeenCalledWith('/api/canvases/smart_1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('keeps paste inside the Agent composer instead of bubbling to the canvas clipboard handler', async () => {
    render(<App />)
    const textarea = await screen.findByPlaceholderText('从一个想法开始，输入 @ 可引用…')
    const canvasPasteHandler = vi.fn((event: Event) => event.preventDefault())
    document.addEventListener('paste', canvasPasteHandler)
    const allowed = fireEvent.paste(textarea, { clipboardData: { getData: () => '粘贴内容' } })
    document.removeEventListener('paste', canvasPasteHandler)

    expect(allowed).toBe(true)
    expect(canvasPasteHandler).not.toHaveBeenCalled()
    fireEvent.change(textarea, { target: { value: '粘贴内容' } })
    expect(textarea).toHaveValue('粘贴内容')
  })

  it('turns pasted clipboard images into Agent references without duplicating item and file entries', async () => {
    const modifiedAt = 1_725_000_000_000
    const image = new File(['clipboard-image'], 'clipboard.png', { type: 'image/png', lastModified: modifiedAt })
    const duplicateImageObject = new File(['clipboard-image'], 'clipboard.png', { type: 'image/png', lastModified: modifiedAt })
    const text = new File(['notes'], 'notes.txt', { type: 'text/plain' })
    const clipboardData = {
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => image },
        { kind: 'file', type: 'text/plain', getAsFile: () => text },
      ],
      files: [duplicateImageObject, text],
    } as unknown as Pick<DataTransfer, 'items' | 'files'>
    expect(clipboardImageFiles(clipboardData)).toEqual([image])

    const fetchMock = vi.mocked(fetch)
    const fallback = fetchMock.getMockImplementation()
    fetchMock.mockImplementation((input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input).endsWith('/api/ai/upload')) return jsonResponse({ files: [
        { url: '/assets/input/clipboard.png', name: 'clipboard.png', kind: 'image', mime: 'image/png' },
      ] })
      return fallback?.(input, options) || jsonResponse({})
    })
    render(<App />)
    const textarea = await screen.findByPlaceholderText('从一个想法开始，输入 @ 可引用…')
    fireEvent.paste(textarea, { clipboardData })
    fireEvent.paste(textarea, { clipboardData })

    expect(await screen.findByLabelText('待发送参考图')).toHaveTextContent('clipboard.png')
    const uploadCalls = fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/api/ai/upload'))
    expect(uploadCalls).toHaveLength(1)
    const uploadCall = uploadCalls[0]
    expect((uploadCall?.[1]?.body as FormData).getAll('files')).toHaveLength(1)
    expect(screen.getAllByText('clipboard.png')).toHaveLength(1)
  })

  it('adds multiple dropped images as removable Agent references without placing canvas files', async () => {
    const fetchMock = vi.mocked(fetch)
    const fallback = fetchMock.getMockImplementation()
    fetchMock.mockImplementation((input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input).endsWith('/api/ai/upload')) return jsonResponse({ files: [
        { url: '/assets/input/first.png', name: 'first.png', kind: 'image', mime: 'image/png' },
        { url: '/assets/input/second.png', name: 'second.png', kind: 'image', mime: 'image/png' },
      ] })
      return fallback?.(input, options) || jsonResponse({})
    })
    const { container } = render(<App />)
    await screen.findByDisplayValue('Campaign design')
    const composer = container.querySelector('.composer-wrap') as HTMLElement
    const files = [
      new File(['first'], 'first.png', { type: 'image/png' }),
      new File(['second'], 'second.png', { type: 'image/png' }),
    ]

    fireEvent.dragEnter(composer, { dataTransfer: { types: ['Files'], files, dropEffect: '' } })
    expect(composer).toHaveClass('reference-drag-active')
    fireEvent.drop(composer, { dataTransfer: { types: ['Files'], files, dropEffect: '' } })

    const referenceList = await screen.findByLabelText('待发送参考图')
    expect(referenceList).toHaveTextContent('first.png')
    expect(referenceList).toHaveTextContent('second.png')
    const uploadCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/api/ai/upload'))
    expect((uploadCall?.[1]?.body as FormData).getAll('files')).toHaveLength(2)
    expect(screen.getAllByTestId('fabric-canvas')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '移除参考图 first.png' }))
    expect(referenceList).not.toHaveTextContent('first.png')
    expect(referenceList).toHaveTextContent('second.png')
    fireEvent.click(screen.getByRole('button', { name: /新对话/ }))
    expect(screen.queryByLabelText('待发送参考图')).not.toBeInTheDocument()
  })

  it('uses a separate multiple file input for Agent references', async () => {
    const fetchMock = vi.mocked(fetch)
    const fallback = fetchMock.getMockImplementation()
    fetchMock.mockImplementation((input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input).endsWith('/api/ai/upload')) return jsonResponse({ files: [
        { url: '/assets/input/a.png', name: 'a.png', kind: 'image', mime: 'image/png' },
        { url: '/assets/input/b.png', name: 'b.png', kind: 'image', mime: 'image/png' },
      ] })
      return fallback?.(input, options) || jsonResponse({})
    })
    const { container } = render(<App />)
    await screen.findByDisplayValue('Campaign design')
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]')
    expect(inputs).toHaveLength(2)
    expect(inputs[1]).toHaveAttribute('multiple')
    fireEvent.change(inputs[1], { target: { files: [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ] } })
    expect(await screen.findByText('a.png')).toBeInTheDocument()
    expect(screen.getByText('b.png')).toBeInTheDocument()
  })

  it('validates and persists pending Agent references compatibly', () => {
    const image = { name: 'reference.png', size: 1024, type: 'image/png' } as File
    const notImage = { name: 'notes.txt', size: 1024, type: 'text/plain' } as File
    const oversized = { name: 'huge.png', size: 50 * 1024 * 1024 + 1, type: 'image/png' } as File
    expect(validateAgentReferenceFiles([image], 7)).toBe('')
    expect(validateAgentReferenceFiles([image, image], 7)).toContain('最多引用 8 张图片')
    expect(validateAgentReferenceFiles([notImage], 0)).toContain('不是支持的图片格式')
    expect(validateAgentReferenceFiles([oversized], 0)).toContain('超过 50MB')
    expect(uniqueReferenceImages([
      { url: '/a.png', name: 'A', role: 'reference', kind: 'image', mime: 'image/png' },
      { url: '/a.png', name: 'A copy', role: 'reference', kind: 'image', mime: 'image/png' },
    ])).toHaveLength(1)

    const session = migrateAgentSessionV2({
      schema_version: 2,
      session_id: 'session-1',
      conversation_id: '',
      active_turn_id: null,
      next_sequence: 1,
      turns: [],
      composer: {
        prompt: 'draft',
        mode: 'agent',
        active_skill: '',
        pending_references: [{ url: '/a.png', name: 'A', role: 'reference', kind: 'image', mime: 'image/png' }],
      },
      updated_at: 1,
    })
    expect(session.composer.pending_references).toHaveLength(1)
    expect(migrateAgentSessionV2().composer.pending_references).toEqual([])
  })

  it('uses the shared optimizer for user-selected uploads and safely falls back', async () => {
    const original = new File(['original'], 'photo.png', { type: 'image/png' })
    const optimized = new File(['small'], 'photo.webp', { type: 'image/webp' })
    const optimizeFiles = vi.fn(async () => [optimized])
    window.LingDrawImageUpload = { optimizeFiles }
    await expect(optimizeUserUploadFiles([original])).resolves.toEqual([optimized])
    expect(optimizeFiles).toHaveBeenCalledWith([original])
    optimizeFiles.mockRejectedValueOnce(new Error('decode failed'))
    await expect(optimizeUserUploadFiles([original])).resolves.toEqual([original])
    delete window.LingDrawImageUpload
  })

  it('keeps separate references for a new request and reuses the original set for retry', () => {
    const first = { url: '/first.png', name: 'first.png', role: 'reference', kind: 'image', mime: 'image/png' }
    const second = { url: '/second.png', name: 'second.png', role: 'reference', kind: 'image', mime: 'image/png' }
    const third = { url: '/third.png', name: 'third.png', role: 'reference', kind: 'image', mime: 'image/png' }
    expect(prepareAgentReferences({
      pendingReferences: [first, second],
      canvasReferences: [third],
      markerReferences: [first],
    })).toEqual([first, second, third])
    expect(prepareAgentReferences({
      previousReferences: [first, second],
      pendingReferences: [third],
      canvasReferences: [third],
    })).toEqual([first, second])
  })

  it('keeps an assistant failure explanation visible until a result image replaces it', () => {
    expect(timelineOwnsMessage('assistant_1', { messageId: 'assistant_1' })).toBe(false)
    expect(timelineOwnsMessage('assistant_1', { messageId: 'assistant_1', imageUrl: '/result.png' })).toBe(true)
    expect(timelineOwnsMessage('assistant_2', { messageId: 'assistant_1', imageUrl: '/result.png' })).toBe(false)
    expect(timelineOwnsMessage('module_1', {
      workflowModules: [{ messageId: 'module_1', imageUrl: '/module.png' }],
    })).toBe(true)
  })

  it('shows a dynamic module plan and requires explicit confirmation before generation', () => {
    const onConfirm = vi.fn()
    const onSelectionChange = vi.fn()
    const onAspectChange = vi.fn()
    const onCopyModeChange = vi.fn()
    const modules = ['首屏定位', '核心卖点', '使用场景', '规格收尾'].map((name, index) => ({
      id: `module-${index + 1}`,
      name,
      purpose: `${name}的设计目的`,
      content: `${name}的主要内容`,
      generation_prompt: `生成${name}`,
      estimated_generation_count: 1,
      estimated_points: 2,
      selected: index !== 3,
      status: 'pending' as const,
      attempt: 1,
    }))
    render(<AgentRunTimeline run={{
      id: 'workflow-run',
      phase: 'confirming',
      prompt: '制作商品详情页',
      skill: '商品详情页',
      model: 'gpt-image-2',
      startedAt: Date.now(),
      executionRoute: 'specialist_workflow',
      workflowPlan: {
        skill_slug: 'product-detail-page',
        workflow_version: 1,
        title: '商品详情页模块规划',
        summary: '根据商品内容动态拆分模块。',
        modules,
        estimated_generation_count: 4,
        estimated_points: 8,
      },
      workflowModules: modules,
    }} lang="zh" onFollowUp={vi.fn()} onRetry={vi.fn()} onWorkflowConfirm={onConfirm} onWorkflowSelectionChange={onSelectionChange} onWorkflowAspectChange={onAspectChange} onWorkflowCopyModeChange={onCopyModeChange} />)

    expect(screen.getByText('4 个模块')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1:1' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '3:4' }))
    expect(onAspectChange).toHaveBeenCalledWith('3:4')
    expect(screen.getByRole('button', { name: /有文案/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /无文案/ }))
    expect(onCopyModeChange).toHaveBeenCalledWith('without_copy')
    expect(screen.getByText(/已选 3\/4 个模块 · 预计 3 次生图 · 6 积分/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /4/ }))
    expect(onSelectionChange).toHaveBeenCalledWith('module-4', true)
    fireEvent.click(screen.getByRole('button', { name: /确认模块并生成/ }))
    expect(onConfirm).toHaveBeenCalledWith(['module-1', 'module-2', 'module-3'])
  })

  it('maps workflow aspect choices to explicit width and height requests', () => {
    expect(workflowImageSizeForAspect('1:1')).toBe('1440x1440')
    expect(workflowImageSizeForAspect('4:5')).toBe('1152x1440')
    expect(workflowImageSizeForAspect('9:16')).toBe('810x1440')
    expect(workflowImageSizeForAspect('16:9')).toBe('1440x810')
  })

  it('maps image composer ratios while preserving the existing automatic default', () => {
    expect(IMAGE_ASPECT_OPTIONS.map(option => option.value)).toEqual([
      'auto', '1:1', '4:5', '3:4', '2:3', '9:16', '5:4', '4:3', '3:2', '16:9',
    ])
    expect(imageComposerSizeForAspect('auto')).toBe('1024x1024')
    expect(imageComposerSizeForAspect('4:5')).toBe('1152x1440')
    expect(imageComposerSizeForAspect('16:9')).toBe('1440x810')
  })

  it('builds distinct workflow instructions for copy and copy-free versions', () => {
    expect(workflowCopyInstruction('with_copy')).toContain('不得继续输出空白无文案图片')
    expect(workflowCopyInstruction('with_copy')).toContain('确切主标题、副标题或卖点')
    expect(workflowCopyInstruction('without_copy')).toContain('画面不得添加主标题、副标题')
    expect(workflowCopyInstruction('without_copy')).toContain('包装上原本存在的商标和标签按参考图保留')
  })

  it('submits edited module content for Agent optimization before generation', () => {
    const onRevise = vi.fn()
    const module = {
      id: 'module-edit',
      name: '原模块',
      purpose: '原目的',
      content: '原内容',
      generation_prompt: '原始生图提示词需要保持产品与整套页面的视觉连续性。',
      estimated_generation_count: 1,
      estimated_points: 1,
      selected: true,
      status: 'pending' as const,
      attempt: 1,
    }
    render(<AgentRunTimeline run={{
      id: 'workflow-edit-run',
      phase: 'confirming',
      prompt: '制作商品详情页',
      skill: '商品详情页',
      model: 'gpt-image-2',
      startedAt: Date.now(),
      executionRoute: 'specialist_workflow',
      workflowPlan: {
        skill_slug: 'product-detail-page', workflow_version: 1, title: '模块规划', summary: '统一视觉体系。',
        modules: [module], estimated_generation_count: 1, estimated_points: 1,
      },
      workflowModules: [module],
    }} lang="zh" onFollowUp={vi.fn()} onRetry={vi.fn()} onWorkflowModuleRevise={onRevise} />)

    fireEvent.click(screen.getByRole('button', { name: '修改模块 1' }))
    fireEvent.change(screen.getByLabelText('模块名称'), { target: { value: '用户修改后的模块' } })
    fireEvent.change(screen.getByLabelText('模块目的'), { target: { value: '突出用户指定的新卖点' } })
    fireEvent.change(screen.getByLabelText('主要内容'), { target: { value: '使用用户新提交的叙事内容' } })
    fireEvent.change(screen.getByLabelText('生图要求'), { target: { value: '根据用户修改后的要求生成完整模块，同时保持产品身份和整套页面视觉连续。' } })
    fireEvent.click(screen.getByRole('button', { name: /提交并优化/ }))

    expect(onRevise).toHaveBeenCalledWith('module-edit', {
      name: '用户修改后的模块',
      purpose: '突出用户指定的新卖点',
      content: '使用用户新提交的叙事内容',
      generation_prompt: '根据用户修改后的要求生成完整模块，同时保持产品身份和整套页面视觉连续。',
    })
  })

  it('requires confirmation of the Agent optimized module before generation', () => {
    const onRevisionConfirm = vi.fn()
    const onWorkflowConfirm = vi.fn()
    const optimized = {
      id: 'module-revised',
      name: '轻量佩戴场景',
      purpose: '突出舒适佩戴',
      content: '展示真实运动佩戴场景，不添加未提供参数。',
      generation_prompt: '生成轻量佩戴场景模块，保持同一产品身份、蓝色科技视觉和完整中文安全区，不虚构参数。',
      estimated_generation_count: 1,
      estimated_points: 1,
    }
    const module = {
      ...optimized,
      name: '旧名称',
      selected: true,
      status: 'pending' as const,
      revision: {
        status: 'confirming' as const,
        attempt: 1,
        requestId: 'revision-request',
        submitted: {
          name: '用户名称', purpose: optimized.purpose, content: optimized.content,
          generation_prompt: optimized.generation_prompt,
        },
        optimized,
        summary: '保留用户意图并补足了产品一致性约束。',
        cautions: [],
      },
    }
    render(<AgentRunTimeline run={{
      id: 'workflow-revision-run', phase: 'confirming', prompt: '制作详情页', skill: '商品详情页',
      model: 'gpt-image-2', startedAt: Date.now(), executionRoute: 'specialist_workflow',
      workflowPlan: {
        skill_slug: 'product-detail-page', workflow_version: 1, title: '模块规划', summary: '统一视觉体系。',
        modules: [module], estimated_generation_count: 1, estimated_points: 1,
      },
      workflowModules: [module],
    }} lang="zh" onFollowUp={vi.fn()} onRetry={vi.fn()} onWorkflowConfirm={onWorkflowConfirm} onWorkflowModuleRevisionConfirm={onRevisionConfirm} />)

    expect(screen.getByText('Agent 优化结果')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /确认模块并生成/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /确认采用/ }))
    expect(onRevisionConfirm).toHaveBeenCalledWith('module-revised')
    expect(onWorkflowConfirm).not.toHaveBeenCalled()
  })

  it('allows stopping later workflow modules while the current module finishes', () => {
    const onPause = vi.fn()
    const modules = ['running', 'pending'].map((status, index) => ({
      id: `module-${index + 1}`,
      name: `模块 ${index + 1}`,
      purpose: '目的',
      content: '内容',
      generation_prompt: '完整提示词需要保持产品身份和整套页面视觉连续性。',
      estimated_generation_count: 1,
      estimated_points: 1,
      selected: true,
      status: status as 'running' | 'pending',
    }))
    render(<AgentRunTimeline run={{
      id: 'workflow-running', phase: 'generating', prompt: '制作详情页', skill: '商品详情页',
      model: 'gpt-image-2', startedAt: Date.now(), executionRoute: 'specialist_workflow',
      workflowPlan: {
        skill_slug: 'product-detail-page', workflow_version: 1, title: '模块规划', summary: '统一视觉体系。',
        modules, estimated_generation_count: 2, estimated_points: 2,
      },
      workflowModules: modules,
    }} lang="zh" onFollowUp={vi.fn()} onRetry={vi.fn()} onWorkflowPause={onPause} busy />)

    fireEvent.click(screen.getByRole('button', { name: /停止后续并修改/ }))
    expect(onPause).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /正在停止后续/ })).toBeDisabled()
  })

  it('requires confirmation of a generated product identity anchor before module generation', () => {
    const onIdentityConfirm = vi.fn()
    const onIdentityRetry = vi.fn()
    const module = {
      id: 'module-1',
      name: '首屏定位',
      purpose: '锁定产品主体',
      content: '展示产品与核心卖点',
      generation_prompt: '生成首屏',
      estimated_generation_count: 1,
      estimated_points: 1,
      selected: true,
      status: 'pending' as const,
      attempt: 1,
    }
    const run: AgentRunView = {
      id: 'workflow-anchor-run',
      phase: 'confirming_identity',
      prompt: '制作耳机商品详情页',
      skill: '商品详情页',
      model: 'gpt-image-2',
      startedAt: Date.now(),
      executionRoute: 'specialist_workflow',
      workflowPlan: {
        skill_slug: 'product-detail-page',
        workflow_version: 1,
        title: '商品详情页模块规划',
        summary: '保持同一款产品的连续叙事。',
        modules: [module],
        estimated_generation_count: 1,
        estimated_points: 1,
      },
      workflowModules: [module],
      identityAnchor: {
        status: 'confirming',
        attempt: 1,
        imageUrl: '/product-master.png',
        imageName: '产品身份母图',
      },
    }

    expect(workflowNeedsIdentityAnchor({ ...run, phase: 'confirming', identityAnchor: { status: 'required' } })).toBe(true)
    expect(workflowIdentityReferences({ ...run, identityAnchor: { ...run.identityAnchor!, status: 'confirmed' } })[0]).toMatchObject({
      url: '/product-master.png',
      role: 'product_identity',
    })

    render(<AgentRunTimeline
      run={run}
      lang="zh"
      onFollowUp={vi.fn()}
      onRetry={vi.fn()}
      onWorkflowIdentityConfirm={onIdentityConfirm}
      onWorkflowIdentityRetry={onIdentityRetry}
    />)
    expect(screen.getByRole('img', { name: '产品身份母图' })).toHaveAttribute('src', '/product-master.png')
    fireEvent.click(screen.getByRole('button', { name: /确认母图并生成模块/ }))
    expect(onIdentityConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /重新生成母图/ }))
    expect(onIdentityRetry).toHaveBeenCalledTimes(1)
  })

  it('retries only the failed modules selected by the user', () => {
    const modules = ['completed', 'review_failed', 'pending', 'pending'].map((status, index) => ({
      id: `module-${index + 1}`,
      name: `模块 ${index + 1}`,
      purpose: '目的',
      content: '内容',
      generation_prompt: '提示词',
      estimated_generation_count: 1,
      estimated_points: 1,
      selected: true,
      status: status as 'completed' | 'review_failed' | 'pending',
    }))
    expect(workflowModuleExecutionIds(modules, ['module-2'], 'retry')).toEqual(['module-2'])
    expect(workflowModuleExecutionIds(modules, ['module-1', 'module-2'], 'review')).toEqual(['module-1', 'module-2'])
  })

  it('allows completed historical results to be reviewed again without regenerating images', () => {
    const onWorkflowReview = vi.fn()
    const modules = ['首屏', '场景屏'].map((name, index) => ({
      id: `module-${index + 1}`,
      name,
      purpose: '目的',
      content: '内容',
      generation_prompt: '提示词',
      estimated_generation_count: 1,
      estimated_points: 1,
      selected: true,
      status: 'completed' as const,
      imageUrl: `/result-${index + 1}.png`,
      imageName: `${name}结果`,
    }))
    const run: AgentRunView = {
      id: 'workflow-history', phase: 'completed', prompt: '制作详情页', skill: '商品详情页',
      model: 'gpt-image-2', startedAt: Date.now(), executionRoute: 'specialist_workflow',
      workflowPlan: {
        skill_slug: 'product-detail-page', workflow_version: 1, title: '模块规划', summary: '统一视觉体系。',
        modules, estimated_generation_count: 2, estimated_points: 2,
      },
      workflowModules: modules,
    }

    render(<AgentRunTimeline run={run} lang="zh" onFollowUp={vi.fn()} onRetry={vi.fn()} onWorkflowReview={onWorkflowReview} />)

    fireEvent.click(screen.getByRole('button', { name: /重新统一复核/ }))
    expect(onWorkflowReview).toHaveBeenCalledTimes(1)
  })

  it('shows the unified review summary and asks before regenerating failed modules', () => {
    const onRetry = vi.fn()
    const onAccept = vi.fn()
    const modules = ['completed', 'review_failed'].map((status, index) => ({
      id: `module-${index + 1}`,
      name: `模块 ${index + 1}`,
      purpose: '目的',
      content: '内容',
      generation_prompt: '提示词',
      estimated_generation_count: 1,
      estimated_points: 1,
      selected: true,
      status: status as 'completed' | 'review_failed',
      review: status === 'review_failed' ? {
        title: '文案缺失', summary: '缺少已批准主标题', overall_score: 60, passed: false,
        highlights: [], checks: [], reference_checks: [], conclusion: '建议重新生成', suggestions: [],
      } : undefined,
    }))
    const run: AgentRunView = {
      id: 'workflow-reviewed', phase: 'completed', prompt: '制作详情页', skill: '商品详情页',
      model: 'gpt-image-2', startedAt: Date.now(), executionRoute: 'specialist_workflow',
      workflowReviewDecision: 'pending',
      workflowPlan: {
        skill_slug: 'product-detail-page', workflow_version: 1, title: '模块规划', summary: '统一视觉体系。',
        modules, estimated_generation_count: 2, estimated_points: 2,
      },
      workflowModules: modules,
    }
    const { rerender } = render(<AgentRunTimeline run={run} lang="zh" onFollowUp={vi.fn()} onRetry={vi.fn()} onWorkflowRetry={onRetry} onWorkflowReviewAccept={onAccept} />)

    expect(screen.getByText(/统一复核完成 · 1 个通过 · 1 个未通过/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新生成未通过模块/ }))
    expect(onRetry).toHaveBeenCalledWith(['module-2'])
    fireEvent.click(screen.getByRole('button', { name: /保留当前结果/ }))
    expect(onAccept).toHaveBeenCalledTimes(1)

    rerender(<AgentRunTimeline run={{ ...run, workflowReviewDecision: 'accepted' }} lang="zh" onFollowUp={vi.fn()} onRetry={vi.fn()} onWorkflowRetry={onRetry} onWorkflowReviewAccept={onAccept} />)
    expect(screen.getByText('已选择保留当前结果')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重新生成未通过模块/ })).not.toBeInTheDocument()
  })

  it('provides every sibling result to the unified cross-module review', () => {
    const modules = ['第一屏', '卖点屏', '场景屏'].map((name, index) => ({
      id: `module-${index + 1}`,
      name,
      purpose: '目的',
      content: '内容',
      generation_prompt: '提示词',
      estimated_generation_count: 1,
      estimated_points: 1,
      selected: true,
      status: 'reviewing' as const,
      imageUrl: index === 2 ? undefined : `/result-${index + 1}.png`,
      imageName: `${name}结果`,
    }))

    expect(workflowReviewReferenceImages(modules, 'module-2')).toEqual([
      { url: '/result-1.png', name: '第一屏结果' },
    ])
    expect(workflowReviewReferenceImages(modules, 'module-1')).toEqual([
      { url: '/result-2.png', name: '卖点屏结果' },
    ])
  })

  it('recovers the same request without duplicating its user bubble', () => {
    const messages: ChatMessage[] = [
      { id: 'user_1', role: 'user', content: '端午海报', request_id: 'run_1' },
      { id: 'error_1', role: 'assistant', type: 'error', content: '连接中断', request_id: 'run_1' },
      { id: 'user_2', role: 'user', content: '保留的另一条消息', request_id: 'run_2' },
    ]
    const next = mergeAgentAttemptMessages(messages, {
      id: 'user_retry', role: 'user', content: '端午海报', request_id: 'run_1',
    }, true)

    expect(next.filter(item => item.role === 'user' && item.request_id === 'run_1')).toHaveLength(1)
    expect(next.some(item => item.id === 'error_1')).toBe(false)
    expect(next.some(item => item.id === 'user_2')).toBe(true)
  })

  it('shows only the active successful attempt after retry', () => {
    const timestamp = Date.now()
    const failedRun: AgentRunView = {
      id: 'attempt-failed',
      phase: 'failed',
      prompt: '节气海报手机尺寸',
      skill: 'Design Agent',
      model: 'gemini-3-flash-preview',
      startedAt: timestamp,
      failedStage: 'analyzing',
      error: '请求过于频繁，已被上游限流，请稍后再试。',
    }
    const succeededRun: AgentRunView = {
      ...failedRun,
      id: 'attempt-success',
      phase: 'completed',
      failedStage: undefined,
      error: undefined,
      imageUrl: '/result.png',
    }
    const visible = visibleAttemptsForTurn({
      id: 'turn-1',
      sequence: 1,
      user_message: { id: 'user-1', role: 'user', content: '节气海报手机尺寸' },
      references: [],
      attempts: [{
        id: failedRun.id,
        request_id: failedRun.id,
        status: 'failed',
        run: failedRun,
        assistant_messages: [{
          id: 'error-1',
          role: 'assistant',
          type: 'error',
          content: failedRun.error || '',
        }],
        created_at: timestamp,
        updated_at: timestamp,
      }, {
        id: succeededRun.id,
        request_id: succeededRun.id,
        status: 'succeeded',
        run: succeededRun,
        assistant_messages: [],
        created_at: timestamp + 1,
        updated_at: timestamp + 1,
      }],
      active_attempt_id: succeededRun.id,
      created_at: timestamp,
      updated_at: timestamp + 1,
    })

    expect(visible.map(attempt => attempt.id)).toEqual(['attempt-success'])
    expect(visible.some(attempt => attempt.run?.error)).toBe(false)
  })

  it('keeps the current failure visible and falls back to the latest attempt', () => {
    const timestamp = Date.now()
    const failedRun: AgentRunView = {
      id: 'attempt-failed',
      phase: 'failed',
      prompt: '节气海报手机尺寸',
      skill: 'Design Agent',
      model: 'gemini-3-flash-preview',
      startedAt: timestamp,
      failedStage: 'analyzing',
      error: '暂时失败',
    }
    const visible = visibleAttemptsForTurn({
      id: 'turn-1',
      sequence: 1,
      user_message: { id: 'user-1', role: 'user', content: '节气海报手机尺寸' },
      references: [],
      attempts: [{
        id: failedRun.id,
        request_id: failedRun.id,
        status: 'failed',
        run: failedRun,
        assistant_messages: [],
        created_at: timestamp,
        updated_at: timestamp,
      }],
      active_attempt_id: 'missing-attempt',
      created_at: timestamp,
      updated_at: timestamp,
    })

    expect(visible.map(attempt => attempt.id)).toEqual(['attempt-failed'])
  })

  it('queries the durable request result instead of resubmitting generation', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _options?: RequestInit) => jsonResponse({
      status: 'succeeded',
      request_id: 'run/safe',
      conversation: { id: 'chat_1' },
      message: { id: 'assistant_1', role: 'assistant', content: '', image_url: '/result.png' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const recovered = await pollAgentRequest('run/safe', 1, 0)

    expect(recovered?.status).toBe('succeeded')
    expect(recovered?.message?.image_url).toBe('/result.png')
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/agent/requests/run%2Fsafe', expect.objectContaining({ credentials: 'same-origin' }))
    expect(fetchMock.mock.calls.some(([input, options]) => String(input).endsWith('/api/chat/agent') && options?.method === 'POST')).toBe(false)
  })

  it('keeps a known upstream task recoverable when the polling window is exhausted', async () => {
    const fetchMock = vi.fn(() => jsonResponse({
      status: 'running',
      request_id: 'run-long',
      conversation: { id: 'chat-long' },
      message: null,
      upstream_task_id: 'task-long-1',
    }))
    vi.stubGlobal('fetch', fetchMock)

    const recovered = await pollAgentRequest('run-long', 1, 0)

    expect(recovered).toMatchObject({ status: 'running', upstream_task_id: 'task-long-1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('scopes durable Agent polling to the active design canvas', async () => {
    const fetchMock = vi.fn(() => jsonResponse({
      status: 'succeeded',
      request_id: 'run-scoped',
      conversation: { id: 'chat-scoped' },
      message: { id: 'assistant-scoped', role: 'assistant', content: '完成' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await pollAgentRequest(
      'run-scoped',
      1,
      0,
      () => true,
      { surface: 'design_agent', contextId: 'canvas-a' },
    )

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/agent/requests/run-scoped?surface=design_agent&context_id=canvas-a',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('waits for an in-flight Workbench request and then replays its durable result', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => jsonResponse({ detail: { code: 'workbench_request_in_progress', message: 'running' } }, 409))
      .mockImplementationOnce(() => jsonResponse({ analysis: { status: 'ready', route: 'direct_generate' }, model: 'test-model' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await replayableWorkbenchRequest<{ analysis: { status: string }; model: string }>(
      '/api/agent/workbench/plan', { request_id: 'run-1' }, () => true, 2, 0,
    )

    expect(result.analysis.status).toBe('ready')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('selects and reveals newly placed results without zooming the whole canvas', () => {
    const mountedEditor = {
      select: vi.fn(),
      zoomToSelectionIfOffscreen: vi.fn(),
    }

    focusPlacedResults(mountedEditor as never, ['shape:result_1' as never])

    expect(mountedEditor.select).toHaveBeenCalledWith('shape:result_1')
    expect(mountedEditor.zoomToSelectionIfOffscreen).toHaveBeenCalledWith(72, expect.objectContaining({ inset: 96 }))
  })

  it('keeps a generated image visible when quality review is unavailable', () => {
    const run: AgentRunView = {
      id: 'run_1',
      phase: 'completed',
      prompt: '端午海报',
      skill: 'Design Agent',
      model: 'gpt-image-2',
      startedAt: Date.now(),
      imageUrl: '/result.png',
      imageName: '端午海报',
      reviewWarning: '质量服务暂时断开',
    }

    render(<AgentRunTimeline run={run} lang="zh" onFollowUp={vi.fn()} onRetry={vi.fn()} />)

    expect(screen.getByRole('img', { name: '端午海报' })).toHaveAttribute('src', '/result.png')
    expect(screen.getByText('图片已生成，复核暂不可用')).toBeInTheDocument()
    expect(screen.getByText('质量服务暂时断开')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重试本次设计/ })).not.toBeInTheDocument()
    expect(shouldResumeLegacyReview(run)).toBe(true)
  })

  it('regenerates a failed review once with a stable child request and complete repair brief', () => {
    const review = {
      title: '仍需修正',
      summary: '参考商品缺失。',
      overall_score: 58,
      passed: false,
      highlights: [],
      checks: [{ label: '商品完整性', passed: false, score: 30, detail: '缺少右侧小盒。' }],
      reference_checks: [{ reference_index: 2, verdict: 'missing' as const, evidence: '画面中无法定位参考图2。' }],
      conclusion: '当前版本不可交付。',
      suggestions: [{ label: '补齐商品', instruction: '加入参考图2的小盒并保持品牌标识。' }],
    }

    expect(shouldAutoRegenerateReview(review, 0)).toBe(true)
    expect(shouldAutoRegenerateReview(review, 1)).toBe(false)
    expect(automaticRegenerationRequestId('run-stable', 1)).toBe('run-stable-regenerate-1')
    expect(automaticRegenerationPrompt('制作商品全家福', review, 2)).toContain('参考图2：画面中无法定位参考图2')
    expect(automaticRegenerationPrompt('制作商品全家福', review, 2)).toContain('覆盖全部 2 张原始参考图')
  })

  it('shows that review-driven regeneration will continue into another review', () => {
    render(<AgentRunTimeline run={{
      id: 'run-auto-fix',
      phase: 'generating',
      prompt: '商品全家福',
      skill: 'Design Agent',
      model: 'gpt-image-2',
      startedAt: Date.now(),
      regenerationCount: 1,
      generationRequestId: 'run-auto-fix-regenerate-1',
    }} lang="zh" onFollowUp={vi.fn()} onRetry={vi.fn()} />)

    expect(screen.getByText('复核未通过，正在自动重新生成')).toBeInTheDocument()
    expect(screen.getByText('正在按复核意见修正上一版；完成后会自动继续复核。')).toBeInTheDocument()
  })

  it('offers a no-generation review retry when the image exists but review failed', () => {
    render(<AgentRunTimeline run={{
      id: 'run-review-failed',
      phase: 'failed',
      prompt: '商品全家福',
      skill: 'Design Agent',
      model: 'gpt-image-2',
      startedAt: Date.now(),
      imageUrl: '/existing-result.png',
      failedStage: 'reviewing',
      error: '复核服务暂时不可用',
    }} lang="zh" onFollowUp={vi.fn()} onRetry={vi.fn()} />)

    expect(screen.getByRole('button', { name: /重新复核/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^重新生成$/ })).not.toBeInTheDocument()
  })

  it('renders model-generated clarification choices and submits the selected route inputs', () => {
    const clarification = {
      id: 'festival-direction',
      introduction: '发布场景会改变版式和视觉重心，请先选一个方向。',
      questions: [{
        id: 'art-direction',
        question: '你希望采用哪种端午视觉语言？',
        description: '选项来自本次需求分析。',
        selection: 'single' as const,
        required: true,
        recommended_option_id: 'paper-cut',
        options: [
          { id: 'paper-cut', label: '先锋剪纸', description: '几何剪纸与高对比节奏' },
          { id: 'ink-photo', label: '水墨摄影', description: '真实产品结合水墨留白' },
        ],
      }],
    }
    const onSubmit = vi.fn()
    const onChange = vi.fn()

    render(<ClarificationCard clarification={clarification} initialAnswers={{}} busy={false} onChange={onChange} onSubmit={onSubmit} />)

    expect(screen.getByText('先锋剪纸')).toBeInTheDocument()
    expect(screen.getByText('水墨摄影')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /确认并继续/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /水墨摄影/ }))
    expect(onChange).toHaveBeenLastCalledWith({ 'art-direction': ['ink-photo'] })
    expect(screen.getByRole('button', { name: /水墨摄影/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /确认并继续/ })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /确认并继续/ }))
    expect(onSubmit).toHaveBeenCalledWith({ 'art-direction': ['ink-photo'] }, false)
    expect(clarificationAnswersComplete(clarification, { 'art-direction': ['ink-photo'] })).toBe(true)
  })

  it('lets the user delegate missing choices back to the Agent without selecting fixed defaults', () => {
    const onSubmit = vi.fn()
    render(<ClarificationCard clarification={{
      id: 'delivery',
      introduction: '需要确认交付方向。',
      questions: [{
        id: 'format', question: '选择画幅', description: '', selection: 'single', required: true,
        recommended_option_id: '',
        options: [
          { id: 'portrait', label: '竖版发布', description: '' },
          { id: 'square', label: '方形发布', description: '' },
        ],
      }],
    }} initialAnswers={{}} busy={false} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: /交给 Agent 判断/ }))
    expect(onSubmit).toHaveBeenCalledWith({}, true)
  })

  it('requires an explicit new paid task confirmation for an ambiguous generator result', () => {
    expect(generatorOutcomeIsUnknown('failed', '连接中断', JSON.stringify({ upstreamOutcome: 'unknown' }))).toBe(true)
    expect(generatorOutcomeIsUnknown('failed', '参数不合法', JSON.stringify({ upstreamOutcome: 'failed' }))).toBe(false)
  })

  it('appends completed-run suggestions to one draft without sending or charging', async () => {
    window.history.replaceState({}, '', '/?qa_state=completed')
    const fetchMock = vi.mocked(fetch)
    render(<App />)
    const textarea = await screen.findByPlaceholderText('从一个想法开始，输入 @ 可引用…')
    fireEvent.change(textarea, { target: { value: '保留包装主体' } })
    fireEvent.click(await screen.findByRole('button', { name: /增加标题留白/ }))
    fireEvent.click(screen.getByRole('button', { name: /生成竖版延展/ }))

    expect(textarea).toHaveValue([
      '保留包装主体',
      '将标题区域向下移动并增加顶部留白，保持礼盒和粽子主体不变。',
      '基于当前图片生成 4:5 竖版延展，保持品牌配色和主体层级。',
    ].join('\n'))
    expect(screen.getByRole('button', { name: /^Agent$/ })).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([input, options]) => String(input).endsWith('/api/chat/agent') && options?.method === 'POST')).toHaveLength(0)
    expect(screen.getByText('88')).toBeInTheDocument()
  })

  it('shows only an honest analysis state before the backend plan returns', async () => {
    window.history.replaceState({}, '', '/?qa_state=analyzing')
    render(<App />)
    expect(await screen.findByText('正在分析需求')).toBeInTheDocument()
    expect(screen.getByText(/结合 Brief、Skill、品牌资料与参考素材/)).toBeInTheDocument()
    expect(screen.queryByText('端午礼盒社媒视觉方案（测试夹具）')).not.toBeInTheDocument()
    expect(screen.queryByText('测试定位')).not.toBeInTheDocument()
  })

  it('renders the backend plan verbatim before image generation', async () => {
    window.history.replaceState({}, '', '/?qa_state=generating')
    render(<App />)
    expect(await screen.findByText('技能编排')).toBeInTheDocument()
    expect(screen.getByText('端午礼盒社媒视觉方案（测试夹具）')).toBeInTheDocument()
    expect(screen.getByText('测试定位')).toBeInTheDocument()
    expect(screen.getByText('面向节日送礼场景突出礼盒质感。')).toBeInTheDocument()
    expect(screen.getByText('正在生成画布成果')).toBeInTheDocument()
    expect(screen.queryByText('品牌美学呈现')).not.toBeInTheDocument()
  })

  it('renders the actual review, failed checks and dynamic suggestions', async () => {
    window.history.replaceState({}, '', '/?qa_state=completed')
    render(<App />)
    expect(await screen.findByText('测试成图复盘')).toBeInTheDocument()
    expect(screen.getByText('礼盒主体清楚，标题区域仍有优化空间。')).toBeInTheDocument()
    expect(screen.getByText('标题安全区').closest('li')).toHaveClass('failed')
    expect(screen.getByText('68')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /增加标题留白/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /生成竖版延展/ })).toBeInTheDocument()
  })

  it('migrates legacy messages into stable turns grouped by request id', () => {
    const migrated = migrateAgentSessionV2({
      schema_version: 1,
      conversation_id: 'legacy-conversation',
      updated_at: 40,
      messages: [
        { id: 'u1', role: 'user', content: '做一张端午海报', request_id: 'req-1' },
        { id: 'a1', role: 'assistant', content: '更偏现代还是传统？', request_id: 'req-1' },
        { id: 'u2', role: 'user', content: '现代简约', request_id: 'req-1' },
        { id: 'u3', role: 'user', content: '把文字移入安全区', request_id: 'req-2' },
      ],
      run: null,
      composer: { prompt: '草稿', mode: 'agent', active_skill: '' },
    })

    expect(migrated.schema_version).toBe(2)
    expect(migrated.turns).toHaveLength(2)
    expect(migrated.turns[0].user_message.content).toBe('做一张端午海报')
    expect(migrated.turns[0].attempts[0].assistant_messages.map(message => message.content)).toEqual([
      '更偏现代还是传统？',
      '现代简约',
    ])
    expect(migrated.turns[1].sequence).toBe(2)
    expect(migrated.next_sequence).toBe(3)
  })

  it('merges concurrent canvas drafts by turn and attempt instead of replacing the session', () => {
    const baseTurn = {
      id: 'turn-1',
      sequence: 1,
      user_message: { id: 'u1', role: 'user' as const, content: '首轮', request_id: 'req-1' },
      references: [],
      attempts: [{
        id: 'attempt-1',
        request_id: 'req-1',
        status: 'succeeded' as const,
        run: null,
        assistant_messages: [{ id: 'a1', role: 'assistant' as const, content: '首轮完成' }],
        created_at: 1,
        updated_at: 2,
      }],
      active_attempt_id: 'attempt-1',
      created_at: 1,
      updated_at: 2,
    }
    const server: AgentSessionV2 = {
      schema_version: 2,
      session_id: 'session-1',
      conversation_id: 'conversation-1',
      active_turn_id: 'turn-1',
      next_sequence: 2,
      turns: [baseTurn],
      composer: { prompt: '', mode: 'agent', active_skill: '' },
      updated_at: 2,
    }
    const local: AgentSessionV2 = {
      ...server,
      active_turn_id: 'turn-2',
      next_sequence: 3,
      turns: [
        baseTurn,
        {
          ...baseTurn,
          id: 'turn-2',
          sequence: 2,
          user_message: { id: 'u2', role: 'user', content: '第二轮', request_id: 'req-2' },
          attempts: [{
            ...baseTurn.attempts[0],
            id: 'attempt-2',
            request_id: 'req-2',
            assistant_messages: [],
            updated_at: 3,
          }],
          active_attempt_id: 'attempt-2',
          created_at: 3,
          updated_at: 3,
        },
      ],
      updated_at: 3,
    }

    const merged = mergeAgentSessionsByTurnId(server, local)
    expect(merged.turns.map(turn => turn.id)).toEqual(['turn-1', 'turn-2'])
    expect(merged.turns[0].attempts[0].assistant_messages[0].content).toBe('首轮完成')
    expect(merged.active_turn_id).toBe('turn-2')
    expect(merged.next_sequence).toBe(3)
  })

  it('does not restore a cleared failure message when a recovered attempt succeeds', () => {
    const failedRun: AgentRunView = {
      id: 'attempt-1',
      phase: 'failed',
      prompt: '节气海报',
      skill: 'Design Agent',
      model: 'gemini-3-flash-preview',
      startedAt: 1,
      failedStage: 'analyzing',
      error: '请求过于频繁',
    }
    const succeededRun: AgentRunView = {
      ...failedRun,
      phase: 'completed',
      failedStage: undefined,
      error: undefined,
      imageUrl: '/result.png',
    }
    const failedTurn = {
      id: 'turn-1',
      sequence: 1,
      user_message: { id: 'u1', role: 'user' as const, content: '节气海报', request_id: 'attempt-1' },
      references: [],
      attempts: [{
        id: 'attempt-1',
        request_id: 'attempt-1',
        status: 'failed' as const,
        run: failedRun,
        assistant_messages: [{
          id: 'error-1',
          role: 'assistant' as const,
          type: 'error',
          content: '请求过于频繁',
        }],
        created_at: 1,
        updated_at: 2,
      }],
      active_attempt_id: 'attempt-1',
      created_at: 1,
      updated_at: 2,
    }
    const server: AgentSessionV2 = {
      schema_version: 2,
      session_id: 'session-1',
      conversation_id: 'conversation-1',
      active_turn_id: 'turn-1',
      next_sequence: 2,
      turns: [failedTurn],
      composer: { prompt: '', mode: 'agent', active_skill: '' },
      updated_at: 2,
    }
    const local: AgentSessionV2 = {
      ...server,
      turns: [{
        ...failedTurn,
        attempts: [{
          ...failedTurn.attempts[0],
          status: 'succeeded',
          run: succeededRun,
          assistant_messages: [],
          updated_at: 3,
        }],
        updated_at: 3,
      }],
      updated_at: 3,
    }

    const merged = mergeAgentSessionsByTurnId(server, local)
    expect(merged.turns[0].attempts[0].status).toBe('succeeded')
    expect(merged.turns[0].attempts[0].assistant_messages).toEqual([])
    expect(merged.turns[0].attempts[0].run?.error).toBeUndefined()
  })

  it('keeps prior-turn model context inside the current New Chat boundary', () => {
    const makeTurn = (sequence: number) => ({
      id: `turn-${sequence}`,
      sequence,
      user_message: {
        id: `user-${sequence}`,
        role: 'user' as const,
        content: `第 ${sequence} 轮`,
        request_id: `request-${sequence}`,
      },
      references: [],
      attempts: [],
      active_attempt_id: '',
      created_at: sequence,
      updated_at: sequence,
    })
    const session: AgentSessionV2 = {
      schema_version: 2,
      session_id: 'session-thread-boundary',
      conversation_id: '',
      active_turn_id: 'turn-3',
      next_sequence: 4,
      turns: [makeTurn(1), makeTurn(2), makeTurn(3)],
      composer: {
        prompt: '',
        mode: 'agent',
        active_skill: '',
        thread_start_sequence: 3,
      },
      updated_at: 3,
    }

    expect(summarizePriorTurns(session).map(item => item.turn_id)).toEqual(['turn-3'])
    expect(summarizePriorTurns({
      ...session,
      composer: { ...session.composer, mode_hint: 'new_session' },
    })).toEqual([])
  })
})

describe('marker preview geometry', () => {
  it('keeps a centered coordinate at the center of the crop', () => {
    const geometry = markerPreviewGeometry(100, 100, .5, .5, 100, 100, 2)
    expect(geometry.pinLeft).toBe(50)
    expect(geometry.pinTop).toBe(50)
    expect(geometry.imageLeft).toBe(-50)
    expect(geometry.imageTop).toBe(-50)
  })

  it('preserves the real coordinate when the crop is clamped at an image edge', () => {
    const geometry = markerPreviewGeometry(100, 100, .95, .9, 100, 100, 2)
    expect(geometry.pinLeft).toBe(90)
    expect(geometry.pinTop).toBe(80)
    expect(geometry.imageLeft).toBe(-100)
    expect(geometry.imageTop).toBe(-100)
  })
})
