// Session-local receipts: no cross-account storage and no unbounded image copies.
export function assetReference(url, name, mime, origin) {
  try {
    const parsed = new URL(url, origin);
    if (parsed.origin !== origin || parsed.username || parsed.password || !parsed.pathname.startsWith('/assets/')) return null;
    return { url: parsed.pathname + parsed.search, name, mime, kind: 'image' };
  } catch { return null; }
}

export async function checkReferences(references, signal, request = fetch) {
  if (!references.length) return new Set();
  const response = await request('/api/canvas-assets/check', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: references.map(ref => ref.url) }), signal });
  if (response.status === 401 || response.status === 403) throw new Error('登录失效或没有访问权限，请重新登录后再导入');
  if (!response.ok) throw new Error('暂时无法核对已有图片，请保留画布后重试');
  let data;
  try { data = await response.json(); } catch { throw new Error('图片核对响应异常，请保留画布后重试'); }
  if (!data.exists || typeof data.exists !== 'object') throw new Error('图片核对响应不完整，请重试');
  return new Set(references.filter(ref => data.exists[ref.url] === true).map(ref => ref.url));
}

export function uploadFiles(files, signal, onProgress, XHR = XMLHttpRequest) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const xhr = new XHR();
    const abort = () => xhr.abort();
    const finish = (error, result) => { signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(result); };
    xhr.open('POST', '/api/ai/upload'); xhr.timeout = 120000;
    xhr.upload.onprogress = event => onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : 0 });
    xhr.onerror = () => finish(new Error('上传连接中断，画布已保留，请重试'));
    xhr.ontimeout = () => finish(new Error('上传超时，画布已保留，请重试'));
    xhr.onabort = () => finish(new DOMException('Upload cancelled', 'AbortError'));
    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { /* Proxy HTML must not leak as a JSON exception. */ }
      if (xhr.status === 401 || xhr.status === 403) return finish(new Error('登录失效或没有上传权限，请重新登录'));
      if (xhr.status < 200 || xhr.status >= 300 || !Array.isArray(data?.files) || data.files.length !== files.length)
        return finish(new Error(typeof data?.detail === 'string' ? data.detail : `上传未收到有效确认（HTTP ${xhr.status}），请保留画布后重试`));
      const refs = data.files.map((ref, i) => assetReference(ref?.url, ref?.name || files[i].name, ref?.mime || files[i].blob.type, location.origin));
      if (refs.some(ref => !ref)) return finish(new Error('上传返回了无效图片地址，请重试'));
      finish(null, refs);
    };
    signal?.addEventListener('abort', abort, { once: true });
    const form = new FormData();
    files.forEach(file => form.append('files', file.blob, file.name));
    xhr.send(form);
  });
}

export function transferProgress(progress, elapsed) {
  if (!progress) return '';
  const mb = value => (value / 1048576).toFixed(1);
  const bytes = progress.total ? ` ${mb(progress.loaded)}/${mb(progress.total)} MB（${Math.min(99, Math.floor(progress.loaded / progress.total * 100))}%）` : '';
  return `${progress.stage}${bytes} · 已用时 ${elapsed} 秒`;
}
