(function(global){
    'use strict';

    function uid(prefix='id'){
        const value = global.crypto?.randomUUID ? global.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        return `${prefix}-${value}`;
    }

    function now(){ return Date.now(); }

    function detailFromError(data, fallback='请求失败'){
        const detail = data?.detail;
        if(typeof detail === 'string') return detail;
        if(detail && typeof detail === 'object') return String(detail.message || detail.detail || detail.code || fallback);
        return String(data?.message || fallback);
    }

    async function api(path, options={}){
        const headers = {...(options.headers || {})};
        if(options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
        const response = await fetch(path, {credentials:'same-origin', ...options, headers});
        const raw = await response.text();
        let data = {};
        if(raw){
            try { data = JSON.parse(raw); }
            catch(_error){ data = {detail:raw}; }
        }
        if(!response.ok){
            const error = new Error(detailFromError(data, response.statusText));
            error.status = response.status;
            error.code = typeof data?.detail === 'object' ? String(data.detail.code || '') : '';
            error.payload = data;
            throw error;
        }
        return data;
    }

    function freshSession(canvasId=''){
        const stamp = now();
        return {
            schema_version:2,
            session_id:uid(`agent-${String(canvasId || 'canvas').slice(0, 12)}`),
            conversation_id:'',
            active_turn_id:null,
            next_sequence:1,
            turns:[],
            composer:{draft:'', mode_hint:'image', image_model:'自动选择', thread_start_sequence:1},
            updated_at:stamp
        };
    }

    function normalizeAttempt(raw={}){
        const stamp = Number(raw.updated_at || raw.created_at || now());
        return {
            ...raw,
            id:String(raw.id || uid('attempt')),
            request_id:String(raw.request_id || uid('request')),
            status:String(raw.status || 'running'),
            resolved:Boolean(raw.resolved),
            assistant_messages:Array.isArray(raw.assistant_messages) ? raw.assistant_messages : [],
            run:raw.run && typeof raw.run === 'object' ? raw.run : {phase:'analyzing'},
            created_at:Number(raw.created_at || stamp),
            updated_at:stamp
        };
    }

    function normalizeTurn(raw={}, sequence=1){
        const stamp = Number(raw.updated_at || raw.created_at || now());
        const attempts = (Array.isArray(raw.attempts) ? raw.attempts : []).map(normalizeAttempt);
        if(!attempts.length) attempts.push(normalizeAttempt());
        return {
            id:String(raw.id || uid('turn')),
            sequence:Number(raw.sequence || sequence),
            parent_turn_id:String(raw.parent_turn_id || ''),
            user_message:raw.user_message && typeof raw.user_message === 'object' ? raw.user_message : {
                id:uid('message'), role:'user', content:String(raw.message || ''), created_at:stamp
            },
            references:Array.isArray(raw.references) ? raw.references : [],
            selected_assets:Array.isArray(raw.selected_assets) ? raw.selected_assets : [],
            attempts,
            active_attempt_id:String(raw.active_attempt_id || attempts.at(-1)?.id || ''),
            created_at:Number(raw.created_at || stamp),
            updated_at:stamp
        };
    }

    function normalizeSession(raw, canvasId=''){
        if(!raw || Number(raw.schema_version) !== 2) return freshSession(canvasId);
        const turns = (Array.isArray(raw.turns) ? raw.turns : []).map((turn, index) => normalizeTurn(turn, index + 1));
        turns.sort((a, b) => a.sequence - b.sequence || a.created_at - b.created_at);
        const session = {
            ...freshSession(canvasId),
            ...raw,
            schema_version:2,
            session_id:String(raw.session_id || freshSession(canvasId).session_id),
            conversation_id:String(raw.conversation_id || ''),
            active_turn_id:raw.active_turn_id ? String(raw.active_turn_id) : null,
            turns,
            composer:{
                draft:'', mode_hint:'image', image_model:'自动选择',
                ...(raw.composer && typeof raw.composer === 'object' ? raw.composer : {})
            },
            updated_at:Number(raw.updated_at || now())
        };
        session.next_sequence = Math.max(Number(raw.next_sequence || 1), ...turns.map(turn => turn.sequence + 1), 1);
        return session;
    }

    function mergeSessions(first, second, canvasId=''){
        const left = normalizeSession(first, canvasId);
        const right = normalizeSession(second, canvasId);
        const byId = new Map();
        [...left.turns, ...right.turns].forEach(turn => {
            const current = byId.get(turn.id);
            if(!current){ byId.set(turn.id, turn); return; }
            const newer = Number(turn.updated_at || 0) >= Number(current.updated_at || 0) ? turn : current;
            const attempts = new Map();
            [...current.attempts, ...turn.attempts].forEach(attempt => {
                const previous = attempts.get(attempt.id);
                if(!previous){ attempts.set(attempt.id, attempt); return; }
                const winner = Number(attempt.updated_at || 0) >= Number(previous.updated_at || 0) ? attempt : previous;
                const messages = [...(previous.assistant_messages || []), ...(attempt.assistant_messages || [])]
                    .filter((message, index, items) => items.findIndex(item => item?.id === message?.id) === index);
                attempts.set(attempt.id, {
                    ...winner,
                    assistant_messages:winner.status !== 'failed' && winner.run?.phase !== 'failed'
                        ? messages.filter(message => message?.type !== 'error')
                        : messages
                });
            });
            const mergedAttempts = [...attempts.values()].sort((a,b) => a.created_at - b.created_at);
            byId.set(turn.id, {
                ...newer,
                attempts:mergedAttempts,
                active_attempt_id:mergedAttempts.some(item => item.id === newer.active_attempt_id)
                    ? newer.active_attempt_id
                    : mergedAttempts.at(-1)?.id || ''
            });
        });
        const preferred = Number(right.updated_at || 0) >= Number(left.updated_at || 0) ? right : left;
        return normalizeSession({...preferred, turns:[...byId.values()], updated_at:Math.max(left.updated_at, right.updated_at)}, canvasId);
    }

    function activeAttempt(turn){
        return turn?.attempts?.find(item => item.id === turn.active_attempt_id) || turn?.attempts?.at(-1) || null;
    }

    function imageUrls(payload){
        const result = [];
        const append = value => {
            const url = String(value || '').trim();
            if(url && !result.includes(url)) result.push(url);
        };
        (Array.isArray(payload?.image_urls) ? payload.image_urls : []).forEach(append);
        append(payload?.image_url);
        (Array.isArray(payload?.images) ? payload.images : []).forEach(item => append(typeof item === 'string' ? item : item?.url));
        return result;
    }

    function mediaUrls(payload){
        const result = imageUrls(payload);
        const append = value => {
            const url = String(value || '').trim();
            if(url && !result.includes(url)) result.push(url);
        };
        (Array.isArray(payload?.videos) ? payload.videos : []).forEach(item => append(typeof item === 'string' ? item : item?.url));
        append(payload?.video_url);
        append(payload?.url);
        return result;
    }

    function summarizePriorTurns(session, beforeSequence=Infinity){
        if(session?.composer?.mode_hint === 'new_session') return [];
        const firstSequence = Math.max(1, Number(session?.composer?.thread_start_sequence || 1));
        return session.turns
            .filter(turn => turn.sequence < beforeSequence && turn.sequence >= firstSequence)
            .slice(-6)
            .map(turn => {
                const attempt = activeAttempt(turn);
                const run = attempt?.run || {};
                const route = String(run.route || run.executionRoute || '');
                const confirmedAnswers = run.clarification_answers || run.clarificationAnswers || {};
                const result = run.result || (run.imageUrl ? {
                    url:run.imageUrl,
                    name:run.imageName || '',
                    request_id:attempt?.request_id || ''
                } : null);
                const review = run.review || null;
                return {
                    turn_id:turn.id,
                    parent_turn_id:turn.parent_turn_id || '',
                    user_message:String(turn.user_message?.content || '').slice(0, 1200),
                    user_request:String(turn.user_message?.content || '').slice(0, 1200),
                    route,
                    clarification:confirmedAnswers,
                    confirmed_answers:confirmedAnswers,
                    plan:run.plan || null,
                    result:result ? {
                        url:result.url,
                        name:result.name,
                        request_id:result.request_id || attempt?.request_id || '',
                        parent_asset_id:result.parent_asset_id || ''
                    } : null,
                    review:review ? {passed:review.passed, overall_score:review.overall_score, conclusion:review.conclusion} : null,
                    quality:review ? {passed:review.passed, score:review.overall_score, conclusion:review.conclusion} : null
                };
            });
    }

    function providerModels(provider, type=''){
        const declared = Array.isArray(provider?.models) ? provider.models : [];
        const typed = declared
            .filter(model => !type || String(model?.type || model?.category || '').toLowerCase() === type)
            .map(model => typeof model === 'string' ? {id:model, name:model, type} : model);
        const catalog = Array.isArray(provider?.[`${type}_models`]) ? provider[`${type}_models`] : [];
        const catalogItems = catalog.map(model => typeof model === 'string'
            ? {id:model, name:provider?.model_names?.[model] || model, type}
            : {...model, type:model?.type || type});
        return [...typed, ...catalogItems].filter((model, index, items) => {
            const id = String(model?.id || model?.name || '');
            return id && items.findIndex(item => String(item?.id || item?.name || '') === id) === index;
        });
    }

    function availableChatModelOptions(payload={}){
        return (Array.isArray(payload?.providers) ? payload.providers : [])
            .filter(provider => provider?.enabled !== false && provider?.available !== false && providerModels(provider, 'chat').length)
            .flatMap(provider => providerModels(provider, 'chat').map(model => ({
                value:`${String(provider.id || provider.name || '')}::${String(model.id || model.name || '')}`,
                model:String(model.id || model.name || ''),
                name:String(model.name || model.id || ''),
                providerId:String(provider.id || provider.name || ''),
                providerName:String(provider.name || provider.id || '')
            })));
    }

    function availableImageModelOptions(payload={}){
        return (Array.isArray(payload?.providers) ? payload.providers : [])
            .filter(provider => provider?.enabled !== false && provider?.available !== false && providerModels(provider, 'image').length)
            .flatMap(provider => providerModels(provider, 'image').map(model => ({
                value:`${String(provider.id || provider.name || '')}::${String(model.id || model.name || '')}`,
                model:String(model.id || model.name || ''),
                name:String(model.name || model.id || ''),
                providerId:String(provider.id || provider.name || ''),
                providerName:String(provider.name || provider.id || '')
            })));
    }

    function resolveGenerationRoute(payload={}, requestedImageModel='自动选择'){
        const providers = (Array.isArray(payload?.providers) ? payload.providers : []).filter(item => item?.enabled !== false);
        const models = providerModels;
        const supports = (provider, type) => models(provider, type).length > 0;
        const usable = provider => provider?.available !== false && (provider?.has_key !== false || ['comfyui','runninghub'].includes(String(provider?.protocol || '').toLowerCase()));
        const imageProviders = providers.filter(provider => usable(provider) && supports(provider, 'image'));
        const chatProviders = providers.filter(provider => usable(provider) && supports(provider, 'chat'));
        const videoProviders = providers.filter(provider => usable(provider) && supports(provider, 'video'));
        const requested = String(requestedImageModel || '').trim();
        const separator = requested.indexOf('::');
        const requestedProviderId = separator > 0 ? requested.slice(0, separator) : '';
        const requestedModelName = separator > 0 ? requested.slice(separator + 2) : requested;
        const hasExplicitImageRequest = Boolean(requested && requested !== '自动选择');
        const exactImage = hasExplicitImageRequest
            ? imageProviders.flatMap(provider => models(provider, 'image').map(model => ({provider, model})))
                .find(candidate =>
                    (!requestedProviderId || String(candidate.provider.id || candidate.provider.name || '') === requestedProviderId)
                    && String(candidate.model.id || candidate.model.name || '').toLowerCase() === requestedModelName.toLowerCase()
                )
            : null;
        const imageProvider = exactImage?.provider
            || imageProviders.find(provider => provider.primary)
            || imageProviders[0]
            || providers[0]
            || {};
        const imageModels = models(imageProvider, 'image');
        const selectedImageModel = exactImage?.model || imageModels[0] || {};
        const chatProvider = chatProviders.find(provider => provider.primary) || chatProviders[0] || imageProvider || {};
        const chatModel = models(chatProvider, 'chat')[0] || {};
        const videoProvider = videoProviders[0] || {};
        const videoModels = models(videoProvider, 'video');
        return {
            provider:String(chatProvider.id || chatProvider.name || ''),
            chat_model:String(chatModel.id || chatModel.name || ''),
            allow_chat_fallback:true,
            image_provider:String(imageProvider.id || imageProvider.name || ''),
            image_model:String(selectedImageModel.id || selectedImageModel.name || (hasExplicitImageRequest ? requestedModelName : '')),
            video_provider:String(videoProvider.id || videoProvider.name || ''),
            video_model:String(videoModels[0]?.id || videoModels[0]?.name || '')
        };
    }

    async function pollAgentRequest(requestId, canvasId, options={}){
        const attempts = Number(options.attempts || 10);
        const interval = Number(options.interval || 1500);
        for(let index=0; index<attempts; index += 1){
            const result = await api(`/api/chat/agent/requests/${encodeURIComponent(requestId)}?surface=design_agent&context_id=${encodeURIComponent(canvasId)}`);
            const status = String(result?.status || result?.request?.status || '').toLowerCase();
            if(['succeeded','completed','success'].includes(status)) return result;
            if(['failed','cancelled'].includes(status)){
                const error = new Error(detailFromError(result, '请求执行失败'));
                error.payload = result;
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, interval));
        }
        const error = new Error('结果状态暂时未知，可稍后恢复。');
        error.code = 'outcome_unknown';
        throw error;
    }

    global.LingDrawAgentWorkbench = {
        uid, now, api, detailFromError, freshSession, normalizeSession, mergeSessions,
        normalizeAttempt, normalizeTurn, activeAttempt, imageUrls, summarizePriorTurns,
        resolveGenerationRoute, availableChatModelOptions, availableImageModelOptions, pollAgentRequest, mediaUrls
    };
})(window);
