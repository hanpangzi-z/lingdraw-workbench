import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { getPrisma } from "@/src/server/db/prisma";
import { ForbiddenError, NotFoundError, ProjectDeletedError, ResourceConflictError, ValidationError } from "@/src/server/errors";
import { getStorageProvider } from "@/src/lib/storage";
import type { AssetType } from "@/src/generated/prisma/enums";
import type { Prisma } from "@/src/generated/prisma/client";
import { ASSET_TYPE_TO_ROLE, maxUploadBytesFor } from "./config";
import { withBasePath } from "@/src/lib/basePath";
import { assetIdFromReference } from "@/src/lib/assets/reference";

const cleanName = (name: string) => name.replace(/[^a-zA-Z0-9._\-一-龥]/g, "-").slice(-160) || "file";

export async function assertProjectOwner(projectId: string, userId: string, includeDeleted = false) {
  const project = await getPrisma().project.findUnique({ where: { id: projectId }, select: { id: true, userId: true, deletedAt: true } });
  if (!project) throw new NotFoundError("项目不存在");
  if (project.userId !== userId) throw new ForbiddenError();
  if (project.deletedAt && !includeDeleted) throw new ProjectDeletedError();
  return project;
}

export async function createAsset(input: { userId: string; projectId?: string; file: File; type: AssetType; width?: number; height?: number; metadata?: Record<string, unknown>; isSystem?: boolean }) {
  await validatePreparedAsset(input.userId, input.projectId, input.type, input.file.size);
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex");
  return persistPreparedAsset({
    ...input,
    fileName: input.file.name,
    mimeType: input.file.type || "application/octet-stream",
    size: input.file.size,
  }, checksum, (storageKey) => getStorageProvider().upload({ key: storageKey, data: bytes, mimeType: input.file.type || "application/octet-stream" }));
}

type PreparedAssetInput = {
  userId: string;
  projectId?: string;
  type: AssetType;
  fileName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  metadata?: Record<string, unknown>;
  isSystem?: boolean;
};

async function validatePreparedAsset(userId: string, projectId: string | undefined, type: AssetType, size: number) {
  if (projectId) await assertProjectOwner(projectId, userId);
  const maxUploadBytes = maxUploadBytesFor(type);
  if (size > maxUploadBytes) throw new ValidationError(`单文件不能超过 ${Math.round(maxUploadBytes / 1024 / 1024)}MB`);
  if (!size) throw new ValidationError("不能上传空文件");
}

async function persistPreparedAsset(
  input: PreparedAssetInput,
  checksum: string,
  upload: (storageKey: string) => Promise<unknown>,
) {
  const existing = await getPrisma().asset.findFirst({ where: { userId: input.userId, checksum, deletedAt: null } });
  if (existing) {
    if (input.projectId) await getPrisma().projectAsset.create({ data: { projectId: input.projectId, assetId: existing.id, role: ASSET_TYPE_TO_ROLE[input.type] } }).catch(() => undefined);
    if (input.type === "source_file" && input.projectId) {
      await getPrisma().sourceFile.create({ data: { projectId: input.projectId, assetId: existing.id, sourceType: path.extname(input.fileName).slice(1).toLowerCase() || "file", originalName: input.fileName } }).catch(() => undefined);
    }
    return { ...serializeAsset(existing), deduplicated: true };
  }
  const extension = path.extname(input.fileName).slice(0, 12);
  const storageKey = `${input.userId}/${input.projectId || "library"}/${input.type}/${randomUUID()}${extension}`;
  await upload(storageKey);
  try {
    const asset = await getPrisma().asset.create({
      data: {
        userId: input.userId, type: input.type, fileName: cleanName(input.fileName), storageKey,
        mimeType: input.mimeType, size: BigInt(input.size), width: input.width, height: input.height,
        checksum, isSystem: Boolean(input.isSystem), metadata: input.metadata as Prisma.InputJsonValue | undefined,
        ...(input.projectId ? { projectLinks: { create: { projectId: input.projectId, role: ASSET_TYPE_TO_ROLE[input.type] } } } : {}),
      },
    });
    if (input.type === "source_file" && input.projectId) {
      await getPrisma().sourceFile.create({ data: { projectId: input.projectId, assetId: asset.id, sourceType: path.extname(input.fileName).slice(1).toLowerCase() || "file", originalName: input.fileName } });
    }
    return serializeAsset(asset);
  } catch (error) {
    await getStorageProvider().delete(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function createAssetFromFilePath(input: PreparedAssetInput & { filePath: string }) {
  const info = await stat(input.filePath);
  if (!info.isFile() || info.size !== input.size) throw new ValidationError("分片合并后的文件大小不正确");
  await validatePreparedAsset(input.userId, input.projectId, input.type, input.size);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(input.filePath)) hash.update(chunk);
  return persistPreparedAsset(input, hash.digest("hex"), (storageKey) => getStorageProvider().uploadFile({
    key: storageKey,
    filePath: input.filePath,
    mimeType: input.mimeType,
    size: input.size,
  }));
}

export async function getAssetForUser(assetId: string, userId: string) {
  const asset = await getPrisma().asset.findUnique({ where: { id: assetId } });
  if (!asset || asset.deletedAt) throw new NotFoundError("文件不存在");
  if (asset.userId !== userId && !asset.isSystem) throw new ForbiddenError("无权访问该文件");
  return asset;
}

export async function listProjectAssets(projectId: string, userId: string) {
  await assertProjectOwner(projectId, userId, true);
  const links = await getPrisma().projectAsset.findMany({
    where: { projectId, asset: { deletedAt: null } },
    include: { asset: true },
    orderBy: { createdAt: "desc" },
  });
  return links.map(({ asset, role }) => ({ ...serializeAsset(asset), role }));
}

export async function findUploadedProjectAsset(projectId: string, userId: string, checksum: string, type: AssetType) {
  await assertProjectOwner(projectId, userId);
  if (!/^[0-9a-f]{64}$/i.test(checksum)) throw new ValidationError("无效的文件校验值");
  const link = await getPrisma().projectAsset.findFirst({
    where: { projectId, role: ASSET_TYPE_TO_ROLE[type], asset: { userId, checksum: checksum.toLowerCase(), deletedAt: null } },
    include: { asset: true },
  });
  if (!link) return null;
  // Source metadata is written after the asset link; do not confirm half a commit.
  if (type === "source_file" && !await getPrisma().sourceFile.findFirst({ where: { projectId, assetId: link.asset.id }, select: { id: true } })) return null;
  return serializeAsset(link.asset);
}

export function serializeAsset(asset: { id: string; type: AssetType; fileName: string; mimeType: string; size: bigint; width: number | null; height: number | null; createdAt: Date }) {
  return {
    id: asset.id, type: asset.type, fileName: asset.fileName, mimeType: asset.mimeType, size: Number(asset.size),
    width: asset.width, height: asset.height, createdAt: asset.createdAt.toISOString(), url: withBasePath(`/api/assets/${asset.id}/content`),
  };
}

export async function listUserAssets(userId: string, input: { page?: number; pageSize?: number; search?: string; type?: AssetType }) {
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.min(60, Math.max(1, input.pageSize || 30));
  const where: Prisma.AssetWhereInput = {
    userId,
    deletedAt: null,
    ...(input.type ? { type: input.type } : {}),
    ...(input.search?.trim() ? { fileName: { contains: input.search.trim() } } : {}),
  };
  const [items, total] = await getPrisma().$transaction([
    getPrisma().asset.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    getPrisma().asset.count({ where }),
  ]);
  return { items: items.map(serializeAsset), page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getAssetReferenceSummary(assetId: string, userId: string) {
  const asset = await getAssetForUser(assetId, userId);
  if (asset.isSystem) return { total: 1, references: { system: 1 } };
  const [projects, sourceFiles, productImages, projectProducts, globalProducts, projectLogos, brands, templates, brandKits, exports] = await getPrisma().$transaction([
    getPrisma().projectAsset.count({ where: { assetId } }),
    getPrisma().sourceFile.count({ where: { assetId } }),
    getPrisma().productAsset.count({ where: { assetId } }),
    getPrisma().projectProductSnapshot.count({ where: { primaryImageAssetId: assetId } }),
    getPrisma().globalProduct.count({ where: { primaryImageAssetId: assetId } }),
    getPrisma().projectDesign.count({ where: { logoAssetId: assetId } }),
    getPrisma().brand.count({ where: { logoAssetId: assetId } }),
    getPrisma().templateDefinition.count({ where: { thumbnailAssetId: assetId } }),
    getPrisma().brandKit.count({ where: { logoAssetId: assetId } }),
    getPrisma().exportRecord.count({ where: { assetId } }),
  ]);
  const references = { projects, sourceFiles, productImages, projectProducts, globalProducts, projectLogos, brands, templates, brandKits, exports };
  return { total: Object.values(references).reduce((sum, value) => sum + value, 0), references };
}

export async function deleteAsset(userId: string, assetId: string) {
  const asset = await getAssetForUser(assetId, userId);
  if (asset.isSystem) throw new ForbiddenError("系统素材不能删除");
  const usage = await getAssetReferenceSummary(assetId, userId);
  if (usage.total) throw new ResourceConflictError(`该素材正在被 ${usage.total} 个资源引用，无法删除`);
  await getStorageProvider().delete(asset.storageKey);
  await getPrisma().asset.delete({ where: { id: assetId } });
}

export function assetIdFromUrl(value?: string) {
  return assetIdFromReference(value);
}

export function assetUrl(assetId?: string | null) {
  return assetId ? withBasePath(`/api/assets/${assetId}/content`) : undefined;
}
