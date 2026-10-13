(function(){
    'use strict';

    const core = window.LingDrawAgentWorkbench;
    const panel = document.getElementById('smartAgentPanel');
    const messagesEl = document.getElementById('smartAgentMessages');
    const referencesEl = document.getElementById('smartAgentReferences');
    const inputEl = document.getElementById('smartAgentInput');
    const sendBtn = document.getElementById('smartAgentSendBtn');
    const newBtn = document.getElementById('smartAgentNewBtn');
    const collapseBtn = document.getElementById('smartAgentCollapseBtn');
    const reopenBtn = document.getElementById('smartAgentReopenBtn');
    const unreadBtn = document.getElementById('smartAgentUnreadBtn');
    const titleEl = document.getElementById('smartAgentTitle');
    const hintEl = document.getElementById('smartAgentHint');
    const imageInputEl = document.getElementById('smartAgentImageInput');
    const imageBtn = document.getElementById('smartAgentImageBtn');
    const promptBtn = document.getElementById('smartAgentPromptBtn');
    const promptPreviewEl = document.getElementById('smartAgentPromptPreview');
    const promptCloseBtn = document.getElementById('smartAgentPromptClose');
    const promptListEl = document.getElementById('smartAgentPromptList');
    const modePickerEl = document.getElementById('smartAgentModePicker');
    const modeLabelEl = document.getElementById('smartAgentModeLabel');
    const imageModelPickerEl = document.getElementById('smartAgentImageModelPicker');
    const imageModelBtn = document.getElementById('smartAgentImageModelBtn');
    const imageModelValueEl = document.getElementById('smartAgentImageModelValue');
    const imageModelMenuEl = document.getElementById('smartAgentImageModelMenu');
    const sizePickerEl = document.getElementById('smartAgentSizePicker');
    const sizeBtn = document.getElementById('smartAgentSizeBtn');
    const sizeValueEl = document.getElementById('smartAgentSizeValue');
    const sizePopoverEl = document.getElementById('smartAgentSizePopover');
    const customWidthEl = document.getElementById('smartAgentCustomWidth');
    const customHeightEl = document.getElementById('smartAgentCustomHeight');
    const customApplyBtn = document.getElementById('smartAgentCustomApply');
    const customHintEl = document.getElementById('smartAgentCustomHint');
    if(!core || !panel || !messagesEl || !inputEl || !sendBtn) return;

    const state = {
        canvasId:'', canvasTitle:'智能画布', references:[], canvasReferences:[], uploadedReferences:[], selectedAssets:[], promptAssets:[],
        session:core.freshSession(), sessionVersion:0, route:null, providerCatalog:null, loading:false,
        saveTimer:0, saveStopped:'', saveToken:0, nearBottom:true, transient:'',
        promptOpen:false, promptTemplates:[], promptLoading:false, promptError:'',
        imageModelOpen:false, imageModelLoading:false, imageModelError:'',
        sizeOpen:false, uploading:false
    };

    const escapeHtml = value => String(value == null ? '' : value)
        .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
        .replaceAll('"','&quot;').replaceAll("'",'&#39;');

    function localKey(){ return `lingdraw:smart-agent:v2:${state.canvasId}`; }
    function touch(item){ item.updated_at = core.now(); state.session.updated_at = item.updated_at; }
    function getTurn(id){ return state.session.turns.find(turn => turn.id === id); }
    function getAttempt(turnId, attemptId){ return getTurn(turnId)?.attempts.find(attempt => attempt.id === attemptId); }
    function activeRun(turn){ return core.activeAttempt(turn)?.run || {}; }
    function imageUrls(message){ return core.imageUrls(message); }
    function mediaUrls(message){ return core.mediaUrls ? core.mediaUrls(message) : imageUrls(message); }

    function rememberLocal(){
        if(!state.canvasId) return;
        try { localStorage.setItem(localKey(), JSON.stringify(state.session)); }
        catch(_error){ /* server persistence remains authoritative */ }
    }

    function markChanged(options={}){
        state.session.updated_at = core.now();
        rememberLocal();
        if(options.persist !== false) queueSave();
        if(options.render !== false) render();
    }

    function queueSave(){
        if(!state.canvasId || state.saveStopped || state.loading) return;
        window.clearTimeout(state.saveTimer);
        state.saveTimer = window.setTimeout(saveSession, 800);
    }

    async function saveSession(){
        if(!state.canvasId || state.saveStopped || state.loading) return;
        const canvasId = state.canvasId;
        const token = ++state.saveToken;
        try {
            const result = await core.api(`/api/canvases/${encodeURIComponent(canvasId)}/agent-session`, {
                method:'PUT',
                body:JSON.stringify({
                    agent_session:state.session,
                    client_id:state.session.session_id,
                    base_updated_at:state.sessionVersion
                })
            });
            if(canvasId !== state.canvasId || token !== state.saveToken) return;
            // A save may finish after the active turn has already advanced from
            // analysis to generation/review.  Never replace that newer in-memory
            // state with the older snapshot echoed by the server.
            state.session = core.mergeSessions(result.agent_session, state.session, canvasId);
            state.sessionVersion = Number(result.updated_at || state.sessionVersion || 0);
            if(state.transient.startsWith('会话保存失败')) state.transient = '';
            rememberLocal();
            render();
        } catch(error){
            if(canvasId !== state.canvasId) return;
            if(error.status === 409){
                const latest = error.payload?.detail?.agent_session || error.payload?.agent_session;
                const latestVersion = Number(error.payload?.detail?.updated_at || error.payload?.updated_at || 0);
                state.session = core.mergeSessions(latest, state.session, canvasId);
                state.sessionVersion = latestVersion;
                rememberLocal();
                queueSave();
                return;
            }
            if(error.status === 401){ state.saveStopped = 'auth'; state.transient = '登录状态已失效，已停止保存。请重新登录后继续。'; }
            else if(error.status === 404){ state.saveStopped = 'missing'; state.transient = '当前画布已删除，已停止保存，避免继续发送无效请求。'; }
            else { state.transient = `会话保存失败：${error.message}`; queueSave(); }
            render();
        }
    }

    async function loadSession(){
        if(!state.canvasId) return;
        const canvasId = state.canvasId;
        state.loading = true;
        state.saveStopped = '';
        state.transient = '';
        let local = null;
        try { local = JSON.parse(localStorage.getItem(localKey()) || 'null'); }
        catch(_error){ local = null; }
        state.session = core.normalizeSession(local, canvasId);
        if(state.session.composer?.draft) inputEl.value = state.session.composer.draft;
        render();
        try {
            const result = await core.api(`/api/canvases/${encodeURIComponent(canvasId)}/agent-session`);
            if(canvasId !== state.canvasId) return;
            state.session = core.mergeSessions(result.agent_session, state.session, canvasId);
            state.sessionVersion = Number(result.updated_at || 0);
            if(document.activeElement !== inputEl && state.session.composer?.draft){
                inputEl.value = state.session.composer.draft;
            }
            rememberLocal();
        } catch(error){
            if(canvasId !== state.canvasId) return;
            if(error.status === 401){ state.saveStopped = 'auth'; state.transient = '请重新登录后继续使用智能体。'; }
            else if(error.status === 404){ state.saveStopped = 'missing'; state.transient = '当前画布不存在或已被删除。'; }
            else state.transient = `会话加载失败：${error.message}`;
        } finally {
            if(canvasId === state.canvasId){
                state.loading = false;
                render();
                if(!state.saveStopped) queueSave();
            }
        }
    }

    async function ensureRoute(){
        if(state.route) return state.route;
        const result = await loadProviderCatalog();
        state.route = core.resolveGenerationRoute(result, selectedImageModel());
        if(!state.route.provider) state.route.provider = 'comfly';
        return state.route;
    }

    function selectedImageModel(){
        return String(state.session.composer?.image_model || '自动选择');
    }

    async function loadProviderCatalog(){
        if(state.providerCatalog) return state.providerCatalog;
        state.providerCatalog = await core.api('/api/providers/available');
        renderImageModelMenu();
        return state.providerCatalog;
    }

    function imageModelOptions(){
        return core.availableImageModelOptions?.(state.providerCatalog || {}) || [];
    }

    function renderImageModelMenu(){
        if(!imageModelMenuEl) return;
        const selected = selectedImageModel();
        const header = '<div class="smart-agent-image-model-menu-head"><strong>选择生图模型</strong><small>按 API 设置顺序</small></div>';
        const auto = `<button type="button" role="menuitemradio" data-agent-image-model="自动选择" aria-checked="${selected === '自动选择'}" class="${selected === '自动选择' ? 'active' : ''}"><span><strong>自动选择</strong><small>优先使用 API 设置中排在前面的模型</small></span><i data-lucide="check"></i></button>`;
        const options = imageModelOptions().map(option => {
            const active = selected === option.value;
            return `<button type="button" role="menuitemradio" data-agent-image-model="${escapeHtml(option.value)}" aria-checked="${active}" class="${active ? 'active' : ''}"><span><strong>${escapeHtml(option.name || option.model)}</strong><small>${escapeHtml(option.providerName)} · 固定模型</small></span><i data-lucide="check"></i></button>`;
        }).join('');
        const status = state.imageModelLoading
            ? '<div class="smart-agent-analysis-model-status smart-agent-image-model-status">正在加载可用模型…</div>'
            : state.imageModelError
                ? `<button type="button" class="smart-agent-analysis-model-retry smart-agent-image-model-retry" data-agent-image-retry><span><strong>模型列表加载失败</strong><small>${escapeHtml(state.imageModelError)} · 点击重试</small></span><i data-lucide="refresh-cw"></i></button>`
                : '';
        imageModelMenuEl.innerHTML = header + auto + options + status;
        window.lucide?.createIcons?.();
    }

    function positionImageModelMenu(){
        if(!state.imageModelOpen || !imageModelBtn || !imageModelMenuEl) return;
        const buttonRect = imageModelBtn.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const viewportWidth = window.visualViewport?.width || window.innerWidth;
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        const safe = 12;
        const gap = 8;
        const width = Math.min(300, Math.max(220, panelRect.width - safe * 2));
        const desiredHeight = Math.min(280, 48 + (imageModelOptions().length + 1) * 48);
        const availableAbove = Math.max(0, buttonRect.top - safe - gap);
        const availableBelow = Math.max(0, viewportHeight - buttonRect.bottom - safe - gap);
        const placeAbove = availableAbove >= Math.min(160, desiredHeight) || availableAbove >= availableBelow;
        const available = placeAbove ? availableAbove : availableBelow;
        const maxHeight = Math.max(120, Math.min(desiredHeight, available || desiredHeight));
        const minLeft = Math.max(safe, panelRect.left + safe);
        const maxLeft = Math.max(minLeft, Math.min(viewportWidth - width - safe, panelRect.right - width - safe));
        const left = Math.min(Math.max(minLeft, buttonRect.right - width), maxLeft);
        const top = placeAbove
            ? Math.max(safe, buttonRect.top - maxHeight - gap)
            : Math.min(viewportHeight - maxHeight - safe, buttonRect.bottom + gap);
        imageModelMenuEl.style.setProperty('--smart-agent-model-left', `${Math.round(left)}px`);
        imageModelMenuEl.style.setProperty('--smart-agent-model-top', `${Math.round(top)}px`);
        imageModelMenuEl.style.setProperty('--smart-agent-model-width', `${Math.round(width)}px`);
        imageModelMenuEl.style.setProperty('--smart-agent-model-max-height', `${Math.round(maxHeight)}px`);
    }

    function syncImageModelControl(){
        if(!imageModelPickerEl || !imageModelBtn || !imageModelValueEl) return;
        const selected = selectedImageModel();
        const option = imageModelOptions().find(item => item.value === selected);
        const label = selected === '自动选择' ? '模型 · 自动' : (option?.name || option?.model || selected.split('::').at(-1));
        imageModelPickerEl.classList.toggle('open', state.imageModelOpen);
        imageModelValueEl.textContent = label;
        imageModelBtn.setAttribute('aria-expanded', String(state.imageModelOpen));
        imageModelBtn.setAttribute('aria-label', `生图模型：${selected === '自动选择' ? '自动选择' : label}`);
        renderImageModelMenu();
        positionImageModelMenu();
    }

    async function setImageModelMenuOpen(open){
        state.imageModelOpen = Boolean(open);
        if(state.imageModelOpen){
            state.sizeOpen = false;
            if(state.promptOpen){ state.promptOpen = false; renderPromptPreview(); }
        }
        syncModeControl();
        if(!state.imageModelOpen || state.providerCatalog) return;
        state.imageModelLoading = true;
        state.imageModelError = '';
        renderImageModelMenu();
        try { await loadProviderCatalog(); }
        catch(error){
            const rawMessage = String(error?.message || '').trim();
            const httpStatus = rawMessage.match(/HTTP\s+\d{3}/i)?.[0];
            state.imageModelError = httpStatus
                || (!rawMessage.includes('<') && rawMessage.length <= 120 ? rawMessage : '')
                || '请稍后重试';
            state.transient = '生图模型列表加载失败，仍可使用自动选择。';
        } finally {
            state.imageModelLoading = false;
            syncModeControl();
        }
    }

    function selectImageModel(value){
        const requested = String(value || '自动选择');
        const valid = requested === '自动选择' || imageModelOptions().some(option => option.value === requested);
        if(!state.session.composer || typeof state.session.composer !== 'object') state.session.composer = {};
        state.session.composer.image_model = valid ? requested : '自动选择';
        state.route = null;
        state.imageModelOpen = false;
        syncModeControl();
        markChanged({render:false});
        inputEl.focus();
    }

    function uniqueReferences(items){
        const seen = new Set();
        return (Array.isArray(items) ? items : []).filter(item => {
            const url = String(item?.url || '').trim();
            if(!url || seen.has(url)) return false;
            seen.add(url);
            return true;
        }).slice(0, 8).map(item => ({
            url:String(item.url), name:String(item.name || '画布参考图'), role:String(item.role || 'reference'),
            kind:'image', sourceNodeId:String(item.sourceNodeId || item.id || ''), lineage:item.lineage || {}
        }));
    }

    const MODE_META = {image:{label:'图片'}};

    const SIZE_PRESETS = {
        square:{ratio:'1:1', label:'正方形', sizes:{'1k':'1024x1024', '2k':'1536x1536', '4k':'2048x2048'}},
        portrait:{ratio:'2:3', label:'竖图', sizes:{'1k':'720x1080', '2k':'1024x1536', '4k':'1365x2048'}},
        landscape:{ratio:'3:2', label:'横图', sizes:{'1k':'1080x720', '2k':'1536x1024', '4k':'2048x1365'}},
        portrait43:{ratio:'3:4', label:'竖图', sizes:{'1k':'1008x1344', '2k':'1536x2048', '4k':'2448x3264'}},
        landscape43:{ratio:'4:3', label:'横图', sizes:{'1k':'1344x1008', '2k':'2048x1536', '4k':'3264x2448'}},
        story:{ratio:'9:16', label:'竖屏', sizes:{'1k':'720x1280', '2k':'1080x1920', '4k':'1440x2560'}},
        wide:{ratio:'16:9', label:'宽屏', sizes:{'1k':'1280x720', '2k':'1920x1080', '4k':'2560x1440'}}
    };
    const SIZE_SCOPES = new Set(['auto', 'preset', 'custom']);
    const SIZE_TIERS = new Set(['1k', '2k', '4k']);

    function composerMode(){
        if(!state.session.composer || typeof state.session.composer !== 'object') state.session.composer = {};
        state.session.composer.mode_hint = 'image';
        return 'image';
    }

    function syncModeControl(){
        composerMode();
        if(modePickerEl) modePickerEl.dataset.mode = 'image';
        if(modeLabelEl) modeLabelEl.textContent = '图片';
        syncImageModelControl();
        syncSizeControl();
    }

    function normalizeCustomSize(value){
        const match = String(value || '').trim().match(/^([1-9]\d{2,3})\s*[xX×*]\s*([1-9]\d{2,3})$/);
        if(!match) return '';
        const width = Math.round(Number(match[1]));
        const height = Math.round(Number(match[2]));
        if(width < 256 || height < 256 || width > 8192 || height > 8192) return '';
        return `${width}x${height}`;
    }

    function composerSizeSettings(){
        if(!state.session.composer || typeof state.session.composer !== 'object') state.session.composer = {};
        const raw = state.session.composer.image_size && typeof state.session.composer.image_size === 'object'
            ? state.session.composer.image_size : {};
        const settings = {
            scope:SIZE_SCOPES.has(raw.scope) ? raw.scope : 'auto',
            ratio:SIZE_PRESETS[raw.ratio] ? raw.ratio : 'square',
            tier:SIZE_TIERS.has(raw.tier) ? raw.tier : '1k',
            custom_size:normalizeCustomSize(raw.custom_size) || '1024x1024'
        };
        state.session.composer.image_size = settings;
        return settings;
    }

    function composerOutputSize(settings=composerSizeSettings()){
        if(settings.scope === 'custom') return settings.custom_size;
        if(settings.scope === 'preset') return SIZE_PRESETS[settings.ratio]?.sizes?.[settings.tier] || '1024x1024';
        return '1024x1024';
    }

    function customAspectRatio(size){
        const normalized = normalizeCustomSize(size);
        if(!normalized) return '1:1';
        const [width, height] = normalized.split('x').map(Number);
        const gcd = (a, b) => b ? gcd(b, a % b) : a;
        const divisor = gcd(width, height) || 1;
        return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
    }

    function composerOutputAspect(settings=composerSizeSettings()){
        if(settings.scope === 'preset') return SIZE_PRESETS[settings.ratio]?.ratio || '1:1';
        if(settings.scope === 'custom') return customAspectRatio(settings.custom_size);
        return '1:1';
    }

    function displaySize(value){
        return String(value || '').replace('x', '×');
    }

    function positionSizePopover(){
        if(!state.sizeOpen || !sizeBtn || !sizePopoverEl) return;
        const rect = sizeBtn.getBoundingClientRect();
        const viewportWidth = window.visualViewport?.width || window.innerWidth;
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        const settings = composerSizeSettings();
        const width = Math.min(410, Math.max(260, viewportWidth - 24));
        const safe = 12;
        const gap = 10;
        const availableAbove = Math.max(130, rect.top - safe - gap);
        const desiredHeight = settings.scope === 'preset' ? 374 : 174;
        const maxHeight = Math.min(desiredHeight, availableAbove, viewportHeight - 24);
        const left = Math.min(
            Math.max(safe, rect.left + rect.width / 2 - width / 2),
            Math.max(safe, viewportWidth - width - safe)
        );
        const top = Math.max(safe, rect.top - maxHeight - gap);
        sizePopoverEl.style.setProperty('--smart-agent-size-left', `${Math.round(left)}px`);
        sizePopoverEl.style.setProperty('--smart-agent-size-top', `${Math.round(top)}px`);
        sizePopoverEl.style.setProperty('--smart-agent-size-width', `${Math.round(width)}px`);
        sizePopoverEl.style.setProperty('--smart-agent-size-max-height', `${Math.round(maxHeight)}px`);
        sizePopoverEl.style.setProperty('--smart-agent-size-list-height', `${Math.max(120, Math.round(maxHeight - 52))}px`);
    }

    function syncSizeControl(){
        if(!sizePickerEl || !sizeBtn || !sizeValueEl) return;
        const settings = composerSizeSettings();
        sizePickerEl.hidden = false;
        sizePickerEl.dataset.scope = settings.scope;
        sizePickerEl.classList.toggle('open', state.sizeOpen);
        sizeBtn.setAttribute('aria-expanded', String(state.sizeOpen));
        const outputSize = composerOutputSize(settings);
        const ratioLabel = SIZE_PRESETS[settings.ratio]?.ratio || '1:1';
        const label = settings.scope === 'auto' ? '自动'
            : settings.scope === 'custom' ? displaySize(outputSize)
            : `${ratioLabel} · ${settings.tier.toUpperCase()}`;
        sizeValueEl.textContent = label;
        sizeBtn.title = settings.scope === 'auto' ? '尺寸选择：自动'
            : settings.scope === 'custom' ? `尺寸选择：自定义 · ${displaySize(outputSize)}`
            : `尺寸选择：${label} · ${displaySize(outputSize)}`;
        sizeBtn.setAttribute('aria-label', sizeBtn.title);
        sizePopoverEl?.querySelectorAll('[data-agent-size-scope]').forEach(button => {
            const active = button.dataset.agentSizeScope === settings.scope;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        sizePopoverEl?.querySelectorAll('[data-agent-size-pane]').forEach(pane => {
            pane.hidden = pane.dataset.agentSizePane !== settings.scope;
        });
        sizePopoverEl?.querySelectorAll('[data-agent-size-ratio]').forEach(button => {
            const active = button.dataset.agentSizeRatio === settings.ratio;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        sizePopoverEl?.querySelectorAll('[data-agent-size-tier]').forEach(button => {
            const tier = button.dataset.agentSizeTier;
            const size = SIZE_PRESETS[settings.ratio]?.sizes?.[tier] || '';
            const sizeLabel = button.querySelector('small');
            if(sizeLabel) sizeLabel.textContent = displaySize(size);
            const active = tier === settings.tier;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        const [customWidth, customHeight] = settings.custom_size.split('x');
        if(customWidthEl && document.activeElement !== customWidthEl) customWidthEl.value = customWidth;
        if(customHeightEl && document.activeElement !== customHeightEl) customHeightEl.value = customHeight;
        if(customHintEl && !customHintEl.classList.contains('error')) customHintEl.textContent = '输入 256–8192 之间的宽度和高度';
        if(state.sizeOpen) requestAnimationFrame(positionSizePopover);
    }

    function setSizePopoverOpen(open){
        state.sizeOpen = Boolean(open);
        if(state.sizeOpen){
            state.imageModelOpen = false;
            if(state.promptOpen){ state.promptOpen = false; renderPromptPreview(); }
        }
        syncModeControl();
    }

    function updateComposerSize(patch){
        const settings = {...composerSizeSettings(), ...patch};
        settings.scope = SIZE_SCOPES.has(settings.scope) ? settings.scope : 'auto';
        settings.ratio = SIZE_PRESETS[settings.ratio] ? settings.ratio : 'square';
        settings.tier = SIZE_TIERS.has(settings.tier) ? settings.tier : '1k';
        settings.custom_size = normalizeCustomSize(settings.custom_size) || '1024x1024';
        state.session.composer.image_size = settings;
        syncSizeControl();
        markChanged({render:false});
    }

    function applyCustomSize(){
        const normalized = normalizeCustomSize(`${customWidthEl?.value || ''}x${customHeightEl?.value || ''}`);
        if(!normalized){
            if(customHintEl){
                customHintEl.textContent = '请输入 256–8192 之间的有效宽度和高度';
                customHintEl.classList.add('error');
            }
            return;
        }
        if(customHintEl){
            customHintEl.textContent = '已应用自定义分辨率';
            customHintEl.classList.remove('error');
        }
        updateComposerSize({scope:'custom', custom_size:normalized});
    }

    function promptTemplateText(item){
        return String(item?.positive || item?.scene || item?.name || '').trim();
    }

    function renderPromptPreview(){
        if(!promptPreviewEl || !promptListEl || !promptBtn) return;
        promptBtn.classList.toggle('active', state.promptOpen);
        promptBtn.setAttribute('aria-expanded', String(state.promptOpen));
        promptPreviewEl.hidden = !state.promptOpen;
        if(!state.promptOpen) return;
        if(state.promptLoading){
            promptListEl.innerHTML = '<div class="smart-agent-prompt-preview-empty">正在加载提示词库…</div>';
            return;
        }
        if(state.promptError){
            promptListEl.innerHTML = `<div class="smart-agent-prompt-preview-empty">${escapeHtml(state.promptError)}</div>`;
            return;
        }
        const templates = state.promptTemplates.slice(0, 30);
        promptListEl.innerHTML = templates.length
            ? templates.map((item, index) => `<button type="button" class="smart-agent-prompt-preview-item" data-agent-prompt-template="${index}"><strong>${escapeHtml(item.name || `提示词 ${index + 1}`)}</strong><span>${escapeHtml(item.scene || item.positive || '')}</span></button>`).join('')
            : '<div class="smart-agent-prompt-preview-empty">提示词库中还没有可用模板。</div>';
    }

    async function loadPromptLibrary(){
        state.promptLoading = true;
        state.promptError = '';
        renderPromptPreview();
        try {
            const result = await core.api('/api/prompt-libraries');
            state.promptTemplates = (result?.library?.libraries || []).flatMap(library => Array.isArray(library?.items) ? library.items : []);
        } catch(error){
            state.promptError = error?.message || '提示词库加载失败，请稍后重试。';
        } finally {
            state.promptLoading = false;
            renderPromptPreview();
        }
    }

    function setPromptLibraryOpen(open){
        state.promptOpen = Boolean(open);
        if(state.promptOpen){
            state.imageModelOpen = false;
            state.sizeOpen = false;
            syncSizeControl();
            syncImageModelControl();
        }
        renderPromptPreview();
        if(state.promptOpen) loadPromptLibrary();
    }

    function combineReferences(){
        state.references = uniqueReferences([...state.canvasReferences, ...state.uploadedReferences]);
        renderReferences();
    }

    function clipboardImageFiles(clipboardData){
        const fromItems = [...(clipboardData?.items || [])]
            .filter(item => item.kind === 'file' && String(item.type || '').startsWith('image/'))
            .map(item => item.getAsFile()).filter(Boolean);
        const fromFiles = [...(clipboardData?.files || [])]
            .filter(file => String(file?.type || '').startsWith('image/'));
        const seen = new Set();
        return [...fromItems, ...fromFiles].filter(file => {
            const key = `${file.name || ''}:${file.type || ''}:${file.size || 0}:${file.lastModified || 0}`;
            if(seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    async function uploadReferenceImages(files){
        const images = [...(files || [])].filter(file => String(file?.type || '').startsWith('image/')).slice(0, 8);
        if(!images.length) return;
        state.uploading = true;
        if(imageBtn) imageBtn.disabled = true;
        try {
            const prepared = window.LingDrawImageUpload
                ? await window.LingDrawImageUpload.optimizeFiles(images)
                : images;
            const form = new FormData();
            prepared.forEach(file => form.append('files', file, file.name || 'reference.png'));
            const response = await fetch('/api/ai/upload', {method:'POST', body:form});
            const data = await response.json().catch(() => ({}));
            if(!response.ok) throw new Error(data.detail || data.message || '图片上传失败');
            const uploaded = (data.files || []).filter(file => file?.url).map(file => ({
                url:file.url, name:file.name || '上传图片', role:'reference', kind:'image', sourceNodeId:''
            }));
            state.uploadedReferences = uniqueReferences([...state.uploadedReferences, ...uploaded]);
            combineReferences();
            state.transient = '';
        } catch(error){
            state.transient = error.message || '图片上传失败，请稍后重试。';
            render();
        } finally {
            state.uploading = false;
            if(imageBtn) imageBtn.disabled = false;
            if(imageInputEl) imageInputEl.value = '';
        }
    }

    function createAttempt(){
        const stamp = core.now();
        return {
            id:core.uid('attempt'), request_id:core.uid('agent-request'), status:'running', resolved:false,
            run:{phase:'analyzing', started_at:stamp, error:'', failed_stage:'', review_warning:''},
            created_at:stamp, updated_at:stamp
        };
    }

    function createTurn(message, options={}){
        const stamp = core.now();
        const attempt = createAttempt();
        const references = uniqueReferences([...(options.references || []), ...state.references]);
        const selectedAssets = [...(options.selectedAssets || []), ...state.selectedAssets]
            .filter((item,index,items) => item?.id && items.findIndex(candidate => candidate?.id === item.id) === index).slice(0,8);
        const turn = {
            id:core.uid('turn'), sequence:state.session.next_sequence++, parent_turn_id:String(options.parentTurnId || ''),
            mode_hint:composerMode(),
            output_size:composerOutputSize(), output_aspect_ratio:composerOutputAspect(),
            output_size_settings:{...composerSizeSettings()},
            user_message:{id:core.uid('message'), role:'user', content:message, created_at:stamp, request_id:attempt.request_id},
            references, selected_assets:selectedAssets, attempts:[attempt], active_attempt_id:attempt.id,
            created_at:stamp, updated_at:stamp
        };
        state.session.turns.push(turn);
        state.session.active_turn_id = turn.id;
        touch(turn);
        markChanged();
        return {turn, attempt};
    }

    function previousContext(turn){
        const previous = turn.parent_turn_id ? getTurn(turn.parent_turn_id) : state.session.turns
            .filter(item => item.sequence < turn.sequence).at(-1);
        const run = previous ? activeRun(previous) : {};
        return {plan:run.plan || {}, review:run.review || {}};
    }

    function clarificationAnswers(clarification, answers){
        return (clarification?.questions || []).map(question => {
            const optionIds = Array.isArray(answers?.[question.id]) ? answers[question.id] : [];
            const values = optionIds.map(id => question.options?.find(option => option.id === id)?.label || id).filter(Boolean);
            return {question_id:question.id, question:question.question, option_ids:optionIds, values};
        }).filter(answer => answer.values.length);
    }

    function executionPrompt(route){
        if(route === 'edit_image') return '你是资深图像编辑设计师。严格依据参考图和用户指令创建子版本，保留未要求改变的内容，并返回完成后的图片。';
        if(route === 'direct_generate') return '你是专业视觉设计师。依据已确认需求直接生成可交付图片，并返回图片结果。';
        return '你是 Creative Director 与 Art Director。严格执行结构化设计方案，生成完整、专业、可交付的图片结果。';
    }

    async function recoverExecution(requestId){
        const status = await core.pollAgentRequest(requestId, state.canvasId, {attempts:12, interval:1800});
        const message = status?.message || status?.request?.message;
        const conversation = status?.conversation || status?.request?.conversation || {};
        if(!message) throw new Error('已找到任务，但暂未取得可恢复的图片结果。');
        return {message, conversation};
    }

    async function executeGeneration(turn, attempt, decision, route){
        const run = attempt.run;
        const resultPayload = {
            request_id:attempt.request_id,
            conversation_id:state.session.conversation_id || '',
            surface:'design_agent', context_id:state.canvasId,
            session_id:state.session.session_id, turn_id:turn.id, parent_turn_id:turn.parent_turn_id || '',
            message:turn.user_message.content, skill:'Design Agent',
            system_prompt:executionPrompt(decision.route), mode:'image', size:String(turn.output_size || '1440x1440'), quality:'auto',
            ...route, model:route.chat_model,
            agent_plan:{status:'ready', route:decision.route, reason:decision.reason,
                generation_prompt:decision.generation_prompt || decision.plan?.generation_prompt || turn.user_message.content,
                plan:decision.plan || null},
            reference_images:turn.references.map(item => ({url:item.url, name:item.name, role:item.role || 'reference'}))
        };
        let result;
        try {
            result = await core.api('/api/chat/agent', {method:'POST', body:JSON.stringify(resultPayload)});
        } catch(error){
            try { result = await recoverExecution(attempt.request_id); }
            catch(recoveryError){
                if(recoveryError.code === 'outcome_unknown') recoveryError.originalError = error;
                throw recoveryError;
            }
        }
        const message = result.message || {};
        const urls = imageUrls(message);
        if(!urls.length) throw new Error('Agent 没有返回可添加到画布的图片成果。');
        state.session.conversation_id = String(result.conversation?.id || state.session.conversation_id || '');
        run.result = {
            url:urls[0], urls, name:String(message.name || message.title || `${turn.user_message.content.slice(0,24)} 设计成果`),
            message_id:String(message.id || ''), request_id:attempt.request_id,
            provider:String(message.provider || route.image_provider || ''), model:String(message.model || route.image_model || ''),
            source_node_id:String(turn.selected_assets[0]?.id || turn.references[0]?.sourceNodeId || ''),
            parent_asset_id:String(turn.selected_assets[0]?.lineage?.generatedAssetId || turn.selected_assets[0]?.id || '')
        };
        return message;
    }

    async function executeVideoGeneration(turn, attempt, route){
        if(!route.video_provider || !route.video_model) throw new Error('当前没有可用的视频平台或模型，请先在 API 设置中配置。');
        const result = await core.api('/api/canvas-video', {
            method:'POST',
            body:JSON.stringify({
                prompt:turn.user_message.content,
                provider_id:route.video_provider,
                model:route.video_model,
                duration:5,
                aspect_ratio:'16:9',
                resolution:'',
                images:turn.references.map((item, index) => ({
                    url:item.url,
                    name:item.name || `参考图 ${index + 1}`,
                    role:index === 0 ? 'first_frame' : 'reference'
                })),
                videos:[],
                audios:[],
                enhance_prompt:true
            })
        });
        if(result?.jimeng_pending) throw new Error(result.message || '视频任务已提交，请稍后在画布任务中查看结果。');
        const urls = mediaUrls(result);
        if(!urls.length) throw new Error('视频模型没有返回可添加到画布的结果。');
        attempt.run.result = {
            kind:'video', url:urls[0], urls,
            name:`${turn.user_message.content.slice(0,24)} 视频成果`,
            message_id:'', request_id:attempt.request_id,
            provider:route.video_provider, model:route.video_model,
            source_node_id:String(turn.selected_assets[0]?.id || turn.references[0]?.sourceNodeId || ''),
            parent_asset_id:String(turn.selected_assets[0]?.lineage?.generatedAssetId || turn.selected_assets[0]?.id || '')
        };
    }

    function completeAttempt(turn, attempt){
        const run = attempt.run;
        run.phase = 'completed';
        attempt.status = 'succeeded';
        attempt.resolved = false;
        turn.attempts.forEach(item => { if(item.id !== attempt.id && item.status === 'failed') item.resolved = true; });
        state.references = [];
        state.canvasReferences = [];
        state.uploadedReferences = [];
        state.selectedAssets = [];
        touch(attempt); touch(turn); markChanged();
        renderReferences();
    }

    async function reviewResult(turn, attempt, route){
        const run = attempt.run;
        if(!run.result?.url) return;
        try {
            const result = await core.api('/api/agent/workbench/review', {
                method:'POST', body:JSON.stringify({
                    request_id:`${attempt.request_id}-review`, message:turn.user_message.content,
                    skill:'Design Agent', provider:route.provider, model:route.chat_model,
                    allow_model_fallback:route.allow_chat_fallback,
                    image_url:run.result.url, image_name:run.result.name, plan:run.plan || null
                })
            });
            run.review = result.analysis;
            run.review_model = result.model || route.chat_model;
            run.review_warning = '';
        } catch(error){
            run.review_warning = error.message || '图片已生成，但质量复核暂不可用。';
        }
    }

    async function processAttempt(turnId, attemptId, continuation={}){
        const turn = getTurn(turnId);
        const attempt = getAttempt(turnId, attemptId);
        if(!turn || !attempt || state.saveStopped) return;
        const run = attempt.run;
        attempt.status = 'running';
        run.error = '';
        run.failed_stage = '';
        run.phase = 'analyzing';
        touch(attempt); touch(turn); markChanged();
        let stage = 'analyzing';
        try {
            const route = await ensureRoute();
            const modeHint = MODE_META[turn.mode_hint] ? turn.mode_hint : 'image';
            if(modeHint === 'image'){
                run.route = 'direct_generate';
                run.generation_prompt = turn.user_message.content;
                run.phase = 'generating';
                stage = 'generating';
                touch(attempt); touch(turn); markChanged();
                await executeGeneration(turn, attempt, {
                    route:'direct_generate',
                    reason:'已选择图片模式，直接生成或修改图像。',
                    generation_prompt:turn.user_message.content
                }, route);
                completeAttempt(turn, attempt);
                return;
            }
            if(modeHint === 'video'){
                run.route = 'direct_video';
                run.generation_prompt = turn.user_message.content;
                run.phase = 'generating';
                stage = 'generating';
                touch(attempt); touch(turn); markChanged();
                await executeVideoGeneration(turn, attempt, route);
                completeAttempt(turn, attempt);
                return;
            }
            const context = previousContext(turn);
            const planResult = await core.api('/api/agent/workbench/plan', {
                method:'POST', body:JSON.stringify({
                    request_id:attempt.request_id, message:turn.user_message.content,
                    canvas_id:state.canvasId, session_id:state.session.session_id,
                    turn_id:turn.id, parent_turn_id:turn.parent_turn_id || '',
                    mode_hint:turn.mode_hint || 'agent', skill:'Design Agent',
                    provider:route.provider, model:route.chat_model,
                    allow_model_fallback:route.allow_chat_fallback,
                    reference_images:turn.references.map(item => ({url:item.url,name:item.name})),
                    selected_assets:turn.selected_assets,
                    prior_turns:core.summarizePriorTurns(state.session, turn.sequence),
                    previous_plan:context.plan, previous_review:context.review,
                    clarification_id:continuation.clarification?.id || '',
                    clarification_answers:continuation.clarification ? clarificationAnswers(continuation.clarification, continuation.answers || {}) : [],
                    skip_clarification:Boolean(continuation.skip)
                })
            });
            const decision = planResult.analysis || {};
            run.analysis_model = planResult.model || route.chat_model;
            run.routing_reason = decision.reason || '';
            run.route = decision.route || '';
            if(decision.status === 'needs_clarification'){
                if(!decision.clarification) throw new Error('需求分析模型未返回可用的澄清问题。');
                run.phase = 'clarifying';
                run.clarification = decision.clarification;
                run.clarification_answers = {};
                attempt.status = 'waiting';
                touch(attempt); touch(turn); markChanged();
                return;
            }
            if(decision.route === 'clarify') throw new Error('需求分析模型返回了无效的执行路径。');
            run.plan = decision.plan || context.plan || null;
            run.generation_prompt = decision.generation_prompt || run.plan?.generation_prompt || turn.user_message.content;
            run.phase = 'generating';
            stage = 'generating';
            touch(attempt); touch(turn); markChanged();
            await executeGeneration(turn, attempt, decision, route);
            run.phase = 'reviewing';
            stage = 'reviewing';
            touch(attempt); touch(turn); markChanged();
            await reviewResult(turn, attempt, route);
            completeAttempt(turn, attempt);
        } catch(error){
            run.phase = 'failed';
            run.failed_stage = stage;
            run.error = error.message || '请求未完成，请稍后重试。';
            run.outcome_unknown = error.code === 'outcome_unknown';
            attempt.status = 'failed';
            touch(attempt); touch(turn); markChanged();
        }
    }

    async function continueClarification(turnId, attemptId, skip=false){
        const attempt = getAttempt(turnId, attemptId);
        if(!attempt?.run?.clarification) return;
        const clarification = attempt.run.clarification;
        const answers = attempt.run.clarification_answers || {};
        if(!skip){
            const missing = (clarification.questions || []).some(question => question.required !== false && !(answers[question.id] || []).length);
            if(missing){ state.transient = '请先完成必选问题。'; render(); return; }
        }
        attempt.run.clarification_skipped = skip;
        touch(attempt); markChanged();
        await processAttempt(turnId, attemptId, {clarification, answers, skip});
    }

    function retryTurn(turnId){
        const turn = getTurn(turnId);
        if(!turn) return;
        const previous = core.activeAttempt(turn);
        if(previous) previous.resolved = true;
        const attempt = createAttempt();
        turn.attempts.push(attempt);
        turn.active_attempt_id = attempt.id;
        state.session.active_turn_id = turn.id;
        touch(turn); markChanged();
        processAttempt(turn.id, attempt.id);
    }

    async function recoverTurn(turnId, attemptId){
        const turn = getTurn(turnId);
        const attempt = getAttempt(turnId, attemptId);
        if(!turn || !attempt) return;
        const run = attempt.run;
        run.phase = 'generating'; run.error = ''; run.outcome_unknown = false;
        touch(attempt); markChanged();
        try {
            const route = await ensureRoute();
            const result = await recoverExecution(attempt.request_id);
            const urls = imageUrls(result.message);
            if(!urls.length) throw new Error('恢复的任务没有图片结果。');
            run.result = {url:urls[0], urls, name:String(result.message.name || '恢复的设计成果'),
                message_id:String(result.message.id || ''), request_id:attempt.request_id,
                provider:String(result.message.provider || route.image_provider || ''), model:String(result.message.model || route.image_model || ''),
                source_node_id:String(turn.selected_assets[0]?.id || turn.references[0]?.sourceNodeId || '')};
            state.session.conversation_id = String(result.conversation?.id || state.session.conversation_id || '');
            run.phase = 'reviewing'; touch(attempt); markChanged();
            await reviewResult(turn, attempt, route);
            run.phase = 'completed'; attempt.status = 'succeeded';
            turn.attempts.forEach(item => { if(item.id !== attempt.id && item.status === 'failed') item.resolved = true; });
        } catch(error){
            run.phase = 'failed'; run.error = error.message || '恢复失败'; run.outcome_unknown = error.code === 'outcome_unknown'; attempt.status = 'failed';
        }
        touch(attempt); touch(turn); markChanged();
    }

    function send(message, options={}){
        const text = String(message || '').trim();
        if(!text || state.loading || state.saveStopped || !state.canvasId) return;
        state.nearBottom = isNearBottom();
        state.transient = '';
        const created = createTurn(text, options);
        inputEl.value = '';
        state.session.composer.draft = '';
        resizeInput();
        processAttempt(created.turn.id, created.attempt.id);
    }

    function sendSuggestion(turnId, instruction){
        const parent = getTurn(turnId);
        const result = activeRun(parent).result;
        const refs = result?.url ? [{url:result.url, name:result.name || '上一轮成果', sourceNodeId:result.source_node_id || '', lineage:{requestId:result.request_id}}] : [];
        const assets = result?.url ? [{id:result.source_node_id || `asset-${result.request_id}`, type:'agent-result', url:result.url, name:result.name, lineage:{requestId:result.request_id}}] : [];
        send(instruction, {parentTurnId:turnId, references:refs, selectedAssets:assets});
    }

    function isNearBottom(){ return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80; }
    function scrollToBottom(behavior='auto'){
        messagesEl.scrollTo({top:messagesEl.scrollHeight, behavior});
        state.nearBottom = true; unreadBtn.hidden = true;
    }

    function planHtml(plan){
        if(!plan) return '';
        const sections = Array.isArray(plan.sections) ? plan.sections : [];
        return `<section class="smart-agent-plan"><h4>${escapeHtml(plan.title || '设计方案')}</h4>${sections.map(section => {
            const details = (section.details || []).map(item => `<li>${escapeHtml(item)}</li>`).join('');
            const colors = (section.colors || []).map(item => `<span class="smart-agent-color"><i style="background:${escapeHtml(item.value)}"></i>${escapeHtml(item.name)}</span>`).join('');
            return `<div class="smart-agent-plan-section"><strong>${escapeHtml(section.title || section.kind)}</strong><p>${escapeHtml(section.summary || '')}</p>${details ? `<ul>${details}</ul>` : ''}${colors ? `<div class="smart-agent-colors">${colors}</div>` : ''}</div>`;
        }).join('')}</section>`;
    }

    function clarificationHtml(turn, attempt){
        const clarification = attempt.run.clarification;
        if(!clarification) return '';
        const answers = attempt.run.clarification_answers || {};
        return `<section class="smart-agent-clarification"><h4>需要你确认</h4><p>${escapeHtml(clarification.introduction)}</p>${(clarification.questions || []).map(question => `<fieldset><legend>${escapeHtml(question.question)}</legend>${question.description ? `<small>${escapeHtml(question.description)}</small>` : ''}<div class="smart-agent-options">${(question.options || []).map(option => {
            const checked = (answers[question.id] || []).includes(option.id);
            return `<label class="${checked ? 'selected' : ''}"><input type="${question.selection === 'multiple' ? 'checkbox' : 'radio'}" name="${escapeHtml(`${attempt.id}-${question.id}`)}" data-agent-answer data-turn-id="${escapeHtml(turn.id)}" data-attempt-id="${escapeHtml(attempt.id)}" data-question-id="${escapeHtml(question.id)}" data-option-id="${escapeHtml(option.id)}" ${checked ? 'checked' : ''}><span><b>${escapeHtml(option.label)}${option.id === question.recommended_option_id ? ' · 推荐' : ''}</b>${option.description ? `<em>${escapeHtml(option.description)}</em>` : ''}</span></label>`;
        }).join('')}</div></fieldset>`).join('')}<div class="smart-agent-card-actions"><button type="button" data-agent-clarify-skip="${escapeHtml(turn.id)}" data-attempt-id="${escapeHtml(attempt.id)}">由 Agent 判断</button><button class="primary" type="button" data-agent-clarify-continue="${escapeHtml(turn.id)}" data-attempt-id="${escapeHtml(attempt.id)}">确认并继续</button></div></section>`;
    }

    function reviewHtml(review, warning){
        if(!review && !warning) return '';
        if(!review) return `<div class="smart-agent-review-warning"><strong>图片已生成，复核暂不可用</strong><span>${escapeHtml(warning)}</span></div>`;
        return `<section class="smart-agent-review"><header><strong>${escapeHtml(review.title || '质量复核')}</strong><b>${Number(review.overall_score || 0)}</b></header><p>${escapeHtml(review.summary || '')}</p><div class="smart-agent-highlights">${(review.highlights || []).map(item => `<div><strong>✓ ${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></div>`).join('')}</div><div class="smart-agent-checks">${(review.checks || []).map(item => `<span class="${item.passed ? 'passed' : 'failed'}">${item.passed ? '✓' : '×'} ${escapeHtml(item.label)} ${Number(item.score || 0)}</span>`).join('')}</div><p class="smart-agent-conclusion">${escapeHtml(review.conclusion || '')}</p></section>`;
    }

    function resultHtml(turn, attempt){
        const result = attempt.run.result;
        if(!result?.url) return '';
        const added = Boolean(result.added_node_id);
        const media = result.kind === 'video'
            ? `<video src="${escapeHtml(result.url)}" controls preload="metadata" aria-label="${escapeHtml(result.name)}"></video>`
            : `<img src="${escapeHtml(result.url)}" alt="${escapeHtml(result.name)}" loading="lazy">`;
        return `<article class="smart-agent-image-card ${result.kind === 'video' ? 'video' : ''}">${media}<div class="smart-agent-image-actions"><span>${escapeHtml(result.model || result.name)}</span><button type="button" data-agent-add-image data-turn-id="${escapeHtml(turn.id)}" data-attempt-id="${escapeHtml(attempt.id)}" ${added ? 'disabled' : ''}>${added ? '已添加' : '添加到画布'}</button></div></article>`;
    }

    function suggestionsHtml(turn, review){
        const suggestions = Array.isArray(review?.suggestions) ? review.suggestions : [];
        if(!suggestions.length) return '';
        return `<div class="smart-agent-suggestions"><strong>继续优化</strong>${suggestions.map(item => `<button type="button" data-agent-suggestion="${escapeHtml(item.instruction || item.label)}" data-turn-id="${escapeHtml(turn.id)}">↳ ${escapeHtml(item.label || item.instruction)}</button>`).join('')}</div>`;
    }

    function runHtml(turn, attempt){
        const run = attempt.run || {};
        const analysis = run.routing_reason ? `<div class="smart-agent-analysis"><span>✦ 需求分析</span><p>${escapeHtml(run.routing_reason)}</p></div>` : '';
        if(run.phase === 'clarifying') return `${analysis}${clarificationHtml(turn, attempt)}`;
        const progressLabels = {analyzing:'正在分析需求与画布上下文…', generating:turn.mode_hint === 'video' ? '正在使用视频模型生成…' : (turn.mode_hint === 'image' ? '正在直接生成图片…' : '正在按方案生成图片…'), reviewing:'图片已生成，正在进行质量复核…'};
        const progress = progressLabels[run.phase] ? `<div class="smart-agent-progress"><i></i><span>${escapeHtml(progressLabels[run.phase])}</span></div>` : '';
        const failed = run.phase === 'failed' ? `<div class="smart-agent-error-card"><strong>${run.outcome_unknown ? '结果状态未知' : '本次执行未完成'}</strong><p>${escapeHtml(run.error || '请求失败')}</p><div class="smart-agent-card-actions">${run.outcome_unknown ? `<button type="button" data-agent-recover="${escapeHtml(turn.id)}" data-attempt-id="${escapeHtml(attempt.id)}">恢复结果</button>` : ''}<button class="primary" type="button" data-agent-retry="${escapeHtml(turn.id)}">重新尝试</button></div></div>` : '';
        return `${analysis}${planHtml(run.plan)}${progress}${resultHtml(turn, attempt)}${reviewHtml(run.review, run.review_warning)}${suggestionsHtml(turn, run.review)}${failed}`;
    }

    function renderTurn(turn){
        const attempt = core.activeAttempt(turn);
        const resolved = turn.attempts.filter(item => item.id !== attempt?.id && item.status === 'failed' && item.resolved).length;
        const refs = (turn.references || []).map(item => `<img src="${escapeHtml(item.url)}" alt="" title="${escapeHtml(item.name)}">`).join('');
        const label = turn.mode_hint === 'video' ? '视频生成' : (turn.mode_hint === 'image' ? '图片生成' : '设计智能体');
        return `<article class="smart-agent-turn" data-turn-id="${escapeHtml(turn.id)}"><div class="smart-agent-message user"><div class="smart-agent-bubble">${escapeHtml(turn.user_message?.content || '')}${refs ? `<div class="smart-agent-turn-refs">${refs}</div>` : ''}</div></div><div class="smart-agent-message assistant"><div class="smart-agent-label"><span>✦</span><span>${label}</span></div>${resolved ? `<small class="smart-agent-resolved">此前 ${resolved} 次失败已由成功重试解决</small>` : ''}${attempt ? runHtml(turn, attempt) : ''}</div></article>`;
    }

    function render(){
        const wasNearBottom = state.nearBottom || isNearBottom();
        const firstSequence = Math.max(1, Number(state.session.composer?.thread_start_sequence || 1));
        const turns = state.session.turns
            .filter(turn => Number(turn.sequence || 0) >= firstSequence)
            .sort((a,b) => a.sequence - b.sequence || a.created_at - b.created_at);
        let html = turns.map(renderTurn).join('');
        if(state.transient) html += `<div class="smart-agent-system-error">${escapeHtml(state.transient)}</div>`;
        if(!html) html = '<div class="smart-agent-empty"><span class="smart-agent-empty-mark">✦</span><strong>直接生成或修改图片</strong><p>输入图片需求，也可以粘贴、上传或选中画布图片作为参考。</p></div>';
        messagesEl.innerHTML = html;
        titleEl.textContent = turns.length ? state.canvasTitle : '新对话';
        sendBtn.disabled = state.loading || Boolean(state.saveStopped) || !inputEl.value.trim() || !state.canvasId;
        syncModeControl();
        if(wasNearBottom) requestAnimationFrame(() => scrollToBottom());
        else if(turns.length) unreadBtn.hidden = false;
    }

    function renderReferences(){
        const refs = uniqueReferences(state.references);
        referencesEl.hidden = !refs.length;
        referencesEl.innerHTML = refs.map((ref, index) => {
            const referenceNumber = index + 1;
            return `<div class="smart-agent-reference"><img src="${escapeHtml(ref.url)}" alt="参考图片 ${referenceNumber}"><span class="smart-agent-reference-index" aria-hidden="true">${referenceNumber}</span><button type="button" data-agent-reference-remove="${index}" aria-label="移除参考图片 ${referenceNumber}"><i data-lucide="x"></i></button></div>`;
        }).join('');
        hintEl.textContent = refs.length ? `已引用 ${refs.length} 张选中图片` : '可选中图片或输出节点作为参考';
        hintEl.hidden = !refs.length;
        window.lucide?.createIcons?.();
    }

    function resizeInput(){
        inputEl.style.height = 'auto';
        inputEl.style.height = `${Math.min(180, Math.max(46, inputEl.scrollHeight))}px`;
        state.session.composer.draft = inputEl.value;
        rememberLocal();
        sendBtn.disabled = state.loading || Boolean(state.saveStopped) || !inputEl.value.trim() || !state.canvasId;
        if(state.promptOpen) renderPromptPreview();
    }

    function setContext(context={}){
        const canvasId = String(context.canvasId || '');
        const changed = canvasId && canvasId !== state.canvasId;
        state.canvasId = canvasId;
        state.canvasTitle = String(context.title || '智能画布');
        if(changed) state.uploadedReferences = [];
        state.canvasReferences = uniqueReferences(context.references || []);
        state.references = uniqueReferences([...state.canvasReferences, ...state.uploadedReferences]);
        state.selectedAssets = Array.isArray(context.selectedAssets) ? context.selectedAssets.slice(0,8) : [];
        state.promptAssets = Array.isArray(context.promptAssets) ? context.promptAssets.slice(0,12) : [];
        document.body.classList.add('smart-agent-enabled');
        renderReferences();
        renderPromptPreview();
        if(changed){ state.route = null; state.session = core.freshSession(canvasId); state.sessionVersion = 0; loadSession(); }
        else render();
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }

    messagesEl.addEventListener('scroll', () => {
        state.nearBottom = isNearBottom();
        if(state.nearBottom) unreadBtn.hidden = true;
    }, {passive:true});

    messagesEl.addEventListener('change', event => {
        const input = event.target.closest('[data-agent-answer]');
        if(!input) return;
        const attempt = getAttempt(input.dataset.turnId, input.dataset.attemptId);
        const clarification = attempt?.run?.clarification;
        const question = clarification?.questions?.find(item => item.id === input.dataset.questionId);
        if(!attempt || !question) return;
        const answers = attempt.run.clarification_answers || (attempt.run.clarification_answers = {});
        if(question.selection === 'multiple'){
            const values = new Set(answers[question.id] || []);
            input.checked ? values.add(input.dataset.optionId) : values.delete(input.dataset.optionId);
            answers[question.id] = [...values];
        } else answers[question.id] = input.checked ? [input.dataset.optionId] : [];
        touch(attempt); markChanged();
    });

    messagesEl.addEventListener('click', event => {
        const addButton = event.target.closest('[data-agent-add-image]');
        if(addButton){
            const turn = getTurn(addButton.dataset.turnId);
            const attempt = getAttempt(addButton.dataset.turnId, addButton.dataset.attemptId);
            const result = attempt?.run?.result;
            if(!turn || !result || typeof window.addSmartCanvasAgentImage !== 'function') return;
            const nodeId = window.addSmartCanvasAgentImage({
                url:result.url, name:result.name, requestId:result.request_id, messageId:result.message_id,
                conversationId:state.session.conversation_id, sessionId:state.session.session_id,
                turnId:turn.id, attemptId:attempt.id, sourceNodeId:result.source_node_id,
                parentAssetId:result.parent_asset_id, provider:result.provider, model:result.model,
                prompt:turn.user_message?.content || '', kind:result.kind || 'image'
            });
            if(nodeId){
                result.added_node_id = nodeId;
                touch(attempt);
                markChanged();
                addButton.textContent = '已添加';
                addButton.disabled = true;
            }
            return;
        }
        const continueButton = event.target.closest('[data-agent-clarify-continue]');
        if(continueButton){ continueClarification(continueButton.dataset.agentClarifyContinue, continueButton.dataset.attemptId); return; }
        const skipButton = event.target.closest('[data-agent-clarify-skip]');
        if(skipButton){ continueClarification(skipButton.dataset.agentClarifySkip, skipButton.dataset.attemptId, true); return; }
        const retryButton = event.target.closest('[data-agent-retry]');
        if(retryButton){ retryTurn(retryButton.dataset.agentRetry); return; }
        const recoverButton = event.target.closest('[data-agent-recover]');
        if(recoverButton){ recoverTurn(recoverButton.dataset.agentRecover, recoverButton.dataset.attemptId); return; }
        const suggestion = event.target.closest('[data-agent-suggestion]');
        if(suggestion){ sendSuggestion(suggestion.dataset.turnId, suggestion.dataset.agentSuggestion); }
    });

    inputEl.addEventListener('input', resizeInput);
    inputEl.addEventListener('keydown', event => {
        if(event.key === 'Enter' && !event.shiftKey && !event.isComposing){ event.preventDefault(); send(inputEl.value); }
    });
    panel.addEventListener('paste', event => {
        const images = clipboardImageFiles(event.clipboardData);
        if(!images.length) return;
        event.preventDefault();
        event.stopPropagation();
        void uploadReferenceImages(images);
    });
    sendBtn.addEventListener('click', () => send(inputEl.value));
    imageBtn?.addEventListener('click', () => imageInputEl?.click());
    imageInputEl?.addEventListener('change', () => uploadReferenceImages(imageInputEl.files));
    promptBtn?.addEventListener('click', event => {
        event.stopPropagation();
        setPromptLibraryOpen(!state.promptOpen);
    });
    promptCloseBtn?.addEventListener('click', () => setPromptLibraryOpen(false));
    promptPreviewEl?.addEventListener('click', event => {
        const button = event.target.closest('[data-agent-prompt-template]');
        if(!button) return;
        const item = state.promptTemplates[Number(button.dataset.agentPromptTemplate)];
        if(!item) return;
        inputEl.value = promptTemplateText(item);
        setPromptLibraryOpen(false);
        resizeInput();
        inputEl.focus();
    });
    sizeBtn?.addEventListener('click', event => {
        event.stopPropagation();
        setSizePopoverOpen(!state.sizeOpen);
    });
    sizePopoverEl?.addEventListener('click', event => {
        event.stopPropagation();
        const scopeButton = event.target.closest('[data-agent-size-scope]');
        if(scopeButton){ updateComposerSize({scope:scopeButton.dataset.agentSizeScope}); return; }
        const ratioButton = event.target.closest('[data-agent-size-ratio]');
        if(ratioButton){ updateComposerSize({scope:'preset', ratio:ratioButton.dataset.agentSizeRatio}); return; }
        const tierButton = event.target.closest('[data-agent-size-tier]');
        if(tierButton){ updateComposerSize({scope:'preset', tier:tierButton.dataset.agentSizeTier}); }
    });
    customApplyBtn?.addEventListener('click', applyCustomSize);
    [customWidthEl, customHeightEl].forEach(element => element?.addEventListener('keydown', event => {
        if(event.key === 'Enter'){ event.preventDefault(); applyCustomSize(); }
    }));
    referencesEl?.addEventListener('click', event => {
        const button = event.target.closest('[data-agent-reference-remove]');
        if(!button) return;
        const ref = uniqueReferences(state.references)[Number(button.dataset.agentReferenceRemove)];
        if(!ref) return;
        state.canvasReferences = state.canvasReferences.filter(item => item.url !== ref.url);
        state.uploadedReferences = state.uploadedReferences.filter(item => item.url !== ref.url);
        combineReferences();
    });
    imageModelBtn?.addEventListener('click', event => {
        event.stopPropagation();
        void setImageModelMenuOpen(!state.imageModelOpen);
    });
    imageModelMenuEl?.addEventListener('click', event => {
        event.stopPropagation();
        if(event.target.closest('[data-agent-image-retry]')){
            state.providerCatalog = null;
            void setImageModelMenuOpen(true);
            return;
        }
        const button = event.target.closest('[data-agent-image-model]');
        if(button) selectImageModel(button.dataset.agentImageModel);
    });
    document.addEventListener('click', event => {
        if(state.imageModelOpen && !imageModelPickerEl?.contains(event.target)) void setImageModelMenuOpen(false);
        if(state.sizeOpen && !sizePickerEl?.contains(event.target)) setSizePopoverOpen(false);
    });
    window.addEventListener('resize', () => {
        if(state.imageModelOpen) positionImageModelMenu();
        if(state.sizeOpen) positionSizePopover();
    });
    window.visualViewport?.addEventListener('resize', () => {
        if(state.imageModelOpen) positionImageModelMenu();
        if(state.sizeOpen) positionSizePopover();
    });
    unreadBtn.addEventListener('click', () => scrollToBottom('smooth'));
    newBtn?.addEventListener('click', () => {
        state.session.conversation_id = '';
        state.session.active_turn_id = null;
        state.session.composer.thread_start_sequence = state.session.next_sequence;
        state.session.composer.draft = '';
        inputEl.value = '';
        state.transient = '';
        markChanged(); resizeInput(); inputEl.focus();
    });
    collapseBtn?.addEventListener('click', () => { document.body.classList.add('smart-agent-collapsed'); reopenBtn.hidden = false; window.dispatchEvent(new Event('resize')); });
    reopenBtn?.addEventListener('click', () => { document.body.classList.remove('smart-agent-collapsed'); reopenBtn.hidden = true; window.dispatchEvent(new Event('resize')); });
    window.addEventListener('smart-canvas-agent-context', event => setContext(event.detail || {}));
    window.addEventListener('beforeunload', rememberLocal);

    resizeInput();
    syncModeControl();
    window.lucide?.createIcons?.();
    const initial = typeof window.getSmartCanvasAgentContext === 'function' ? window.getSmartCanvasAgentContext() : null;
    if(initial) setContext(initial);
})();
