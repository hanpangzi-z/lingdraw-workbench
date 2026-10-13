import { withBasePath } from "@/src/lib/basePath";
import { CloudApiError, isUncertainResponse, parseCloudResponse, readCloudResponse, recoverCloudResult } from "./apiError";

export const CHUNK_UPLOAD_BYTES = 5 * 1024 * 1024;
const CHUNK_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 250;

export type ClientAssetType = "source_file" | "product_image" | "logo" | "generated_ppt" | "thumbnail";

export interface ClientAsset {
  id: string;
  type: ClientAssetType;
  fileName: string;
  mimeType: string;
  size: number;
  width?: number | null;
  height?: number | null;
  createdAt: string;
  url: string;
  role?: string;
}

function notifyAuthRequired(status: number) {
  if (status === 401 && window.parent !== window)
    window.parent.postMessage({ type: "ppt:auth-required" }, window.location.origin);
}

async function responsePayload(response: Response) {
  notifyAuthRequired(response.status);
  return readCloudResponse<{ asset?: ClientAsset; error?: string; code?: string; uploadId?: string; chunkSize?: number; chunkCount?: number }>(response, "上传文件");
}

function directUpload(projectId: string, file: File, type: ClientAssetType, onProgress?: (percent: number) => void) {
  return new Promise<ClientAsset>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("type", type);
    const request = new XMLHttpRequest();
    request.open("POST", withBasePath(`/api/projects/${projectId}/assets`));
    request.timeout = 120_000;
    request.upload.onprogress = (event) => event.lengthComputable && onProgress?.(Math.min(95, Math.round((event.loaded / event.total) * 100)));
    request.onerror = () => reject(new CloudApiError("网络异常，上传结果待核对"));
    request.ontimeout = () => reject(new CloudApiError("上传超时，上传结果待核对"));
    request.onabort = () => reject(new CloudApiError("上传已中断，上传结果待核对"));
    request.onload = () => {
      try {
        notifyAuthRequired(request.status);
        const payload = parseCloudResponse<{ asset?: ClientAsset; error?: string; code?: string }>(request.responseText, request.status, "上传文件");
        if (!payload.asset?.id || !payload.asset.url) throw new CloudApiError(payload.error || "上传确认数据不完整，正在核对结果", request.status, payload.code || "INVALID_RESPONSE");
        onProgress?.(100);
        resolve(payload.asset);
      } catch (error) { reject(error); }
    };
    request.send(form);
  });
}

class ChunkRequestError extends CloudApiError {}

const retryDelay = (attempt: number) => new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * 2 ** attempt));

async function sha256(blob: Blob) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function uploadChunk(url: string, chunk: Blob, index: number, checksum: string, onProgress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.timeout = 120_000;
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.setRequestHeader("X-Chunk-Index", String(index));
    request.setRequestHeader("X-Chunk-SHA256", checksum);
    request.upload.onprogress = (event) => onProgress(Math.min(chunk.size, event.loaded));
    request.onerror = () => reject(new ChunkRequestError("网络异常，分片上传失败"));
    request.ontimeout = () => reject(new ChunkRequestError("分片上传超时，请重试"));
    request.onabort = () => reject(new ChunkRequestError("分片上传已中断，请重试"));
    request.onload = () => {
      notifyAuthRequired(request.status);
      try {
        parseCloudResponse(request.responseText, request.status, "分片上传");
        onProgress(chunk.size); resolve();
      } catch (error) { reject(error); }
    };
    request.send(chunk);
  });
}

async function uploadChunkWithRetry(url: string, chunk: Blob, index: number, checksum: string, onProgress: (loaded: number) => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < CHUNK_RETRY_ATTEMPTS; attempt += 1) {
    try { return await uploadChunk(url, chunk, index, checksum, onProgress); }
    catch (error) {
      lastError = error;
      if (!isUncertainResponse(error)) throw error;
      if (attempt < CHUNK_RETRY_ATTEMPTS - 1) await retryDelay(attempt);
    }
  }
  throw lastError;
}

async function completeChunkUpload(url: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < CHUNK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { method: "POST", signal: AbortSignal.timeout(120_000) });
      const payload = await responsePayload(response);
      notifyAuthRequired(response.status);
      if (!response.ok || !payload.asset) throw new ChunkRequestError(payload.error || "分片合并失败", response.status, payload.code);
      return payload.asset;
    } catch (error) {
      lastError = error;
      if (!isUncertainResponse(error) && !(error instanceof CloudApiError && error.status === 409)) throw error;
      if (attempt < CHUNK_RETRY_ATTEMPTS - 1) await retryDelay(attempt);
    }
  }
  throw lastError;
}

async function chunkedUpload(projectId: string, file: File, type: ClientAssetType, onProgress?: (percent: number) => void) {
  const collectionUrl = withBasePath(`/api/projects/${projectId}/assets/uploads`);
  const response = await fetch(collectionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, mimeType: file.type, size: file.size, type }),
    signal: AbortSignal.timeout(120_000),
  });
  const plan = await responsePayload(response);
  notifyAuthRequired(response.status);
  if (!response.ok || !plan.uploadId || !plan.chunkSize || !plan.chunkCount)
    throw new ChunkRequestError(plan.error || "无法创建分片上传任务", response.status, plan.code);
  const uploadUrl = withBasePath(`/api/projects/${projectId}/assets/uploads/${plan.uploadId}`);
  let completing = false;
  let reported = 0;
  const report = (percent: number) => {
    reported = Math.max(reported, Math.min(95, percent));
    onProgress?.(reported);
  };
  try {
    for (let index = 0; index < plan.chunkCount; index += 1) {
      const start = index * plan.chunkSize;
      const chunk = file.slice(start, Math.min(file.size, start + plan.chunkSize));
      const checksum = await sha256(chunk);
      await uploadChunkWithRetry(uploadUrl, chunk, index, checksum, (loaded) =>
        report(Math.round(((start + loaded) / file.size) * 95)),
      );
    }
    completing = true;
    const asset = await completeChunkUpload(uploadUrl);
    onProgress?.(100);
    return asset;
  } catch (error) {
    if (!completing) void fetch(uploadUrl, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}

export async function uploadProjectAsset(projectId: string, file: File, type: ClientAssetType, onProgress?: (percent: number) => void, onStatus?: (message: string) => void) {
  // Large sources keep bounded 5 MB hashing; never buffer a whole large workbook.
  if (file.size > CHUNK_UPLOAD_BYTES) return chunkedUpload(projectId, file, type, onProgress);
  const checksum = await sha256(file);
  const lookup = async () => {
    try {
      const response = await fetch(withBasePath(`/api/projects/${projectId}/assets?checksum=${checksum}&type=${type}`), { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const payload = await responsePayload(response);
      if (payload.asset === null) return undefined;
      if (!payload.asset?.id || !payload.asset.url) throw new CloudApiError("上传结果查询返回不完整，当前资料已保留", 200, "INVALID_RESPONSE");
      return payload.asset;
    } catch (error) {
      if (error instanceof CloudApiError || !isUncertainResponse(error)) throw error;
      throw new CloudApiError("上传进度查询中断，当前资料已保留，请保留页面后重试", 0, "NETWORK_ERROR");
    }
  };
  // Content-based receipts survive refresh without serializing the File again.
  const existing = await lookup();
  if (existing) { onProgress?.(100); return existing; }
  try {
    return await directUpload(projectId, file, type, onProgress);
  } catch (error) {
    if (!isUncertainResponse(error)) throw error;
    const recovered = await recoverCloudResult(lookup, "上传图片/文件", onStatus);
    onProgress?.(100); return recovered;
  }
}
