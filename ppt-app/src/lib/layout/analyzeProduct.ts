import type { Product } from "@/types/catalog";
import { analyzeImage } from "./analyzeImage";
import { LAYOUT_RULES } from "./layoutRules";
import type { ProductAnalysis, ProductDensity } from "./types";

function getDensity(titleLength: number, itemCount: number, itemTextLength: number, deliveryLength: number): ProductDensity {
  const { low, medium, veryHigh } = LAYOUT_RULES.density;
  if (itemCount <= low.maxItems && itemTextLength <= low.maxItemText && titleLength <= low.maxTitle && deliveryLength <= low.maxDelivery) return "low";
  if (itemCount <= medium.maxItems && itemTextLength <= medium.maxItemText && titleLength <= medium.maxTitle && deliveryLength <= medium.maxDelivery) return "medium";
  if (itemCount >= veryHigh.minItems || itemTextLength >= veryHigh.minItemText || titleLength >= veryHigh.minTitle || deliveryLength >= veryHigh.minDelivery) return "very-high";
  return "high";
}

export function analyzeProduct(product: Product): ProductAnalysis {
  const image = analyzeImage(product);
  const titleLength = product.name.trim().length;
  const itemCount = product.details.length;
  const componentTitleLength = product.components?.reduce((total, component) => total + component.name.trim().length, 0) ?? 0;
  const itemTextLength = product.details.reduce((total, item) => total + item.trim().length, 0) + componentTitleLength;
  const deliveryLength = product.deliveryRegions.join(" · ").length;
  const density = getDensity(titleLength, itemCount, itemTextLength, deliveryLength);
  return {
    productId: product.id,
    titleLength,
    itemCount,
    itemTextLength,
    deliveryLength,
    hasImage: image.hasImage,
    imageAspectRatio: image.aspectRatio,
    imageType: image.imageType,
    imageQuality: image.quality,
    density,
    recommendedCardSize: density === "low" ? "compact" : density === "medium" ? "standard" : density === "high" ? "large" : "full",
    categoryId: product.categoryId,
    featured: Boolean(product.featured),
  };
}

export function analyzeProducts(products: Product[]) {
  return products.map(analyzeProduct);
}
