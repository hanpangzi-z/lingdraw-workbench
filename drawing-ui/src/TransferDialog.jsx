import React, { useEffect, useRef, useState } from 'react';
import { annotationSources, annotationText, drawingPrompt } from './annotation-export.js';
import { exportDimensions, generationDimensions, hasUpscaledImages } from './export-sizing.js';

export default function TransferDialog({ snapshot, intent = 'chat', lang, busy, progress, percent, error, onCancel, onSubmit }) {
  const dialog = useRef(null);
  const sources = annotationSources(snapshot.elements, snapshot.files);
  const [mode, setMode] = useState(sources.length ? 'annotation' : 'sketch');
  const [sourceId, setSourceId] = useState(sources.find(source => snapshot.appState.selectedElementIds?.[source.id])?.id || sources[0]?.id || '');
  const [instructions, setInstructions] = useState(annotationText(snapshot.elements));
  const [preview, setPreview] = useState('');
  const [quality, setQuality] = useState(intent === 'download' && sources.length ? 'auto' : '2k');
  const [lightweight, setLightweight] = useState(false);
  const isDownload = intent === 'download';
  const zh = lang === 'zh';
  useEffect(() => {
    dialog.current.showModal();
    const url = URL.createObjectURL(snapshot.blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [snapshot]);
  const source = sources.find(item => item.id === sourceId);
  const sourceElement = snapshot.elements.find(element => element.id === sourceId);
  const sourceSize = snapshot.imageDimensions[sourceElement?.fileId];
  const canvasSize = exportDimensions(snapshot.logicalSize.width, snapshot.logicalSize.height, quality, snapshot.density);
  const generationSize = generationDimensions(canvasSize, sourceSize, quality, mode);
  const upscaled = hasUpscaledImages(snapshot.elements, snapshot.imageDimensions, canvasSize.scale)
    || (!isDownload && mode === 'annotation' && sourceSize && Math.max(generationSize.width, generationSize.height) > Math.max(sourceSize.width, sourceSize.height) + 16);
  const valid = isDownload || mode === 'sketch' || (source && instructions.trim());
  return <dialog ref={dialog} className="transfer-dialog" aria-labelledby="transfer-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <form onSubmit={event => { event.preventDefault(); if (valid && !busy) onSubmit({ mode, source, quality, generationSize, lightweight, prompt: isDownload ? '' : drawingPrompt(mode, instructions) }); }}>
      <h2 id="transfer-title">{isDownload ? (zh ? '导出图片' : 'Export PNG') : (zh ? '导入创意生图' : 'Use in Creative Images')}</h2>
      {!isDownload && <><fieldset className="transfer-modes" disabled={busy}>
        <legend>{zh ? '这张画布用来做什么？' : 'How should this drawing be used?'}</legend>
        <label><input type="radio" name="purpose" value="annotation" checked={mode === 'annotation'} disabled={!sources.length} onChange={() => setMode('annotation')} />{zh ? '标注改图' : 'Edit with annotations'}</label>
        <label><input type="radio" name="purpose" value="sketch" checked={mode === 'sketch'} onChange={() => setMode('sketch')} />{zh ? '草图生图' : 'Generate from sketch'}</label>
      </fieldset>
      <p className="transfer-help">{mode === 'annotation'
        ? (zh ? '原图与标注示意图会分别发送。箭头、圈线和说明文字只用于传达修改要求。' : 'The original and annotated guide are sent separately. Guide marks describe edits only.')
        : (zh ? '将整张画布作为创作参考，保留绘画、文字与图片的构图关系。' : 'Use the full canvas as a composition reference for a new image.')}</p>
      {mode === 'annotation' && sources.length > 1 && <label className="transfer-field">{zh ? '选择要修改的原图' : 'Choose the image to edit'}<select value={sourceId} disabled={busy} onChange={event => setSourceId(event.target.value)}>{sources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</>}
      <label className="transfer-field quality-field">{zh ? '清晰度' : 'Resolution'}<select aria-label={zh ? '清晰度' : 'Resolution'} value={quality} disabled={busy} onChange={event => setQuality(event.target.value)}>
        <option value="auto">{zh ? '跟随原图（画布最高 4096 像素）' : 'Match original (canvas up to 4096 px)'}</option>
        <option value="2k">2K · {zh ? '长边 2048 像素' : '2048 px long edge'}</option>
        <option value="4k">4K · {zh ? '长边 4096 像素' : '4096 px long edge'}</option>
      </select></label>
      <div className="export-dimensions" aria-live="polite"><span>{zh ? '画布像素' : 'Canvas pixels'} · {canvasSize.width} × {canvasSize.height}</span>
        {!isDownload && <span>{zh ? '生成尺寸' : 'Generation'} · {generationSize.width} × {generationSize.height}</span>}
        {!isDownload && mode === 'annotation' && sourceSize && <span>{zh ? '原图保持' : 'Original unchanged'} · {sourceSize.width} × {sourceSize.height}</span>}
      </div>
      {upscaled && <p className="transfer-help">{zh ? '增加输出像素，不恢复原图细节。' : 'More output pixels do not restore missing image detail.'}</p>}
      {!isDownload && mode === 'annotation' && <label className="transfer-help"><input type="checkbox" checked={lightweight} disabled={busy} onChange={event => setLightweight(event.target.checked)} />{zh ? '轻量标注图（同像素 WebP；原图不变。细字保真优先时请保持关闭）' : 'Smaller guide (same-pixel WebP, original unchanged; leave off for fine text)'}</label>}
      <div className={`transfer-previews ${isDownload || mode === 'sketch' ? 'single' : ''}`}>
        {!isDownload && mode === 'annotation' && source && <figure><img src={snapshot.imagePreviews[sourceElement.fileId]} alt={zh ? '干净原图预览' : 'Clean original preview'} /><figcaption>{zh ? '原图 · 修改对象' : 'Original · edit target'}</figcaption></figure>}
        <figure><img src={preview} alt={zh ? '当前画布预览' : 'Canvas preview'} /><figcaption>{isDownload ? (zh ? '完整画布 · 轻量预览' : 'Full canvas · preview') : mode === 'annotation' ? (zh ? '标注图 · 仅作说明' : 'Guide · instructions only') : (zh ? '草图 · 创作参考' : 'Sketch · composition reference')}</figcaption></figure>
      </div>
      {!isDownload && <><label className="transfer-field">{mode === 'annotation' ? (zh ? '修改说明（必填，可编辑）' : 'Edit instructions (required)') : (zh ? '创作要求（选填）' : 'Creative brief (optional)')}
        <textarea value={instructions} onChange={event => setInstructions(event.target.value)} disabled={busy} required={mode === 'annotation'} maxLength={6000} rows={3} placeholder={zh ? '例如：把箭头指向的苹果改成绿色，保留水珠、光影和背景。' : 'For example: make the indicated apple green; preserve droplets, lighting and background.'} />
      </label>
      <p className="transfer-help">{zh ? '画布文字已带入。导入后自动匹配本次生成尺寸，生成前仍可修改；较大尺寸可能增加耗时或费用。' : 'Canvas text is prefilled. The generation size follows this import and remains editable. Larger sizes may cost more or take longer.'}</p></>}
      {error && <p className="transfer-error" role="alert">{error}</p>}
      {progress && <div className="transfer-progress" role="status"><div>{progress}</div><progress aria-label={zh ? '当前上传阶段进度' : 'Current upload progress'} max="100" value={percent} /><small>{zh ? '分阶段进度，不是整体完成百分比；请勿关闭页面。' : 'Current stage only. Keep this page open.'}</small></div>}
      <div className="transfer-actions"><button type="button" className="action-button" disabled={busy} onClick={onCancel}>{zh ? '返回画布' : 'Back'}</button><button type="submit" className="action-button primary" disabled={busy || !valid}>{busy ? (zh ? '正在处理…' : 'Processing…') : isDownload ? (zh ? '下载 PNG' : 'Download PNG') : (zh ? '导入并填写提示词' : 'Import with instructions')}</button></div>
    </form>
  </dialog>;
}
