export const EXPORT_PADDING = 32;
export const MAX_EXPORT_EDGE = 4096;

const positive = value => Number.isFinite(value) && value > 0;

export function imagePixelDensity(element, dimensions) {
  if (!dimensions || element.isDeleted || element.opacity === 0 || !positive(element.width) || !positive(element.height)) return 0;
  const crop = element.crop;
  // Crop coordinates use the original dimensions recorded by Excalidraw.
  const width = crop ? dimensions.width * crop.width / crop.naturalWidth : dimensions.width;
  const height = crop ? dimensions.height * crop.height / crop.naturalHeight : dimensions.height;
  const density = Math.max(width / element.width, height / element.height);
  return positive(density) ? density : 0;
}

export function scenePixelDensity(elements, dimensions) {
  return elements.reduce((value, element) => element.type === 'image'
    ? Math.max(value, imagePixelDensity(element, dimensions[element.fileId])) : value, 0);
}

export function exportDimensions(width, height, quality = 'auto', density = 0) {
  if (!positive(width) || !positive(height)) throw new Error('画布尺寸无效');
  if (!['auto', '2k', '4k', 'preview'].includes(quality)) throw new Error('导出清晰度无效');
  const edge = Math.max(width, height);
  const target = quality === 'auto' ? (density > 0 ? edge * density : 2048)
    : quality === 'preview' ? Math.min(edge, 1024) : quality === '2k' ? 2048 : 4096;
  const scale = Math.min(target, MAX_EXPORT_EDGE) / edge;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

export function generationDimensions(canvasSize, sourceDimensions, quality, mode) {
  const size = mode === 'annotation' && sourceDimensions
    ? exportDimensions(sourceDimensions.width, sourceDimensions.height, quality, 1) : canvasSize;
  // Use the same rounding rule as the backend, before showing the dimensions.
  return { width: Math.ceil(size.width / 16) * 16, height: Math.ceil(size.height / 16) * 16 };
}

export function hasUpscaledImages(elements, dimensions, exportScale) {
  return elements.some(element => {
    const density = element.type === 'image' ? imagePixelDensity(element, dimensions[element.fileId]) : 0;
    return density > 0 && exportScale > density + .01;
  });
}
