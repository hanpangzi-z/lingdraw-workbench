// Keep the original file intact; the flattened canvas is only an instruction guide.
export function annotationSources(elements, files) {
  return elements.filter(item => !item.isDeleted && item.type === 'image' && files[item.fileId]?.dataURL)
    .map((item, index) => ({ id: item.id, file: files[item.fileId], name: item.customData?.filename || `原图 ${index + 1}` }));
}

export function annotationText(elements) {
  return [...new Set(elements.filter(item => !item.isDeleted && item.type === 'text')
    .map(item => String(item.originalText ?? item.text ?? '').trim()).filter(Boolean))].join('\n');
}

export function originalImageBlob(file) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif|bmp));base64,([A-Za-z0-9+/=\s]+)$/.exec(file?.dataURL || '');
  if (!match) throw new Error('原图格式暂不支持，请使用 PNG、JPEG、WebP、GIF 或 BMP 图片');
  const binary = atob(match[2]);
  return new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type: match[1] });
}

export function drawingPrompt(mode, instructions) {
  const text = String(instructions || '').trim();
  if (mode === 'annotation' && !text) throw new Error('请填写具体修改要求，例如：将箭头指向的苹果改成绿色');
  return mode === 'annotation'
    ? `请根据标注修改原图。修改要求：\n${text}`
    : `请根据画布草图生成完整作品。${text ? `\n创作要求：\n${text}` : ''}`;
}
