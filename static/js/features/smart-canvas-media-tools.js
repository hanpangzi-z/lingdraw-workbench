// Cold-loaded smart canvas video editor and lighting tools.
function videoEditClamp(value, min, max){
    const numeric = Number(value);
    return Math.min(max, Math.max(min, Number.isFinite(numeric) ? numeric : min));
}
function videoEditFormatTime(value){
    const seconds = Math.max(0, Number(value) || 0);
    const minutes = Math.floor(seconds / 60);
    const wholeSeconds = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}`;
}
function isVideoEditDraftNode(node){
    return Boolean(node?.videoEditDraft);
}
function createVideoEditDraftNode(sourceNode, imageIndex=0){
    const sourceItem = sourceNode?.images?.[imageIndex];
    if(!sourceNode || !sourceItem?.url) return null;
    const rect = nodeRect(sourceNode);
    const point = {x:rect.x + rect.width + 220, y:rect.y + rect.height / 2};
    const draftItem = {
        ...sourceItem,
        kind:'video',
        video_edit_original_url:sourceItem.video_edit_original_url || sourceItem.source_url || sourceItem.url,
        video_edit_source_url:sourceItem.url,
        originalLocalUrl:sourceItem.url,
        localUrl:sourceItem.url,
        sourceUrl:sourceItem.url,
        local_url:sourceItem.url,
        source_url:sourceItem.url
    };
    pushUndo();
    const draftNode = createImageNodeAt(point, [draftItem], {select:true, skipUndo:true});
    draftNode.title = '剪辑';
    draftNode.videoEditDraft = true;
    draftNode.videoEditSourceNodeId = sourceNode.id;
    connectInputNode(sourceNode.id, draftNode.id);
    selectedId = draftNode.id;
    selectedIds = [];
    selectedImage = {nodeId:draftNode.id, index:0};
    render();
    scheduleSave();
    requestAnimationFrame(() => focusNodesInViewport([sourceNode, draftNode]));
    return draftNode;
}
function startVideoEditorFromNode(nodeId, imageIndex=0){
    const sourceNode = nodes.find(node => node.id === nodeId);
    if(!sourceNode) return;
    const editNode = isVideoEditDraftNode(sourceNode)
        ? sourceNode
        : createVideoEditDraftNode(sourceNode, imageIndex);
    if(!editNode){
        toast('无法创建剪辑节点');
        return;
    }
    openVideoEditor(editNode.id, isVideoEditDraftNode(sourceNode) ? imageIndex : 0);
}
function cloneVideoEditSegments(segments=videoEditState.segments){
    return (segments || []).map(segment => ({
        id:String(segment.id || uid('video_segment')),
        start:Number(segment.start) || 0,
        end:Number(segment.end) || 0
    }));
}
function videoEditSnapshot(){
    return {
        inPoint:videoEditState.inPoint,
        outPoint:videoEditState.outPoint,
        currentTime:videoEditState.currentTime,
        segments:cloneVideoEditSegments(),
        selectedSegmentId:videoEditState.selectedSegmentId
    };
}
function videoEditSnapshotEqual(a, b){
    return Boolean(a && b
        && Math.abs(a.inPoint - b.inPoint) < .001
        && Math.abs(a.outPoint - b.outPoint) < .001
        && Math.abs(a.currentTime - b.currentTime) < .001
        && a.selectedSegmentId === b.selectedSegmentId
        && JSON.stringify(a.segments || []) === JSON.stringify(b.segments || []));
}
function pushVideoEditHistory(){
    const snapshot = videoEditSnapshot();
    const last = videoEditState.history[videoEditState.history.length - 1];
    if(!videoEditSnapshotEqual(snapshot, last)) videoEditState.history.push(snapshot);
    if(videoEditState.history.length > 80) videoEditState.history.shift();
    videoEditState.redo = [];
    renderVideoEditControls();
}
function applyVideoEditSnapshot(snapshot){
    if(!snapshot || !videoEditState.duration) return;
    videoEditState.inPoint = videoEditClamp(snapshot.inPoint, 0, Math.max(0, videoEditState.duration - .1));
    videoEditState.outPoint = videoEditClamp(snapshot.outPoint, videoEditState.inPoint + .1, videoEditState.duration);
    videoEditState.segments = cloneVideoEditSegments(snapshot.segments);
    videoEditState.selectedSegmentId = snapshot.selectedSegmentId || videoEditState.segments[0]?.id || '';
    setVideoEditCurrentTime(videoEditClamp(snapshot.currentTime, videoEditState.inPoint, videoEditState.outPoint), true);
    renderVideoEditSegments();
    renderVideoEditControls();
}
function undoVideoEdit(){
    const snapshot = videoEditState.history.pop();
    if(!snapshot) return;
    videoEditState.redo.push(videoEditSnapshot());
    applyVideoEditSnapshot(snapshot);
}
function redoVideoEdit(){
    const snapshot = videoEditState.redo.pop();
    if(!snapshot) return;
    videoEditState.history.push(videoEditSnapshot());
    applyVideoEditSnapshot(snapshot);
}
function videoEditPercent(value){
    return videoEditState.duration > 0 ? videoEditClamp(value / videoEditState.duration * 100, 0, 100) : 0;
}
function normalizedVideoEditSegments(segments=videoEditState.segments){
    const duration = Math.max(0, Number(videoEditState.duration) || 0);
    return cloneVideoEditSegments(segments)
        .map(segment => ({
            ...segment,
            start:videoEditClamp(segment.start, 0, duration),
            end:videoEditClamp(segment.end, 0, duration)
        }))
        .filter(segment => segment.end - segment.start >= .1)
        .sort((a, b) => a.start - b.start || a.end - b.end);
}
function videoEditPlayableSegments(){
    return normalizedVideoEditSegments().map(segment => ({
        ...segment,
        start:Math.max(segment.start, videoEditState.inPoint),
        end:Math.min(segment.end, videoEditState.outPoint)
    })).filter(segment => segment.end - segment.start >= .1);
}
function videoEditSegmentAtTime(time, segments=normalizedVideoEditSegments()){
    const value = Number(time) || 0;
    return segments.find((segment, index) => value >= segment.start - .001
        && (value < segment.end - .001 || (index === segments.length - 1 && value <= segment.end + .001)));
}
function renderVideoEditSegments(){
    const layer = document.getElementById('videoEditSegments');
    if(!layer) return;
    const segments = normalizedVideoEditSegments();
    if(!(videoEditState.duration > 0) || !segments.length){
        layer.innerHTML = '';
        return;
    }
    videoEditState.segments = segments;
    if(!segments.some(segment => segment.id === videoEditState.selectedSegmentId)){
        videoEditState.selectedSegmentId = segments[0]?.id || '';
    }
    const parts = [];
    let cursor = 0;
    segments.forEach((segment, index) => {
        if(segment.start > cursor + .001){
            parts.push(`<span class="video-edit-segment-gap" style="left:${videoEditPercent(cursor)}%;width:${videoEditPercent(segment.start - cursor)}%"></span>`);
        }
        const selected = segment.id === videoEditState.selectedSegmentId;
        parts.push(`<button type="button" class="video-edit-segment${selected ? ' selected' : ''}" data-video-segment-id="${escapeAttr(segment.id)}" style="left:${videoEditPercent(segment.start)}%;width:${videoEditPercent(segment.end - segment.start)}%" aria-label="片段 ${index + 1}，${videoEditFormatTime(segment.start)} 至 ${videoEditFormatTime(segment.end)}" aria-pressed="${selected ? 'true' : 'false'}"></button>`);
        if(index > 0 && Math.abs(segment.start - segments[index - 1].end) <= .01){
            parts.push(`<span class="video-edit-segment-cut" style="left:${videoEditPercent(segment.start)}%"></span>`);
        }
        cursor = Math.max(cursor, segment.end);
    });
    if(cursor < videoEditState.duration - .001){
        parts.push(`<span class="video-edit-segment-gap" style="left:${videoEditPercent(cursor)}%;width:${videoEditPercent(videoEditState.duration - cursor)}%"></span>`);
    }
    layer.innerHTML = parts.join('');
    layer.querySelectorAll('[data-video-segment-id]').forEach(button => {
        button.addEventListener('pointerdown', event => {
            if(event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            pauseVideoEdit();
            videoEditState.selectedSegmentId = button.dataset.videoSegmentId || '';
            setVideoEditCurrentTime(videoEditTimeFromClientX(event.clientX), true);
            renderVideoEditSegments();
            renderVideoEditControls();
        });
    });
}
function splitVideoEditAtPlayhead(){
    if(videoEditState.composing || !(videoEditState.duration > 0)) return;
    const segments = normalizedVideoEditSegments();
    const time = videoEditState.currentTime;
    const index = segments.findIndex(segment => time > segment.start + .1 && time < segment.end - .1);
    if(index < 0){
        toast('请将播放头移到片段中间再分割');
        return;
    }
    pauseVideoEdit();
    pushVideoEditHistory();
    const segment = segments[index];
    const left = {...segment, id:uid('video_segment'), end:time};
    const right = {...segment, id:uid('video_segment'), start:time};
    videoEditState.segments = [...segments.slice(0, index), left, right, ...segments.slice(index + 1)];
    videoEditState.selectedSegmentId = right.id;
    renderVideoEditSegments();
    renderVideoEditControls();
    toast(`已在 ${videoEditFormatTime(time)} 分割`);
}
function deleteSelectedVideoSegment(){
    if(videoEditState.composing || !(videoEditState.duration > 0)) return;
    const segments = normalizedVideoEditSegments();
    if(segments.length <= 1){
        toast('至少保留一个视频片段');
        return;
    }
    let index = segments.findIndex(segment => segment.id === videoEditState.selectedSegmentId);
    if(index < 0) index = segments.findIndex(segment => videoEditSegmentAtTime(videoEditState.currentTime, [segment]));
    if(index < 0) return;
    pauseVideoEdit();
    pushVideoEditHistory();
    const remaining = segments.filter((_, segmentIndex) => segmentIndex !== index);
    const next = remaining[Math.min(index, remaining.length - 1)];
    videoEditState.segments = remaining;
    videoEditState.selectedSegmentId = next?.id || '';
    if(next) setVideoEditCurrentTime(next.start, true);
    renderVideoEditSegments();
    renderVideoEditControls();
    toast('已删除选中片段');
}
function renderVideoEditRuler(){
    const ruler = document.getElementById('videoEditRuler');
    if(!ruler) return;
    const duration = videoEditState.duration;
    if(!(duration > 0)){
        ruler.innerHTML = '<span class="video-edit-ruler-loading">正在读取视频…</span>';
        return;
    }
    let step = 1;
    if(duration > 180) step = 30;
    else if(duration > 90) step = 15;
    else if(duration > 45) step = 10;
    else if(duration > 20) step = 5;
    const marks = [];
    for(let at = 0; at <= duration + .001; at += step){
        const left = videoEditPercent(at);
        marks.push(`<span class="video-edit-ruler-mark major" style="left:${left}%"><span>${videoEditFormatTime(at)}</span></span>`);
    }
    if(Math.abs((marks.length - 1) * step - duration) > .05){
        marks.push(`<span class="video-edit-ruler-mark major" style="left:100%"><span>${videoEditFormatTime(duration)}</span></span>`);
    }
    ruler.innerHTML = marks.join('');
}
function renderVideoEditControls(){
    if(!videoEditPanel) return;
    const duration = videoEditState.duration;
    const inPercent = videoEditPercent(videoEditState.inPoint);
    const outPercent = videoEditPercent(videoEditState.outPoint);
    const currentPercent = videoEditPercent(videoEditState.currentTime);
    const inHandle = document.getElementById('videoEditInHandle');
    const outHandle = document.getElementById('videoEditOutHandle');
    const shadeBefore = document.getElementById('videoEditTrimShadeBefore');
    const shadeAfter = document.getElementById('videoEditTrimShadeAfter');
    const playhead = document.getElementById('videoEditPlayhead');
    if(inHandle) inHandle.style.left = `${inPercent}%`;
    if(outHandle) outHandle.style.left = `${outPercent}%`;
    if(shadeBefore) shadeBefore.style.width = `${inPercent}%`;
    if(shadeAfter) shadeAfter.style.width = `${Math.max(0, 100 - outPercent)}%`;
    if(playhead) playhead.style.left = `${currentPercent}%`;
    const time = document.getElementById('videoEditTime');
    if(time) time.value = `${videoEditFormatTime(videoEditState.currentTime)} / ${videoEditFormatTime(duration)}`;
    const play = document.getElementById('videoEditPlay');
    if(play){
        play.innerHTML = `<i data-lucide="${videoEditState.playing ? 'pause' : 'play'}"></i>`;
        play.title = videoEditState.playing ? '暂停' : '播放';
        play.setAttribute('aria-label', play.title);
        play.disabled = !(duration > 0);
    }
    if(videoEditTrack){
        videoEditTrack.setAttribute('aria-valuemax', String(duration || 0));
        videoEditTrack.setAttribute('aria-valuenow', String(videoEditState.currentTime || 0));
        videoEditTrack.setAttribute('aria-valuetext', videoEditFormatTime(videoEditState.currentTime));
    }
    const undo = document.getElementById('videoEditUndo');
    const redo = document.getElementById('videoEditRedo');
    if(undo) undo.disabled = !videoEditState.history.length || videoEditState.composing;
    if(redo) redo.disabled = !videoEditState.redo.length || videoEditState.composing;
    ['videoEditSetIn','videoEditSetOut'].forEach(id => {
        const button = document.getElementById(id);
        if(button) button.disabled = !(duration > 0) || videoEditState.composing;
    });
    const split = document.getElementById('videoEditSplit');
    const splitSegment = videoEditSegmentAtTime(videoEditState.currentTime);
    if(split) split.disabled = !(duration > 0)
        || !splitSegment
        || videoEditState.currentTime <= splitSegment.start + .1
        || videoEditState.currentTime >= splitSegment.end - .1
        || videoEditState.composing;
    const deleteSegment = document.getElementById('videoEditDeleteSegment');
    if(deleteSegment) deleteSegment.disabled = normalizedVideoEditSegments().length <= 1 || videoEditState.composing;
    const extractFrame = document.getElementById('videoEditExtractFrame');
    if(extractFrame){
        extractFrame.disabled = !(duration > 0) || videoEditState.composing || videoEditState.extractingFrame;
        extractFrame.classList.toggle('extracting', videoEditState.extractingFrame);
        extractFrame.innerHTML = `<i data-lucide="${videoEditState.extractingFrame ? 'loader-2' : 'image-plus'}"></i>`;
        extractFrame.title = videoEditState.extractingFrame ? '正在提取关键帧' : '提取当前关键帧';
        extractFrame.setAttribute('aria-label', extractFrame.title);
    }
    const compose = document.getElementById('videoEditCompose');
    if(compose){
        compose.disabled = !(duration > 0) || !videoEditPlayableSegments().length || videoEditState.composing || videoEditState.extractingFrame;
        compose.classList.toggle('composing', videoEditState.composing);
        compose.innerHTML = videoEditState.composing
            ? '<i data-lucide="loader-2"></i><span>合成中…</span>'
            : '<i data-lucide="wand-sparkles"></i><span>合成</span>';
    }
    refreshIcons();
}
function setVideoEditCurrentTime(value, syncVideo=false){
    const max = videoEditState.outPoint > 0 ? videoEditState.outPoint : videoEditState.duration;
    videoEditState.currentTime = videoEditClamp(value, 0, Math.max(0, max));
    if(syncVideo && videoEditSource && videoEditSource.readyState >= 1){
        try { videoEditSource.currentTime = videoEditState.currentTime; } catch(e) {}
    }
    renderVideoEditControls();
}
function pauseVideoEdit(){
    videoEditSource?.pause?.();
    videoEditState.playing = false;
    renderVideoEditControls();
}
function toggleVideoEditPlayback(){
    if(!videoEditSource || !(videoEditState.duration > 0)) return;
    if(!videoEditSource.paused){
        pauseVideoEdit();
        return;
    }
    const playable = videoEditPlayableSegments();
    if(!playable.length) return;
    const currentSegment = videoEditSegmentAtTime(videoEditState.currentTime, playable);
    if(!currentSegment || videoEditState.currentTime >= currentSegment.end - .02){
        const next = playable.find(segment => segment.start >= videoEditState.currentTime + .01) || playable[0];
        setVideoEditCurrentTime(next.start, true);
        videoEditState.selectedSegmentId = next.id;
        renderVideoEditSegments();
    }
    const result = videoEditSource.play();
    videoEditState.playing = true;
    renderVideoEditControls();
    result?.catch?.(() => {
        videoEditState.playing = false;
        renderVideoEditControls();
        toast('视频暂时无法播放');
    });
}
function setVideoEditBoundary(side){
    if(!(videoEditState.duration > 0)) return;
    pushVideoEditHistory();
    const minimum = Math.min(.1, videoEditState.duration);
    if(side === 'in'){
        videoEditState.inPoint = videoEditClamp(videoEditState.currentTime, 0, Math.max(0, videoEditState.outPoint - minimum));
    } else {
        videoEditState.outPoint = videoEditClamp(videoEditState.currentTime, videoEditState.inPoint + minimum, videoEditState.duration);
    }
    renderVideoEditControls();
}
function videoEditTimeFromClientX(clientX){
    const rect = videoEditTrack?.getBoundingClientRect();
    if(!rect || !rect.width || !videoEditState.duration) return 0;
    return videoEditClamp((clientX - rect.left) / rect.width * videoEditState.duration, 0, videoEditState.duration);
}
function beginVideoEditHandleDrag(event, side){
    if(videoEditState.composing || !(videoEditState.duration > 0)) return;
    event.preventDefault();
    event.stopPropagation();
    pauseVideoEdit();
    pushVideoEditHistory();
    videoEditState.drag = {side, pointerId:event.pointerId};
    event.currentTarget.setPointerCapture?.(event.pointerId);
}
function moveVideoEditHandleDrag(event){
    const drag = videoEditState.drag;
    if(!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const minimum = Math.min(.1, videoEditState.duration);
    const time = videoEditTimeFromClientX(event.clientX);
    if(drag.side === 'in'){
        videoEditState.inPoint = videoEditClamp(time, 0, Math.max(0, videoEditState.outPoint - minimum));
        if(videoEditState.currentTime < videoEditState.inPoint) setVideoEditCurrentTime(videoEditState.inPoint, true);
    } else {
        videoEditState.outPoint = videoEditClamp(time, videoEditState.inPoint + minimum, videoEditState.duration);
        if(videoEditState.currentTime > videoEditState.outPoint) setVideoEditCurrentTime(videoEditState.outPoint, true);
    }
    renderVideoEditControls();
}
function endVideoEditHandleDrag(event){
    if(!videoEditState.drag || videoEditState.drag.pointerId !== event.pointerId) return;
    videoEditState.drag = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    renderVideoEditControls();
}
function videoEditThumbFallback(item){
    return smartMediaPreviewUrl(item, 320) || displayMediaUrl(item);
}
async function buildVideoEditThumbnails(token){
    const thumbs = document.getElementById('videoEditThumbs');
    if(!thumbs || !videoEditState.item || !(videoEditState.duration > 0)) return;
    const count = Math.max(10, Math.min(28, Math.round(14 * videoEditState.zoom)));
    thumbs.innerHTML = Array.from({length:count}, () => '<span class="video-edit-thumb-placeholder"></span>').join('');
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.src = displayMediaUrl(videoEditState.item);
    try {
        video.load();
        if(video.readyState < 1) await waitForVideoEvent(video, 'loadedmetadata', 5000);
        if(!video.videoWidth || !video.videoHeight) await waitForVideoEvent(video, 'loadeddata', 5000);
        if(videoEditState.loadToken !== token || !videoEditState.open) return;
        const canvasEl = document.getElementById('videoEditFrameCanvas');
        const sourceW = Math.max(1, Number(video.videoWidth) || 320);
        const sourceH = Math.max(1, Number(video.videoHeight) || 180);
        canvasEl.width = 180;
        canvasEl.height = Math.max(72, Math.round(180 * sourceH / sourceW));
        const ctx = canvasEl.getContext('2d', {alpha:false});
        const urls = [];
        for(let index = 0; index < count; index += 1){
            if(videoEditState.loadToken !== token || !videoEditState.open) return;
            const time = Math.min(videoEditState.duration - .02, (index + .5) / count * videoEditState.duration);
            await seekVideoForFrame(video, Math.max(0, time));
            ctx.drawImage(video, 0, 0, canvasEl.width, canvasEl.height);
            urls.push(canvasEl.toDataURL('image/jpeg', .68));
        }
        if(videoEditState.loadToken !== token || !videoEditState.open) return;
        thumbs.innerHTML = urls.map(url => `<img class="video-edit-thumb" src="${escapeAttr(url)}" alt="">`).join('');
    } catch(e) {
        if(videoEditState.loadToken !== token || !videoEditState.open) return;
        const fallback = videoEditThumbFallback(videoEditState.item);
        thumbs.innerHTML = Array.from({length:count}, () => `<img class="video-edit-thumb" src="${escapeAttr(fallback)}" alt="">`).join('');
    } finally {
        video.pause?.();
        video.removeAttribute('src');
        video.load?.();
    }
}
function closeVideoEditor(){
    if(!videoEditPanel) return;
    pauseVideoEdit();
    videoEditState.loadToken = uid('video_edit_closed');
    videoEditState.open = false;
    videoEditState.drag = null;
    videoEditPanel.hidden = true;
    videoEditPanel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('video-editor-open');
    if(videoEditSource){
        videoEditSource.removeAttribute('src');
        videoEditSource.load?.();
    }
}
function openVideoEditor(nodeId, imageIndex=0){
    const node = nodes.find(item => item.id === nodeId);
    const rawItem = node?.images?.[imageIndex];
    const item = rawItem?.url ? {...rawItem} : imageForDisplay(rawItem);
    if(!node || !item?.url || mediaKindForItem(item) !== 'video'){
        toast('没有可剪辑的视频');
        return;
    }
    if(imageEditModal?.classList.contains('open')) closeImageEditor();
    if(lightingModal?.classList.contains('open')) closeLightingPanel();
    pauseVideoEdit();
    const token = uid('video_edit');
    videoEditState = {
        open:true,
        nodeId,
        imageIndex,
        item:{...item},
        duration:0,
        inPoint:0,
        outPoint:0,
        currentTime:0,
        zoom:1,
        history:[],
        redo:[],
        segments:[],
        selectedSegmentId:'',
        playing:false,
        composing:false,
        extractingFrame:false,
        loadToken:token,
        drag:null
    };
    videoEditPanel.hidden = false;
    videoEditPanel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('video-editor-open');
    const zoom = document.getElementById('videoEditZoom');
    if(zoom) zoom.value = '1';
    if(videoEditTimeline) videoEditTimeline.style.setProperty('--video-edit-zoom', '1');
    document.getElementById('videoEditThumbs').innerHTML = Array.from({length:14}, () => '<span class="video-edit-thumb-placeholder"></span>').join('');
    document.getElementById('videoEditSegments').innerHTML = '';
    renderVideoEditRuler();
    renderVideoEditControls();
    refreshIcons();
    videoEditSource.crossOrigin = 'anonymous';
    videoEditSource.muted = false;
    videoEditSource.src = displayMediaUrl(item);
    videoEditSource.load?.();
    const onMetadata = () => {
        if(videoEditState.loadToken !== token || !videoEditState.open) return;
        const duration = Number(videoEditSource.duration);
        if(!Number.isFinite(duration) || duration <= 0){
            toast('无法读取视频时长');
            return;
        }
        videoEditState.duration = duration;
        videoEditState.inPoint = 0;
        videoEditState.outPoint = duration;
        videoEditState.currentTime = 0;
        const segment = {id:uid('video_segment'), start:0, end:duration};
        videoEditState.segments = [segment];
        videoEditState.selectedSegmentId = segment.id;
        renderVideoEditRuler();
        renderVideoEditSegments();
        renderVideoEditControls();
        buildVideoEditThumbnails(token);
    };
    if(videoEditSource.readyState >= 1) onMetadata();
    else videoEditSource.addEventListener('loadedmetadata', onMetadata, {once:true});
}
function setVideoEditZoom(value){
    const zoom = videoEditClamp(value, 1, 4);
    videoEditState.zoom = zoom;
    const input = document.getElementById('videoEditZoom');
    if(input && Number(input.value) !== zoom) input.value = String(zoom);
    if(videoEditTimeline) videoEditTimeline.style.setProperty('--video-edit-zoom', String(zoom));
}
async function extractVideoEditKeyframe(){
    if(videoEditState.extractingFrame || videoEditState.composing || !(videoEditState.duration > 0)) return;
    const sourceNode = nodes.find(node => node.id === videoEditState.nodeId);
    const sourceItem = sourceNode?.images?.[videoEditState.imageIndex];
    if(!sourceNode || !sourceItem?.url || !videoEditSource){
        toast('当前视频已不存在');
        return;
    }
    const editorToken = videoEditState.loadToken;
    const targetTime = videoEditClamp(videoEditState.currentTime, 0, Math.max(0, videoEditState.duration - .001));
    videoEditState.extractingFrame = true;
    pauseVideoEdit();
    renderVideoEditControls();
    try {
        if(videoEditSource.readyState < 2) await waitForVideoEvent(videoEditSource, 'loadeddata', 2600);
        if(!videoEditSource.videoWidth || !videoEditSource.videoHeight) throw new Error('视频画面尚未加载完成');
        await seekVideoForFrame(videoEditSource, targetTime);
        const canvasEl = document.createElement('canvas');
        canvasEl.width = videoEditSource.videoWidth;
        canvasEl.height = videoEditSource.videoHeight;
        const ctx = canvasEl.getContext('2d', {alpha:false});
        ctx.drawImage(videoEditSource, 0, 0, canvasEl.width, canvasEl.height);
        const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
        if(!blob) throw new Error('关键帧生成失败');
        const rawName = sourceItem.name || fileNameFromUrl(sourceItem.url) || 'video';
        const base = String(rawName).replace(/\.[a-z0-9]{2,8}$/i, '') || 'video';
        const timeCode = targetTime.toFixed(3).replace('.', '-');
        const filename = safeExportFileName(`${base}-关键帧-${timeCode}s.png`, `关键帧-${timeCode}s.png`);
        const uploaded = await uploadFiles([new File([blob], filename, {type:'image/png'})]);
        const frame = uploaded[0];
        if(!frame?.url) throw new Error('关键帧上传失败');
        if(!videoEditState.open || videoEditState.loadToken !== editorToken) throw new Error('剪辑器已关闭，关键帧提取已取消');
        const frameItem = {
            ...frame,
            kind:'image',
            natural_w:canvasEl.width,
            natural_h:canvasEl.height,
            keyframe_time_seconds:Number(targetTime.toFixed(3)),
            keyframe_video_url:sourceItem.url,
            keyframe_source_node_id:sourceNode.id
        };
        const existingCount = nodes.filter(node => node?.keyframeSourceNodeId === sourceNode.id).length;
        const rect = nodeRect(sourceNode);
        const point = {
            x:rect.x + rect.width + 240 + (existingCount % 3) * 320,
            y:rect.y + rect.height / 2 + Math.floor(existingCount / 3) * 240
        };
        pushUndo();
        const frameNode = createImageNodeAt(point, [frameItem], {select:true, skipUndo:true});
        frameNode.title = `关键帧 ${videoEditFormatTime(targetTime)}`;
        frameNode.keyframeSourceNodeId = sourceNode.id;
        frameNode.keyframeTime = Number(targetTime.toFixed(3));
        selectedId = frameNode.id;
        selectedIds = [];
        selectedImage = {nodeId:frameNode.id, index:0};
        render();
        scheduleSave();
        toast(`已提取 ${videoEditFormatTime(targetTime)} 关键帧`);
    } catch(e) {
        toast((e.message || '关键帧提取失败').slice(0, 160));
    } finally {
        videoEditState.extractingFrame = false;
        renderVideoEditControls();
    }
}
async function composeVideoEdit(){
    if(videoEditState.composing || !(videoEditState.duration > 0)) return;
    const draftNode = nodes.find(node => node.id === videoEditState.nodeId);
    const sourceItem = draftNode?.images?.[videoEditState.imageIndex];
    if(!draftNode || !sourceItem?.url){
        toast('当前剪辑节点已不存在');
        closeVideoEditor();
        return;
    }
    const segments = videoEditPlayableSegments();
    if(!segments.length){
        toast('请至少保留一个视频片段');
        return;
    }
    videoEditState.composing = true;
    pauseVideoEdit();
    renderVideoEditControls();
    try {
        const response = await fetch('/api/canvas-video/trim', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                url:sourceItem.url,
                name:sourceItem.name || fileNameFromUrl(sourceItem.url) || 'video.mp4',
                start:segments[0].start,
                end:segments[segments.length - 1].end,
                segments:segments.map(segment => ({start:segment.start, end:segment.end}))
            })
        });
        const data = await response.json().catch(() => ({}));
        if(!response.ok) throw new Error(data.detail || '视频合成失败');
        if(!data.url) throw new Error('合成接口没有返回视频');
        const outputItem = {
            ...sourceItem,
            ...data,
            url:data.url,
            name:data.name || `剪辑-${sourceItem.name || 'video.mp4'}`,
            kind:'video',
            video_edit_original_url:sourceItem.video_edit_original_url || sourceItem.source_url || sourceItem.url,
            video_edit_source_url:data.url,
            originalLocalUrl:data.url,
            localUrl:data.url,
            sourceUrl:data.url,
            local_url:data.url,
            source_url:data.url,
            trim:{start:segments[0].start, end:segments[segments.length - 1].end},
            segments:data.segments || segments.map(segment => ({start:segment.start, end:segment.end}))
        };
        pushUndo();
        draftNode.images = (draftNode.images || []).map((item, index) => index === videoEditState.imageIndex ? outputItem : item);
        draftNode.title = '剪辑';
        draftNode.videoEditDraft = true;
        selectedId = draftNode.id;
        selectedIds = [];
        selectedImage = {nodeId:draftNode.id, index:videoEditState.imageIndex};
        closeVideoEditor();
        render();
        scheduleSave();
        toast('视频剪辑已合成并覆盖当前剪辑节点');
    } catch(e) {
        videoEditState.composing = false;
        renderVideoEditControls();
        toast((e.message || '视频合成失败').slice(0, 180));
    }
}
function lightingClamp(value, min, max, fallback){
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}
function lightingTemperatureDescription(value){
    const temperature = Number(value) || 5000;
    if(temperature < 3400) return '暖烛光';
    if(temperature < 4600) return '暖日光';
    if(temperature < 5800) return '中午日光';
    if(temperature < 7200) return '阴天冷光';
    return '蓝调冷光';
}
function lightingDirectionVector(direction){
    const vectors = {
        front:{x:.5,y:.5}, left:{x:.08,y:.5}, top:{x:.5,y:.08},
        back:{x:.5,y:.92}, right:{x:.92,y:.5}, bottom:{x:.5,y:.92}
    };
    return vectors[direction] || vectors.front;
}
function paintLightingImage(ctx, image, dx, dy, dw, dh, params=lightingState){
    if(!ctx || !image || !(dw > 0) || !(dh > 0)) return;
    const brightness = lightingClamp(params.brightness, 0, 100, 50);
    const temperature = lightingClamp(params.temperature, 2500, 9000, 5000);
    const direction = params.direction || 'front';
    const exposure = .64 + brightness * .0072;
    const directionStrength = .12 + brightness * .0028;
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.clip();
    ctx.filter = `brightness(${exposure.toFixed(3)}) saturate(${(1.01 + Math.abs(temperature - 5000) / 22000).toFixed(3)})`;
    ctx.drawImage(image, dx, dy, dw, dh);
    ctx.filter = 'none';

    const temperatureDelta = (5000 - temperature) / 4000;
    if(Math.abs(temperatureDelta) > .015){
        ctx.globalCompositeOperation = 'soft-light';
        ctx.fillStyle = temperatureDelta > 0
            ? `rgba(255,132,48,${Math.min(.26, Math.abs(temperatureDelta) * .24).toFixed(3)})`
            : `rgba(84,132,255,${Math.min(.24, Math.abs(temperatureDelta) * .22).toFixed(3)})`;
        ctx.fillRect(dx, dy, dw, dh);
    }

    ctx.globalCompositeOperation = 'soft-light';
    let lightGradient;
    if(direction === 'front'){
        lightGradient = ctx.createRadialGradient(dx + dw * .5, dy + dh * .46, 0, dx + dw * .5, dy + dh * .5, Math.max(dw, dh) * .7);
        lightGradient.addColorStop(0, `rgba(255,255,246,${Math.min(.5, directionStrength + .1).toFixed(3)})`);
        lightGradient.addColorStop(.64, 'rgba(255,255,255,.04)');
        lightGradient.addColorStop(1, `rgba(8,12,22,${Math.min(.32, directionStrength * .62).toFixed(3)})`);
    } else if(direction === 'back'){
        lightGradient = ctx.createRadialGradient(dx + dw * .5, dy + dh * .5, Math.min(dw, dh) * .2, dx + dw * .5, dy + dh * .5, Math.max(dw, dh) * .78);
        lightGradient.addColorStop(0, `rgba(5,8,18,${Math.min(.4, directionStrength).toFixed(3)})`);
        lightGradient.addColorStop(.62, 'rgba(255,255,255,.02)');
        lightGradient.addColorStop(1, `rgba(255,246,220,${Math.min(.62, directionStrength + .2).toFixed(3)})`);
    } else {
        const source = lightingDirectionVector(direction);
        const endX = direction === 'left' ? 1 : direction === 'right' ? 0 : .5;
        const endY = direction === 'top' ? 1 : direction === 'bottom' ? 0 : .5;
        lightGradient = ctx.createLinearGradient(dx + dw * source.x, dy + dh * source.y, dx + dw * endX, dy + dh * endY);
        lightGradient.addColorStop(0, `rgba(255,250,232,${Math.min(.62, directionStrength + .18).toFixed(3)})`);
        lightGradient.addColorStop(.58, 'rgba(255,255,255,.03)');
        lightGradient.addColorStop(1, `rgba(5,8,18,${Math.min(.38, directionStrength * .8).toFixed(3)})`);
    }
    ctx.fillStyle = lightGradient;
    ctx.fillRect(dx, dy, dw, dh);
    ctx.restore();
}
function drawLightingDirectionIndicator(ctx, width, height){
    const source = lightingDirectionVector(lightingState.direction);
    const sx = width * source.x;
    const sy = height * source.y;
    const cx = width * .5;
    const cy = height * .5;
    ctx.save();
    ctx.strokeStyle = 'rgba(83,218,255,.88)';
    ctx.fillStyle = 'rgba(18,24,38,.9)';
    ctx.lineWidth = Math.max(2, width / 210);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo((sx + cx) / 2, Math.min(sy, cy) - height * .035, cx, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(8, width * .026), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(234,250,255,.95)';
    ctx.lineWidth = Math.max(1.5, width / 280);
    ctx.stroke();
    ctx.restore();
}
function renderLightingPreview(){
    const canvasEl = document.getElementById('lightingPreviewCanvas');
    const image = lightingSourceImage;
    if(!canvasEl || !image?.naturalWidth || !image?.naturalHeight) return;
    const ctx = canvasEl.getContext('2d');
    const width = canvasEl.width;
    const height = canvasEl.height;
    ctx.clearRect(0, 0, width, height);
    const ambient = ctx.createRadialGradient(width * .5, height * .48, width * .06, width * .5, height * .5, width * .58);
    const tempDelta = (5000 - lightingState.temperature) / 4000;
    ambient.addColorStop(0, tempDelta >= 0 ? 'rgba(110,91,74,.68)' : 'rgba(72,91,132,.68)');
    ambient.addColorStop(.64, 'rgba(54,59,72,.92)');
    ambient.addColorStop(1, 'rgba(17,19,25,1)');
    ctx.fillStyle = ambient;
    ctx.fillRect(0, 0, width, height);

    const maxWidth = width * (lightingState.view === 'perspective' ? .68 : .76);
    const maxHeight = height * (lightingState.view === 'perspective' ? .6 : .72);
    const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
    const drawWidth = Math.max(1, image.naturalWidth * scale);
    const drawHeight = Math.max(1, image.naturalHeight * scale);
    const drawX = (width - drawWidth) / 2;
    const drawY = (height - drawHeight) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.46)';
    ctx.shadowBlur = width * .035;
    ctx.shadowOffsetY = width * .018;
    paintLightingImage(ctx, image, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();
    drawLightingDirectionIndicator(ctx, width, height);
}
function syncLightingControls(){
    const brightnessRange = document.getElementById('lightingBrightnessRange');
    const temperatureRange = document.getElementById('lightingTemperatureRange');
    if(brightnessRange) brightnessRange.value = String(lightingState.brightness);
    if(temperatureRange) temperatureRange.value = String(lightingState.temperature);
    const brightnessValue = document.getElementById('lightingBrightnessValue');
    const temperatureValue = document.getElementById('lightingTemperatureValue');
    const temperatureHint = document.getElementById('lightingTemperatureHint');
    if(brightnessValue) brightnessValue.textContent = `${Math.round(lightingState.brightness)}%`;
    if(temperatureValue) temperatureValue.textContent = `${Math.round(lightingState.temperature)}K`;
    if(temperatureHint) temperatureHint.textContent = `（${lightingTemperatureDescription(lightingState.temperature)}）`;
    document.querySelectorAll('[data-lighting-direction]').forEach(btn => btn.classList.toggle('active', btn.dataset.lightingDirection === lightingState.direction));
    document.getElementById('lightingFrontViewBtn')?.classList.toggle('active', lightingState.view === 'front');
    document.getElementById('lightingPerspectiveViewBtn')?.classList.toggle('active', lightingState.view === 'perspective');
    document.getElementById('lightingPreviewShell')?.classList.toggle('perspective', lightingState.view === 'perspective');
    const applyBtn = document.getElementById('lightingApplyBtn');
    if(applyBtn) applyBtn.disabled = lightingState.applying || !lightingState.nodeId;
    renderLightingPreview();
}
function setLightingBrightness(value){
    lightingState.brightness = lightingClamp(value, 0, 100, 50);
    syncLightingControls();
}
function setLightingTemperature(value){
    lightingState.temperature = lightingClamp(value, 2500, 9000, 5000);
    syncLightingControls();
}
function bindLightingRangePointerControl(inputId, setter){
    const input = document.getElementById(inputId);
    if(!input || typeof setter !== 'function') return;
    let activePointerId = null;
    const setFromPointer = event => {
        const rect = input.getBoundingClientRect();
        if(!(rect.width > 0)) return;
        const min = Number(input.min) || 0;
        const max = Number(input.max) || 100;
        const step = Math.max(Number(input.step) || 1, Number.EPSILON);
        const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        const stepped = min + Math.round(((min + (max - min) * ratio) - min) / step) * step;
        setter(Math.min(max, Math.max(min, stepped)));
    };
    input.addEventListener('pointerdown', event => {
        if(event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        activePointerId = event.pointerId;
        input.setPointerCapture?.(event.pointerId);
        setFromPointer(event);
    });
    input.addEventListener('pointermove', event => {
        if(activePointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        setFromPointer(event);
    });
    const finishPointer = event => {
        if(activePointerId !== event.pointerId) return;
        event.stopPropagation();
        if(input.hasPointerCapture?.(event.pointerId)) input.releasePointerCapture(event.pointerId);
        activePointerId = null;
    };
    input.addEventListener('pointerup', finishPointer);
    input.addEventListener('pointercancel', finishPointer);
}
function setLightingDirection(direction){
    if(!['front','left','top','back','right','bottom'].includes(direction)) return;
    lightingState.direction = direction;
    syncLightingControls();
}
function setLightingView(view){
    lightingState.view = view === 'perspective' ? 'perspective' : 'front';
    syncLightingControls();
}
function resetLightingParameters(){
    lightingState = {...lightingState, brightness:50, temperature:5000, direction:'front', view:'front'};
    syncLightingControls();
}
function lightingImageCandidates(item){
    return [...new Set([
        displayMediaUrl(item),
        proxiedMediaUrl(item),
        displayMediaUrl({url:smartOriginalMediaUrl(item)})
    ].map(value => String(value || '').trim()).filter(Boolean))];
}
function loadLightingSourceImage(item){
    const token = ++lightingLoadToken;
    const candidates = lightingImageCandidates(item);
    return new Promise((resolve, reject) => {
        const tryCandidate = index => {
            if(token !== lightingLoadToken) return reject(new Error('cancelled'));
            if(index >= candidates.length) return reject(new Error('图片加载失败'));
            const image = new Image();
            if(!/^data:|^blob:/i.test(candidates[index])) image.crossOrigin = 'anonymous';
            image.onload = async () => {
                try { if(image.decode) await image.decode(); } catch(e) {}
                if(token !== lightingLoadToken) return reject(new Error('cancelled'));
                resolve(image);
            };
            image.onerror = () => tryCandidate(index + 1);
            image.src = candidates[index];
        };
        tryCandidate(0);
    });
}
async function openLightingPanel(nodeId, imageIndex=0){
    const node = nodes.find(entry => entry.id === nodeId);
    const rawImage = node?.images?.[imageIndex];
    const item = imageForDisplay(rawImage);
    if(!node || !item?.url || mediaKindForItem(item) !== 'image'){
        toast('当前素材不支持打光');
        return;
    }
    const saved = rawImage?.lighting || {};
    lightingState = {
        nodeId,
        imageIndex,
        brightness:lightingClamp(saved.brightness, 0, 100, 50),
        temperature:lightingClamp(saved.temperature, 2500, 9000, 5000),
        direction:['front','left','top','back','right','bottom'].includes(saved.direction) ? saved.direction : 'front',
        view:saved.view === 'perspective' ? 'perspective' : 'front',
        applying:false
    };
    lightingSourceImage = null;
    lightingModal?.classList.add('open');
    const loading = document.getElementById('lightingPreviewLoading');
    if(loading){
        loading.classList.remove('hidden');
        loading.innerHTML = '<i data-lucide="loader-circle"></i><span>载入图片…</span>';
    }
    syncLightingControls();
    refreshIcons();
    try {
        lightingSourceImage = await loadLightingSourceImage(item);
        if(!lightingModal?.classList.contains('open') || lightingState.nodeId !== nodeId) return;
        loading?.classList.add('hidden');
        syncLightingControls();
    } catch(error) {
        if(error?.message === 'cancelled') return;
        if(loading){
            loading.classList.remove('hidden');
            loading.innerHTML = '<span>图片载入失败，请重新上传后再试</span>';
        }
        toast('打光预览载入失败');
    }
}
function closeLightingPanel(){
    lightingLoadToken += 1;
    lightingModal?.classList.remove('open');
    lightingSourceImage = null;
    lightingState = {...lightingState, applying:false};
}
function lightingDirectionLabel(direction){
    const labels = {
        front:'前方顺光',
        left:'左侧光',
        top:'顶光',
        back:'后方逆光',
        right:'右侧光',
        bottom:'底光'
    };
    return labels[direction] || labels.front;
}
function lightingPromptText(){
    const brightness = Math.round(lightingState.brightness);
    const temperature = Math.round(lightingState.temperature);
    const temperatureLabel = lightingTemperatureDescription(temperature);
    const direction = lightingDirectionLabel(lightingState.direction);
    const view = lightingState.view === 'perspective' ? '透视' : '正面';
    return `打光参数：亮度 ${brightness}%，色温 ${temperature}K（${temperatureLabel}），主光源方向为${direction}，采用${view}视角。`;
}
function appendLightingPromptToComposer(text){
    if(!promptInput || promptInput.dataset.promptLocked === '1') return false;
    const content = String(text || '').trim();
    if(!content) return false;
    const hasExistingText = Boolean(promptPlainText().trim());
    promptInput.appendChild(document.createTextNode(`${hasExistingText ? '\n' : ''}${content}`));
    promptInput.dispatchEvent(new Event('input', {bubbles:true}));
    promptInput.focus({preventScroll:true});
    const selection = window.getSelection?.();
    if(selection){
        const range = document.createRange();
        range.selectNodeContents(promptInput);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }
    return true;
}
function applyLightingEffect(){
    if(lightingState.applying) return;
    const node = nodes.find(entry => entry.id === lightingState.nodeId);
    if(!node){
        toast('原图片已不存在');
        closeLightingPanel();
        return;
    }
    const promptText = lightingPromptText();
    closeLightingPanel();
    if(!appendLightingPromptToComposer(promptText)){
        toast('当前提示词不可编辑');
        return;
    }
    scheduleSave();
    toast('打光参数已写入提示词');
}
// 智能分组顶部小菜单：整理排列 / 预览（整组左右切换）/ 宫格拼接 / 批量下载 / 解散分组。
// 与多图节点的 smart-node-floating-menu 同款样式与定位（选中分组时浮在卡片上方）。
bindLightingRangePointerControl('lightingBrightnessRange', setLightingBrightness);
bindLightingRangePointerControl('lightingTemperatureRange', setLightingTemperature);
window.LingDrawFeatures?.register('smart-canvas-media-tools', true);
