(function(root) {
    'use strict';
    function dimensions(value, aligned = false) {
        if(!value || !['width','height'].every(key => Number.isInteger(value[key]) && value[key] >= 1 && value[key] <= 4096 && (!aligned || value[key] % 16 === 0))) throw new Error('画布像素尺寸无效，请重新导入');
        return {width:value.width,height:value.height};
    }
    function validate(payload, origin) {
        const {requestId} = payload;
        if(typeof requestId !== 'string' || !requestId || requestId.length > 100) throw new Error('画布导入标识无效');
        // Accept the previous single-image payload while already-open frames update.
        const mode = payload.mode || 'legacy';
        if(!['annotation', 'sketch', 'legacy'].includes(mode)) throw new Error('画布用途无效');
        const incoming = Array.isArray(payload.references) ? payload.references : [payload.reference];
        if(incoming.length !== (mode === 'annotation' ? 2 : 1)) throw new Error('原图或标注说明图缺失，请重新导入');
        const references = incoming.map((reference, index) => {
            if(typeof reference?.url !== 'string') throw new Error('画布图片无效，请重试');
            const url = new URL(reference.url, origin);
            if(url.origin !== origin || url.username || url.password || !url.pathname.startsWith('/assets/')) throw new Error('画布图片无效，请重试');
            const role = mode === 'annotation' ? (index === 0 ? 'source' : 'annotation') : mode === 'sketch' ? 'sketch' : '';
            if(mode !== 'legacy' && reference.role !== role) throw new Error('原图与标注说明图顺序无效');
            return {url:url.pathname + url.search, name:String(reference.name || '画布.png').slice(0,160), kind:'image', mime:String(reference.mime || 'image/png'), role, annotation_group:mode === 'annotation' ? requestId : ''};
        });
        const prompt = String(payload.prompt || '').trim();
        if(prompt.length > 7000 || (mode === 'annotation' && !prompt)) throw new Error('请补充具体修改说明后重新导入');
        const sizes = payload.canvasSize || payload.generationSize
            ? {canvasSize:dimensions(payload.canvasSize),generationSize:dimensions(payload.generationSize,true)} : {};
        return {requestId, mode, references, prompt, ...sizes};
    }

    function mergeDraft(refs, currentPrompt, payload, maximum) {
        if(refs.length + payload.references.length > maximum) throw new Error(`本次需要 ${payload.references.length} 个附件位置，请先移除部分附件后重试`);
        if(payload.mode === 'annotation' && refs.some(ref => ref.annotation_group || ref.role === 'annotation')) throw new Error('输入框已有一组标注改图，请先移除旧的原图和标注图后再导入');
        return { refs:[...refs, ...payload.references], prompt:[String(currentPrompt || '').trim(), payload.prompt].filter(Boolean).join('\n\n') };
    }

    function removeReference(refs, index) {
        const group = refs[index]?.annotation_group;
        return refs.filter((ref, i) => group ? ref.annotation_group !== group : i !== index);
    }
    const api = {validate, mergeDraft, removeReference};
    if(typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.LingDrawDrawingHandoff = api;
})(typeof window !== 'undefined' ? window : globalThis);
