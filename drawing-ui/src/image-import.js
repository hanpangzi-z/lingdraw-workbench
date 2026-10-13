export function resolveImageSource(value, origin) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid image source');
  const url = new URL(value, origin);
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Images must use the authenticated, same-origin media route');
  }
  return url.href;
}

export function fitImageSize(width, height, maxEdge = 960) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Invalid image dimensions');
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: width * scale, height: height * scale };
}

// Cold-start delivery can be retried. A request must insert its image only once,
// and concurrent imports must not replace each other's scene snapshots.
export function createImportQueue(importImage) {
  const pending = new Map();
  const completed = new Map();
  let tail = Promise.resolve();
  return {
    enqueue(payload) {
      if (completed.has(payload.requestId)) return Promise.resolve(completed.get(payload.requestId));
      if (pending.has(payload.requestId)) return pending.get(payload.requestId);
      const task = tail.then(() => importImage(payload)).then(result => {
        pending.delete(payload.requestId);
        completed.set(payload.requestId, result);
        if (completed.size > 100) completed.delete(completed.keys().next().value);
        return result;
      }, error => {
        pending.delete(payload.requestId);
        throw error;
      });
      pending.set(payload.requestId, task);
      tail = task.catch(() => {});
      return task;
    },
  };
}

export async function loadImageFile(sourceUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  let objectUrl;
  try {
    const response = await fetch(sourceUrl, { credentials: 'same-origin', signal: controller.signal });
    if (!response.ok) throw new Error('Image request failed');
    const maxBytes = 50 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Image is too large');
    let blob = await response.blob();
    if (!blob.size || blob.size > maxBytes) throw new Error('Image size is invalid');
    // Some providers send image bytes as application/octet-stream.
    if (!blob.type.startsWith('image/')) {
      const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      const ascii = String.fromCharCode(...bytes);
      const mime = bytes[0] === 137 && ascii.slice(1, 4) === 'PNG' ? 'image/png'
        : bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg'
        : ascii.startsWith('GIF8') ? 'image/gif'
        : ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP' ? 'image/webp'
        : ascii.startsWith('BM') ? 'image/bmp' : '';
      if (!mime) throw new Error('Response is not an image');
      blob = new Blob([blob], { type: mime });
    }
    objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return { blob, ...fitImageSize(image.naturalWidth, image.naturalHeight) };
  } finally {
    clearTimeout(timeout);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
