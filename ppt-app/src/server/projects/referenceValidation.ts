import type { CloudProjectSnapshot } from "./types";
import { getPrisma } from "@/src/server/db/prisma";
import { ForbiddenError, ValidationError } from "@/src/server/errors";
import { assetIdFromReference, isAssetReferenceLike } from "@/src/lib/assets/reference";
const MAX_REFERENCES = 10_000;

export function collectSnapshotReferences(snapshot: CloudProjectSnapshot) {
  const assetIds = new Set<string>();
  const globalProductIds = new Set<string>();
  const templateDefinitionIds = new Set<string>();
  const themeDefinitionIds = new Set<string>();
  const brandKitIds = new Set<string>();
  const visited = new WeakSet<object>();
  const visit = (value: unknown, key?: string) => {
    if (typeof value === "string") {
      const assetId = assetIdFromReference(value);
      if (assetId) assetIds.add(assetId);
      else if (isAssetReferenceLike(value)) throw new ValidationError("项目包含格式不正确的素材引用");
      if (key === "globalProductId") globalProductIds.add(value);
      else if (key === "templateDefinitionId") templateDefinitionIds.add(value);
      else if (key === "themeDefinitionId") themeDefinitionIds.add(value);
      else if (key === "brandKitId") brandKitIds.add(value);
      return;
    }
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) value.forEach((child) => visit(child, key));
    else Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(snapshot);
  const total = assetIds.size + globalProductIds.size + templateDefinitionIds.size + themeDefinitionIds.size + brandKitIds.size;
  if (total > MAX_REFERENCES) throw new ValidationError("项目引用资源数量过多");
  return {
    assetIds: [...assetIds],
    globalProductIds: [...globalProductIds],
    templateDefinitionIds: [...templateDefinitionIds],
    themeDefinitionIds: [...themeDefinitionIds],
    brandKitIds: [...brandKitIds],
  };
}

export async function validateAssetReferences(userId: string, assetIds: string[]) {
  const uniqueIds = [...new Set(assetIds.filter(Boolean))];
  if (!uniqueIds.length) return;
  const count = await getPrisma().asset.count({ where: { id: { in: uniqueIds }, deletedAt: null, OR: [{ userId }, { isSystem: true }] } });
  if (count !== uniqueIds.length) throw new ForbiddenError("项目包含无权使用或不存在的素材");
}

/** Rejects missing and cross-user IDs with the same response to avoid disclosing resource existence. */
export async function validateSnapshotReferences(userId: string, snapshot: CloudProjectSnapshot) {
  const prisma = getPrisma();
  const refs = collectSnapshotReferences(snapshot);
  const checks: Promise<boolean>[] = [];
  if (refs.assetIds.length) checks.push(validateAssetReferences(userId, refs.assetIds).then(() => true));
  if (refs.globalProductIds.length) checks.push(prisma.globalProduct.count({
    where: { id: { in: refs.globalProductIds }, ownerId: userId },
  }).then((count) => count === refs.globalProductIds.length));
  if (refs.templateDefinitionIds.length) checks.push(prisma.templateDefinition.count({ where: {
    id: { in: refs.templateDefinitionIds },
    deletedAt: null,
    OR: [{ ownerId: userId }, { isSystem: true, status: "published" }],
    AND: [
      { OR: [{ themeDefinitionId: null }, { themeDefinition: { is: { deletedAt: null, OR: [{ ownerId: userId }, { isSystem: true, status: "published" }] } } }] },
      { OR: [{ brandKitId: null }, { brandKit: { is: { ownerId: userId } } }] },
    ],
  } }).then((count) => count === refs.templateDefinitionIds.length));
  if (refs.themeDefinitionIds.length) checks.push(prisma.themeDefinition.count({ where: {
    id: { in: refs.themeDefinitionIds }, deletedAt: null, OR: [{ ownerId: userId }, { isSystem: true, status: "published" }],
  } }).then((count) => count === refs.themeDefinitionIds.length));
  if (refs.brandKitIds.length) checks.push(prisma.brandKit.count({
    where: { id: { in: refs.brandKitIds }, ownerId: userId },
  }).then((count) => count === refs.brandKitIds.length));
  if ((await Promise.all(checks)).some((allowed) => !allowed)) {
    throw new ForbiddenError("项目包含无权使用或不存在的资源");
  }
}
