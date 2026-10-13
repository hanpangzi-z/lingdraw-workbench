import type { CatalogMeta, Product } from "@/types/catalog";
import type { ManualLayoutOverride } from "@/src/lib/layout/types";

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${key}:${stableSerialize(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function createBatchDataHash(project: CatalogMeta, products: Product[], layoutOverrides?: Record<string, ManualLayoutOverride>) {
  const payload = stableSerialize({
    design: project.design,
    title: project.title,
    subtitle: project.subtitle,
    products: products.map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      details: product.details,
      price: product.price,
      deliveryRegions: product.deliveryRegions,
      categoryId: product.categoryId,
      imageMetadata: product.imageMetadata,
      featured: product.featured,
    })),
    layoutOverrides,
  });
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
