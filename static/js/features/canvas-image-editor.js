// Cold-loaded classic canvas image editor. Keep global function names for inline handlers.
function cropBounds(){
    const img = document.getElementById('cropImage');
    return {w:img.clientWidth || 1, h:img.clientHeight || 1};
}
function editDrawCanvas(){
    return document.getElementById('editDrawCanvas');
}
function editTextCanvas(){
    return document.getElementById('editTextCanvas');
}
function editTextContext(){
    return editTextCanvas()?.getContext('2d') || null;
}
function selectedEditTextItem(){
    return editTextItems.find(item => item.id === editTextSelectedId) || null;
}
function defaultEditTextText(){
    return langIsEn() ? 'Double-click to edit' : '双击编辑';
}
function editTextSizeFromBrush(){
    return Math.max(14, Math.min(120, Math.round(editBrushSize() * 2)));
}
function createEditTextItem(text, point, preset={}){
    const size = Math.max(10, Math.min(120, Number(preset.size) || editTextSizeFromBrush()));
    return {
        id: uid('txt'),
        text: String(text || defaultEditTextText()).trim(),
        x: Number(point?.x || 0),
        y: Number(point?.y || 0),
        color: preset.color || brushColor(),
        size,
    };
}
function textItemFont(item){
    const size = Math.max(10, Math.min(120, Number(item?.size) || 28));
    return `900 ${size}px Arial, sans-serif`;
}
function measureEditTextItem(item, ctx=editTextContext()){
    if(!item || !ctx) return {x:0, y:0, w:0, h:0};
    const size = Math.max(10, Math.min(120, Number(item.size) || 28));
    ctx.save();
    ctx.font = textItemFont(item);
    const metrics = ctx.measureText(String(item.text || ''));
    ctx.restore();
    const width = Math.max(1, metrics.width || 1);
    const ascent = Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : size * 0.8;
    const descent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : size * 0.25;
    const pad = Math.max(4, Math.round(size * 0.18));
    return {
        x: item.x - width / 2 - pad,
        y: item.y - (ascent + descent) / 2 - pad,
        w: width + pad * 2,
        h: ascent + descent + pad * 2,
        textW: width,
        textH: ascent + descent,
        pad
    };
}
function hitEditTextItem(point){
    const ctx = editTextContext();
    if(!ctx) return null;
    for(let i = editTextItems.length - 1; i >= 0; i--){
        const item = editTextItems[i];
        const box = measureEditTextItem(item, ctx);
        if(point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) return item;
    }
    return null;
}
function renderEditTextCanvas(){
    const canvasEl = editTextCanvas();
    const ctx = editTextContext();
    if(!canvasEl || !ctx) return;
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    editTextItems.forEach(item => {
        if(!item?.text) return;
        const selected = item.id === editTextSelectedId;
        const box = measureEditTextItem(item, ctx);
        ctx.save();
        ctx.font = textItemFont(item);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = item.color || brushColor();
        ctx.strokeStyle = 'rgba(255,255,255,.92)';
        ctx.lineWidth = Math.max(2, (Number(item.size) || 28) / 8);
        ctx.strokeText(String(item.text || ''), item.x, item.y);
        ctx.fillText(String(item.text || ''), item.x, item.y);
        if(selected){
            ctx.setLineDash([7, 5]);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(15,23,42,.72)';
            ctx.strokeRect(box.x, box.y, box.w, box.h);
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(15,23,42,.92)';
            ctx.beginPath();
            ctx.arc(item.x + box.w / 2 - box.pad, item.y - box.h / 2 + box.pad, 3.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    });
    positionEditTextInlineEditor();
}
function syncTextToolState(force=false){
    const selected = selectedEditTextItem();
    const cropCanvasEl = document.getElementById('cropCanvas');
    cropCanvasEl?.classList.toggle('text-mode', imageEditMode === 'brush' && brushTool === 'text');
}
function syncSelectedEditTextStyleFromBrush(){
    if(imageEditMode !== 'brush' || brushTool !== 'text' || editTextInlineEditor) return;
    const item = selectedEditTextItem();
    if(!item) return;
    const nextSize = editTextSizeFromBrush();
    const nextColor = brushColor();
    if(item.size === nextSize && item.color === nextColor) return;
    beginTextEditChange();
    item.size = nextSize;
    item.color = nextColor;
    renderEditTextCanvas();
    syncTextToolState(true);
}
function beginTextEditChange(){
    if(editTextDirty) return;
    pushEditDrawHistory();
    editTextDirty = true;
}
function setSelectedEditTextItem(id){
    editTextSelectedId = id || '';
    renderEditTextCanvas();
    syncTextToolState(true);
}
function confirmSelectedEditTextItem(){
    const selected = selectedEditTextItem();
    if(!selected) return false;
    if(!String(selected.text || '').trim()){
        editTextItems = editTextItems.filter(item => item.id !== selected.id);
    }
    editTextSelectedId = '';
    editTextDrag = null;
    editTextDirty = false;
    renderEditTextCanvas();
    syncTextToolState(true);
    return true;
}
function editTextCanvasScale(){
    const canvasEl = editTextCanvas();
    const rect = canvasEl?.getBoundingClientRect?.();
    return {
        x:(rect?.width || canvasEl?.width || 1) / Math.max(1, canvasEl?.width || 1),
        y:(rect?.height || canvasEl?.height || 1) / Math.max(1, canvasEl?.height || 1),
        rect
    };
}
function selectInlineEditorText(el){
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}
function inlineEditorText(){
    return String(editTextInlineEditor?.el?.innerText || editTextInlineEditor?.el?.textContent || '').replace(/\u00a0/g, ' ');
}
function autosizeEditTextInlineEditor(){
    const editor = editTextInlineEditor;
    if(!editor?.el) return;
    const el = editor.el;
    el.style.width = 'auto';
    el.style.height = 'auto';
    const minW = Number(editor.minW || 48);
    const minH = Number(editor.minH || 28);
    el.style.width = `${Math.max(minW, el.scrollWidth + 10)}px`;
    el.style.height = `${Math.max(minH, el.scrollHeight + 4)}px`;
}
function positionEditTextInlineEditor(){
    const editor = editTextInlineEditor;
    if(!editor?.el) return;
    const item = editTextItems.find(x => x.id === editor.itemId);
    const canvasEl = editTextCanvas();
    const cropCanvasEl = document.getElementById('cropCanvas');
    if(!item || !canvasEl || !cropCanvasEl) return;
    const ctx = editTextContext();
    const box = measureEditTextItem(item, ctx);
    const scale = editTextCanvasScale();
    const hostRect = cropCanvasEl.getBoundingClientRect();
    const canvasRect = scale.rect || canvasEl.getBoundingClientRect();
    const left = canvasRect.left - hostRect.left + box.x * scale.x;
    const top = canvasRect.top - hostRect.top + box.y * scale.y;
    const w = Math.max(48, box.w * scale.x);
    const h = Math.max(28, box.h * scale.y);
    editor.minW = w;
    editor.minH = h;
    editor.el.style.left = `${left}px`;
    editor.el.style.top = `${top}px`;
    editor.el.style.minWidth = `${w}px`;
    editor.el.style.minHeight = `${h}px`;
    editor.el.style.font = `900 ${Math.max(10, (Number(item.size) || 28) * scale.y)}px Arial, sans-serif`;
    editor.el.style.color = item.color || brushColor();
    autosizeEditTextInlineEditor();
}
function removeEditTextInlineEditor(commit=true){
    const editor = editTextInlineEditor;
    if(!editor) return;
    const item = editTextItems.find(x => x.id === editor.itemId);
    const next = inlineEditorText().trim();
    editTextInlineEditor = null;
    editor.el.remove();
    if(!item) return;
    if(commit){
        if(next !== String(editor.before || '')){
            beginTextEditChange();
            if(next){
                item.text = next;
            } else {
                editTextItems = editTextItems.filter(x => x.id !== item.id);
                editTextSelectedId = '';
            }
        }
    } else {
        item.text = editor.before || item.text || defaultEditTextText();
    }
    editTextDirty = false;
    renderEditTextCanvas();
    syncTextToolState(true);
}
function beginEditTextInline(item){
    if(!item) return;
    removeEditTextInlineEditor(true);
    editTextSelectedId = item.id;
    const host = document.getElementById('cropCanvas');
    if(!host) return;
    const el = document.createElement('div');
    el.className = 'edit-text-inline';
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.textContent = item.text || defaultEditTextText();
    host.appendChild(el);
    editTextInlineEditor = {el, itemId:item.id, before:item.text || ''};
    positionEditTextInlineEditor();
    el.addEventListener('input', autosizeEditTextInlineEditor);
    el.addEventListener('keydown', event => {
        if(event.key === 'Enter' && !event.shiftKey){
            event.preventDefault();
            removeEditTextInlineEditor(true);
        } else if(event.key === 'Escape'){
            event.preventDefault();
            removeEditTextInlineEditor(false);
        }
    });
    el.addEventListener('blur', () => removeEditTextInlineEditor(true));
    requestAnimationFrame(() => {
        el.focus();
        selectInlineEditorText(el);
    });
    renderEditTextCanvas();
    syncTextToolState(true);
}
function editTextPoint(event){
    return editDrawPoint(event);
}
function beginEditText(event){
    if(imageEditMode !== 'brush' || brushTool !== 'text') return;
    event.preventDefault();
    event.stopPropagation();
    removeEditTextInlineEditor(true);
    const canvasEl = editTextCanvas();
    const point = editTextPoint(event);
    const hit = hitEditTextItem(point);
    if(hit){
        editTextSelectedId = hit.id;
        editTextDrag = {
            id: hit.id,
            pointerId: event.pointerId,
            startX: hit.x,
            startY: hit.y,
            sx: event.clientX,
            sy: event.clientY,
            moved: false,
            hasHistory: false
        };
        canvasEl.setPointerCapture?.(event.pointerId);
        canvasEl.style.cursor = 'grabbing';
        syncTextToolState(true);
        renderEditTextCanvas();
        return;
    }
    if(selectedEditTextItem()){
        confirmSelectedEditTextItem();
        return;
    }
    beginTextEditChange();
    const item = createEditTextItem(defaultEditTextText(), point, {color:brushColor(), size:editTextSizeFromBrush()});
    editTextItems.push(item);
    editTextSelectedId = item.id;
    canvasEl.style.cursor = 'text';
    renderEditTextCanvas();
    syncTextToolState(true);
}
function updateEditTextCursor(event){
    const canvasEl = editTextCanvas();
    if(!canvasEl || imageEditMode !== 'brush' || brushTool !== 'text') return;
    const hit = hitEditTextItem(editTextPoint(event));
    canvasEl.style.cursor = hit ? 'move' : 'text';
}
function moveEditText(event){
    if(!editTextDrag){
        updateEditTextCursor(event);
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    const item = editTextItems.find(x => x.id === editTextDrag.id);
    if(!item) return;
    const dx = event.clientX - editTextDrag.sx;
    const dy = event.clientY - editTextDrag.sy;
    if(!editTextDrag.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    editTextDrag.moved = true;
    if(!editTextDrag.hasHistory){
        beginTextEditChange();
        editTextDrag.hasHistory = true;
    }
    const canvasEl = editTextCanvas();
    const rect = canvasEl?.getBoundingClientRect?.();
    const scaleX = canvasEl ? canvasEl.width / Math.max(1, rect?.width || canvasEl.width) : 1;
    const scaleY = canvasEl ? canvasEl.height / Math.max(1, rect?.height || canvasEl.height) : 1;
    item.x = editTextDrag.startX + dx * scaleX;
    item.y = editTextDrag.startY + dy * scaleY;
    renderEditTextCanvas();
}
function endEditText(event){
    if(editTextDrag && event?.pointerId != null) editTextCanvas()?.releasePointerCapture?.(event.pointerId);
    editTextDrag = null;
    editTextDirty = false;
    renderEditTextCanvas();
    syncTextToolState(true);
    if(event) updateEditTextCursor(event);
}
function editTextHasContent(){
    return editTextItems.some(item => String(item?.text || '').trim().length > 0);
}
function resizeEditTextCanvas(){
    const img = document.getElementById('cropImage');
    const canvasEl = editTextCanvas();
    if(!img || !canvasEl) return;
    const w = Math.max(1, img.naturalWidth || img.clientWidth || 1);
    const h = Math.max(1, img.naturalHeight || img.clientHeight || 1);
    if(canvasEl.width !== w) canvasEl.width = w;
    if(canvasEl.height !== h) canvasEl.height = h;
    canvasEl.style.width = `${img.clientWidth || 1}px`;
    canvasEl.style.height = `${img.clientHeight || 1}px`;
    renderEditTextCanvas();
}
function resizeEditDrawCanvas(){
    const img = document.getElementById('cropImage');
    const canvasEl = editDrawCanvas();
    const w = Math.max(1, img.naturalWidth || img.clientWidth || 1);
    const h = Math.max(1, img.naturalHeight || img.clientHeight || 1);
    if(canvasEl.width !== w || canvasEl.height !== h){
        canvasEl.width = w;
        canvasEl.height = h;
    }
    canvasEl.style.width = `${img.clientWidth || 1}px`;
    canvasEl.style.height = `${img.clientHeight || 1}px`;
    resizeEditTextCanvas();
    if(imageEditMode === 'grid') refreshGridSplitPreview();
}
function setImageEditMode(mode, userTouched=false){
    if(userTouched) imageEditModeTouched = true;
    const prevImageEditMode = imageEditMode;
    if(mode !== 'brush') removeEditTextInlineEditor(true);
    imageEditMode = ['preview','crop','outpaint','mask','brush','resize','grid'].includes(mode) ? mode : 'crop';
    const isPreview = imageEditMode === 'preview';
    const cropCanvasEl = document.getElementById('cropCanvas');
    cropCanvasEl.classList.toggle('preview-mode', isPreview);
    cropCanvasEl.classList.toggle('mask-mode', imageEditMode === 'mask');
    cropCanvasEl.classList.toggle('brush-mode', imageEditMode === 'brush');
    cropCanvasEl.classList.toggle('resize-mode', imageEditMode === 'resize');
    cropCanvasEl.classList.toggle('grid-mode', imageEditMode === 'grid');
    cropCanvasEl.classList.toggle('outpaint-mode', imageEditMode === 'outpaint');
    _syncGridCustomCursor();
    document.querySelectorAll('[data-image-edit-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.imageEditMode === imageEditMode));
    document.getElementById('imageCropTools')?.classList.toggle('active', imageEditMode === 'crop');
    document.getElementById('imageMaskTools').classList.toggle('active', imageEditMode === 'mask');
    document.getElementById('imageBrushTools').classList.toggle('active', imageEditMode === 'brush');
    document.getElementById('imageResizeTools')?.classList.toggle('active', imageEditMode === 'resize');
    document.getElementById('imageGridTools').classList.toggle('active', imageEditMode === 'grid');
    syncGridGapValue();
    syncImageResizeControls();
    const title = document.getElementById('imageEditTitle');
    const sub = document.getElementById('imageEditSub');
    const apply = document.getElementById('imageEditApplyBtn');
    if(isPreview){
        apply.style.display = 'none';
        title.textContent = tr('canvas.previewImage');
        sub.textContent = tr('canvas.previewHint');
    } else {
        apply.style.display = '';
        if(imageEditMode === 'resize'){
            title.textContent = '缩放图片';
            sub.textContent = '选择缩小倍数，应用会替换当前原图';
            apply.innerHTML = `<i data-lucide="minimize-2" class="w-4 h-4"></i><span>应用缩放</span>`;
        } else {
            const icon = imageEditMode === 'crop' ? 'crop' : imageEditMode === 'outpaint' ? 'expand' : imageEditMode === 'mask' ? 'brush' : imageEditMode === 'brush' ? 'paintbrush' : 'grid-3x3';
            const labelKey = imageEditMode === 'crop' ? 'canvas.applyCrop' : imageEditMode === 'outpaint' ? 'canvas.applyOutpaint' : imageEditMode === 'mask' ? 'canvas.applyMask' : imageEditMode === 'brush' ? 'canvas.applyBrush' : 'canvas.applyGrid';
            const titleKey = imageEditMode === 'crop' ? 'canvas.cropImage' : imageEditMode === 'outpaint' ? 'canvas.outpaintImage' : imageEditMode === 'mask' ? 'canvas.maskEdit' : imageEditMode === 'brush' ? 'canvas.brushEdit' : 'canvas.modeGrid';
            const subKey = imageEditMode === 'crop' ? 'canvas.cropHint' : imageEditMode === 'outpaint' ? 'canvas.outpaintHint' : imageEditMode === 'mask' ? 'canvas.maskHint2' : imageEditMode === 'brush' ? 'canvas.brushHint' : 'canvas.gridHint';
            title.textContent = tr(titleKey);
            sub.textContent = tr(subKey);
            apply.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4"></i><span>${tr(labelKey)}</span>`;
        }
    }
    resizeEditDrawCanvas();
    if(isPreview) clearEditDrawing(true);
    else if(imageEditMode === 'grid') refreshGridSplitPreview();
    else if(imageEditMode === 'outpaint') resetOutpaintBox();
    else if(imageEditMode === 'crop' || imageEditMode === 'resize') clearEditDrawing(true);
    else if(prevImageEditMode === 'grid') clearEditDrawing(true); // 离开 grid 时主动清掉画布上残留的分割线预览
    syncEditDrawingHistoryButtons();
    syncBrushToolButtons();
    syncTextToolState(true);
    refreshIcons();
}
function editDrawSnapshot(){
    const canvasEl = editDrawCanvas();
    return {
        imageData: canvasEl.getContext('2d').getImageData(0, 0, canvasEl.width, canvasEl.height),
        labelCounter: brushLabelCounter,
        textItems: editTextItems.map(item => ({...item})),
        textSelectedId: editTextSelectedId || '',
    };
}
function restoreEditDrawSnapshot(snapshot){
    if(!snapshot) return;
    removeEditTextInlineEditor(false);
    const canvasEl = editDrawCanvas();
    const imageData = snapshot.imageData || snapshot;
    canvasEl.getContext('2d').putImageData(imageData, 0, 0);
    if(snapshot.labelCounter) brushLabelCounter = snapshot.labelCounter;
    editTextItems = (snapshot.textItems || []).map(item => ({...item}));
    editTextSelectedId = snapshot.textSelectedId || '';
    renderEditTextCanvas();
    syncTextToolState(true);
}
function pushEditDrawHistory(){
    editDrawUndoStack.push(editDrawSnapshot());
    if(editDrawUndoStack.length > EDIT_DRAW_HISTORY_MAX) editDrawUndoStack.shift();
    editDrawRedoStack = [];
    syncEditDrawingHistoryButtons();
}
function syncEditDrawingHistoryButtons(){
    ['maskUndoBtn','brushUndoBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if(btn){ btn.disabled = !editDrawUndoStack.length; btn.style.opacity = editDrawUndoStack.length ? '1' : '.42'; }
    });
    ['maskRedoBtn','brushRedoBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if(btn){ btn.disabled = !editDrawRedoStack.length; btn.style.opacity = editDrawRedoStack.length ? '1' : '.42'; }
    });
}
function undoEditDrawing(){
    if(!editDrawUndoStack.length) return;
    editDrawRedoStack.push(editDrawSnapshot());
    restoreEditDrawSnapshot(editDrawUndoStack.pop());
    syncEditDrawingHistoryButtons();
}
function redoEditDrawing(){
    if(!editDrawRedoStack.length) return;
    editDrawUndoStack.push(editDrawSnapshot());
    restoreEditDrawSnapshot(editDrawRedoStack.pop());
    syncEditDrawingHistoryButtons();
}
function clearEditDrawing(silent=false){
    removeEditTextInlineEditor(false);
    const canvasEl = editDrawCanvas();
    if(!silent && editCanvasHasPixels()) pushEditDrawHistory();
    canvasEl.getContext('2d').clearRect(0, 0, canvasEl.width, canvasEl.height);
    const textCanvasEl = editTextCanvas();
    textCanvasEl?.getContext('2d')?.clearRect(0, 0, textCanvasEl.width, textCanvasEl.height);
    editTextItems = [];
    editTextSelectedId = '';
    editTextDrag = null;
    editTextDirty = false;
    brushLabelCounter = 1;
    syncTextToolState(true);
    syncEditDrawingHistoryButtons();
}
function resetEditDrawingHistory(){
    removeEditTextInlineEditor(false);
    editDrawUndoStack = [];
    editDrawRedoStack = [];
    brushLabelCounter = 1;
    editTextItems = [];
    editTextSelectedId = '';
    editTextDrag = null;
    editTextDirty = false;
    renderEditTextCanvas();
    syncTextToolState(true);
    syncEditDrawingHistoryButtons();
}
function setBrushTool(tool){
    if(tool !== 'text') removeEditTextInlineEditor(true);
    brushTool = ['free','rect','ellipse','label','text'].includes(tool) ? tool : 'free';
    syncBrushToolButtons();
    syncTextToolState(true);
}
function syncBrushToolButtons(){
    document.querySelectorAll('[data-brush-tool]').forEach(btn => {
        const active = btn.dataset.brushTool === brushTool;
        btn.classList.toggle('primary', active);
        btn.classList.toggle('secondary', !active);
    });
    const cropCanvasEl = document.getElementById('cropCanvas');
    cropCanvasEl?.classList.toggle('text-mode', imageEditMode === 'brush' && brushTool === 'text');
}
function editDrawPoint(event){
    const canvasEl = editDrawCanvas();
    const rect = canvasEl.getBoundingClientRect();
    return {
        x:(event.clientX - rect.left) * canvasEl.width / Math.max(1, rect.width),
        y:(event.clientY - rect.top) * canvasEl.height / Math.max(1, rect.height),
    };
}
function gridCustomLineHit(point){
    if(!gridCustomLines.length) return -1;
    const canvasEl = editDrawCanvas();
    const threshold = Math.max(8, Math.min(canvasEl.width, canvasEl.height) / 80);
    let best = -1;
    let bestDist = Infinity;
    gridCustomLines.forEach((line, index) => {
        const dist = line.type === 'h'
            ? Math.abs(point.y - line.pos * canvasEl.height)
            : Math.abs(point.x - line.pos * canvasEl.width);
        if(dist < bestDist && dist <= threshold){
            best = index;
            bestDist = dist;
        }
    });
    return best;
}
function setGridCustomLinePos(index, point){
    const canvasEl = editDrawCanvas();
    const line = gridCustomLines[index];
    if(!line) return;
    line.pos = line.type === 'h'
        ? Math.max(0.001, Math.min(0.999, point.y / Math.max(1, canvasEl.height)))
        : Math.max(0.001, Math.min(0.999, point.x / Math.max(1, canvasEl.width)));
}
function editBrushSize(){
    const id = imageEditMode === 'mask' ? 'maskBrushSize' : 'paintBrushSize';
    return Number(document.getElementById(id)?.value || 20);
}
function brushColor(){
    return document.getElementById('paintBrushColor')?.value || '#ff2d55';
}
const MASK_BRUSH_ALPHA = 115;
const MASK_BRUSH_RGB = [37, 99, 235];
const MASK_BRUSH_COLOR = `rgba(${MASK_BRUSH_RGB.join(',')},${MASK_BRUSH_ALPHA / 255})`;
function setupDrawStyle(ctx){
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = editBrushSize();
    ctx.strokeStyle = imageEditMode === 'mask' ? MASK_BRUSH_COLOR : brushColor();
    ctx.fillStyle = imageEditMode === 'mask' ? MASK_BRUSH_COLOR : brushColor();
    ctx.globalCompositeOperation = 'source-over';
}
function normalizeMaskPreviewCanvas(canvasEl=editDrawCanvas()){
    if(imageEditMode !== 'mask' || !canvasEl?.width || !canvasEl?.height) return;
    const ctx = canvasEl.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
    const data = imageData.data;
    let changed = false;
    for(let i = 0; i < data.length; i += 4){
        if(data[i + 3] <= 0) continue;
        data[i] = MASK_BRUSH_RGB[0];
        data[i + 1] = MASK_BRUSH_RGB[1];
        data[i + 2] = MASK_BRUSH_RGB[2];
        if(data[i + 3] > MASK_BRUSH_ALPHA) data[i + 3] = MASK_BRUSH_ALPHA;
        changed = true;
    }
    if(changed) ctx.putImageData(imageData, 0, 0);
}
function circledNumber(n){
    if(n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
    return String(n);
}
function drawBrushShape(ctx, start, end, preview=false){
    setupDrawStyle(ctx);
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    if(brushTool === 'rect'){
        ctx.strokeRect(x, y, w, h);
    } else if(brushTool === 'ellipse'){
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
    }
}
function drawNumberLabel(point){
    const canvasEl = editDrawCanvas();
    const ctx = canvasEl.getContext('2d');
    const size = Math.max(18, editBrushSize() * 2.2);
    const text = circledNumber(brushLabelCounter++);
    setupDrawStyle(ctx);
    ctx.save();
    ctx.font = `900 ${size}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeText(text, point.x, point.y);
    ctx.fillStyle = brushColor();
    ctx.fillText(text, point.x, point.y);
    ctx.restore();
}
function beginEditDraw(event){
    if(imageEditMode === 'crop') return;
    if(imageEditMode === 'grid'){
        if(!gridCustomMode) return;
        // 自定义模式：拖动已有线，或点击空白处放置新线
        event.preventDefault();
        event.stopPropagation();
        const canvasEl = editDrawCanvas();
        canvasEl.setPointerCapture?.(event.pointerId);
        const point = editDrawPoint(event);
        const hitIndex = gridCustomLineHit(point);
        gridCustomHistory.push([...gridCustomLines.map(line => ({...line}))]);
        if(hitIndex >= 0){
            gridCustomDrag = {index: hitIndex, pointerId: event.pointerId};
            setGridCustomLinePos(hitIndex, point);
            refreshGridSplitPreview();
            _syncGridCustomUndoBtn();
            return;
        }
        const rect = canvasEl.getBoundingClientRect();
        const fracX = Math.max(0.001, Math.min(0.999, (event.clientX - rect.left) / rect.width));
        const fracY = Math.max(0.001, Math.min(0.999, (event.clientY - rect.top) / rect.height));
        gridCustomLines.push({type: gridCustomOrientation, pos: gridCustomOrientation === 'h' ? fracY : fracX});
        gridCustomDrag = {index: gridCustomLines.length - 1, pointerId: event.pointerId};
        _syncGridCustomUndoBtn();
        refreshGridSplitPreview();
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    const canvasEl = editDrawCanvas();
    canvasEl.setPointerCapture?.(event.pointerId);
    const ctx = canvasEl.getContext('2d');
    const p = editDrawPoint(event);
    pushEditDrawHistory();
    if(imageEditMode === 'brush' && brushTool === 'label'){
        drawNumberLabel(p);
        editDrawState = null;
        canvasEl.releasePointerCapture?.(event.pointerId);
        syncEditDrawingHistoryButtons();
        return;
    }
    editDrawState = {x:p.x, y:p.y, sx:p.x, sy:p.y, pointerId:event.pointerId, snapshot:(imageEditMode === 'brush' && brushTool !== 'free') ? editDrawSnapshot() : null};
    setupDrawStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y + 0.01);
    if(imageEditMode === 'mask' || brushTool === 'free') ctx.stroke();
    normalizeMaskPreviewCanvas(canvasEl);
}
function moveEditDraw(event){
    if(imageEditMode === 'grid' && gridCustomMode && gridCustomDrag){
        event.preventDefault();
        event.stopPropagation();
        setGridCustomLinePos(gridCustomDrag.index, editDrawPoint(event));
        refreshGridSplitPreview();
        return;
    }
    if(!editDrawState || imageEditMode === 'crop' || imageEditMode === 'grid') return;
    event.preventDefault();
    event.stopPropagation();
    const ctx = editDrawCanvas().getContext('2d');
    const p = editDrawPoint(event);
    if(imageEditMode === 'brush' && brushTool !== 'free'){
        restoreEditDrawSnapshot(editDrawState.snapshot);
        drawBrushShape(ctx, {x:editDrawState.sx, y:editDrawState.sy}, p, true);
        return;
    }
    setupDrawStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(editDrawState.x, editDrawState.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    editDrawState.x = p.x;
    editDrawState.y = p.y;
    normalizeMaskPreviewCanvas();
}
function endEditDraw(event){
    if(editDrawState && event?.pointerId != null) editDrawCanvas().releasePointerCapture?.(event.pointerId);
    if(gridCustomDrag && event?.pointerId != null) editDrawCanvas().releasePointerCapture?.(event.pointerId);
    editDrawState = null;
    gridCustomDrag = null;
    syncEditDrawingHistoryButtons();
}
function editCanvasHasPixels(){
    if(editTextHasContent()) return true;
    const canvasEl = editDrawCanvas();
    const data = canvasEl.getContext('2d').getImageData(0, 0, canvasEl.width, canvasEl.height).data;
    for(let i = 3; i < data.length; i += 4) if(data[i] > 0) return true;
    return false;
}
function syncGridGapValue(){
    const input = document.getElementById('gridGapSize');
    const value = Math.max(0, Math.min(240, Number(input?.value || 0)));
    if(input) input.value = value;
    const label = document.getElementById('gridGapValue');
    if(label) label.textContent = String(value);
    return value;
}
function gridSplitSettings(){
    const hLines = Math.max(0, Math.min(20, Number(document.getElementById('gridHorizontalLines')?.value || 0)));
    const vLines = Math.max(0, Math.min(20, Number(document.getElementById('gridVerticalLines')?.value || 0)));
    const gap = syncGridGapValue();
    return {rows:hLines + 1, cols:vLines + 1, gap};
}
function gridSplitRects(width, height){
    if(gridCustomMode) return gridSplitRectsCustom(width, height);
    const {rows, cols, gap} = gridSplitSettings();
    const halfGap = gap / 2;
    const rects = [];
    for(let row = 0; row < rows; row++){
        const topLine = row * height / rows;
        const bottomLine = (row + 1) * height / rows;
        const y1 = Math.round(row === 0 ? 0 : topLine + halfGap);
        const y2 = Math.round(row === rows - 1 ? height : bottomLine - halfGap);
        for(let col = 0; col < cols; col++){
            const leftLine = col * width / cols;
            const rightLine = (col + 1) * width / cols;
            const x1 = Math.round(col === 0 ? 0 : leftLine + halfGap);
            const x2 = Math.round(col === cols - 1 ? width : rightLine - halfGap);
            if(x2 > x1 && y2 > y1) rects.push({row, col, x:x1, y:y1, w:x2 - x1, h:y2 - y1});
        }
    }
    return rects;
}
function gridSplitRectsCustom(width, height){
    const gap = Math.max(0, Math.min(240, Number(document.getElementById('gridGapSize')?.value || 0)));
    const halfGap = gap / 2;
    // 按方向归类，转换为像素位置（去重并排序）
    const rawH = [...new Set(gridCustomLines.filter(l => l.type === 'h').map(l => l.pos * height))].sort((a, b) => a - b);
    const rawV = [...new Set(gridCustomLines.filter(l => l.type === 'v').map(l => l.pos * width))].sort((a, b) => a - b);
    const hCuts = [0, ...rawH, height]; // 切割边界（含图片两端）
    const vCuts = [0, ...rawV, width];
    const rects = [];
    for(let row = 0; row < hCuts.length - 1; row++){
        for(let col = 0; col < vCuts.length - 1; col++){
            const y1 = Math.round(row === 0 ? hCuts[row] : hCuts[row] + halfGap);
            const y2 = Math.round(row === hCuts.length - 2 ? hCuts[row + 1] : hCuts[row + 1] - halfGap);
            const x1 = Math.round(col === 0 ? vCuts[col] : vCuts[col] + halfGap);
            const x2 = Math.round(col === vCuts.length - 2 ? vCuts[col + 1] : vCuts[col + 1] - halfGap);
            if(x2 > x1 && y2 > y1) rects.push({row, col, x:x1, y:y1, w:x2 - x1, h:y2 - y1});
        }
    }
    return rects;
}
function gridLayoutFromRects(rects){
    const rows = Math.max(1, ...rects.map(r => Number(r.row || 0) + 1));
    const cols = Math.max(1, ...rects.map(r => Number(r.col || 0) + 1));
    return {type:'grid-split', groupId:uid('grid'), rows, cols};
}
function applyGridPreset(rows, cols){
    gridCustomMode = false;
    gridCustomLines = [];
    gridCustomHistory = [];
    gridCustomDrag = null;
    const h = document.getElementById('gridHorizontalLines');
    const v = document.getElementById('gridVerticalLines');
    if(h){ h.disabled = false; h.value = String(Math.max(0, Number(rows || 1) - 1)); }
    if(v){ v.disabled = false; v.value = String(Math.max(0, Number(cols || 1) - 1)); }
    const toggle = document.getElementById('gridCustomToggle');
    const custom = document.getElementById('gridCustomControls');
    const regular = document.getElementById('gridRegularControls');
    if(toggle){
        toggle.classList.remove('primary');
        toggle.classList.add('secondary');
    }
    if(custom) custom.style.display = 'none';
    if(regular) regular.style.display = 'contents';
    _syncGridCustomCursor();
    _syncGridCustomUndoBtn();
    refreshGridSplitPreview();
}
// ——— 自定义宫格辅助函数 ———
function toggleGridCustomMode(){
    gridCustomMode = !gridCustomMode;
    if(gridCustomMode){ gridCustomLines = []; gridCustomHistory = []; } // 进入自定义时清空旧线及历史
    gridCustomDrag = null;
    const toggle = document.getElementById('gridCustomToggle');
    const regular = document.getElementById('gridRegularControls');
    const custom = document.getElementById('gridCustomControls');
    toggle.classList.toggle('primary', gridCustomMode);
    toggle.classList.toggle('secondary', !gridCustomMode);
    // 禁用/启用常规输入
    ['gridHorizontalLines','gridVerticalLines'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.disabled = gridCustomMode;
    });
    if(custom) custom.style.display = gridCustomMode ? 'flex' : 'none';
    _syncGridCustomCursor();
    _syncGridCustomUndoBtn();
    refreshGridSplitPreview();
}
function setGridCustomOrientation(orient){
    gridCustomOrientation = orient;
    document.getElementById('gridOrientH').classList.toggle('primary', orient === 'h');
    document.getElementById('gridOrientH').classList.toggle('secondary', orient !== 'h');
    document.getElementById('gridOrientV').classList.toggle('primary', orient === 'v');
    document.getElementById('gridOrientV').classList.toggle('secondary', orient !== 'v');
    _syncGridCustomCursor();
}
function clearGridCustomLines(){
    gridCustomHistory = [];
    gridCustomLines = [];
    gridCustomDrag = null;
    _syncGridCustomUndoBtn();
    refreshGridSplitPreview();
}
function undoGridCustomLine(){
    if(!gridCustomHistory.length) return;
    gridCustomLines = gridCustomHistory.pop();
    gridCustomDrag = null;
    _syncGridCustomUndoBtn();
    refreshGridSplitPreview();
}
function _syncGridCustomUndoBtn(){
    const btn = document.getElementById('gridUndoBtn');
    if(!btn) return;
    btn.disabled = gridCustomHistory.length === 0;
    btn.style.opacity = gridCustomHistory.length === 0 ? '0.4' : '1';
}
function clampImageResizeScale(value){
    const num = Number(value);
    if(!Number.isFinite(num)) return 0.5;
    return Math.max(0.05, Math.min(1, Math.round(num * 100) / 100));
}
function imageResizeDimensions(){
    const img = document.getElementById('cropImage');
    const sourceW = Math.max(1, Math.round(Number(img?.naturalWidth || 0)));
    const sourceH = Math.max(1, Math.round(Number(img?.naturalHeight || 0)));
    const scale = clampImageResizeScale(imageResizeScale);
    return {
        sourceW,
        sourceH,
        scale,
        targetW:Math.max(1, Math.round(sourceW * scale)),
        targetH:Math.max(1, Math.round(sourceH * scale))
    };
}
function syncImageResizeControls(){
    imageResizeScale = clampImageResizeScale(imageResizeScale);
    const range = document.getElementById('imageResizeScaleRange');
    const input = document.getElementById('imageResizeScaleInput');
    const label = document.getElementById('imageResizeResolution');
    const overlay = document.getElementById('resizeResolutionOverlay');
    const dims = imageResizeDimensions();
    const text = `${dims.targetW}×${dims.targetH}`;
    if(range && Number(range.value) !== dims.scale) range.value = String(dims.scale);
    if(input && Number(input.value) !== dims.scale) input.value = String(dims.scale);
    if(label) label.textContent = text;
    if(overlay) overlay.textContent = text;
}
function setImageResizeScale(value){
    imageResizeScale = clampImageResizeScale(value);
    syncImageResizeControls();
}
async function resizedImageBlobFromEditor(){
    const img = document.getElementById('cropImage');
    if(!img?.naturalWidth || !img?.naturalHeight) return null;
    const dims = imageResizeDimensions();
    const canvasEl = document.createElement('canvas');
    canvasEl.width = dims.targetW;
    canvasEl.height = dims.targetH;
    const ctx = canvasEl.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, dims.targetW, dims.targetH);
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    return blob ? {blob, ...dims} : null;
}
// ——— 图片缩放 ———
function applyImageEditZoom(){
    if(!imageEditBaseW) return;
    const img = document.getElementById('cropImage');
    const oldW = img.clientWidth;
    img.style.maxWidth = 'none';
    img.style.maxHeight = 'none';
    img.style.width = Math.round(imageEditBaseW * imageEditZoom) + 'px';
    img.style.height = Math.round(imageEditBaseH * imageEditZoom) + 'px';
    resizeEditDrawCanvas();
    // 按比例同步裁剪框位置
    if(cropState && oldW > 0){
        const scale = img.clientWidth / oldW;
        cropState.x = Math.round(cropState.x * scale);
        cropState.y = Math.round(cropState.y * scale);
        cropState.w = Math.round(cropState.w * scale);
        cropState.h = Math.round(cropState.h * scale);
        clampCrop();
        renderCropBox();
    }
    if(imageEditMode === 'grid') refreshGridSplitPreview();
    syncImageResizeControls();
    syncImageEditOverflow();
    _updateZoomLabel();
}
function syncImageEditOverflow(){
    const stage = document.getElementById('imageEditStage');
    const crop = document.getElementById('cropCanvas');
    if(!stage || !crop) return;
    const rect = crop.getBoundingClientRect();
    const pad = 36;
    const overflowX = rect.width + pad > stage.clientWidth;
    const overflowY = rect.height + pad > stage.clientHeight;
    stage.classList.toggle('overflowing', overflowX || overflowY);
    stage.classList.toggle('overflow-x', overflowX);
    stage.classList.toggle('overflow-y', overflowY);
}
function resetImageEditZoom(){
    const stage = document.getElementById('imageEditStage');
    imageEditZoom = 1.0;
    applyImageEditZoom();
    if(stage){ stage.scrollLeft = 0; stage.scrollTop = 0; }
}
function _updateZoomLabel(){
    const el = document.getElementById('imageEditZoomLabel');
    if(el) el.textContent = Math.round(imageEditZoom * 100) + '%';
}
function _syncGridCustomCursor(){
    const cropCanvasEl = document.getElementById('cropCanvas');
    cropCanvasEl.classList.toggle('grid-custom-h', imageEditMode === 'grid' && gridCustomMode && gridCustomOrientation === 'h');
    cropCanvasEl.classList.toggle('grid-custom-v', imageEditMode === 'grid' && gridCustomMode && gridCustomOrientation === 'v');
}
function refreshGridSplitPreview(){
    const canvasEl = editDrawCanvas();
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    if(imageEditMode !== 'grid') return;
    const countEl = document.getElementById('gridSplitCount');
    const lineWidth = Math.max(2, Math.round(Math.min(canvasEl.width, canvasEl.height) / 320));
    const drawGuideLine = (x1, y1, x2, y2) => {
        ctx.save();
        ctx.lineWidth = lineWidth + 2;
        ctx.strokeStyle = 'rgba(2,6,23,0.72)';
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.restore();
    };
    if(gridCustomMode){
        // 自定义模式：按已放置线渲染（包含空心范围预览）
        const gap = Math.max(0, Math.min(240, Number(document.getElementById('gridGapSize')?.value || 0)));
        const hLines = gridCustomLines.filter(l => l.type === 'h');
        const vLines = gridCustomLines.filter(l => l.type === 'v');
        if(countEl) countEl.textContent = tr('canvas.gridWillOutput').replace('{n}', (hLines.length + 1) * (vLines.length + 1));
        ctx.save();
        hLines.forEach(l => {
            const y = l.pos * canvasEl.height;
            if(gap > 0){
                drawGuideLine(0, y - gap / 2, canvasEl.width, y - gap / 2);
                drawGuideLine(0, y + gap / 2, canvasEl.width, y + gap / 2);
            } else {
                drawGuideLine(0, y, canvasEl.width, y);
            }
        });
        vLines.forEach(l => {
            const x = l.pos * canvasEl.width;
            if(gap > 0){
                drawGuideLine(x - gap / 2, 0, x - gap / 2, canvasEl.height);
                drawGuideLine(x + gap / 2, 0, x + gap / 2, canvasEl.height);
            } else {
                drawGuideLine(x, 0, x, canvasEl.height);
            }
        });
        ctx.restore();
        return;
    }
    // 常规模式
    const {rows, cols, gap} = gridSplitSettings();
    if(countEl) countEl.textContent = tr('canvas.gridWillOutput').replace('{n}', rows * cols);
    ctx.save();
    const scaleX = canvasEl.width;
    const scaleY = canvasEl.height;
    for(let i = 1; i < cols; i++){
        const x = i * scaleX / cols;
        if(gap > 0){
            drawGuideLine(x - gap / 2, 0, x - gap / 2, scaleY);
            drawGuideLine(x + gap / 2, 0, x + gap / 2, scaleY);
        } else {
            drawGuideLine(x, 0, x, scaleY);
        }
    }
    for(let i = 1; i < rows; i++){
        const y = i * scaleY / rows;
        if(gap > 0){
            drawGuideLine(0, y - gap / 2, scaleX, y - gap / 2);
            drawGuideLine(0, y + gap / 2, scaleX, y + gap / 2);
        } else {
            drawGuideLine(0, y, scaleX, y);
        }
    }
    ctx.restore();
}
function imageEditorOutputPoint(node, offsetY=0){
    return {x:(node.x || 0) + Number(node.w || 260) + 36, y:(node.y || 0) + offsetY};
}
function imageEditorOutputNode(sourceNode){
    let out = connections.filter(c => c.from === sourceNode.id)
        .map(c => nodes.find(n => n.id === c.to))
        .find(n => n?.type === 'output');
    if(!out){
        const p = imageEditorOutputPoint(sourceNode, 0);
        out = {id:uid('out'), type:'output', x:p.x, y:p.y, images:[]};
        nodes.push(out);
    }
    return out;
}
function addGeneratedImageNode(file, sourceNode, suffix, offsetY=0, extra={}){
    const p = imageEditorOutputPoint(sourceNode, offsetY);
    const next = {id:uid('img'), type:'image', x:p.x, y:p.y, url:file.url, name:file.name || suffix, ...extra};
    nodes.push(next);
    selected.clear();
    selected.add(next.id);
    return next;
}
function renderCropBox(){
    if(!cropState) return;
    const cropCanvasEl = document.getElementById('cropCanvas');
    const img = document.getElementById('cropImage');
    const draw = editDrawCanvas();
    const textCanvas = editTextCanvas();
    let boxX = cropState.x;
    let boxY = cropState.y;
    if(imageEditMode === 'outpaint' && cropCanvasEl && img){
        cropCanvasEl.style.width = `${Math.round(cropState.w)}px`;
        cropCanvasEl.style.height = `${Math.round(cropState.h)}px`;
        img.style.left = `${Math.round(cropState.x)}px`;
        img.style.top = `${Math.round(cropState.y)}px`;
        boxX = 0;
        boxY = 0;
        if(draw){
            draw.style.left = img.style.left;
            draw.style.top = img.style.top;
        }
        if(textCanvas){
            textCanvas.style.left = img.style.left;
            textCanvas.style.top = img.style.top;
        }
        updateOutpaintResolutionLabel();
    } else if(cropCanvasEl && img){
        cropCanvasEl.style.width = '';
        cropCanvasEl.style.height = '';
        img.style.left = '';
        img.style.top = '';
        if(draw){
            draw.style.left = '';
            draw.style.top = '';
        }
        if(textCanvas){
            textCanvas.style.left = '';
            textCanvas.style.top = '';
        }
    }
    const box = document.getElementById('cropBox');
    box.style.left = `${boxX}px`;
    box.style.top = `${boxY}px`;
    box.style.width = `${cropState.w}px`;
    box.style.height = `${cropState.h}px`;
    const outpaintFrame = document.getElementById('outpaintFrame');
    if(outpaintFrame){
        outpaintFrame.style.left = imageEditMode === 'outpaint' ? '0px' : `${boxX}px`;
        outpaintFrame.style.top = imageEditMode === 'outpaint' ? '0px' : `${boxY}px`;
        outpaintFrame.style.width = `${cropState.w}px`;
        outpaintFrame.style.height = `${cropState.h}px`;
    }
}
function outpaintNaturalSize(){
    const img = document.getElementById('cropImage');
    if(!img || !cropState) return {w:1, h:1};
    const scaleX = Math.max(1, Number(img.naturalWidth || 1)) / Math.max(1, Number(img.clientWidth || 1));
    const scaleY = Math.max(1, Number(img.naturalHeight || 1)) / Math.max(1, Number(img.clientHeight || 1));
    return {
        w:Math.max(1, Math.round((cropState.w || 1) * scaleX)),
        h:Math.max(1, Math.round((cropState.h || 1) * scaleY))
    };
}
function updateOutpaintResolutionLabel(){
    const label = document.getElementById('outpaintResolution');
    const cropCanvasEl = document.getElementById('cropCanvas');
    if(!label || !cropState) return;
    const size = outpaintNaturalSize();
    const outputSize = fitWithinFourKStandard(size.w, size.h);
    cropCanvasEl?.classList.toggle('outpaint-warning', outputSize.limited);
    label.textContent = outputSize.limited
        ? Math.round(size.w) + ' x ' + Math.round(size.h) + ' → ' + outputSize.width + ' x ' + outputSize.height
        : Math.round(size.w) + ' x ' + Math.round(size.h);
}
function clampOutpaint(){
    if(!cropState) return;
    const {w, h} = cropBounds();
    cropState.w = Math.max(w, cropState.w);
    cropState.h = Math.max(h, cropState.h);
    cropState.x = Math.min(cropState.w - w, Math.max(0, cropState.x));
    cropState.y = Math.min(cropState.h - h, Math.max(0, cropState.y));
}
function resetOutpaintBox(){
    if(!cropState) return;
    const {w, h} = cropBounds();
    cropState.x = 0;
    cropState.y = 0;
    cropState.w = w;
    cropState.h = h;
    renderCropBox();
}
function cropRatioFromPreset(preset){
    if(!preset || preset === 'free') return null;
    if(preset === 'source'){
        const {w, h} = cropBounds();
        return w > 0 && h > 0 ? w / h : null;
    }
    const parts = String(preset).split(':').map(v => Math.max(0, Number(v)));
    return parts.length === 2 && parts[0] > 0 && parts[1] > 0 ? parts[0] / parts[1] : null;
}
function syncCropRatioButtons(){
    document.querySelectorAll('[data-crop-ratio]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.cropRatio === cropAspectPreset);
    });
}
function fitCropRectToAspect(ratio, sourceRect=null){
    const {w:boundsW, h:boundsH} = cropBounds();
    const rect = sourceRect || cropState || {x:0, y:0, w:boundsW, h:boundsH};
    const minSize = 24;
    let nextW = Math.max(minSize, Number(rect.w || boundsW));
    let nextH = Math.max(minSize, Number(rect.h || boundsH));
    if(ratio){
        if(nextW / nextH > ratio) nextW = nextH * ratio;
        else nextH = nextW / ratio;
        if(nextW > boundsW){ nextW = boundsW; nextH = nextW / ratio; }
        if(nextH > boundsH){ nextH = boundsH; nextW = nextH * ratio; }
    } else {
        nextW = Math.min(nextW, boundsW);
        nextH = Math.min(nextH, boundsH);
    }
    const cx = Number(rect.x || 0) + Number(rect.w || nextW) / 2;
    const cy = Number(rect.y || 0) + Number(rect.h || nextH) / 2;
    cropState.w = Math.round(nextW);
    cropState.h = Math.round(nextH);
    cropState.x = Math.round(cx - cropState.w / 2);
    cropState.y = Math.round(cy - cropState.h / 2);
    clampCrop();
}
function setCropAspectPreset(preset='free'){
    cropAspectPreset = preset || 'free';
    cropAspectRatio = cropRatioFromPreset(cropAspectPreset);
    syncCropRatioButtons();
    if(cropState && imageEditMode === 'crop' && cropAspectRatio){
        fitCropRectToAspect(cropAspectRatio);
        renderCropBox();
    }
}
function resetCropBox(){
    if(!cropState) return;
    if(imageEditMode === 'outpaint') return resetOutpaintBox();
    const {w, h} = cropBounds();
    const rect = {x:Math.round(w * 0.08), y:Math.round(h * 0.08), w:Math.round(w * 0.84), h:Math.round(h * 0.84)};
    cropState.x = rect.x;
    cropState.y = rect.y;
    cropState.w = rect.w;
    cropState.h = rect.h;
    if(cropAspectRatio) fitCropRectToAspect(cropAspectRatio, rect);
    renderCropBox();
}
function openImageEditor(nodeId, initialMode='crop'){
    const node = nodes.find(n => n.id === nodeId);
    if(!node?.url) return;
    if(mediaKindForNode(node) !== 'image') return;
    if(!['preview','crop','outpaint','mask','brush','resize','grid'].includes(initialMode)) initialMode = 'crop';
    cropState = {nodeId, x:0, y:0, w:0, h:0};
    // 重置自定义宫格状态
    gridCustomMode = false;
    gridCustomLines = [];
    gridCustomHistory = [];
    gridCustomDrag = null;
    gridCustomOrientation = 'h';
    imageEditZoom = 1.0;
    imageEditBaseW = 0;
    imageEditBaseH = 0;
    imageResizeScale = 0.5;
    imageEditModeTouched = false;
    cropAspectPreset = 'free';
    cropAspectRatio = null;
    syncCropRatioButtons();
    editTextItems = [];
    editTextSelectedId = '';
    editTextDrag = null;
    editTextDirty = false;
    const toggle = document.getElementById('gridCustomToggle');
    if(toggle){ toggle.classList.add('secondary'); toggle.classList.remove('primary'); }
    const custom = document.getElementById('gridCustomControls');
    if(custom) custom.style.display = 'none';
    ['gridHorizontalLines','gridVerticalLines'].forEach(id => { const el = document.getElementById(id); if(el) el.disabled = false; });
    const orientH = document.getElementById('gridOrientH');
    const orientV = document.getElementById('gridOrientV');
    if(orientH){ orientH.classList.add('primary'); orientH.classList.remove('secondary'); }
    if(orientV){ orientV.classList.add('secondary'); orientV.classList.remove('primary'); }
    _syncGridCustomUndoBtn();
    _updateZoomLabel();
    const modal = document.getElementById('imageEditModal');
    const img = document.getElementById('cropImage');
    img.style.width = '';
    img.style.height = '';
    img.style.maxWidth = '';
    img.style.maxHeight = '';
    modal.classList.add('open');
    const editorSrcToken = `${nodeId}:${Date.now()}`;
    img.dataset.editorSrcToken = editorSrcToken;
    img.onload = () => {
        // 记录 zoom=1 时的基础显示尺寸
        imageEditBaseW = img.clientWidth;
        imageEditBaseH = img.clientHeight;
        _updateZoomLabel();
        syncImageResizeControls();
        resizeEditDrawCanvas();
        resetEditDrawingHistory();
        clearEditDrawing(true);
        resetCropBox();
        if(!imageEditModeTouched) setImageEditMode(initialMode);
        syncImageEditOverflow();
        refreshIcons();
    };
    img.crossOrigin = 'anonymous';
    const fullEditorSrc = canvasDisplayMediaUrl(node.url, node.name || '');
    const quickEditorSrc = canvasMediaPreviewUrl(node.url, initialMode === 'preview' ? 1536 : 2048);
    if(quickEditorSrc && quickEditorSrc !== fullEditorSrc){
        img.src = quickEditorSrc;
        requestAnimationFrame(() => {
            setTimeout(() => {
                if(!cropState || cropState.nodeId !== nodeId) return;
                if(!modal.classList.contains('open') || img.dataset.editorSrcToken !== editorSrcToken) return;
                if(img.getAttribute('src') !== fullEditorSrc) img.src = fullEditorSrc;
            }, initialMode === 'preview' ? 120 : 60);
        });
    } else {
        img.src = fullEditorSrc;
    }
    setImageEditMode(initialMode);
    refreshIcons();
}
function closeImageEditor(){
    document.getElementById('imageEditModal').classList.remove('open');
    const img = document.getElementById('cropImage');
    img.onload = null;
    delete img.dataset.editorSrcToken;
    img.removeAttribute('src');
    img.style.width = '';
    img.style.height = '';
    img.style.maxWidth = '';
    img.style.maxHeight = '';
    clearEditDrawing(true);
    cropState = null;
    cropDrag = null;
    editDrawState = null;
    resetEditDrawingHistory();
    gridCustomDrag = null;
    imageEditZoom = 1.0;
    imageEditBaseW = 0;
    imageEditBaseH = 0;
    imageResizeScale = 0.5;
    imageEditModeTouched = false;
    cropAspectPreset = 'free';
    cropAspectRatio = null;
    syncCropRatioButtons();
    document.getElementById('imageEditStage')?.classList.remove('overflowing', 'overflow-x', 'overflow-y');
    const cropCanvasEl = document.getElementById('cropCanvas');
    cropCanvasEl.classList.remove('grid-custom-h', 'grid-custom-v', 'outpaint-mode', 'outpaint-warning', 'dragging-image', 'text-mode', 'resize-mode');
    cropCanvasEl.style.width = '';
    cropCanvasEl.style.height = '';
    const textCanvas = editTextCanvas();
    if(textCanvas){
        textCanvas.style.left = '';
        textCanvas.style.top = '';
    }
}
function clampCrop(){
    if(!cropState) return;
    if(imageEditMode === 'outpaint') return clampOutpaint();
    const {w, h} = cropBounds();
    cropState.w = Math.max(24, Math.min(cropState.w, w));
    cropState.h = Math.max(24, Math.min(cropState.h, h));
    cropState.x = Math.max(0, Math.min(cropState.x, w - cropState.w));
    cropState.y = Math.max(0, Math.min(cropState.y, h - cropState.h));
}
function beginCropDrag(event, mode){
    if(!cropState) return;
    event.preventDefault();
    event.stopPropagation();
    if(imageEditMode === 'outpaint' && mode === 'move') return;
    cropDrag = {mode, sx:event.clientX, sy:event.clientY, start:{...cropState}};
}
function resizeOutpaintFromDrag(dx, dy){
    const start = cropDrag?.start;
    if(!start) return;
    let growX = 0, growY = 0;
    if(cropDrag.mode === 'outpaint-left') growX = -dx;
    else if(cropDrag.mode === 'outpaint-right') growX = dx;
    else if(cropDrag.mode === 'outpaint-top') growY = -dy;
    else if(cropDrag.mode === 'outpaint-bottom') growY = dy;
    else if(cropDrag.mode === 'outpaint-corner'){ growX = dx; growY = dy; }
    const {w, h} = cropBounds();
    const nextW = Math.max(w, start.w + growX * 2);
    const nextH = Math.max(h, start.h + growY * 2);
    cropState.w = nextW;
    cropState.h = nextH;
    cropState.x = start.x + Math.round((nextW - start.w) / 2);
    cropState.y = start.y + Math.round((nextH - start.h) / 2);
    clampOutpaint();
}
function clampAspectCropToBounds(anchorX, anchorY, movingX, movingY, ratio, handle){
    const {w:boundsW, h:boundsH} = cropBounds();
    const minSize = 24;
    let width = Math.max(minSize, Math.abs(movingX - anchorX));
    let height = Math.max(minSize, Math.abs(movingY - anchorY));
    const corner = /[ns][ew]/.test(handle);
    if(corner){
        if(width / height > ratio) width = height * ratio;
        else height = width / ratio;
    } else if(handle === 'e' || handle === 'w'){
        height = width / ratio;
    } else {
        width = height * ratio;
    }
    const dirX = handle.includes('w') ? -1 : 1;
    const dirY = handle.includes('n') ? -1 : 1;
    const maxW = dirX < 0 ? anchorX : boundsW - anchorX;
    const maxH = dirY < 0 ? anchorY : boundsH - anchorY;
    width = Math.min(width, maxW);
    height = Math.min(height, maxH);
    if(width / height > ratio) width = height * ratio;
    else height = width / ratio;
    return {
        x:dirX < 0 ? anchorX - width : anchorX,
        y:dirY < 0 ? anchorY - height : anchorY,
        w:width,
        h:height
    };
}
function resizeCropFromDrag(dx, dy){
    const start = cropDrag?.start;
    if(!start) return;
    const handle = String(cropDrag.mode || 'resize').replace(/^crop-/, '') || 'se';
    if(!cropAspectRatio){
        let left = start.x;
        let top = start.y;
        let right = start.x + start.w;
        let bottom = start.y + start.h;
        if(handle.includes('w')) left += dx;
        if(handle.includes('e') || handle === 'resize') right += dx;
        if(handle.includes('n')) top += dy;
        if(handle.includes('s') || handle === 'resize') bottom += dy;
        cropState.x = Math.min(left, right - 24);
        cropState.y = Math.min(top, bottom - 24);
        cropState.w = Math.max(24, right - cropState.x);
        cropState.h = Math.max(24, bottom - cropState.y);
        return;
    }
    const normalized = handle === 'resize' ? 'se' : handle;
    const centerX = start.x + start.w / 2;
    const centerY = start.y + start.h / 2;
    if(normalized === 'e' || normalized === 'w'){
        const {w:boundsW, h:boundsH} = cropBounds();
        let width = Math.max(24, normalized === 'e' ? start.w + dx : start.w - dx);
        const maxW = normalized === 'e' ? boundsW - start.x : start.x + start.w;
        const maxH = Math.max(24, 2 * Math.min(centerY, boundsH - centerY));
        width = Math.min(width, maxW, maxH * cropAspectRatio);
        const height = width / cropAspectRatio;
        cropState.x = Math.round(normalized === 'e' ? start.x : start.x + start.w - width);
        cropState.y = Math.round(centerY - height / 2);
        cropState.w = Math.round(width);
        cropState.h = Math.round(height);
        return;
    }
    if(normalized === 'n' || normalized === 's'){
        const {w:boundsW, h:boundsH} = cropBounds();
        let height = Math.max(24, normalized === 's' ? start.h + dy : start.h - dy);
        const maxH = normalized === 's' ? boundsH - start.y : start.y + start.h;
        const maxW = Math.max(24, 2 * Math.min(centerX, boundsW - centerX));
        height = Math.min(height, maxH, maxW / cropAspectRatio);
        const width = height * cropAspectRatio;
        cropState.x = Math.round(centerX - width / 2);
        cropState.y = Math.round(normalized === 's' ? start.y : start.y + start.h - height);
        cropState.w = Math.round(width);
        cropState.h = Math.round(height);
        return;
    }
    let anchorX = normalized.includes('w') ? start.x + start.w : normalized.includes('e') ? start.x : centerX;
    let anchorY = normalized.includes('n') ? start.y + start.h : normalized.includes('s') ? start.y : centerY;
    let movingX = normalized.includes('w') ? start.x + dx : normalized.includes('e') ? start.x + start.w + dx : centerX;
    let movingY = normalized.includes('n') ? start.y + dy : normalized.includes('s') ? start.y + start.h + dy : centerY;
    const next = clampAspectCropToBounds(anchorX, anchorY, movingX, movingY, cropAspectRatio, normalized);
    cropState.x = Math.round(next.x);
    cropState.y = Math.round(next.y);
    cropState.w = Math.round(next.w);
    cropState.h = Math.round(next.h);
}
window.addEventListener('mousemove', event => {
    if(!cropDrag || !cropState) return;
    const dx = event.clientX - cropDrag.sx;
    const dy = event.clientY - cropDrag.sy;
    if(cropDrag.mode === 'move'){
        cropState.x = cropDrag.start.x + dx;
        cropState.y = cropDrag.start.y + dy;
    } else if(cropDrag.mode === 'image'){
        cropState.x = cropDrag.start.x + dx;
        cropState.y = cropDrag.start.y + dy;
    } else if(String(cropDrag.mode || '').startsWith('outpaint-')){
        resizeOutpaintFromDrag(dx, dy);
    } else {
        resizeCropFromDrag(dx, dy);
    }
    clampCrop();
    renderCropBox();
});
window.addEventListener('mouseup', () => { cropDrag = null; document.getElementById('cropCanvas')?.classList.remove('dragging-image'); });
async function uploadCroppedBlob(blob, name){
    const form = new FormData();
    form.append('files', blob, name);
    const response = await fetch('/api/ai/upload', {method:'POST', body:form});
    let data = {};
    try { data = await response.json(); } catch(_) {}
    if(!response.ok){
        throw new Error(data.detail || data.error || ('上传失败（HTTP ' + response.status + '）'));
    }
    const file = data.files?.[0];
    if(!file?.url) throw new Error('上传完成但未返回图片地址');
    return file;
}
async function uploadImageBlobs(blobs){
    const form = new FormData();
    blobs.forEach(item => form.append('files', item.blob, item.name));
    const data = await fetch('/api/ai/upload', {method:'POST', body:form}).then(r=>r.json());
    return data.files || [];
}
async function applyImageCrop(){
    if(!cropState) return;
    const node = nodes.find(n => n.id === cropState.nodeId);
    const img = document.getElementById('cropImage');
    if(!node || !img.naturalWidth || !img.naturalHeight) return;
    const scaleX = img.naturalWidth / (img.clientWidth || 1);
    const scaleY = img.naturalHeight / (img.clientHeight || 1);
    const sx = Math.max(0, Math.round(cropState.x * scaleX));
    const sy = Math.max(0, Math.round(cropState.y * scaleY));
    const sw = Math.max(1, Math.round(cropState.w * scaleX));
    const sh = Math.max(1, Math.round(cropState.h * scaleY));
    const canvasEl = document.createElement('canvas');
    canvasEl.width = sw;
    canvasEl.height = sh;
    canvasEl.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    if(!blob) return;
    const base = (node.name || 'image').replace(/\.[^.]+$/, '');
    const file = await uploadCroppedBlob(blob, `${base}_crop.png`);
    if(file){
        node.url = file.url;
        node.name = file.name;
        closeImageEditor();
        render();
        scheduleSave();
    }
}
async function applyImageOutpaint(){
    if(!cropState) return;
    const applyBtn = document.getElementById('imageEditApplyBtn');
    if(applyBtn?.disabled) return;
    const node = nodes.find(n => n.id === cropState.nodeId);
    const img = document.getElementById('cropImage');
    if(!node || !img?.naturalWidth || !img?.naturalHeight){
        alert('扩图失败：原图尚未加载完成，请稍后重试');
        return;
    }
    const applyLabel = applyBtn?.querySelector('span');
    const originalLabel = applyLabel?.textContent || '';
    if(applyBtn){
        applyBtn.disabled = true;
        applyBtn.setAttribute('aria-busy', 'true');
    }
    if(applyLabel) applyLabel.textContent = '处理中...';
    try {
        clampOutpaint();
        const scaleX = img.naturalWidth / (img.clientWidth || 1);
        const scaleY = img.naturalHeight / (img.clientHeight || 1);
        const requestedW = Math.max(img.naturalWidth, Math.round(cropState.w * scaleX));
        const requestedH = Math.max(img.naturalHeight, Math.round(cropState.h * scaleY));
        const outputSize = fitWithinFourKStandard(requestedW, requestedH);
        const canvasEl = document.createElement('canvas');
        canvasEl.width = outputSize.width;
        canvasEl.height = outputSize.height;
        const ctx = canvasEl.getContext('2d');
        if(!ctx) throw new Error('浏览器无法创建图片画布');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outputSize.width, outputSize.height);
        ctx.drawImage(
            img,
            Math.round(cropState.x * scaleX * outputSize.scale),
            Math.round(cropState.y * scaleY * outputSize.scale),
            Math.max(1, Math.round(img.naturalWidth * outputSize.scale)),
            Math.max(1, Math.round(img.naturalHeight * outputSize.scale))
        );
        const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
        if(!blob) throw new Error('浏览器未能导出扩图结果');
        const base = (node.name || 'image').replace(/\.[^.]+$/, '');
        const file = await uploadCroppedBlob(blob, base + '_outpaint.png');
        addGeneratedImageNode(file, node, 'outpaint', 28, {
            role:'outpaint',
            sourceId:node.id,
            natural_w:outputSize.width,
            natural_h:outputSize.height
        });
        closeImageEditor();
        render();
        scheduleSave();
    } catch(error) {
        console.error('[canvas-outpaint] apply failed', error);
        alert('扩图失败：' + (error?.message || '未知错误'));
    } finally {
        if(applyBtn){
            applyBtn.disabled = false;
            applyBtn.removeAttribute('aria-busy');
        }
        if(applyLabel && document.body.contains(applyLabel)) applyLabel.textContent = originalLabel;
    }
}
async function applyImageMask(){
    if(!cropState) return;
    const node = nodes.find(n => n.id === cropState.nodeId);
    if(!node || !editCanvasHasPixels()) return;
    const mask = maskCanvasFromDrawCanvas(editDrawCanvas());
    const blob = await new Promise(resolve => mask.toBlob(resolve, 'image/png'));
    if(!blob) return;
    const base = (node.name || 'image').replace(/\.[^.]+$/, '');
    const file = await uploadCroppedBlob(blob, `${base}_mask.png`);
    if(file){
        addGeneratedImageNode(file, node, 'mask', 28, {role:'mask'});
        closeImageEditor();
        render();
        scheduleSave();
    }
}
function maskCanvasFromDrawCanvas(src){
    const mask = document.createElement('canvas');
    mask.width = src.width;
    mask.height = src.height;
    const srcCtx = src.getContext('2d');
    const srcData = srcCtx.getImageData(0, 0, src.width, src.height);
    const ctx = mask.getContext('2d');
    const out = ctx.createImageData(mask.width, mask.height);
    for(let i = 0; i < srcData.data.length; i += 4){
        const painted = srcData.data[i + 3] > 8;
        // Image edits use transparent mask pixels as the editable area.
        out.data[i] = 0;
        out.data[i + 1] = 0;
        out.data[i + 2] = 0;
        out.data[i + 3] = painted ? 0 : 255;
    }
    ctx.putImageData(out, 0, 0);
    return mask;
}
async function applyImageBrush(){
    if(!cropState) return;
    removeEditTextInlineEditor(true);
    const node = nodes.find(n => n.id === cropState.nodeId);
    const img = document.getElementById('cropImage');
    if(!node || !img.naturalWidth || !img.naturalHeight || !editCanvasHasPixels()) return;
    const canvasEl = document.createElement('canvas');
    canvasEl.width = img.naturalWidth;
    canvasEl.height = img.naturalHeight;
    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
    ctx.drawImage(editDrawCanvas(), 0, 0);
    ctx.drawImage(editTextCanvas(), 0, 0);
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    if(!blob) return;
    const base = (node.name || 'image').replace(/\.[^.]+$/, '');
    const file = await uploadCroppedBlob(blob, `${base}_paint.png`);
    if(file){
        node.url = file.url;
        node.name = file.name;
        closeImageEditor();
        render();
        scheduleSave();
    }
}
async function applyImageGridSplit(){
    if(!cropState) return;
    const node = nodes.find(n => n.id === cropState.nodeId);
    const img = document.getElementById('cropImage');
    if(!node || !img.naturalWidth || !img.naturalHeight) return;
    const rects = gridSplitRects(img.naturalWidth, img.naturalHeight);
    if(!rects.length) return;
    const base = (node.name || 'image').replace(/\.[^.]+$/, '');
    const blobs = [];
    for(const rect of rects){
        const canvasEl = document.createElement('canvas');
        canvasEl.width = rect.w;
        canvasEl.height = rect.h;
        canvasEl.getContext('2d').drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
        if(blob) blobs.push({blob, name:`${base}_r${rect.row + 1}_c${rect.col + 1}.png`});
    }
    if(!blobs.length) return;
    const files = await uploadImageBlobs(blobs);
    if(files.length){
        const out = imageEditorOutputNode(node);
        const urls = files.map(file => file.url).filter(Boolean);
        const layout = gridLayoutFromRects(rects);
        appendOutputImages(out, urls, {url:node.url, name:node.name || 'source image'}, urls.map((url, i) => ({
            runMs:0,
            run:{prompt:'宫格切分', refs:[{url:node.url, name:node.name || 'source image'}]},
            grid:{...layout, row:rects[i]?.row || 0, col:rects[i]?.col || 0, w:rects[i]?.w || 1, h:rects[i]?.h || 1}
        })), layout);
        closeImageEditor();
        render();
        scheduleSave();
    }
}
async function applyImageResize(){
    if(!cropState) return;
    const node = nodes.find(n => n.id === cropState.nodeId);
    if(!node) return;
    let resized = null;
    try {
        resized = await resizedImageBlobFromEditor();
    } catch(err) {
        alert('缩放失败：当前图片无法写入画布，请换成本地图片或重新上传后再试。');
        return;
    }
    if(!resized?.blob) return;
    const base = (node.name || 'image').replace(/\.[^.]+$/, '');
    const suffix = `${Math.round(resized.scale * 100)}pct`;
    const file = await uploadCroppedBlob(resized.blob, `${base}_resize_${suffix}.png`);
    if(!file) return;
    node.url = file.url;
    node.name = file.name;
    node.mediaKind = 'image';
    node.natural_w = resized.targetW;
    node.natural_h = resized.targetH;
    closeImageEditor();
    render();
    scheduleSave();
}
function applyImageEdit(){
    if(imageEditMode === 'outpaint') return applyImageOutpaint();
    if(imageEditMode === 'mask') return applyImageMask();
    if(imageEditMode === 'brush') return applyImageBrush();
    if(imageEditMode === 'resize') return applyImageResize();
    if(imageEditMode === 'grid') return applyImageGridSplit();
    return applyImageCrop();
}
window.LingDrawFeatures?.register('canvas-image-editor', true);
