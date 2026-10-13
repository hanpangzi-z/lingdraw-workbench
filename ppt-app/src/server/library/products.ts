import { randomUUID } from "node:crypto";
import { productSearchIds } from "@/src/server/db/search";
import type { Prisma } from "@/src/generated/prisma/client";
import type { GlobalProductStatus } from "@/src/generated/prisma/enums";
import { catalogMeta } from "@/data/catalog";
import type { Product, ProductCategoryId } from "@/types/catalog";
import { emptyEditorState } from "@/types/editor";
import { getPrisma } from "@/src/server/db/prisma";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/src/server/errors";
import { assetIdFromUrl, assetUrl, assertProjectOwner, createAsset } from "@/src/server/assets/service";
import { createProject, getProject, saveProject } from "@/src/server/projects/service";
import { validateAssetReferences } from "@/src/server/projects/referenceValidation";

export interface GlobalProductInput {
  sku?: string;
  name: string;
  shortName?: string;
  brandId?: string | null;
  categoryId?: string | null;
  description?: string;
  items?: string[];
  marketPrice?: number | null;
  defaultSalePrice?: number | null;
  deliveryProfileId?: string | null;
  deliveryOverrideText?: string;
  status?: GlobalProductStatus;
}

const includeDetail = {
  brand: true,
  category: true,
  deliveryProfile: true,
  images: { include: { asset: true }, orderBy: [{ role: "asc" as const }, { sortOrder: "asc" as const }] },
  _count: { select: { projectSnapshots: true } },
} satisfies Prisma.GlobalProductInclude;

type GlobalProductRecord = Prisma.GlobalProductGetPayload<{ include: typeof includeDetail }>;

const normalizeSku = (value?: string | null) => value?.trim() || null;
const numberOrNull = (value: unknown) => value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const textArray = (value: unknown) => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];

function buildSearchText(input: { sku?: string | null; name: string; shortName?: string | null; description?: string | null; items?: unknown; brandName?: string | null }) {
  return [input.sku, input.name, input.shortName, input.brandName, input.description, ...textArray(input.items)].filter(Boolean).join(" ");
}

function serializeProduct(record: GlobalProductRecord) {
  return {
    id: record.id,
    sku: record.sku || "",
    name: record.name,
    shortName: record.shortName,
    description: record.description,
    items: textArray(record.items),
    marketPrice: record.marketPrice == null ? null : Number(record.marketPrice),
    defaultSalePrice: record.defaultSalePrice == null ? null : Number(record.defaultSalePrice),
    deliveryOverrideText: record.deliveryOverrideText,
    status: record.status,
    revision: record.revision,
    category: record.category ? { id: record.category.id, code: record.category.code, name: record.category.name } : null,
    brand: record.brand ? { id: record.brand.id, name: record.brand.name } : null,
    deliveryProfile: record.deliveryProfile ? { id: record.deliveryProfile.id, name: record.deliveryProfile.name, displayText: record.deliveryProfile.displayText } : null,
    primaryImageAssetId: record.primaryImageAssetId,
    primaryImageUrl: assetUrl(record.primaryImageAssetId) || null,
    images: record.images.map((image) => ({ id: image.id, assetId: image.assetId, role: image.role, sortOrder: image.sortOrder, url: assetUrl(image.assetId), fileName: image.asset.fileName, width: image.asset.width, height: image.asset.height })),
    usageCount: record._count.projectSnapshots,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function assertProductOwner(productId: string, ownerId: string, includeDeleted = false) {
  const product = await getPrisma().globalProduct.findUnique({ where: { id: productId }, include: includeDetail });
  if (!product) throw new NotFoundError("商品不存在");
  if (product.ownerId !== ownerId) throw new ForbiddenError("无权访问该商品");
  if (product.deletedAt && !includeDeleted) throw new NotFoundError("商品已归档");
  return product;
}

async function validateRelations(ownerId: string, input: Pick<GlobalProductInput, "brandId" | "categoryId" | "deliveryProfileId">) {
  const checks = await Promise.all([
    input.brandId ? getPrisma().brand.findUnique({ where: { id: input.brandId }, select: { ownerId: true, name: true } }) : null,
    input.categoryId ? getPrisma().productCategory.findUnique({ where: { id: input.categoryId }, select: { ownerId: true } }) : null,
    input.deliveryProfileId ? getPrisma().deliveryProfile.findUnique({ where: { id: input.deliveryProfileId }, select: { ownerId: true } }) : null,
  ]);
  if (checks.some((record) => record && record.ownerId !== ownerId)) throw new ForbiddenError("不能绑定其他用户的资源");
  return { brandName: checks[0]?.name || null };
}

function versionSnapshot(record: GlobalProductRecord) {
  return JSON.parse(JSON.stringify(serializeProduct(record))) as Prisma.InputJsonValue;
}

async function recordProductVersion(ownerId: string, productId: string, changeSummary: string) {
  const record = await assertProductOwner(productId, ownerId, true);
  await getPrisma().globalProductVersion.upsert({
    where: { productId_versionNumber: { productId, versionNumber: record.revision } },
    create: { productId, versionNumber: record.revision, snapshot: versionSnapshot(record), changeSummary, createdById: ownerId },
    update: { snapshot: versionSnapshot(record), changeSummary },
  });
  return record;
}

export async function listGlobalProducts(ownerId: string, input: { page?: number; pageSize?: number; search?: string; categoryId?: string; brandId?: string; status?: GlobalProductStatus; missingImage?: boolean; missingPrice?: boolean; deliveryProfileId?: string; updatedFrom?: string; sort?: string }) {
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize || 30));
  const query = input.search?.trim();
  const where: Prisma.GlobalProductWhereInput = {
    ownerId,
    deletedAt: null,
    ...(query ? { id: { in: await productSearchIds(ownerId, query) } } : {}),
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    ...(input.brandId ? { brandId: input.brandId } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.deliveryProfileId ? { deliveryProfileId: input.deliveryProfileId } : {}),
    ...(input.missingImage ? { primaryImageAssetId: null } : {}),
    ...(input.missingPrice ? { OR: [{ marketPrice: null }, { defaultSalePrice: null }] } : {}),
    ...(input.updatedFrom ? { updatedAt: { gte: new Date(input.updatedFrom) } } : {}),
  };
  const orderBy: Prisma.GlobalProductOrderByWithRelationInput = input.sort === "created" ? { createdAt: "desc" } : input.sort === "name" ? { name: "asc" } : input.sort === "sku" ? { sku: "asc" } : input.sort === "price" ? { marketPrice: "asc" } : { updatedAt: "desc" };
  const [items, total, active, missingImages, missingPrices] = await getPrisma().$transaction([
    getPrisma().globalProduct.findMany({ where, include: includeDetail, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    getPrisma().globalProduct.count({ where }),
    getPrisma().globalProduct.count({ where: { ownerId, deletedAt: null, status: "active" } }),
    getPrisma().globalProduct.count({ where: { ownerId, deletedAt: null, primaryImageAssetId: null } }),
    getPrisma().globalProduct.count({ where: { ownerId, deletedAt: null, OR: [{ marketPrice: null }, { defaultSalePrice: null }] } }),
  ]);
  return { items: items.map(serializeProduct), page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)), stats: { active, missingImages, missingPrices } };
}

export async function recommendLibraryProductImages(ownerId: string, skus: string[]) {
  const normalized = [...new Set(skus.map((sku) => sku.trim()).filter(Boolean))].slice(0, 500);
  if (!normalized.length) return { items: [] };
  const products = await getPrisma().globalProduct.findMany({
    where: { ownerId, sku: { in: normalized }, status: "active", deletedAt: null, primaryImageAssetId: { not: null } },
    select: { id: true, sku: true, revision: true, primaryImageAssetId: true },
  });
  return {
    items: products.flatMap((product) => product.sku && product.primaryImageAssetId ? [{
      sku: product.sku,
      globalProductId: product.id,
      globalProductVersion: product.revision,
      imageAssetId: product.primaryImageAssetId,
      imageUrl: assetUrl(product.primaryImageAssetId)!,
    }] : []),
  };
}

export async function getGlobalProduct(ownerId: string, productId: string) {
  const record = await assertProductOwner(productId, ownerId, true);
  const [versions, usage] = await Promise.all([
    getPrisma().globalProductVersion.findMany({ where: { productId }, orderBy: { versionNumber: "desc" }, take: 30, select: { id: true, versionNumber: true, changeSummary: true, createdAt: true } }),
    getPrisma().projectProductSnapshot.findMany({ where: { globalProductId: productId, project: { userId: ownerId, deletedAt: null } }, distinct: ["projectId"], take: 50, orderBy: { project: { updatedAt: "desc" } }, select: { project: { select: { id: true, name: true, updatedAt: true } } } }),
  ]);
  return { ...serializeProduct(record), versions: versions.map((version) => ({ ...version, createdAt: version.createdAt.toISOString() })), usage: usage.map(({ project }) => ({ ...project, updatedAt: project.updatedAt.toISOString() })) };
}

export async function createGlobalProduct(ownerId: string, input: GlobalProductInput, changeSummary = "创建商品") {
  const name = input.name?.trim();
  if (!name) throw new ValidationError("商品名称不能为空");
  const sku = normalizeSku(input.sku);
  if (sku && await getPrisma().globalProduct.findUnique({ where: { ownerId_sku: { ownerId, sku } } })) throw new ConflictError(`SKU ${sku} 已存在商品库`);
  const relations = await validateRelations(ownerId, input);
  const record = await getPrisma().globalProduct.create({
    data: {
      ownerId, sku, name, shortName: input.shortName?.trim() || null, brandId: input.brandId || null, categoryId: input.categoryId || null,
      description: input.description?.trim() || null, items: (input.items || []) as Prisma.InputJsonValue,
      marketPrice: numberOrNull(input.marketPrice), defaultSalePrice: numberOrNull(input.defaultSalePrice), deliveryProfileId: input.deliveryProfileId || null,
      deliveryOverrideText: input.deliveryOverrideText?.trim() || null, status: input.status || "active",
      searchText: buildSearchText({ ...input, sku, name, brandName: relations.brandName }),
    }, include: includeDetail,
  });
  await recordProductVersion(ownerId, record.id, changeSummary);
  return serializeProduct(record);
}

export async function updateGlobalProduct(ownerId: string, productId: string, input: Partial<GlobalProductInput>, changeSummary = "更新商品资料") {
  const current = await assertProductOwner(productId, ownerId, true);
  const merged = {
    sku: input.sku !== undefined ? normalizeSku(input.sku) : current.sku,
    name: input.name?.trim() || current.name,
    shortName: input.shortName !== undefined ? input.shortName?.trim() || null : current.shortName,
    description: input.description !== undefined ? input.description?.trim() || null : current.description,
    items: input.items ?? textArray(current.items),
    brandId: input.brandId !== undefined ? input.brandId || null : current.brandId,
    categoryId: input.categoryId !== undefined ? input.categoryId || null : current.categoryId,
    deliveryProfileId: input.deliveryProfileId !== undefined ? input.deliveryProfileId || null : current.deliveryProfileId,
  };
  if (merged.sku) {
    const duplicate = await getPrisma().globalProduct.findUnique({ where: { ownerId_sku: { ownerId, sku: merged.sku } } });
    if (duplicate && duplicate.id !== productId) throw new ConflictError(`SKU ${merged.sku} 已存在商品库`);
  }
  const relations = await validateRelations(ownerId, merged);
  await getPrisma().globalProduct.update({ where: { id: productId }, data: {
    ...merged,
    ...(input.marketPrice !== undefined ? { marketPrice: numberOrNull(input.marketPrice) } : {}),
    ...(input.defaultSalePrice !== undefined ? { defaultSalePrice: numberOrNull(input.defaultSalePrice) } : {}),
    ...(input.deliveryOverrideText !== undefined ? { deliveryOverrideText: input.deliveryOverrideText?.trim() || null } : {}),
    ...(input.status ? { status: input.status } : {}),
    searchText: buildSearchText({ ...merged, brandName: relations.brandName }), revision: { increment: 1 }, deletedAt: input.status === "archived" ? new Date() : null,
  } });
  return serializeProduct(await recordProductVersion(ownerId, productId, changeSummary));
}

export async function batchUpdateGlobalProducts(ownerId: string, input: { ids: string[]; categoryId?: string | null; brandId?: string | null; deliveryProfileId?: string | null; defaultSalePrice?: number | null; status?: GlobalProductStatus }) {
  const ids = [...new Set(input.ids)].slice(0, 500);
  if (!ids.length) throw new ValidationError("请先选择商品");
  const owned = await getPrisma().globalProduct.count({ where: { id: { in: ids }, ownerId } });
  if (owned !== ids.length) throw new ForbiddenError("选择中包含无权修改的商品");
  await validateRelations(ownerId, input);
  await getPrisma().globalProduct.updateMany({ where: { id: { in: ids }, ownerId }, data: {
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}), ...(input.brandId !== undefined ? { brandId: input.brandId } : {}),
    ...(input.deliveryProfileId !== undefined ? { deliveryProfileId: input.deliveryProfileId } : {}), ...(input.defaultSalePrice !== undefined ? { defaultSalePrice: numberOrNull(input.defaultSalePrice) } : {}),
    ...(input.status ? { status: input.status, deletedAt: input.status === "archived" ? new Date() : null } : {}), revision: { increment: 1 },
  } });
  for (const id of ids) await recordProductVersion(ownerId, id, "批量更新");
  return { updated: ids.length };
}

export async function addProductImage(ownerId: string, productId: string, file: File) {
  const product = await assertProductOwner(productId, ownerId);
  const asset = await createAsset({ userId: ownerId, file, type: "product_image" });
  const existing = await getPrisma().productAsset.findUnique({ where: { productId_assetId: { productId, assetId: asset.id } } });
  const role = product.primaryImageAssetId ? "secondary" : "primary";
  if (!existing) await getPrisma().productAsset.create({ data: { productId, assetId: asset.id, role, sortOrder: product.images.length } });
  if (!product.primaryImageAssetId) await getPrisma().globalProduct.update({ where: { id: productId }, data: { primaryImageAssetId: asset.id, revision: { increment: 1 } } });
  else await getPrisma().globalProduct.update({ where: { id: productId }, data: { revision: { increment: 1 } } });
  await recordProductVersion(ownerId, productId, "deduplicated" in asset && asset.deduplicated ? "复用已有商品图片" : "上传商品图片");
  return { asset, product: await getGlobalProduct(ownerId, productId) };
}

export async function updateProductImages(ownerId: string, productId: string, input: { action: "primary" | "remove" | "reorder"; assetId?: string; assetIds?: string[] }) {
  const product = await assertProductOwner(productId, ownerId);
  if (input.action === "primary" && input.assetId) {
    const link = product.images.find((image) => image.assetId === input.assetId);
    if (!link) throw new NotFoundError("商品图片不存在");
    await getPrisma().$transaction([
      getPrisma().productAsset.updateMany({ where: { productId, role: "primary" }, data: { role: "secondary" } }),
      getPrisma().productAsset.update({ where: { id: link.id }, data: { role: "primary", sortOrder: 0 } }),
      getPrisma().globalProduct.update({ where: { id: productId }, data: { primaryImageAssetId: input.assetId, revision: { increment: 1 } } }),
    ]);
  } else if (input.action === "remove" && input.assetId) {
    await getPrisma().productAsset.delete({ where: { productId_assetId: { productId, assetId: input.assetId } } });
    const next = await getPrisma().productAsset.findFirst({ where: { productId }, orderBy: { sortOrder: "asc" } });
    if (product.primaryImageAssetId === input.assetId && next) await getPrisma().productAsset.update({ where: { id: next.id }, data: { role: "primary", sortOrder: 0 } });
    await getPrisma().globalProduct.update({ where: { id: productId }, data: { primaryImageAssetId: product.primaryImageAssetId === input.assetId ? next?.assetId || null : product.primaryImageAssetId, revision: { increment: 1 } } });
  } else if (input.action === "reorder" && input.assetIds) {
    await getPrisma().$transaction(input.assetIds.map((assetId, sortOrder) => getPrisma().productAsset.update({ where: { productId_assetId: { productId, assetId } }, data: { sortOrder } })));
    await getPrisma().globalProduct.update({ where: { id: productId }, data: { revision: { increment: 1 } } });
  } else throw new ValidationError("无效的图片操作");
  await recordProductVersion(ownerId, productId, input.action === "primary" ? "更换商品主图" : input.action === "remove" ? "移除商品图片" : "调整图片顺序");
  return getGlobalProduct(ownerId, productId);
}

function toProjectProduct(record: GlobalProductRecord, index: number): Product {
  const delivery = record.deliveryOverrideText || record.deliveryProfile?.displayText || "";
  return {
    id: `library-${record.id}-${randomUUID().slice(0, 8)}`,
    globalProductId: record.id,
    globalProductVersion: record.revision,
    productNumber: String(index + 1).padStart(2, "0"), sku: record.sku || "", packageCode: record.sku || `LIB-${index + 1}`,
    name: record.name, details: textArray(record.items), image: assetUrl(record.primaryImageAssetId), images: record.images.map((image) => assetUrl(image.assetId)).filter(Boolean) as string[],
    price: { currency: "CNY", market: record.marketPrice == null ? undefined : Number(record.marketPrice), package: record.defaultSalePrice == null ? undefined : Number(record.defaultSalePrice) },
    deliveryRegions: delivery ? [delivery] : [], categoryId: (record.category?.code || "uncategorized") as ProductCategoryId,
  };
}

async function ownedProducts(ownerId: string, ids: string[]) {
  const records = await getPrisma().globalProduct.findMany({ where: { id: { in: [...new Set(ids)] }, ownerId, deletedAt: null, status: "active" }, include: includeDetail });
  if (records.length !== new Set(ids).size) throw new ForbiddenError("部分商品不存在或不可用");
  const order = new Map(ids.map((id, index) => [id, index]));
  return records.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function addLibraryProductsToProject(ownerId: string, input: { productIds: string[]; projectId?: string; projectName?: string }) {
  const records = await ownedProducts(ownerId, input.productIds);
  if (input.projectId) {
    const project = await getProject(ownerId, input.projectId);
    const existing = new Set(project.snapshot.products.map((product) => product.globalProductId).filter(Boolean));
    const additions = records.filter((record) => !existing.has(record.id)).map((record, index) => toProjectProduct(record, project.snapshot.products.length + index));
    const products = [...project.snapshot.products, ...additions].map((product, index) => ({ ...product, productNumber: String(index + 1).padStart(2, "0") }));
    const saved = await saveProject(ownerId, input.projectId, project.revision, { ...project.snapshot, products });
    return { projectId: input.projectId, added: additions.length, revision: saved.revision };
  }
  const name = input.projectName?.trim() || "从商品库创建的产品手册";
  const products = records.map(toProjectProduct);
  const project = await createProject(ownerId, { name, snapshot: { project: { ...catalogMeta, projectName: name, title: name }, products, layoutMode: "smart", layoutOverrides: {}, editorState: emptyEditorState() } });
  return { projectId: project.id, added: products.length, revision: project.revision };
}

export async function getProjectProductSync(ownerId: string, projectId: string) {
  await assertProjectOwner(projectId, ownerId);
  const products = await getPrisma().projectProductSnapshot.findMany({ where: { projectId, globalProductId: { not: null } }, include: { globalProduct: { include: includeDetail } }, orderBy: { sortOrder: "asc" } });
  if (products.some((snapshot) => snapshot.globalProduct && snapshot.globalProduct.ownerId !== ownerId)) {
    throw new ForbiddenError("项目包含无权同步的商品库引用");
  }
  return products.flatMap((snapshot) => {
    const library = snapshot.globalProduct;
    if (!library || library.deletedAt || library.revision <= (snapshot.globalProductVersion || 0)) return [];
    const current = {
      sku: snapshot.sku, name: snapshot.name, items: textArray(snapshot.items), marketPrice: snapshot.marketPrice == null ? null : Number(snapshot.marketPrice), salePrice: snapshot.salePrice == null ? null : Number(snapshot.salePrice),
      delivery: Array.isArray(snapshot.delivery) ? snapshot.delivery.map(String) : [], category: snapshot.category, imageAssetId: snapshot.primaryImageAssetId,
    };
    const latest = {
      sku: library.sku || "", name: library.name, items: textArray(library.items), marketPrice: library.marketPrice == null ? null : Number(library.marketPrice), salePrice: library.defaultSalePrice == null ? null : Number(library.defaultSalePrice),
      delivery: [library.deliveryOverrideText || library.deliveryProfile?.displayText || ""].filter(Boolean), category: library.category?.code || "uncategorized", imageAssetId: library.primaryImageAssetId,
    };
    const fields = (Object.keys(latest) as (keyof typeof latest)[]).filter((key) => JSON.stringify(current[key]) !== JSON.stringify(latest[key]));
    return [{ clientId: snapshot.clientId, globalProductId: library.id, currentVersion: snapshot.globalProductVersion || 0, latestVersion: library.revision, fields, current, latest }];
  });
}

export async function applyProjectProductSync(ownerId: string, projectId: string, input: { updates: { clientId: string; fields?: string[]; ignore?: boolean }[] }) {
  const project = await getProject(ownerId, projectId);
  const available = await getProjectProductSync(ownerId, projectId);
  const byClient = new Map(available.map((item) => [item.clientId, item]));
  const products = project.snapshot.products.map((product) => {
    const request = input.updates.find((update) => update.clientId === product.id);
    const diff = byClient.get(product.id);
    if (!request || !diff) return product;
    if (request.ignore) return { ...product, globalProductVersion: diff.latestVersion };
    const fields = new Set(request.fields?.length ? request.fields : diff.fields);
    return {
      ...product,
      globalProductVersion: diff.latestVersion,
      ...(fields.has("sku") ? { sku: diff.latest.sku, packageCode: diff.latest.sku } : {}),
      ...(fields.has("name") ? { name: diff.latest.name } : {}),
      ...(fields.has("items") ? { details: diff.latest.items } : {}),
      ...(fields.has("marketPrice") || fields.has("salePrice") ? { price: { ...product.price, ...(fields.has("marketPrice") ? { market: diff.latest.marketPrice ?? undefined } : {}), ...(fields.has("salePrice") ? { package: diff.latest.salePrice ?? undefined } : {}) } } : {}),
      ...(fields.has("delivery") ? { deliveryRegions: diff.latest.delivery } : {}),
      ...(fields.has("category") ? { categoryId: diff.latest.category as ProductCategoryId } : {}),
      ...(fields.has("imageAssetId") ? { image: assetUrl(diff.latest.imageAssetId), images: assetUrl(diff.latest.imageAssetId) ? [assetUrl(diff.latest.imageAssetId)!] : [] } : {}),
    };
  });
  const saved = await saveProject(ownerId, projectId, project.revision, { ...project.snapshot, products });
  return { ...saved, updated: input.updates.length };
}

export async function importGlobalProducts(ownerId: string, input: { products: Product[]; strategy?: "skip" | "update-empty" | "overwrite" | "prices" }) {
  const strategy = input.strategy || "skip";
  const resources = await getPrisma().productCategory.findMany({ where: { ownerId } });
  const categories = new Map(resources.map((category) => [category.code, category.id]));
  const result = { added: 0, updated: 0, skipped: 0, conflicts: [] as { sku: string; name: string }[] };
  for (const product of input.products.slice(0, 1000)) {
    const sku = normalizeSku(product.sku);
    const existing = sku ? await getPrisma().globalProduct.findUnique({ where: { ownerId_sku: { ownerId, sku } }, include: includeDetail }) : null;
    const payload: GlobalProductInput = { sku: sku || undefined, name: product.name, items: product.details, marketPrice: product.price.market, defaultSalePrice: product.price.package, deliveryOverrideText: product.deliveryRegions.join("；"), categoryId: categories.get(product.categoryId) || null };
    if (!existing) { await createGlobalProduct(ownerId, payload, "批量导入"); result.added += 1; continue; }
    if (strategy === "skip") { result.skipped += 1; result.conflicts.push({ sku: sku || "", name: product.name }); continue; }
    if (strategy === "prices") await updateGlobalProduct(ownerId, existing.id, { marketPrice: payload.marketPrice, defaultSalePrice: payload.defaultSalePrice }, "批量更新价格");
    else if (strategy === "update-empty") await updateGlobalProduct(ownerId, existing.id, { name: existing.name || payload.name, items: textArray(existing.items).length ? undefined : payload.items, marketPrice: existing.marketPrice == null ? payload.marketPrice : undefined, defaultSalePrice: existing.defaultSalePrice == null ? payload.defaultSalePrice : undefined, deliveryOverrideText: existing.deliveryOverrideText || payload.deliveryOverrideText, categoryId: existing.categoryId || payload.categoryId }, "批量补全空字段");
    else await updateGlobalProduct(ownerId, existing.id, payload, "批量覆盖更新");
    result.updated += 1;
  }
  return result;
}

export async function saveProjectProductToLibrary(ownerId: string, projectId: string, input: { clientId: string; strategy?: "update" | "copy" }) {
  const project = await getProject(ownerId, projectId);
  const product = project.snapshot.products.find((item) => item.id === input.clientId);
  if (!product) throw new NotFoundError("项目商品不存在");
  const category = await getPrisma().productCategory.findFirst({ where: { ownerId, code: product.categoryId } });
  const existing = product.sku ? await getPrisma().globalProduct.findUnique({ where: { ownerId_sku: { ownerId, sku: product.sku } } }) : null;
  if (existing && !input.strategy) throw new ConflictError(`商品库已有 SKU ${product.sku}，请选择更新或另存新商品`);
  const imageAssetIds = [...new Set((product.images?.length ? product.images : product.image ? [product.image] : []).map(assetIdFromUrl).filter((id): id is string => Boolean(id)))];
  await validateAssetReferences(ownerId, imageAssetIds);
  const payload: GlobalProductInput = { sku: input.strategy === "copy" ? undefined : product.sku || undefined, name: product.name, items: product.details, marketPrice: product.price.market, defaultSalePrice: product.price.package, deliveryOverrideText: product.deliveryRegions.join("；"), categoryId: category?.id || null };
  const library = existing && input.strategy === "update" ? await updateGlobalProduct(ownerId, existing.id, payload, "从项目更新") : await createGlobalProduct(ownerId, payload, "从项目保存");
  if (imageAssetIds.length) {
    await getPrisma().productAsset.createMany({ data: imageAssetIds.map((assetId, index) => ({ productId: library.id, assetId, role: index === 0 ? "primary" : "secondary", sortOrder: index })), skipDuplicates: true });
    await getPrisma().globalProduct.update({ where: { id: library.id }, data: { primaryImageAssetId: imageAssetIds[0] } });
  }
  return getGlobalProduct(ownerId, library.id);
}
