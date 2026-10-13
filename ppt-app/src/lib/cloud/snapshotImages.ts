import { uploadProjectAsset } from "./upload";
import { isProjectDeleted } from "./apiError";

/** Receipts belong to one project and survive a failed submission in its local draft. */
export type ImageUploadReceipts = Record<string, string>;

export async function uploadSnapshotImages<T>(
  projectId: string,
  snapshot: T,
  receipts: ImageUploadReceipts,
  progress: (message: string) => void,
): Promise<T> {
  const sources = new Set<string>();
  const collect = (value: unknown) => {
    if (typeof value === "string") {
      if (value.startsWith("blob:") || value.startsWith("data:image/")) sources.add(value);
    } else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(snapshot);
  const aliases = new Map<string, string>();
  const files = new Map<string, File>();
  let prepared = 0;
  for (const source of sources) {
    progress(`正在整理图片 ${prepared + 1}/${sources.size}…`);
    const response = await fetch(source);
    if (!response.ok) throw new Error("本地图片读取失败，请保留页面后重试");
    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || !blob.size) throw new Error("图片为空或格式不正确，请检查导入资料");
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
      (byte) => byte.toString(16).padStart(2, "0")).join("");
    aliases.set(source, hash);
    if (!receipts[hash] && !files.has(hash)) {
      const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/svg+xml": "svg", "image/gif": "gif" } as Record<string, string>)[blob.type] || "img";
      files.set(hash, new File([blob], `${hash}.${extension}`, { type: blob.type }));
    }
    prepared += 1;
  }
  const queue = [...files.entries()];
  const totalBytes = queue.reduce((sum, [, file]) => sum + file.size, 0);
  const loaded = new Map<string, number>();
  let next = 0;
  let failure: unknown;
  const report = () => {
    const bytes = [...loaded.values()].reduce((sum, size) => sum + size, 0);
    progress(`正在上传图片 ${(bytes / 1024 / 1024).toFixed(1)}/${(totalBytes / 1024 / 1024).toFixed(1)} MB（${Math.round(bytes / totalBytes * 100)}%）`);
  };
  // Bound upload concurrency; settle active uploads before reporting failure so a
  // retry cannot race requests that are still adding receipts to this draft.
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (!failure && next < queue.length) {
      const [hash, file] = queue[next++];
      try {
        const asset = await uploadProjectAsset(projectId, file, "product_image", (percent) => {
          loaded.set(hash, file.size * percent / 100); report();
        }, progress);
        if (!asset.url) throw new Error("图片上传未返回有效引用，请重试");
        receipts[hash] = asset.url;
        loaded.set(hash, file.size); report();
      } catch (error) {
        // A later timeout from another active upload must not hide deletion.
        if (!failure || isProjectDeleted(error)) failure = error;
      }
    }
  }));
  if (failure) throw failure;
  const replace = (value: unknown): unknown => {
    if (typeof value === "string") {
      const hash = aliases.get(value);
      return hash ? receipts[hash] : value;
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]));
    return value;
  };
  return replace(snapshot) as T;
}
