import { describe, expect, it } from "vitest";
import { mockProducts } from "@/data/mock-products";
import { analyzeProduct } from "@/src/lib/layout/analyzeProduct";
import { classifyImageType } from "@/src/lib/layout/analyzeImage";
import { checkSlideOverflow, createSlidePlan } from "@/src/lib/layout/createSlidePlan";
import { productGrid2Config } from "@/src/lib/layout/layouts/productGrid2/config";
import type { ManualLayoutOverride } from "@/src/lib/layout/types";
import type { Product } from "@/types/catalog";

function product(index: number, patch: Partial<Product> = {}): Product {
  const base = mockProducts[index % mockProducts.length];
  return {
    ...base,
    id: `layout-${index}`,
    productNumber: String(index + 1).padStart(2, "0"),
    sku: `LAYOUT-${index}`,
    packageCode: `LAYOUT-${index}`,
    name: `测试商品 ${index + 1}`,
    details: ["规格 A", "规格 B", "规格 C"],
    deliveryRegions: ["全国配送 A 类"],
    ...patch,
  };
}

describe("rule based layout engine", () => {
  it("classifies low-density products and groups three per page", () => {
    const products = [product(0), product(1), product(2)];
    expect(analyzeProduct(products[0]).density).toBe("low");
    expect(createSlidePlan(products)[0]).toMatchObject({ type: "product-grid-3", productIds: products.map((item) => item.id) });
  });

  it("uses two-column pages for two high-density products", () => {
    const details = Array.from({ length: 6 }, (_, index) => `明细 ${index + 1}：中等长度规格内容`);
    const plans = createSlidePlan([product(0, { details }), product(1, { details })]);
    expect(plans[0].type).toBe("product-grid-2");
    expect(plans[0].overflow.overflow).toBe(false);
  });

  it("uses two full-width horizontal cards for a two-product page", () => {
    expect(productGrid2Config.cards).toHaveLength(2);
    expect(productGrid2Config.cards.every((card) => card.variant === "grid-2-row")).toBe(true);
    expect(productGrid2Config.cards[0].x).toBe(productGrid2Config.cards[1].x);
    expect(productGrid2Config.cards[0].w).toBeGreaterThan(productGrid2Config.cards[0].h * 3);
    expect(productGrid2Config.cards[1].y).toBeGreaterThan(productGrid2Config.cards[0].y + productGrid2Config.cards[0].h);
  });

  it("uses package detail for very-high density content", () => {
    const details = Array.from({ length: 10 }, (_, index) => `第 ${index + 1} 项套餐组成与完整规格说明 500g×2`);
    const plan = createSlidePlan([product(0, { details })])[0];
    expect(plan.type).toBe("package-detail");
    expect(plan.analyses[0].density).toBe("very-high");
  });

  it("uses image focus for an excellent large image with light text", () => {
    const plan = createSlidePlan([product(0, { imageMetadata: { width: 2400, height: 1600 } })])[0];
    expect(plan.type).toBe("product-image-focus");
    expect(plan.analyses[0]).toMatchObject({ imageType: "landscape", imageQuality: "excellent" });
  });

  it("promotes a featured product to the feature layout", () => {
    expect(createSlidePlan([product(0, { featured: true })])[0].type).toBe("product-feature");
  });

  it("uses the mixed layout for one high and two light products", () => {
    const high = product(0, { details: Array.from({ length: 6 }, (_, index) => `规格 ${index + 1} 组合内容`) });
    const plan = createSlidePlan([high, product(1), product(2)])[0];
    expect(plan.type).toBe("mixed-product");
  });

  it("preserves manual overrides during smart regeneration", () => {
    const products = [product(0), product(1), product(2), product(3)];
    const override: ManualLayoutOverride = { anchorProductId: products[0].id, type: "product-grid-2" };
    const options = { mode: "smart" as const, overrides: { [override.anchorProductId]: override } };
    const first = createSlidePlan(products, options);
    const regenerated = createSlidePlan(products.map((item) => ({ ...item })), options);
    expect(first[0]).toMatchObject({ type: "product-grid-2", source: "manual", productIds: [products[0].id, products[1].id] });
    expect(regenerated[0]).toMatchObject({ type: "product-grid-2", source: "manual", productIds: [products[0].id, products[1].id] });
  });

  it("supports all three global force modes without reordering products", () => {
    const products = Array.from({ length: 7 }, (_, index) => product(index));
    expect(createSlidePlan(products, { mode: "force-grid-3" }).map((plan) => plan.productIds.length)).toEqual([3, 3, 1]);
    expect(createSlidePlan(products, { mode: "force-grid-2" }).map((plan) => plan.productIds.length)).toEqual([2, 2, 2, 1]);
    expect(createSlidePlan(products, { mode: "force-single-image" }).every((plan) => plan.type === "product-image-focus")).toBe(true);
    expect(createSlidePlan(products).flatMap((plan) => plan.productIds)).toEqual(products.map((item) => item.id));
  });

  it("detects unsafe fields and records overflow on a manual compact layout", () => {
    const dense = product(0, {
      name: "一个非常非常长并且需要完整保留不能被直接截断的中英文 Mixed Product Name 2026",
      details: Array.from({ length: 14 }, (_, index) => `套餐组成 ${index + 1}：详细规格 500g×2 与说明`),
      deliveryRegions: ["全国配送（内蒙古、新疆、西藏、青海、海南、宁夏、甘肃、吉林、黑龙江、港澳台不支持配送；偏远地区履约范围按招标文件最终确认）"],
    });
    const overflow = checkSlideOverflow("product-grid-3", [dense]);
    expect(overflow.overflow).toBe(true);
    expect(overflow.fields).toEqual(expect.arrayContaining(["title", "items", "delivery"]));
    expect(createSlidePlan([dense])[0].type).toBe("package-detail");
  });

  it("classifies image aspect ratios at the centralized boundaries", () => {
    expect(classifyImageType(0.5)).toBe("tall");
    expect(classifyImageType(0.7)).toBe("portrait");
    expect(classifyImageType(1)).toBe("square");
    expect(classifyImageType(1.5)).toBe("landscape");
    expect(classifyImageType(2)).toBe("wide");
  });

  it("creates a complete mixed plan for the existing 33-product fixture", () => {
    const plans = createSlidePlan(mockProducts);
    expect(plans.flatMap((plan) => plan.productIds)).toEqual(mockProducts.map((item) => item.id));
    expect(plans.some((plan) => plan.type !== "product-grid-3")).toBe(true);
    expect(plans.every((plan) => plan.score >= 0 && plan.score <= 100)).toBe(true);
  });
});
