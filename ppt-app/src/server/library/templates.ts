import { templateSearchIds } from '@/src/server/db/search';
import type { Prisma } from "@/src/generated/prisma/client";
import type { TemplateStatus } from "@/src/generated/prisma/enums";
import type { TemplateId } from "@/src/templates/types";
import type { ThemeId } from "@/src/themes/types";
import { getAvailableTemplates, getTemplate } from "@/src/templates/registry";
import { getAvailableThemes } from "@/src/themes/registry";
import { getPrisma } from "@/src/server/db/prisma";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/src/server/errors";
import { assetUrl, createAsset } from "@/src/server/assets/service";
import { getProject, saveProject } from "@/src/server/projects/service";

const cleanJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const escapeXml = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const includeTemplate = (userId: string) => ({
  themeDefinition: true,
  brandKit: true,
  favorites: { where: { userId }, select: { id: true } },
} satisfies Prisma.TemplateDefinitionInclude);

type TemplateRecord = Prisma.TemplateDefinitionGetPayload<{ include: ReturnType<typeof includeTemplate> }>;

function templateDto(record: TemplateRecord) {
  return {
    id: record.id, name: record.name, description: record.description, category: record.category, status: record.status, version: record.version,
    rendererKey: record.rendererKey, config: record.config, tags: Array.isArray(record.tags) ? record.tags.map(String) : [], isSystem: record.isSystem, scope: record.scope,
    usageCount: record.usageCount, previewDirty: record.previewDirty, thumbnailUrl: assetUrl(record.thumbnailAssetId) || null, favorite: record.favorites.length > 0,
    theme: record.themeDefinition ? { id: record.themeDefinition.id, name: record.themeDefinition.name, rendererKey: record.themeDefinition.rendererKey, tokens: record.themeDefinition.tokens, version: record.themeDefinition.version } : null,
    brandKit: record.brandKit ? { id: record.brandKit.id, name: record.brandKit.name, primaryColor: record.brandKit.primaryColor } : null,
    createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(),
  };
}

function previewSvg(template: { name: string; category: string; config: unknown }, theme?: { tokens: unknown } | null) {
  const tokens = (theme?.tokens || {}) as { colors?: { primary?: string; background?: string; surface?: string; textPrimary?: string } };
  const primary = /^#[0-9a-f]{6}$/i.test(tokens.colors?.primary || "") ? tokens.colors!.primary! : "#B51F32";
  const background = tokens.colors?.background || "#F7F4EF";
  const surface = tokens.colors?.surface || "#FFFFFF";
  const text = tokens.colors?.textPrimary || "#202126";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#eae7e1"/><rect x="38" y="38" width="780" height="438" rx="10" fill="${background}"/><rect x="38" y="38" width="780" height="18" fill="${primary}"/>
  <text x="90" y="128" font-family="Arial, PingFang SC, Microsoft YaHei" font-size="18" font-weight="700" fill="${primary}" letter-spacing="3">灵绘 PPT TEMPLATE</text>
  <text x="90" y="220" font-family="Arial, PingFang SC, Microsoft YaHei" font-size="48" font-weight="700" fill="${text}">${escapeXml(template.name)}</text>
  <text x="90" y="272" font-family="Arial, PingFang SC, Microsoft YaHei" font-size="22" fill="#73757b">封面 · 分类总览 · 商品页 · 配送 · 结束页</text>
  <rect x="90" y="350" width="186" height="58" rx="6" fill="${primary}"/><text x="183" y="387" text-anchor="middle" font-family="Arial, PingFang SC, Microsoft YaHei" font-size="18" font-weight="700" fill="#fff">${escapeXml(template.category)}</text>
  <rect x="852" y="38" width="390" height="206" rx="10" fill="${surface}"/><rect x="874" y="66" width="346" height="12" fill="${primary}"/>
  <rect x="874" y="100" width="100" height="110" fill="#f2efea"/><rect x="992" y="100" width="100" height="110" fill="#f2efea"/><rect x="1110" y="100" width="100" height="110" fill="#f2efea"/>
  <rect x="852" y="270" width="390" height="206" rx="10" fill="${surface}"/><rect x="874" y="294" width="346" height="12" fill="${primary}"/>
  <rect x="874" y="326" width="160" height="122" fill="#f2efea"/><rect x="1052" y="326" width="168" height="122" fill="#f2efea"/>
  <rect x="38" y="510" width="1204" height="170" rx="10" fill="${surface}"/><rect x="64" y="540" width="272" height="110" fill="${primary}" opacity=".1"/>
  <rect x="360" y="540" width="260" height="12" fill="${primary}"/><rect x="360" y="572" width="420" height="12" fill="#d7d2ca"/><rect x="360" y="600" width="330" height="12" fill="#d7d2ca"/>
  <text x="1198" y="650" text-anchor="end" font-family="Arial" font-size="15" fill="#777">COVER / GRID 3 / GRID 2 / FEATURE</text>
  </svg>`;
}

async function refreshTemplatePreview(assetOwnerId: string, templateId: string, isSystem: boolean) {
  const template = await getPrisma().templateDefinition.findUnique({ where: { id: templateId }, include: { themeDefinition: true } });
  if (!template) throw new NotFoundError("模板不存在");
  const svg = previewSvg(template, template.themeDefinition);
  const asset = await createAsset({ userId: assetOwnerId, type: "thumbnail", isSystem, file: new File([svg], `${template.rendererKey}-preview.svg`, { type: "image/svg+xml" }), width: 1280, height: 720, metadata: { templateId } });
  await getPrisma().templateDefinition.update({ where: { id: templateId }, data: { thumbnailAssetId: asset.id, previewDirty: false } });
  return asset.id;
}

async function assertTemplateReadable(userId: string, templateId: string) {
  const record = await getPrisma().templateDefinition.findUnique({ where: { id: templateId }, include: includeTemplate(userId) });
  if (!record || record.deletedAt) throw new NotFoundError("模板不存在");
  if (!record.isSystem && record.ownerId !== userId) throw new ForbiddenError("无权访问该模板");
  if (record.isSystem && record.status !== "published") throw new ForbiddenError("无权访问该模板");
  if (record.themeDefinition && (record.themeDefinition.deletedAt || (record.themeDefinition.isSystem ? record.themeDefinition.status !== "published" : record.themeDefinition.ownerId !== userId))) {
    throw new ForbiddenError("模板关联了无权使用的主题");
  }
  if (record.brandKit && record.brandKit.ownerId !== userId) throw new ForbiddenError("模板关联了无权使用的品牌方案");
  return record;
}

export async function listTemplates(userId: string, input: { page?: number; pageSize?: number; search?: string; category?: string; scope?: string; status?: TemplateStatus; sort?: string }) {
  const page = Math.max(1, input.page || 1); const pageSize = Math.min(50, Math.max(1, input.pageSize || 24)); const query = input.search?.trim();
  const visibility: Prisma.TemplateDefinitionWhereInput = { OR: [{ isSystem: true, status: "published" }, { ownerId: userId }] };
  const where: Prisma.TemplateDefinitionWhereInput = { AND: [visibility], deletedAt: null, ...(query ? { id: { in: await templateSearchIds(userId, query) } } : {}), ...(input.category ? { category: input.category } : {}), ...(input.scope === "system" ? { isSystem: true } : input.scope === "personal" ? { ownerId: userId, isSystem: false } : {}), ...(input.status ? { status: input.status } : {}) };
  const orderBy: Prisma.TemplateDefinitionOrderByWithRelationInput = input.sort === "name" ? { name: "asc" } : input.sort === "usage" ? { usageCount: "desc" } : { updatedAt: "desc" };
  const [items, total, custom, favoriteCount] = await getPrisma().$transaction([
    getPrisma().templateDefinition.findMany({ where, include: includeTemplate(userId), orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    getPrisma().templateDefinition.count({ where }),
    getPrisma().templateDefinition.count({ where: { ownerId: userId, isSystem: false, deletedAt: null } }),
    getPrisma().templateFavorite.count({ where: { userId } }),
  ]);
  return { items: items.map(templateDto), page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)), stats: { custom, favorites: favoriteCount } };
}

export async function getTemplateDetail(userId: string, templateId: string) { return templateDto(await assertTemplateReadable(userId, templateId)); }

async function uniqueTemplateName(ownerId: string, base: string) {
  let name = base; let index = 2;
  while (await getPrisma().templateDefinition.findFirst({ where: { ownerId, name, deletedAt: null } })) name = `${base} ${index++}`;
  return name;
}

export async function copyTemplate(userId: string, templateId: string) {
  const source = await assertTemplateReadable(userId, templateId);
  const name = await uniqueTemplateName(userId, `${source.name} - 副本`);
  const created = await getPrisma().templateDefinition.create({ data: {
    ownerId: userId, name, description: source.description, category: source.category, status: "draft", rendererKey: source.rendererKey,
    themeDefinitionId: source.themeDefinitionId, brandKitId: source.brandKitId, config: cleanJson(source.config) as Prisma.InputJsonValue, tags: cleanJson(source.tags) as Prisma.InputJsonValue,
    searchText: [name, source.description, ...(Array.isArray(source.tags) ? source.tags : [])].filter(Boolean).join(" "), isSystem: false, scope: "personal",
  }, include: includeTemplate(userId) });
  await refreshTemplatePreview(userId, created.id, false);
  return getTemplateDetail(userId, created.id);
}

export async function updateTemplate(userId: string, templateId: string, input: { name?: string; description?: string; category?: string; status?: TemplateStatus; tags?: string[]; config?: unknown; themeDefinitionId?: string | null; brandKitId?: string | null }) {
  const current = await assertTemplateReadable(userId, templateId);
  if (current.isSystem || current.ownerId !== userId) throw new ForbiddenError("系统模板不能修改，请先复制");
  if (input.themeDefinitionId) {
    const theme = await getPrisma().themeDefinition.findUnique({ where: { id: input.themeDefinitionId } });
    if (!theme || theme.deletedAt || (theme.isSystem ? theme.status !== "published" : theme.ownerId !== userId)) throw new ForbiddenError("无权使用该主题");
  }
  if (input.brandKitId) {
    const brandKit = await getPrisma().brandKit.findUnique({ where: { id: input.brandKitId }, select: { ownerId: true } });
    if (!brandKit || brandKit.ownerId !== userId) throw new ForbiddenError("无权使用该品牌方案");
  }
  const name = input.name?.trim() || current.name; const description = input.description !== undefined ? input.description.trim() : current.description; const tags = input.tags || (Array.isArray(current.tags) ? current.tags.map(String) : []);
  await getPrisma().templateDefinition.update({ where: { id: templateId }, data: {
    name, description, ...(input.category ? { category: input.category } : {}), ...(input.status ? { status: input.status } : {}), ...(input.tags ? { tags: input.tags as Prisma.InputJsonValue } : {}),
    ...(input.config !== undefined ? { config: cleanJson(input.config) as Prisma.InputJsonValue } : {}), ...(input.themeDefinitionId !== undefined ? { themeDefinitionId: input.themeDefinitionId } : {}), ...(input.brandKitId !== undefined ? { brandKitId: input.brandKitId } : {}),
    searchText: [name, description, ...tags].filter(Boolean).join(" "), version: { increment: 1 }, previewDirty: true,
  } });
  await refreshTemplatePreview(userId, templateId, false);
  return getTemplateDetail(userId, templateId);
}

export async function toggleTemplateFavorite(userId: string, templateId: string) {
  await assertTemplateReadable(userId, templateId);
  const existing = await getPrisma().templateFavorite.findUnique({ where: { userId_templateId: { userId, templateId } } });
  if (existing) await getPrisma().templateFavorite.delete({ where: { id: existing.id } });
  else await getPrisma().templateFavorite.create({ data: { userId, templateId } });
  return { favorite: !existing };
}

export async function listThemes(userId: string) {
  const items = await getPrisma().themeDefinition.findMany({ where: { deletedAt: null, OR: [{ isSystem: true, status: "published" }, { ownerId: userId }] }, orderBy: [{ isSystem: "desc" }, { updatedAt: "desc" }] });
  return { items: items.map((theme) => ({ ...theme, tokens: theme.tokens, createdAt: theme.createdAt.toISOString(), updatedAt: theme.updatedAt.toISOString() })) };
}

export async function createTheme(userId: string, input: { name: string; rendererKey?: string; tokens: unknown; status?: TemplateStatus }) {
  const name = input.name?.trim(); if (!name) throw new ValidationError("主题名称不能为空");
  return getPrisma().themeDefinition.create({ data: { ownerId: userId, name, rendererKey: input.rendererKey || "business-red", tokens: cleanJson(input.tokens) as Prisma.InputJsonValue, status: input.status || "draft", isSystem: false, scope: "personal" } });
}

export async function updateTheme(userId: string, themeId: string, input: { name?: string; tokens?: unknown; status?: TemplateStatus }) {
  const current = await getPrisma().themeDefinition.findUnique({ where: { id: themeId } });
  if (!current) throw new NotFoundError("主题不存在");
  if (current.isSystem || current.ownerId !== userId) throw new ForbiddenError("系统主题不能修改");
  return getPrisma().themeDefinition.update({ where: { id: themeId }, data: { ...(input.name ? { name: input.name.trim() } : {}), ...(input.tokens !== undefined ? { tokens: cleanJson(input.tokens) as Prisma.InputJsonValue } : {}), ...(input.status ? { status: input.status } : {}), version: { increment: 1 } } });
}

export async function applyTemplateToProject(userId: string, templateId: string, projectId: string) {
  const [template, project] = await Promise.all([assertTemplateReadable(userId, templateId), getProject(userId, projectId)]);
  const renderer = getAvailableTemplates().some((item) => item.id === template.rendererKey) ? template.rendererKey as TemplateId : "business-standard";
  const themeRenderer = template.themeDefinition && getAvailableThemes().some((item) => item.id === template.themeDefinition?.rendererKey) ? template.themeDefinition.rendererKey as ThemeId : "business-red";
  const design = {
    ...project.snapshot.project.design, templateId: renderer, themeId: themeRenderer,
    templateDefinitionId: template.id, templateDefinitionVersion: template.version, templateSnapshot: cleanJson({ config: template.config, rendererKey: template.rendererKey, name: template.name }),
    themeDefinitionId: template.themeDefinition?.id, themeDefinitionVersion: template.themeDefinition?.version, themeSnapshot: template.themeDefinition ? cleanJson(template.themeDefinition.tokens) : undefined,
  };
  const config = template.config && typeof template.config === "object" && !Array.isArray(template.config) ? template.config as Record<string, unknown> : {};
  const layoutMode = ["smart", "force-grid-3", "force-grid-2", "force-single-image"].includes(String(config.defaultLayoutMode))
    ? config.defaultLayoutMode as typeof project.snapshot.layoutMode
    : getTemplate(renderer).defaultLayoutMode ?? project.snapshot.layoutMode;
  const saved = await saveProject(userId, projectId, project.revision, { ...project.snapshot, layoutMode, project: { ...project.snapshot.project, design } });
  await getPrisma().templateDefinition.update({ where: { id: templateId }, data: { usageCount: { increment: 1 } } });
  return saved;
}

export async function seedBuiltInResources(systemUserId: string) {
  const themeByRenderer = new Map<string, string>();
  for (const theme of getAvailableThemes()) {
    const existing = await getPrisma().themeDefinition.findFirst({ where: { isSystem: true, rendererKey: theme.id } });
    const record = existing
      ? await getPrisma().themeDefinition.update({ where: { id: existing.id }, data: { name: theme.name, tokens: cleanJson(theme) as unknown as Prisma.InputJsonValue, status: "published", isSystem: true, scope: "system" } })
      : await getPrisma().themeDefinition.create({ data: { ownerId: null, name: theme.name, rendererKey: theme.id, tokens: cleanJson(theme) as unknown as Prisma.InputJsonValue, status: "published", isSystem: true, scope: "system" } });
    themeByRenderer.set(theme.id, record.id);
  }
  for (const template of getAvailableTemplates()) {
    const existing = await getPrisma().templateDefinition.findFirst({ where: { isSystem: true, rendererKey: template.id } });
    const data = {
      name: template.name, description: template.description, category: template.category === "business" ? "企业商务" : template.category === "gift" ? "高端礼品" : "商品目录",
      status: "published" as const, rendererKey: template.id, themeDefinitionId: themeByRenderer.get(template.defaultThemeId), config: cleanJson({ ...template.layoutVariants, defaultLayoutMode: template.defaultLayoutMode, showProductIdentifiers: template.showProductIdentifiers }) as unknown as Prisma.InputJsonValue,
      tags: template.tags as Prisma.InputJsonValue, searchText: [template.name, template.description, ...template.tags].join(" "), isSystem: true, scope: "system" as const,
    };
    const record = existing ? await getPrisma().templateDefinition.update({ where: { id: existing.id }, data }) : await getPrisma().templateDefinition.create({ data: { ownerId: null, ...data } });
    if (!record.thumbnailAssetId || record.previewDirty) await refreshTemplatePreview(systemUserId, record.id, true);
  }
}
