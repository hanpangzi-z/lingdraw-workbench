import type { Product } from "@/types/catalog";

export function getProductImages(product: Pick<Product, "image" | "images">): string[] {
  return [...new Set([...(product.images ?? []), product.image].filter((source): source is string => Boolean(source?.trim())))];
}
