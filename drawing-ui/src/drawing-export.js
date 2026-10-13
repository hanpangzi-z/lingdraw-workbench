import { exportToCanvas } from '@excalidraw/excalidraw';
import { EXPORT_PADDING, exportDimensions, scenePixelDensity } from './export-sizing.js';

const renderedSnapshots = new WeakMap();
export async function renderDrawingCached(snapshot, quality, signal, lightweight = false) {
  signal?.throwIfAborted();
  const cached = renderedSnapshots.get(snapshot);
  if (cached?.quality === quality && cached.lightweight === lightweight) return cached.output;
  const output = await renderDrawing(snapshot, quality, signal, lightweight);
  signal?.throwIfAborted();
  renderedSnapshots.set(snapshot, { quality, lightweight, output });
  return output;
}

function imageDimensions(file, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (error, value) => {
      image.onload = image.onerror = null;
      signal?.removeEventListener('abort', abort);
      image.src = '';
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(new DOMException('Export cancelled', 'AbortError'));
    if (signal?.aborted) return abort();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      try {
        const width = image.naturalWidth, height = image.naturalHeight;
        const scale = Math.min(1, 512 / Math.max(width, height));
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        finish(null, { width, height, preview: canvas.toDataURL('image/png') });
      } catch (error) { finish(error); }
      finally { canvas.width = canvas.height = 0; }
    };
    image.onerror = () => finish(new Error('原图无法读取，请重新导入图片后再导出'));
    signal?.addEventListener('abort', abort, { once: true });
    image.src = file.dataURL;
  });
}

export async function renderDrawing(snapshot, quality, signal, lightweight = false) {
  signal?.throwIfAborted();
  let logicalSize;
  let canvas;
  try {
    canvas = await exportToCanvas({
      elements: snapshot.elements, files: snapshot.files,
      appState: { ...snapshot.appState, exportBackground: true, exportWithDarkMode: false },
      exportPadding: EXPORT_PADDING,
      getDimensions: (width, height) => {
        logicalSize = { width, height };
        return exportDimensions(width, height, quality, snapshot.density);
      },
    });
    signal?.throwIfAborted();
    const size = { width: canvas.width, height: canvas.height };
    let blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('高清图片导出失败，请重试')), 'image/png'));
    if (lightweight) {
      signal?.throwIfAborted();
      const smaller = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.96));
      if (smaller?.type === 'image/webp' && smaller.size < blob.size * 0.8) blob = smaller;
    }
    signal?.throwIfAborted();
    return { blob, size, logicalSize };
  } finally {
    // Release the large backing buffer even if encoding or cancellation fails.
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export async function prepareDrawingSnapshot(elements, appState, files, signal) {
  const snapshot = { elements: structuredClone(elements), appState: { ...appState }, files: { ...files }, imageDimensions: {}, imagePreviews: {} };
  const imageIds = [...new Set(elements.filter(element => element.type === 'image' && !element.isDeleted).map(element => element.fileId))];
  // Decode sequentially to avoid retaining several 4K image buffers at once.
  for (const id of imageIds) {
    if (!files[id]?.dataURL) throw new Error('画板中的原图已失效，请重新导入');
    const { width, height, preview } = await imageDimensions(files[id], signal);
    snapshot.imageDimensions[id] = { width, height };
    snapshot.imagePreviews[id] = preview;
  }
  snapshot.density = scenePixelDensity(snapshot.elements, snapshot.imageDimensions);
  const preview = await renderDrawing(snapshot, 'preview', signal);
  return { ...snapshot, logicalSize: preview.logicalSize, blob: preview.blob };
}
