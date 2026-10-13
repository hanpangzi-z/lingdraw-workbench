import { catalogMeta } from "@/data/catalog";
import { projectSearchIds } from "@/src/server/db/search";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { isDefaultProjectName, suggestProjectName } from "@/src/lib/cloud/projectNaming";
import { emptyEditorState } from "@/types/editor";
import type { CatalogMeta, Product } from "@/types/catalog";
import type { Prisma } from "@/src/generated/prisma/client";
import type { ProjectStatus } from "@/src/generated/prisma/enums";
import { getPrisma } from "@/src/server/db/prisma";
import { ConflictError, ForbiddenError, NotFoundError, ProjectDeletedError, ValidationError } from "@/src/server/errors";
import { assetIdFromUrl, assetUrl, assertProjectOwner, deleteAsset } from "@/src/server/assets/service";
import { createSlidePlan } from "@/src/lib/layout/createSlidePlan";
import { createFinalPresentationModel } from "@/src/lib/editor/createFinalPresentationModel";
import { getProjectCategories } from "@/src/lib/catalog/categories";
import { compactAssetReferences, hydrateAssetReferences } from "./snapshot";
import { refreshProjectThumbnail } from "./thumbnail";
import type { CloudProjectSnapshot, ProjectDetailDto, ProjectListDto, ProjectSummaryDto } from "./types";
import { rawDataWithProductComponents, withDerivedProductComponents } from "@/src/lib/catalog/components";
import { getTemplate, resolveTemplateLayoutMode } from "@/src/templates/registry";
import { validateSnapshotReferences } from "./referenceValidation";

type FullProject = Prisma.ProjectGetPayload<{
  include: { products: { orderBy: { sortOrder: "asc" } }; design: true; editorState: true };
}>;

const json = (value: unknown) => value as Prisma.InputJsonValue;
const jsonOrNull = (value: unknown) => value == null ? undefined : json(value);
const parseNumber = (value?: string | null) => {
  const number = Number(String(value ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(number) ? number : 0;
};

function imagesForProduct(product: Product) {
  return (product.images?.length ? product.images : product.image ? [product.image] : []).filter(Boolean);
}

function productData(projectId: string, product: Product, sortOrder: number): Prisma.ProjectProductSnapshotCreateManyInput {
  const refs = imagesForProduct(product).map((source) => compactAssetReferences(source));
  const assetIds = refs.map((source) => typeof source === "string" ? assetIdFromUrl(source) : undefined).filter((id): id is string => Boolean(id));
  return {
    projectId,
    globalProductId: product.globalProductId,
    globalProductVersion: product.globalProductVersion,
    clientId: product.id,
    productNumber: product.productNumber,
    sku: product.sku || "",
    packageCode: product.packageCode || product.sku || "",
    name: product.name || "",
    items: json(product.details ?? []),
    marketPrice: product.price.market,
    salePrice: product.price.package,
    delivery: json(product.deliveryRegions ?? []),
    category: product.categoryId,
    region: product.region,
    priceTier: product.priceTier,
    packageType: product.packageType,
    customerGroup: product.customerGroup,
    featured: Boolean(product.featured),
    sortOrder,
    primaryImageAssetId: assetIds[0],
    imageAssetIds: assetIds.length ? json(assetIds) : undefined,
    imageUrls: refs.length ? json(refs) : undefined,
    imageMetadata: jsonOrNull(product.imageMetadata),
    rawData: jsonOrNull(rawDataWithProductComponents(product)),
    deliveryRaw: product.deliveryRaw,
    deliveryNormalized: product.deliveryNormalized,
    aiMetadata: jsonOrNull(product.aiMetadata),
    sources: jsonOrNull(product.sources),
    importMetadata: jsonOrNull(product.importMetadata),
  };
}

function hydrateProduct(record: FullProject["products"][number]): Product {
  const refs = Array.isArray(record.imageUrls) ? (record.imageUrls as string[]) : record.primaryImageAssetId ? [`asset://${record.primaryImageAssetId}`] : [];
  const images = hydrateAssetReferences(refs);
  return withDerivedProductComponents({
    id: record.clientId,
    globalProductId: record.globalProductId ?? undefined,
    globalProductVersion: record.globalProductVersion ?? undefined,
    productNumber: record.productNumber,
    sku: record.sku,
    packageCode: record.packageCode,
    name: record.name,
    image: images[0],
    images,
    details: Array.isArray(record.items) ? record.items.map(String) : [],
    price: { currency: "CNY", market: record.marketPrice == null ? undefined : Number(record.marketPrice), package: record.salePrice == null ? undefined : Number(record.salePrice) },
    deliveryRegions: Array.isArray(record.delivery) ? record.delivery.map(String) : [],
    categoryId: record.category as Product["categoryId"],
    region: record.region ?? undefined,
    priceTier: record.priceTier ?? undefined,
    packageType: record.packageType ?? undefined,
    customerGroup: record.customerGroup ?? undefined,
    featured: record.featured,
    imageMetadata: record.imageMetadata as Product["imageMetadata"],
    rawData: record.rawData as Product["rawData"],
    deliveryRaw: record.deliveryRaw ?? undefined,
    deliveryNormalized: record.deliveryNormalized ?? undefined,
    aiMetadata: record.aiMetadata as unknown as Product["aiMetadata"],
    sources: record.sources as unknown as Product["sources"],
    importMetadata: record.importMetadata as unknown as Product["importMetadata"],
  });
}

function metadataFromRecord(record: FullProject): CatalogMeta {
  const design = record.design;
  return hydrateAssetReferences({
    brand: record.brand || catalogMeta.brand,
    city: record.region || catalogMeta.city,
    year: record.year || catalogMeta.year,
    priceTier: parseNumber(record.priceTier),
    tierName: record.tierName || record.priceTier || catalogMeta.tierName,
    projectName: record.name,
    title: record.title || record.name,
    subtitle: record.subtitle || catalogMeta.subtitle,
    edition: record.edition || catalogMeta.edition,
    serviceLine: record.serviceLine || catalogMeta.serviceLine,
    version: record.version || undefined,
    logo: record.logoUrl || design?.logoUrl || undefined,
    design: {
      templateId: (design?.templateId || record.templateId) as CatalogMeta["design"]["templateId"],
      themeId: (design?.themeId || record.themeId) as CatalogMeta["design"]["themeId"],
      themeOverrides: (design?.themeOverrides || {}) as CatalogMeta["design"]["themeOverrides"],
      logo: design?.logoUrl || undefined,
      brandName: design?.brandName || undefined,
      brandColor: design?.brandColor || undefined,
      pageRatio: "16:9",
      templateDefinitionId: design?.templateDefinitionId || undefined,
      templateDefinitionVersion: design?.templateDefinitionVersion || undefined,
      templateSnapshot: design?.templateSnapshot ?? undefined,
      themeDefinitionId: design?.themeDefinitionId || undefined,
      themeDefinitionVersion: design?.themeDefinitionVersion || undefined,
      themeSnapshot: design?.themeSnapshot ?? undefined,
    },
  });
}

function summary(record: { id: string; name: string; templateId?: string; description: string | null; status: ProjectStatus; year: number | null; region: string | null; priceTier: string | null; thumbnailUrl: string | null; thumbnailAssetId: string | null; thumbnailDirty: boolean; productCount: number; slideCount: number; categoryCount: number; revision: number; createdAt: Date; updatedAt: Date; lastOpenedAt: Date; deletedAt: Date | null }): ProjectSummaryDto {
  return {
    id: record.id, name: record.name, description: record.description, status: record.status,
    year: record.year, region: record.region, priceTier: record.priceTier,
    thumbnailUrl: hydrateAssetReferences(record.thumbnailUrl || assetUrl(record.thumbnailAssetId)) || null,
    templateName: getTemplate(record.templateId as Parameters<typeof getTemplate>[0]).name,
    thumbnailDirty: record.thumbnailDirty, productCount: record.productCount, slideCount: record.slideCount,
    categoryCount: record.categoryCount, revision: record.revision,
    createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(), lastOpenedAt: record.lastOpenedAt.toISOString(), deletedAt: record.deletedAt?.toISOString() || null,
  };
}

function snapshotFromRecord(record: FullProject): CloudProjectSnapshot {
  const editor = record.editorState;
  return {
    project: metadataFromRecord(record),
    products: record.products.map(hydrateProduct),
    layoutMode: (editor?.selectedLayoutMode || "smart") as CloudProjectSnapshot["layoutMode"],
    layoutOverrides: hydrateAssetReferences((editor?.layoutOverrides || {}) as unknown as CloudProjectSnapshot["layoutOverrides"]),
    editorState: hydrateAssetReferences({
      slides: editor?.slideOverrides || {},
      manualSlides: editor?.manualSlides || {},
      slideOrder: editor?.pageOrder || [],
      hiddenSlideIds: editor?.hiddenSlideIds || [],
      lockedSlideIds: editor?.lockedSlideIds || [],
    }) as unknown as CloudProjectSnapshot["editorState"],
    batchConfig: record.batchConfig ?? undefined,
  };
}

function defaultSnapshot(name = "未命名产品手册"): CloudProjectSnapshot {
  return { project: { ...catalogMeta, projectName: name, title: name }, products: [], layoutMode: "smart", layoutOverrides: {}, editorState: emptyEditorState() };
}

function snapshotStats(snapshot: CloudProjectSnapshot) {
  const layoutMode = resolveTemplateLayoutMode(snapshot.project.design.templateId, snapshot.layoutMode);
  const slidePlans = createSlidePlan(snapshot.products, { mode: layoutMode, overrides: snapshot.layoutOverrides });
  const slideCount = createFinalPresentationModel({
    project: snapshot.project,
    products: snapshot.products,
    categories: getProjectCategories(snapshot.products),
    slidePlans,
    editorState: snapshot.editorState,
  }).slides.length;
  return { slideCount, categoryCount: new Set(snapshot.products.map((product) => product.categoryId)).size };
}

export async function getProjectByCreationKey(userId: string, creationKey: string) {
  if (!/^[0-9a-f-]{36}$/i.test(creationKey)) throw new ValidationError("无效的创建请求标识");
  const id = `draft-${createHash("sha256").update(`${userId}:${creationKey}`).digest("hex")}`;
  if (!await getPrisma().project.findUnique({ where: { id }, select: { id: true } })) return null;
  return getProject(userId, id, false, false);
}

export async function createProject(userId: string, input: { name?: string; description?: string; snapshot?: CloudProjectSnapshot; creationKey?: string }) {
  if (input.creationKey && !/^[0-9a-f-]{36}$/i.test(input.creationKey)) throw new ValidationError("无效的创建请求标识");
  const creationId = input.creationKey ? `draft-${createHash("sha256").update(`${userId}:${input.creationKey}`).digest("hex")}` : undefined;
  if (creationId) {
    const existing = await getPrisma().project.findUnique({ where: { id: creationId } });
    if (existing) return getProject(userId, creationId);
  }
  const requestedName = input.name?.trim() || input.snapshot?.project.projectName?.trim();
  const name = isDefaultProjectName(requestedName) ? suggestProjectName(input.snapshot?.project || catalogMeta, undefined, new Date(), input.creationKey || randomUUID()) : requestedName!;
  const originalSnapshot = input.snapshot || defaultSnapshot(name);
  const snapshot = { ...originalSnapshot, project: { ...originalSnapshot.project, projectName: name, title: isDefaultProjectName(originalSnapshot.project.title) ? name : originalSnapshot.project.title } };
  if (name.length > 120) throw new ValidationError("项目名称不能超过 120 字");
  await validateSnapshotReferences(userId, snapshot);
  const meta = snapshot.project;
  const stats = snapshotStats(snapshot);
  const data = {
      ...(creationId ? { id: creationId } : {}),
      userId, name, description: input.description, status: snapshot.products.length ? "ready" : "draft",
      brand: meta.brand, title: meta.title, subtitle: meta.subtitle, tierName: meta.tierName, edition: meta.edition, serviceLine: meta.serviceLine, version: meta.version,
      logoUrl: compactAssetReferences(meta.logo), year: meta.year, region: meta.city, priceTier: String(meta.priceTier || ""), templateId: meta.design.templateId, themeId: meta.design.themeId,
      productCount: snapshot.products.length, slideCount: stats.slideCount, categoryCount: stats.categoryCount, batchConfig: jsonOrNull(snapshot.batchConfig),
      products: { createMany: { data: snapshot.products.map((product, index) => productData("__placeholder__", product, index)).map(({ projectId: _, ...data }) => data) } },
      design: { create: { templateId: meta.design.templateId, themeId: meta.design.themeId, themeOverrides: json(meta.design.themeOverrides), logoAssetId: assetIdFromUrl(meta.design.logo || meta.logo), logoUrl: compactAssetReferences(meta.design.logo || meta.logo), brandName: meta.design.brandName, brandColor: meta.design.brandColor, pageRatio: meta.design.pageRatio, templateDefinitionId: meta.design.templateDefinitionId, templateDefinitionVersion: meta.design.templateDefinitionVersion, templateSnapshot: jsonOrNull(meta.design.templateSnapshot), themeDefinitionId: meta.design.themeDefinitionId, themeDefinitionVersion: meta.design.themeDefinitionVersion, themeSnapshot: jsonOrNull(meta.design.themeSnapshot) } },
      editorState: { create: { slideOverrides: json(compactAssetReferences(snapshot.editorState.slides)), manualSlides: json(compactAssetReferences(snapshot.editorState.manualSlides)), hiddenSlideIds: json(snapshot.editorState.hiddenSlideIds), lockedSlideIds: json(snapshot.editorState.lockedSlideIds), pageOrder: json(snapshot.editorState.slideOrder), selectedLayoutMode: snapshot.layoutMode, layoutOverrides: json(compactAssetReferences(snapshot.layoutOverrides)) } },
    } satisfies Prisma.ProjectUncheckedCreateInput;
  const include = { products: { orderBy: { sortOrder: "asc" as const } }, design: true, editorState: true };
  const created = creationId
    ? await getPrisma().project.upsert({ where: { id: creationId }, create: data, update: {}, include }).catch(async (error: unknown) => {
      // Nested writes may emulate upsert; concurrent retries can lose the insert race.
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") return getPrisma().project.findUniqueOrThrow({ where: { id: creationId }, include });
      throw error;
    })
    : await getPrisma().project.create({ data, include });
  // A concurrent delete may win the idempotent upsert/retry race.
  if (created.userId !== userId) throw new ForbiddenError();
  if (created.deletedAt) throw new ProjectDeletedError();
  await refreshProjectThumbnail(userId, created.id, snapshotFromRecord(created)).catch((error) => console.warn("[Thumbnail] 项目封面生成失败", error));
  return { ...summary(created), snapshot: snapshotFromRecord(created) } satisfies ProjectDetailDto;
}

export async function listProjects(userId: string, input: { page?: number; pageSize?: number; search?: string; sort?: string; trash?: boolean }): Promise<ProjectListDto> {
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.min(50, Math.max(1, input.pageSize || 20));
  const search = input.search?.trim();
  const where: Prisma.ProjectWhereInput = {
    userId,
    deletedAt: input.trash ? { not: null } : null,
    ...(search ? { id: { in: await projectSearchIds(userId, search) } } : {}),
  };
  const orderBy: Prisma.ProjectOrderByWithRelationInput = input.sort === "created" ? { createdAt: "desc" } : input.sort === "name" ? { name: "asc" } : { updatedAt: "desc" };
  const [items, total] = await getPrisma().$transaction([
    getPrisma().project.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    getPrisma().project.count({ where }),
  ]);
  return { items: items.map(summary), page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getProject(userId: string, projectId: string, includeDeleted = false, markOpened = true): Promise<ProjectDetailDto> {
  const record = await getPrisma().project.findUnique({ where: { id: projectId }, include: { products: { orderBy: { sortOrder: "asc" } }, design: true, editorState: true } });
  if (!record) throw new NotFoundError("项目不存在");
  if (record.userId !== userId) throw new ForbiddenError();
  if (record.deletedAt && !includeDeleted) throw new ProjectDeletedError();
  if (markOpened && !record.deletedAt) await getPrisma().project.update({ where: { id: projectId }, data: { lastOpenedAt: new Date() } });
  return { ...summary(record), snapshot: snapshotFromRecord(record) };
}

export async function saveProject(userId: string, projectId: string, expectedRevision: number, snapshot: CloudProjectSnapshot, options?: { reimportRequestId: string }) {
  const owned = await assertProjectOwner(projectId, userId);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new ValidationError("无效的项目修订号");
  if (options && (!snapshot.products?.length || snapshot.products.some((product) => !product.name?.trim()))) {
    throw new ValidationError("请先导入并确认有效商品，不能用空资料替换原项目");
  }
  await validateSnapshotReferences(userId, snapshot);
  const meta = snapshot.project;
  const stats = snapshotStats(snapshot);
  const thumbnailSource = await getPrisma().project.findUniqueOrThrow({
    where: { id: projectId },
    select: { name: true, title: true, year: true, region: true, priceTier: true, templateId: true, themeId: true, logoUrl: true, productCount: true, categoryCount: true, thumbnailDirty: true, design: { select: { brandColor: true, logoUrl: true } } },
  });
  const desiredLogo = compactAssetReferences(meta.design.logo || meta.logo) || null;
  const shouldRefreshThumbnail = thumbnailSource.thumbnailDirty || [
    thumbnailSource.name !== (meta.projectName || owned.id),
    thumbnailSource.title !== meta.title,
    thumbnailSource.year !== meta.year,
    thumbnailSource.region !== meta.city,
    thumbnailSource.priceTier !== String(meta.priceTier || ""),
    thumbnailSource.templateId !== meta.design.templateId,
    thumbnailSource.themeId !== meta.design.themeId,
    thumbnailSource.logoUrl !== (compactAssetReferences(meta.logo) || null),
    thumbnailSource.design?.logoUrl !== desiredLogo,
    thumbnailSource.design?.brandColor !== (meta.design.brandColor || null),
    thumbnailSource.productCount !== snapshot.products.length,
    thumbnailSource.categoryCount !== stats.categoryCount,
  ].some(Boolean);
  const compactEditor = compactAssetReferences(snapshot.editorState);
  const result = await getPrisma().$transaction(async (tx) => {
    // The deterministic backup ID makes retries safe even if the first response
    // was lost after the replacement committed. Never apply the same import twice.
    const backupId = options ? `reimport-${projectId}-${options.reimportRequestId}` : undefined;
    if (backupId && await tx.projectVersion.findUnique({ where: { id: backupId } })) {
      const current = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, updatedAt: true } });
      return { ...current, reimportReplay: true };
    }
    const previous = options ? await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { products: { orderBy: { sortOrder: "asc" } }, design: true, editorState: true },
    }) : undefined;
    if (previous && previous.revision !== expectedRevision) throw new ConflictError();
    const updated = await tx.project.updateMany({
      where: { id: projectId, userId, revision: expectedRevision, deletedAt: null },
      data: {
        name: meta.projectName || owned.id, brand: meta.brand, title: meta.title, subtitle: meta.subtitle, tierName: meta.tierName,
        edition: meta.edition, serviceLine: meta.serviceLine, version: meta.version, logoUrl: compactAssetReferences(meta.logo),
        year: meta.year, region: meta.city, priceTier: String(meta.priceTier || ""), templateId: meta.design.templateId, themeId: meta.design.themeId,
        status: snapshot.products.length ? "ready" : "draft", productCount: snapshot.products.length,
        slideCount: stats.slideCount, categoryCount: stats.categoryCount, batchConfig: jsonOrNull(snapshot.batchConfig),
        thumbnailDirty: shouldRefreshThumbnail, revision: { increment: 1 }, lastOpenedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      const current = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { deletedAt: true } });
      if (current.deletedAt) throw new ProjectDeletedError();
      throw new ConflictError();
    }
    if (previous && backupId) {
      const latest = await tx.projectVersion.aggregate({ where: { projectId }, _max: { versionNumber: true } });
      await tx.projectVersion.create({ data: {
        id: backupId,
        projectId,
        versionNumber: (latest._max.versionNumber ?? 0) + 1,
        snapshot: json(JSON.parse(JSON.stringify(compactAssetReferences(snapshotFromRecord(previous))))),
        label: "重新导入前自动备份",
        reason: "reimport",
        createdById: userId,
      } });
    }
    await tx.projectProductSnapshot.deleteMany({ where: { projectId } });
    if (snapshot.products.length) await tx.projectProductSnapshot.createMany({ data: snapshot.products.map((product, index) => productData(projectId, product, index)) });
    // This is a full snapshot, so an omitted brandColor means the template
    // default was restored. Prisma skips undefined on update; null clears it.
    await tx.projectDesign.upsert({
      where: { projectId },
      create: { projectId, templateId: meta.design.templateId, themeId: meta.design.themeId, themeOverrides: json(meta.design.themeOverrides), logoAssetId: assetIdFromUrl(meta.design.logo || meta.logo), logoUrl: compactAssetReferences(meta.design.logo || meta.logo), brandName: meta.design.brandName, brandColor: meta.design.brandColor ?? null, pageRatio: meta.design.pageRatio, templateDefinitionId: meta.design.templateDefinitionId, templateDefinitionVersion: meta.design.templateDefinitionVersion, templateSnapshot: jsonOrNull(meta.design.templateSnapshot), themeDefinitionId: meta.design.themeDefinitionId, themeDefinitionVersion: meta.design.themeDefinitionVersion, themeSnapshot: jsonOrNull(meta.design.themeSnapshot) },
      update: { templateId: meta.design.templateId, themeId: meta.design.themeId, themeOverrides: json(meta.design.themeOverrides), logoAssetId: assetIdFromUrl(meta.design.logo || meta.logo), logoUrl: compactAssetReferences(meta.design.logo || meta.logo), brandName: meta.design.brandName, brandColor: meta.design.brandColor ?? null, pageRatio: meta.design.pageRatio, templateDefinitionId: meta.design.templateDefinitionId, templateDefinitionVersion: meta.design.templateDefinitionVersion, templateSnapshot: jsonOrNull(meta.design.templateSnapshot), themeDefinitionId: meta.design.themeDefinitionId, themeDefinitionVersion: meta.design.themeDefinitionVersion, themeSnapshot: jsonOrNull(meta.design.themeSnapshot) },
    });
    await tx.projectEditorState.upsert({
      where: { projectId },
      create: { projectId, slideOverrides: json(compactEditor.slides), manualSlides: json(compactEditor.manualSlides), hiddenSlideIds: json(compactEditor.hiddenSlideIds), lockedSlideIds: json(compactEditor.lockedSlideIds), pageOrder: json(compactEditor.slideOrder), selectedLayoutMode: snapshot.layoutMode, layoutOverrides: json(compactAssetReferences(snapshot.layoutOverrides)) },
      update: { slideOverrides: json(compactEditor.slides), manualSlides: json(compactEditor.manualSlides), hiddenSlideIds: json(compactEditor.hiddenSlideIds), lockedSlideIds: json(compactEditor.lockedSlideIds), pageOrder: json(compactEditor.slideOrder), selectedLayoutMode: snapshot.layoutMode, layoutOverrides: json(compactAssetReferences(snapshot.layoutOverrides)) },
    });
    return tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { revision: true, updatedAt: true } });
  });
  // A replay may refer to an older import; never regenerate its old thumbnail.
  if (shouldRefreshThumbnail && !("reimportReplay" in result)) await refreshProjectThumbnail(userId, projectId, snapshot).catch((error) => console.warn("[Thumbnail] 项目封面更新失败", error));
  return { revision: result.revision, updatedAt: result.updatedAt.toISOString() };
}

export async function renameProject(userId: string, projectId: string, name: string) {
  await assertProjectOwner(projectId, userId, true);
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120) throw new ValidationError("项目名称应为 1–120 字");
  const updated = await getPrisma().project.update({ where: { id: projectId }, data: { name: trimmed, title: trimmed, revision: { increment: 1 }, thumbnailDirty: true } });
  const detail = await getProject(userId, projectId);
  await refreshProjectThumbnail(userId, projectId, detail.snapshot).catch((error) => console.warn("[Thumbnail] 项目封面更新失败", error));
  return summary(updated);
}

export async function duplicateProject(userId: string, projectId: string) {
  const source = await getProject(userId, projectId);
  const copy = await createProject(userId, { name: `${source.name} - 副本`, snapshot: { ...source.snapshot, project: { ...source.snapshot.project, projectName: `${source.name} - 副本` } } });
  const links = await getPrisma().projectAsset.findMany({ where: { projectId }, select: { assetId: true, role: true } });
  if (links.length) await getPrisma().projectAsset.createMany({ data: links.map((link) => ({ projectId: copy.id, ...link })), skipDuplicates: true });
  return copy;
}

export async function softDeleteProject(userId: string, projectId: string) {
  await assertProjectOwner(projectId, userId);
  await getPrisma().project.update({ where: { id: projectId }, data: { deletedAt: new Date() } });
}

export async function restoreProject(userId: string, projectId: string) {
  await assertProjectOwner(projectId, userId, true);
  return summary(await getPrisma().project.update({ where: { id: projectId }, data: { deletedAt: null, lastOpenedAt: new Date() } }));
}

export async function permanentlyDeleteProject(userId: string, projectId: string) {
  await assertProjectOwner(projectId, userId, true);
  const links = await getPrisma().projectAsset.findMany({ where: { projectId }, include: { asset: true } });
  await getPrisma().project.delete({ where: { id: projectId } });
  for (const { asset } of links) {
    const references = await getPrisma().projectAsset.count({ where: { assetId: asset.id } });
    if (!references) {
      await deleteAsset(userId, asset.id).catch((error) => console.warn("[Storage] 资源仍被其他库引用或清理失败", error));
    }
  }
}
