import type { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/server/db/prisma";
import { ForbiddenError, NotFoundError, ValidationError } from "@/src/server/errors";

type ResourceType = "category" | "brand" | "delivery";

export async function listProductResources(ownerId: string) {
  const [categories, brands, deliveries] = await Promise.all([
    getPrisma().productCategory.findMany({ where: { ownerId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { products: true } } } }),
    getPrisma().brand.findMany({ where: { ownerId }, orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } }),
    getPrisma().deliveryProfile.findMany({ where: { ownerId }, orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } }),
  ]);
  return { categories, brands, deliveries };
}

async function assertOwned(type: ResourceType, id: string, ownerId: string) {
  const record = type === "category"
    ? await getPrisma().productCategory.findUnique({ where: { id }, select: { ownerId: true } })
    : type === "brand"
      ? await getPrisma().brand.findUnique({ where: { id }, select: { ownerId: true } })
      : await getPrisma().deliveryProfile.findUnique({ where: { id }, select: { ownerId: true } });
  if (!record) throw new NotFoundError("资源不存在");
  if (record.ownerId !== ownerId) throw new ForbiddenError("无权修改该资源");
}

export async function createProductResource(ownerId: string, input: { type: ResourceType; name: string; code?: string; parentId?: string; description?: string; displayText?: string; includedRegions?: string[]; excludedRegions?: string[] }) {
  const name = input.name?.trim();
  if (!name) throw new ValidationError("名称不能为空");
  if (input.type === "category") {
    if (input.parentId) await assertOwned("category", input.parentId, ownerId);
    const max = await getPrisma().productCategory.aggregate({ where: { ownerId, parentId: input.parentId || null }, _max: { sortOrder: true } });
    return getPrisma().productCategory.create({ data: { ownerId, name, code: input.code?.trim() || null, parentId: input.parentId || null, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
  }
  if (input.type === "brand") return getPrisma().brand.create({ data: { ownerId, name } });
  return getPrisma().deliveryProfile.create({ data: { ownerId, name, description: input.description, includedRegions: (input.includedRegions || []) as Prisma.InputJsonValue, excludedRegions: (input.excludedRegions || []) as Prisma.InputJsonValue, displayText: input.displayText?.trim() || name } });
}

export async function updateProductResource(ownerId: string, input: { type: ResourceType; id: string; name?: string; active?: boolean; sortOrder?: number; parentId?: string | null; description?: string; displayText?: string; includedRegions?: string[]; excludedRegions?: string[] }) {
  await assertOwned(input.type, input.id, ownerId);
  const base = { ...(input.name != null ? { name: input.name.trim() } : {}), ...(input.active != null ? { active: input.active } : {}) };
  if (input.type === "category") {
    if (input.parentId) await assertOwned("category", input.parentId, ownerId);
    return getPrisma().productCategory.update({ where: { id: input.id }, data: { ...base, ...(input.sortOrder != null ? { sortOrder: input.sortOrder } : {}), ...(input.parentId !== undefined ? { parentId: input.parentId } : {}) } });
  }
  if (input.type === "brand") return getPrisma().brand.update({ where: { id: input.id }, data: base });
  return getPrisma().deliveryProfile.update({ where: { id: input.id }, data: { ...base, ...(input.description !== undefined ? { description: input.description } : {}), ...(input.displayText !== undefined ? { displayText: input.displayText } : {}), ...(input.includedRegions ? { includedRegions: input.includedRegions as Prisma.InputJsonValue } : {}), ...(input.excludedRegions ? { excludedRegions: input.excludedRegions as Prisma.InputJsonValue } : {}) } });
}
