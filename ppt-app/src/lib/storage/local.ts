import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageProvider } from "./types";
import { withBasePath } from "@/src/lib/basePath";

const root = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.PPT_STORAGE_PATH || process.env.LOCAL_STORAGE_PATH || "storage");

function resolveKey(key: string) {
  const target = path.resolve(/*turbopackIgnore: true*/ root, key);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("非法存储路径");
  return target;
}

export class LocalStorageProvider implements StorageProvider {
  async health() {
    await mkdir(root, { recursive: true });
    const probe = resolveKey(`.health-${process.pid}-${randomUUID()}`);
    try {
      await writeFile(probe, new Uint8Array([0x4f, 0x4b]));
      const result = await readFile(probe);
      if (result.byteLength !== 2) throw new Error("存储读写探测失败");
    } finally {
      await rm(probe, { force: true }).catch(() => undefined);
    }
  }

  async upload(input: { key: string; data: Uint8Array; mimeType: string }) {
    const target = resolveKey(input.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.data);
    return { key: input.key, size: input.data.byteLength };
  }

  async uploadFile(input: { key: string; filePath: string; size: number }) {
    const target = resolveKey(input.key);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(input.filePath, target);
    return { key: input.key, size: input.size };
  }

  async delete(key: string) {
    await rm(resolveKey(key), { force: true });
  }

  async getObject(key: string) {
    const target = resolveKey(key);
    const [data, info] = await Promise.all([readFile(target), stat(target)]);
    return { data: new Uint8Array(data), size: info.size };
  }

  async getUrl(key: string) {
    return withBasePath(`/api/storage/local?key=${encodeURIComponent(key)}`);
  }
}
