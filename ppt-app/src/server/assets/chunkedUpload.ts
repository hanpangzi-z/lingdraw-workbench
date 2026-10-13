import { getPrisma } from "@/src/server/db/prisma";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AssetType } from "@/src/generated/prisma/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/src/server/errors";
import { CHUNK_UPLOAD_BYTES, maxUploadBytesFor } from "./config";

const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_UPLOADS_PER_USER = 3;
const META_FILE = "upload.json";
const COMPLETE_LOCK_FILE = "complete.lock";

export interface ChunkUploadSession {
  version: 1;
  uploadId: string;
  userId: string;
  projectId: string;
  fileName: string;
  mimeType: string;
  type: AssetType;
  totalSize: number;
  chunkSize: number;
  chunkCount: number;
  createdAt: number;
  updatedAt: number;
  completedAsset?: Record<string, unknown>;
  completedAt?: number;
}

function uploadRoot() {
  const configured = process.env.PPT_UPLOAD_TEMP_PATH
    || path.join(process.env.PPT_STORAGE_PATH || process.env.LOCAL_STORAGE_PATH || "storage", ".uploads");
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), configured);
}

function uploadDirectory(uploadId: string) {
  if (!UPLOAD_ID_PATTERN.test(uploadId)) throw new ValidationError("分片上传编号无效");
  return path.join(uploadRoot(), uploadId);
}

function partPath(directory: string, partNumber: number) {
  return path.join(directory, `${partNumber}.part`);
}

function safeFileName(value: string) {
  const fileName = String(value || "").replace(/[\0\r\n]/g, "").trim();
  if (!fileName) throw new ValidationError("文件名不能为空");
  if (fileName.length > 260) throw new ValidationError("文件名过长");
  return fileName;
}

function assertSessionOwner(session: ChunkUploadSession, userId: string, projectId: string) {
  if (session.userId !== userId || session.projectId !== projectId) throw new NotFoundError("分片上传不存在");
}

async function writeSession(_directory: string, session: ChunkUploadSession) {
  await getPrisma().uploadSession.upsert({
    where: { id: session.uploadId },
    create: { id: session.uploadId, userId: session.userId, payload: JSON.parse(JSON.stringify(session)), updatedAt: BigInt(session.updatedAt), completed: !!session.completedAsset },
    update: { payload: JSON.parse(JSON.stringify(session)), updatedAt: BigInt(session.updatedAt), completed: !!session.completedAsset },
  });
}
async function readSession(uploadId: string) {
  const directory = uploadDirectory(uploadId);
  const row = await getPrisma().uploadSession.findUnique({ where: { id: uploadId } });
  if (!row) throw new NotFoundError("分片上传不存在或已过期");
  return { directory, session: row.payload as unknown as ChunkUploadSession };
}

async function fileDigest(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export function expectedChunkBytes(session: ChunkUploadSession, partNumber: number) {
  if (!Number.isInteger(partNumber) || partNumber < 0 || partNumber >= session.chunkCount)
    throw new ValidationError("分片序号超出范围");
  return partNumber === session.chunkCount - 1
    ? session.totalSize - partNumber * session.chunkSize
    : session.chunkSize;
}

export async function cleanupExpiredChunkUploads(now = Date.now()) {
  const cutoff = BigInt(now - UPLOAD_TTL_MS);
  const expired = await getPrisma().uploadSession.findMany({ where: { updatedAt: { lt: cutoff } }, select: { id: true } });
  for (const row of expired) {
    const removed = await getPrisma().uploadSession.deleteMany({ where: { id: row.id, updatedAt: { lt: cutoff } } });
    if (removed.count) await rm(uploadDirectory(row.id), { recursive: true, force: true });
  }
}

export async function beginChunkUpload(input: {
  userId: string;
  projectId: string;
  fileName: string;
  mimeType?: string;
  type: AssetType;
  totalSize: number;
}) {
  if (!Number.isSafeInteger(input.totalSize) || input.totalSize <= 0) throw new ValidationError("不能上传空文件");
  const maxBytes = maxUploadBytesFor(input.type);
  if (input.totalSize > maxBytes) throw new ValidationError(`单文件不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB`);
  await cleanupExpiredChunkUploads();
  const activeUploads = await getPrisma().uploadSession.count({ where: { userId: input.userId, completed: false } });
  if (activeUploads >= MAX_ACTIVE_UPLOADS_PER_USER)
    throw new ConflictError(`同时最多保留 ${MAX_ACTIVE_UPLOADS_PER_USER} 个分片上传任务，请稍后重试`);
  const uploadId = randomUUID();
  const directory = uploadDirectory(uploadId);
  const now = Date.now();
  const session: ChunkUploadSession = {
    version: 1,
    uploadId,
    userId: input.userId,
    projectId: input.projectId,
    fileName: safeFileName(input.fileName),
    mimeType: String(input.mimeType || "application/octet-stream").slice(0, 200),
    type: input.type,
    totalSize: input.totalSize,
    chunkSize: CHUNK_UPLOAD_BYTES,
    chunkCount: Math.ceil(input.totalSize / CHUNK_UPLOAD_BYTES),
    createdAt: now,
    updatedAt: now,
  };
  await mkdir(uploadRoot(), { recursive: true });
  await mkdir(directory, { recursive: false });
  await writeSession(directory, session);
  return session;
}

export async function getChunkUpload(uploadId: string, userId: string, projectId: string) {
  const current = await readSession(uploadId);
  assertSessionOwner(current.session, userId, projectId);
  return current;
}

export async function storeUploadChunk(input: {
  uploadId: string;
  userId: string;
  projectId: string;
  partNumber: number;
  checksum: string;
  bytes: Uint8Array;
}) {
  const { directory, session } = await getChunkUpload(input.uploadId, input.userId, input.projectId);
  if (session.completedAsset) throw new ConflictError("文件已经完成上传");
  const expectedSize = expectedChunkBytes(session, input.partNumber);
  if (input.bytes.byteLength !== expectedSize) throw new ValidationError("分片大小与上传计划不一致");
  const checksum = String(input.checksum || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(checksum)) throw new ValidationError("分片校验值无效");
  const actualChecksum = createHash("sha256").update(input.bytes).digest("hex");
  if (actualChecksum !== checksum) throw new ValidationError("分片校验失败，请重试");

  const target = partPath(directory, input.partNumber);
  try {
    const existing = await stat(target);
    if (existing.size === expectedSize && await fileDigest(target) === checksum)
      return { ok: true, partNumber: input.partNumber, deduplicated: true };
    throw new ConflictError("该分片已存在但内容不同，请重新上传文件");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, input.bytes, { flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    try {
      const existing = await stat(target);
      if (existing.size === expectedSize && await fileDigest(target) === checksum)
        return { ok: true, partNumber: input.partNumber, deduplicated: true };
    } catch { /* Preserve the original write error. */ }
    throw error;
  }
  session.updatedAt = Date.now();
  await writeSession(directory, session);
  return { ok: true, partNumber: input.partNumber, deduplicated: false };
}

export async function completeChunkUpload<T extends Record<string, unknown>>(
  uploadId: string,
  userId: string,
  projectId: string,
  persist: (filePath: string, session: ChunkUploadSession) => Promise<T>,
) {
  const { directory, session } = await getChunkUpload(uploadId, userId, projectId);
  if (session.completedAsset) return session.completedAsset as T;
  let lock;
  try {
    lock = await open(path.join(directory, COMPLETE_LOCK_FILE), "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ConflictError("文件正在合并，请稍后重试");
    throw error;
  }

  const combinedPath = path.join(directory, `${randomUUID()}.complete`);
  let output;
  try {
    output = await open(combinedPath, "wx");
    let written = 0;
    for (let partNumber = 0; partNumber < session.chunkCount; partNumber += 1) {
      const sourcePath = partPath(directory, partNumber);
      let info;
      try { info = await stat(sourcePath); }
      catch { throw new ValidationError(`第 ${partNumber + 1} 个分片尚未上传`); }
      if (info.size !== expectedChunkBytes(session, partNumber)) throw new ValidationError(`第 ${partNumber + 1} 个分片大小不正确`);
      for await (const chunk of createReadStream(sourcePath)) {
        const buffer = chunk as Buffer;
        let chunkOffset = 0;
        while (chunkOffset < buffer.byteLength) {
          const result = await output.write(buffer, chunkOffset, buffer.byteLength - chunkOffset, written);
          if (result.bytesWritten <= 0) throw new Error("分片合并写入失败");
          chunkOffset += result.bytesWritten;
          written += result.bytesWritten;
        }
      }
    }
    await output.close();
    output = undefined;
    if (written !== session.totalSize) throw new ValidationError("分片合并后的文件大小不正确");
    const asset = await persist(combinedPath, session);
    session.completedAsset = asset;
    session.completedAt = Date.now();
    session.updatedAt = session.completedAt;
    await writeSession(directory, session);
    await Promise.all([
      rm(combinedPath, { force: true }),
      ...Array.from({ length: session.chunkCount }, (_, index) => rm(partPath(directory, index), { force: true })),
    ]);
    return asset;
  } finally {
    await output?.close().catch(() => undefined);
    await rm(combinedPath, { force: true }).catch(() => undefined);
    await lock.close().catch(() => undefined);
    await rm(path.join(directory, COMPLETE_LOCK_FILE), { force: true }).catch(() => undefined);
  }
}

export async function abortChunkUpload(uploadId: string, userId: string, projectId: string) {
  const { directory, session } = await getChunkUpload(uploadId, userId, projectId);
  assertSessionOwner(session, userId, projectId);
  await rm(directory, { recursive: true, force: true });
}
