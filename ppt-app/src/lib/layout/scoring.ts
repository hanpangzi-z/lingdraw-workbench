import type { Product } from "@/types/catalog";
import type { LayoutScore, ProductAnalysis, ProductLayoutType } from "./types";

const densityFit: Record<ProductLayoutType, Record<ProductAnalysis["density"], number>> = {
  "product-grid-3": { low: 45, medium: 38, high: 16, "very-high": 0 },
  "product-grid-2": { low: 31, medium: 42, high: 45, "very-high": 18 },
  "product-feature": { low: 39, medium: 43, high: 38, "very-high": 25 },
  "package-detail": { low: 23, medium: 31, high: 42, "very-high": 45 },
  "product-image-focus": { low: 38, medium: 25, high: 8, "very-high": 0 },
  "mixed-product": { low: 36, medium: 38, high: 34, "very-high": 8 },
};

const targetCounts: Record<ProductLayoutType, number> = {
  "product-grid-3": 3,
  "product-grid-2": 2,
  "product-feature": 1,
  "package-detail": 1,
  "product-image-focus": 1,
  "mixed-product": 3,
};

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function scoreLayout(layout: ProductLayoutType, products: Product[], analyses: ProductAnalysis[]): LayoutScore {
  const textSpace = average(analyses.map((analysis) => densityFit[layout][analysis.density]));
  const imageSpace = average(analyses.map((analysis) => {
    if (!analysis.hasImage) return layout === "package-detail" ? 10 : 2;
    if (layout === "product-image-focus") return analysis.imageQuality === "excellent" ? 20 : analysis.imageQuality === "good" ? 17 : 11;
    if (layout === "product-feature") return 17;
    return 13;
  }));
  const expected = targetCounts[layout];
  const productCount = Math.max(0, 25 - Math.abs(expected - products.length) * 13);
  const imageRatio = average(analyses.map((analysis) => {
    if (!analysis.hasImage) return layout === "package-detail" ? 8 : 1;
    if (layout === "product-image-focus") return ["landscape", "wide", "square"].includes(analysis.imageType) ? 10 : 6;
    if (layout === "product-grid-3") return analysis.imageType === "wide" ? 5 : 9;
    return 8;
  }));
  const sameCategory = new Set(products.map((product) => product.categoryId)).size <= 1;
  const categoryAffinity = sameCategory ? 2 : 0;
  const total = Math.max(0, Math.min(100, Math.round(textSpace + imageSpace + productCount + imageRatio + categoryAffinity)));
  const reasons = [
    `文本空间 ${Math.round(textSpace)}/45`,
    `图片空间 ${Math.round(imageSpace)}/20`,
    `商品数量 ${Math.round(productCount)}/25`,
    `图片比例 ${Math.round(imageRatio)}/10`,
  ];
  return { layout, total, textSpace, imageSpace, productCount, imageRatio, categoryAffinity, reasons };
}
