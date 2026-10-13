import type { BatchGroup, BatchProductPatch, GlobalBatchConfig, ProductProjectOverride, ResolvedBatchProject } from "@/types/batch";
import type { CatalogMeta, Product } from "@/types/catalog";
import { createSlidePlan } from "@/src/lib/layout/createSlidePlan";
import { numericPriceTier } from "@/src/lib/catalog/project";
import { applyBatchRule, buildBatchFileName, getBatchVariables } from "./naming";
import { createBatchDataHash } from "./slidePlanCache";

function mergeProduct(product: Product, patch?: BatchProductPatch): Product {
  if (!patch) return product;
  return {
    ...product,
    ...patch,
    id: product.id,
    price: { ...product.price, ...patch.price },
  };
}

export function resolveBatchProducts(baseProducts: Product[], group: BatchGroup, overrides: ProductProjectOverride[]) {
  const overrideByProduct = new Map(overrides.filter((item) => item.batchGroupId === group.id).map((item) => [item.productId, item.overrides]));
  return group.productIds.flatMap((productId, index) => {
    const base = baseProducts.find((product) => product.id === productId);
    if (!base) return [];
    const withGroupDefaults = mergeProduct(base, group.projectConfig?.productDefaults);
    const resolved = mergeProduct(withGroupDefaults, overrideByProduct.get(productId));
    return [{ ...resolved, productNumber: String(index + 1).padStart(2, "0") }];
  });
}

export function resolveBatchMeta(base: CatalogMeta, global: GlobalBatchConfig, group: BatchGroup): CatalogMeta {
  const override = group.projectConfig ?? {};
  const project: CatalogMeta = {
    ...base,
    projectName: override.projectName ?? base.projectName,
    brand: override.brand ?? base.brand,
    logo: override.logo ?? global.logo ?? base.logo,
    city: override.city ?? group.dimensions.region ?? base.city,
    year: override.year ?? base.year,
    priceTier: override.priceTier ?? numericPriceTier(group.dimensions.priceTier) ?? base.priceTier,
    tierName: override.tierName ?? group.dimensions.priceTier ?? base.tierName,
    version: override.version ?? global.version ?? base.version,
    design: {
      ...base.design,
      templateId: override.templateId ?? global.templateId ?? base.design.templateId,
      themeId: override.themeId ?? global.themeId ?? base.design.themeId,
      logo: override.logo ?? global.logo ?? base.design.logo,
    },
  };
  const variables = getBatchVariables(project, group.dimensions, project.version);
  return {
    ...project,
    title: override.title ?? applyBatchRule(global.titleRule, variables),
    subtitle: override.subtitle ?? applyBatchRule(global.subtitleRule, variables),
  };
}

export function resolveBatchProject(baseMeta: CatalogMeta, baseProducts: Product[], global: GlobalBatchConfig, group: BatchGroup, overrides: ProductProjectOverride[]): ResolvedBatchProject {
  const project = resolveBatchMeta(baseMeta, global, group);
  const products = resolveBatchProducts(baseProducts, group, overrides);
  const dataHash = createBatchDataHash(project, products, group.editorSession?.layoutOverrides);
  const slidePlans = group.slidePlanCache?.dataHash === dataHash
    ? group.slidePlanCache.plans
    : createSlidePlan(products, { overrides: group.editorSession?.layoutOverrides });
  const variables = getBatchVariables(project, group.dimensions, project.version);
  return {
    group,
    project,
    products,
    slidePlans,
    dataHash,
    fileName: buildBatchFileName(global.filenameRule, variables, project.version),
    pageCount: slidePlans.length + 4 + Object.keys(group.editorSession?.editorState.manualSlides ?? {}).length,
  };
}
