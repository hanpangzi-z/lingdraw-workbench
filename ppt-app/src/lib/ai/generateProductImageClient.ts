import { MAX_IMAGE_REFERENCES } from "@/src/lib/ai/imageScenePrompts";
import { pptFetch } from "@/src/lib/basePath";
import { ImageJobFailedError, ImageJobPendingError, type ImageJobProgress, type ImageJobResult } from "./imageJobProtocol";
export const PRODUCT_IMAGE_GENERATION_TIMEOUT_MS = 260_000;
export interface ProductImageGenerationInput {
  prompt: string; productName: string; referenceImages: string[]; aspectRatio: number;
  projectId?: string; providerId: string; model: string;
}
export type ProductImageGenerationResult = ImageJobResult;
type Options = { jobId?: string; signal?: AbortSignal; onProgress?: (progress: ImageJobProgress) => void };
type JobResponse = { jobId?: string; status?: string; result?: ImageJobResult; error?: string; imageUrl?: string; outputSize?: string };
async function requestJson(url: string, init: RequestInit, jobId: string, signal?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await pptFetch(url, { ...init, cache: "no-store", signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
    const payload = await response.json().catch(() => undefined) as JobResponse | undefined;
    if (response.status === 401 || response.status === 403) throw new ImageJobPendingError(jobId, "登录或权限校验失败，任务已保留；重新登录后继续查询", true);
    if (response.status === 404) throw new ImageJobPendingError(jobId, "尚未查到该任务，可能请求还未提交完成；请稍后继续查询");
    if (response.status === 409) throw new ImageJobPendingError(jobId, payload?.error || "任务编号冲突，请查询原任务", true);
    if (!response.ok && response.status < 500 && response.status !== 408) throw new ImageJobFailedError(payload?.error || `请求未成功（HTTP ${response.status}）`);
    if (!response.ok || !payload) throw new ImageJobPendingError(jobId);
    return payload;
  } finally { clearTimeout(timeout); }
}
function pause(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const aborted = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", aborted); resolve(); }, milliseconds);
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

export async function pollImageJob(jobId: string, options: Options = {}): Promise<ImageJobResult> {
  const start = Date.now(); let consecutiveErrors = 0;
  while (Date.now() - start < PRODUCT_IMAGE_GENERATION_TIMEOUT_MS) {
    options.signal?.throwIfAborted();
    try {
      const job = await requestJson(`/api/ai/image-jobs/${encodeURIComponent(jobId)}`, {}, jobId, options.signal);
      consecutiveErrors = 0;
      if (job.jobId && job.jobId !== jobId) throw new ImageJobPendingError(jobId, "任务编号不匹配，已停止自动处理", true);
      if (job.status === "succeeded" && job.result?.imageUrl) return job.result;
      if (job.status === "failed") throw new ImageJobFailedError(job.error || "AI 图片生成失败");
      if (job.status === "unknown") throw new ImageJobPendingError(jobId, job.error, true);
      if (!["queued", "generating", "persisting"].includes(job.status || "")) throw new ImageJobPendingError(jobId, "任务返回状态异常，原任务编号已保留", true);
      options.onProgress?.({ message: job.status === "queued" ? "任务已接收，准备生成" : job.status === "persisting" ? "图片已生成，正在保存" : "AI 正在生成，可继续编辑其他内容", elapsedSeconds: Math.floor((Date.now() - start) / 1000) });
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error instanceof ImageJobFailedError) throw error;
      if (error instanceof ImageJobPendingError && error.stopPolling) throw error;
      if (++consecutiveErrors >= 4) throw error instanceof ImageJobPendingError ? error : new ImageJobPendingError(jobId);
      options.onProgress?.({ message: "连接暂时中断，正在查询原任务（不会重新生成）", elapsedSeconds: Math.floor((Date.now() - start) / 1000) });
    }
    await pause(1800, options.signal);
  }
  throw new ImageJobPendingError(jobId, "生成或查询用时较长，任务已保留；可稍后继续查询，不会重新生成");
}

export async function generateProductImage(input: ProductImageGenerationInput, options: Options = {}): Promise<ImageJobResult> {
  const jobId = options.jobId || crypto.randomUUID();
  const form = new FormData();
  form.append("jobId", jobId); form.append("prompt", input.prompt.trim()); form.append("productName", input.productName);
  form.append("aspectRatio", String(input.aspectRatio)); form.append("provider", input.providerId); form.append("model", input.model);
  if (input.projectId) form.append("projectId", input.projectId);
  options.onProgress?.({ message: "正在准备参考图片", elapsedSeconds: 0 });
  for (const [index, source] of input.referenceImages.slice(0, MAX_IMAGE_REFERENCES).entries()) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await pptFetch(source, { signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal });
      if (!response.ok) throw new ImageJobFailedError(`第 ${index + 1} 张参考图片读取失败`);
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new ImageJobFailedError(`第 ${index + 1} 张参考文件不是图片`);
      const extension = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
      form.append("images", new File([blob], `reference-${index + 1}.${extension}`, { type: blob.type }));
    } catch (error) { if (options.signal?.aborted) throw error; throw error instanceof ImageJobFailedError ? error : new ImageJobFailedError("参考图片准备失败，尚未提交绘图任务"); }
    finally { clearTimeout(timeout); }
  }
  options.onProgress?.({ message: "正在提交绘图任务", elapsedSeconds: 0 });
  try {
    const response = await requestJson("/api/ai/generate-product-image", { method: "POST", body: form }, jobId, options.signal);
    if (response.imageUrl) return { imageUrl: response.imageUrl, outputSize: response.outputSize };
    if (response.jobId && response.jobId !== jobId) throw new ImageJobPendingError(jobId, "任务编号不匹配，已停止自动处理", true);
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof ImageJobFailedError) throw error;
    if (error instanceof ImageJobPendingError && error.stopPolling) throw error;
    // Lost acknowledgement does not mean failed generation. Only query the same ID.
  }
  return pollImageJob(jobId, options);
}
