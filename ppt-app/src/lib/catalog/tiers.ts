import { numericPriceTier } from "./project";
import type { CatalogMeta, CatalogSlide, Product } from "@/types/catalog";

export interface ResolvedProductTier {
  key: string;
  priceTier: number;
  tierName: string;
}

export function resolveProductTier(product: Product, fallback = 0): ResolvedProductTier {
  const packagePrice = product.price.package;
  const priceTier = numericPriceTier(product.priceTier)
    ?? (packagePrice !== undefined && Number.isFinite(packagePrice) && packagePrice > 0 ? packagePrice : undefined)
    ?? fallback;
  return {
    key: priceTier > 0 ? String(priceTier) : "unassigned",
    priceTier,
    tierName: priceTier > 0 ? `${priceTier}元档位` : "未设置档位",
  };
}

export function getSlideCatalogMeta(meta: CatalogMeta, slide: CatalogSlide): CatalogMeta {
  if ((slide.kind !== "cover" && slide.kind !== "products") || !slide.priceTier) return meta;
  return { ...meta, priceTier: slide.priceTier, tierName: slide.tierName || `${slide.priceTier}元档位` };
}

export function getSlideProducts(products: Product[], slide: CatalogSlide) {
  if (slide.kind !== "cover" || !slide.productIds?.length) return products;
  const ids = new Set(slide.productIds);
  return products.filter((product) => ids.has(product.id));
}
