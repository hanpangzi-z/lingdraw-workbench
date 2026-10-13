import type { Product } from "@/types/catalog";
import { resolveProductTier } from "@/src/lib/catalog/tiers";
import { analyzeProducts } from "./analyzeProduct";
import { DENSITY_LABELS, LAYOUT_LABELS, LAYOUT_RULES } from "./layoutRules";
import { scoreLayout } from "./scoring";
import type { LayoutMode, LayoutPlanningOptions, ProductAnalysis, ProductLayoutType, SlideOverflowCheck, SlidePlan } from "./types";

export function checkSlideOverflow(layout: ProductLayoutType, products: Product[], analyses = analyzeProducts(products)): SlideOverflowCheck {
  const limit = LAYOUT_RULES.overflow[layout];
  const fields = new Set<SlideOverflowCheck["fields"][number]>();
  analyses.forEach((analysis) => {
    if (analysis.titleLength > limit.title) fields.add("title");
    if (analysis.itemCount > limit.items || analysis.itemTextLength > limit.itemText) fields.add("items");
    if (analysis.deliveryLength > limit.delivery) fields.add("delivery");
  });
  products.forEach((product) => {
    const market = product.price.market === undefined ? "" : String(product.price.market);
    const sale = product.price.package === undefined ? "" : String(product.price.package);
    if (market.length > 9 || sale.length > 9) fields.add("price");
  });
  const labels = { title: "商品名称", items: "商品明细", delivery: "配送区域", price: "价格" } as const;
  return { overflow: fields.size > 0, fields: [...fields], messages: [...fields].map((field) => `${labels[field]}超过当前版式安全容量`) };
}

function forcedLayout(mode: LayoutMode): ProductLayoutType | undefined {
  if (mode === "force-grid-3") return "product-grid-3";
  if (mode === "force-grid-2") return "product-grid-2";
  if (mode === "force-single-image") return "product-image-focus";
  return undefined;
}

function makePlan(type: ProductLayoutType, products: Product[], analyses: ProductAnalysis[], source: "auto" | "manual", reason: string): SlidePlan {
  const score = scoreLayout(type, products, analyses);
  return {
    id: `products-${products[0]?.id ?? "empty"}`,
    type,
    productIds: products.map((product) => product.id),
    layoutVariant: type,
    reason,
    score: score.total,
    source,
    layoutOverride: source === "manual" ? type : undefined,
    overflow: checkSlideOverflow(type, products, analyses),
    analyses,
  };
}

function chooseSmartType(products: Product[], analyses: ProductAnalysis[]): ProductLayoutType {
  const first = analyses[0];
  const firstProduct = products[0];
  if (firstProduct.components?.length) {
    return firstProduct.components.length > 1 || first.density === "high" || first.density === "very-high"
      ? "package-detail"
      : "product-image-focus";
  }
  if (first.featured) return "product-feature";
  if (first.density === "very-high") return "package-detail";
  if (first.hasImage && first.imageQuality === "excellent" && ["low", "medium"].includes(first.density)) return "product-image-focus";

  const firstThree = analyses.slice(0, 3);
  if (firstThree.length === 3) {
    const lighterFollowers = firstThree.slice(1).every((item) => item.density === "low" || item.density === "medium");
    if (firstThree[0].density === "high" && lighterFollowers && !checkSlideOverflow("mixed-product", products.slice(0, 3), firstThree).overflow) return "mixed-product";
    if (firstThree.every((item) => item.density === "low" || item.density === "medium") && !checkSlideOverflow("product-grid-3", products.slice(0, 3), firstThree).overflow) return "product-grid-3";
  }

  const firstTwo = analyses.slice(0, 2);
  if (firstTwo.length === 2 && !firstTwo.some((item) => item.density === "very-high") && !checkSlideOverflow("product-grid-2", products.slice(0, 2), firstTwo).overflow) return "product-grid-2";
  if (first.hasImage && first.density === "low") return "product-feature";
  return "package-detail";
}

function autoReason(type: ProductLayoutType, analyses: ProductAnalysis[], score: number) {
  const densities = [...new Set(analyses.map((analysis) => DENSITY_LABELS[analysis.density]))].join("、");
  if (type === "product-feature") return `商品已标记精选或适合单品强调，采用${LAYOUT_LABELS[type]}；${densities}，适配度 ${score} 分。`;
  if (type === "product-image-focus") return `图片质量和比例适合放大展示，且文字负担较轻；适配度 ${score} 分。`;
  if (type === "package-detail") return `内容密度较高，切换到完整详情区以保护最小字号；适配度 ${score} 分。`;
  if (type === "mixed-product") return `同一连续区间同时包含高、低密度商品，使用一主两辅的混合版式；适配度 ${score} 分。`;
  return `${densities}商品按 ${analyses.length} 项成组，文字与图片空间均处于安全范围；适配度 ${score} 分。`;
}

export function createSlidePlan(products: Product[], options: LayoutPlanningOptions = {}): SlidePlan[] {
  const mode = options.mode ?? "smart";
  const analyses = analyzeProducts(products);
  const analysisById = new Map(analyses.map((analysis) => [analysis.productId, analysis]));
  const overrides = options.overrides ?? {};
  const manualAnchors = new Set(Object.keys(overrides));
  const plans: SlidePlan[] = [];
  let index = 0;

  while (index < products.length) {
    const anchor = products[index].id;
    const manual = overrides[anchor];
    let type = manual?.type ?? forcedLayout(mode);
    let source: "auto" | "manual" = manual ? "manual" : "auto";
    const remainingBeforeManual = products.slice(index + 1).findIndex((product) => manualAnchors.has(product.id));
    const manualBoundary = remainingBeforeManual < 0 ? products.length : index + 1 + remainingBeforeManual;
    const anchorTier = resolveProductTier(products[index]).key;
    const remainingBeforeTier = products.slice(index + 1).findIndex((product) => resolveProductTier(product).key !== anchorTier);
    const tierBoundary = remainingBeforeTier < 0 ? products.length : index + 1 + remainingBeforeTier;
    const boundary = Math.min(manualBoundary, tierBoundary);
    const available = products.slice(index, boundary);
    const availableAnalyses = available.map((product) => analysisById.get(product.id)!);
    if (!type) type = chooseSmartType(available, availableAnalyses);

    const capacity = LAYOUT_RULES.layoutCapacity[type];
    const pageProducts = available.slice(0, capacity);
    const pageAnalyses = pageProducts.map((product) => analysisById.get(product.id)!);
    const provisionalScore = scoreLayout(type, pageProducts, pageAnalyses).total;
    const reason = source === "manual"
      ? `该页由用户锁定为${LAYOUT_LABELS[type]}，重新智能排版时保持不变。`
      : autoReason(type, pageAnalyses, provisionalScore);
    plans.push(makePlan(type, pageProducts, pageAnalyses, source, reason));
    index += Math.max(1, pageProducts.length);
  }

  return plans;
}
