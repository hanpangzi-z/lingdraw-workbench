(function(root, factory){
    const api = factory();
    if(typeof module === 'object' && module.exports) module.exports = api;
    else root.ChatRequestRecovery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
    'use strict';

    async function readResponse(response){
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch(_) { /* Proxy HTML is not an API error. */ }
        const valid = data && typeof data === 'object' && !Array.isArray(data);
        if(!response.ok || !valid){
            const detail = valid ? data.detail : null;
            const message = typeof detail === 'string' ? detail : detail?.message;
            throw Object.assign(new Error(message || (response.status === 401
                ? '登录已失效，请登录后继续查询原任务'
                : response.status === 403 ? '无权查询此任务，请确认当前账号'
                : '连接中断，正在查询生成结果')), {
                httpStatus:response.status, detail, code:detail?.code || '',
                apiError:Boolean(valid && detail),
            });
        }
        return data;
    }

    function definitiveFailure(error){
        if(error?.detail?.upstream_outcome === 'unknown') return false;
        return Boolean(error?.apiError && error.httpStatus >= 400 && error.httpStatus < 500
            && ![401,403,408,409,429].includes(error.httpStatus));
    }

    // Only GET the original receipt. Never retries the paid POST.
    async function poll(requestId, options={}){
        const get = options.fetch || fetch;
        const now = options.now || Date.now;
        const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
        const deadline = now() + (options.maxDuration ?? 600000);
        let attempt = 0;
        let reason = '连接中断，正在查询生成结果';
        while(now() < deadline){
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), Math.min(20000, deadline - now()));
            try {
                const response = await get(`/api/chat/agent/requests/${encodeURIComponent(requestId)}?surface=gpt_chat`, {
                    headers:options.headers || {}, signal:controller.signal,
                });
                if(response.status === 401 || response.status === 403){
                    return {status:'paused', reason:response.status === 401
                        ? '登录已失效，请登录后继续查询原任务'
                        : '无权查询此任务，请确认当前账号', httpStatus:response.status};
                }
                if(response.status === 404){
                    reason = '暂未查到任务，正在确认结果；不会重新提交';
                } else {
                    const data = await readResponse(response);
                    if(data.request_id && data.request_id !== requestId) throw new Error('任务编号不匹配');
                    if(data.status === 'succeeded' && data.message) return data;
                    if(data.status === 'failed') return data;
                    if(data.status === 'outcome_unknown') return {...data, status:'paused', reason:'供应商结果尚未确认，请继续查询原任务；不会重新提交'};
                    reason = data.status === 'running' ? '后台仍在生成，正在查询结果' : '暂未取得完整结果，正在继续查询';
                }
            } catch(_) {
                reason = '连接中断，正在查询生成结果';
            } finally { clearTimeout(timer); }
            options.onProgress?.(reason);
            const delay = attempt++ < 5 ? 2000 : attempt < 20 ? 5000 : 10000;
            await sleep(Math.max(0, Math.min(delay, deadline - now())));
        }
        return {status:'paused', reason:'本轮查询已暂停，任务记录已保留；可继续查询，勿重复生成'};
    }

    function matches(record, conversationId, fingerprint, message, attachments){
        if(record.conversationId !== conversationId) return false;
        if(record.sendKey) return record.sendKey === fingerprint;
        // Older receipts have no options snapshot. Conservatively protect the
        // same references and prompt until their original outcome is known.
        return record.message === message && JSON.stringify((record.attachments || []).map(ref => ref.url))
            === JSON.stringify(attachments.map(ref => ref.url));
    }
    return {readResponse, definitiveFailure, poll, matches};
});
