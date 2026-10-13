import type { CatalogMeta, Product } from "@/types/catalog";

export function getProjectDisplayName(meta: CatalogMeta) {
  const name = meta.projectName.trim() || "职工乐品套餐";
  return name.startsWith(meta.city) ? name : `${meta.city}${name}`;
}

export function getTierDividerProjectLine(meta: CatalogMeta) {
  const projectName = meta.projectName.trim();
  const displayName = projectName && !projectName.startsWith("未命名")
    ? getProjectDisplayName(meta)
    : `${meta.city}职工乐品福利方案`;
  return `${meta.year} ${displayName}`;
}

export function getTierDividerLabel(meta: CatalogMeta) {
  return `TIER ${meta.priceTier} / 套餐分栏`;
}

export function getProjectFileLabel(meta: CatalogMeta) {
  const displayName = getProjectDisplayName(meta);
  // 保持第二阶段默认项目的既有验收文件名，同时让用户自定义名称真实进入文件名。
  if (displayName === `${meta.city}职工乐品福利方案`) return `${meta.city}职工乐品套餐`;
  return displayName.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "");
}

export function numericPriceTier(value?: string) {
  const parsed = Number((value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function inferProjectPriceTier(products: Product[], fallback = 100) {
  const counts = new Map<number, { count: number; firstIndex: number }>();
  products.forEach((product, index) => {
    const price = product.price.package;
    if (price === undefined || !Number.isFinite(price)) return;
    const current = counts.get(price);
    counts.set(price, current ? { ...current, count: current.count + 1 } : { count: 1, firstIndex: index });
  });
  return [...counts.entries()]
    .sort(([, a], [, b]) => b.count - a.count || a.firstIndex - b.firstIndex)[0]?.[0] ?? fallback;
}

export function withInferredPriceTier(meta: CatalogMeta, products: Product[]): CatalogMeta {
  const priceTier = inferProjectPriceTier(products, meta.priceTier);
  if (priceTier === meta.priceTier && meta.tierName === `${priceTier}元档位`) return meta;
  return { ...meta, priceTier, tierName: `${priceTier}元档位` };
}
