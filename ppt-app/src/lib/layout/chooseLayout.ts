import type { Product } from "@/types/catalog";
import { analyzeProducts } from "./analyzeProduct";
import { checkSlideOverflow } from "./createSlidePlan";
import { PRODUCT_LAYOUT_TYPES, type LayoutRecommendation, type ProductAnalysis } from "./types";
import { scoreLayout } from "./scoring";

export function chooseLayout(products: Product[], analyses = analyzeProducts(products)): LayoutRecommendation {
  const candidates = PRODUCT_LAYOUT_TYPES
    .filter((layout) => !checkSlideOverflow(layout, products, analyses).overflow)
    .map((layout) => scoreLayout(layout, products, analyses))
    .sort((left, right) => right.total - left.total);
  const best = candidates[0] ?? scoreLayout("package-detail", products.slice(0, 1), analyses.slice(0, 1));
  return {
    type: best.layout,
    score: best,
    reason: `在固定模板中，${best.reasons.slice(0, 2).join("，")}，综合适配度 ${best.total} 分。`,
  };
}
