import { describe, expect, it } from "vitest";
import { mockProducts } from "@/data/mock-products";
import { buildCatalogSlides, PRODUCTS_PER_SLIDE } from "@/lib/pagination";
import { createSlidePlan } from "@/src/lib/layout/createSlidePlan";

describe("catalog pagination", () => {
  it("generates 11 three-product detail slides for 33 products", () => {
    const slides = buildCatalogSlides(mockProducts);
    const productSlides = slides.filter((slide) => slide.kind === "products");

    expect(PRODUCTS_PER_SLIDE).toBe(3);
    expect(mockProducts).toHaveLength(33);
    expect(productSlides).toHaveLength(11);
    expect(slides).toHaveLength(13);
    expect(slides.map((slide) => slide.kind)).not.toContain("category-overview");
    expect(slides.map((slide) => slide.kind)).not.toContain("delivery");
    expect(productSlides.every((slide) => slide.products.length === 3)).toBe(true);
  });

  it("keeps a partial final page when the product count is not divisible by three", () => {
    const slides = buildCatalogSlides(mockProducts.slice(0, 32));
    const productSlides = slides.filter((slide) => slide.kind === "products");

    expect(productSlides).toHaveLength(11);
    expect(productSlides.at(-1)?.products).toHaveLength(2);
  });

  it("starts every imported price tier with its own divider page", () => {
    const products = mockProducts.slice(0, 4).map((product, index) => {
      const priceTier = index < 2 ? 500 : 600;
      return { ...product, id: `tiered-${index + 1}`, priceTier: `${priceTier}元`, price: { ...product.price, package: priceTier } };
    });
    const plans = createSlidePlan(products, { mode: "force-grid-3" });
    const slides = buildCatalogSlides(products, plans);
    const covers = slides.filter((slide) => slide.kind === "cover");
    const productSlides = slides.filter((slide) => slide.kind === "products");

    expect(plans.map((plan) => plan.productIds)).toEqual([
      ["tiered-1", "tiered-2"],
      ["tiered-3", "tiered-4"],
    ]);
    expect(slides.map((slide) => slide.kind)).toEqual(["cover", "products", "cover", "products", "end"]);
    expect(covers.map((slide) => slide.tierName)).toEqual(["500元档位", "600元档位"]);
    expect(covers.map((slide) => slide.productIds?.length)).toEqual([2, 2]);
    expect(productSlides.map((slide) => slide.sectionPage)).toEqual([1, 1]);
    expect(slides.map((slide) => slide.pageNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it("contains all requested edge-case fixtures", () => {
    expect(mockProducts.some((product) => product.details.length === 2)).toBe(true);
    expect(mockProducts.some((product) => product.details.length >= 7)).toBe(true);
    expect(mockProducts.some((product) => product.name.length > 20)).toBe(true);
    expect(mockProducts.some((product) => product.price.market === undefined)).toBe(true);
    expect(mockProducts.some((product) => product.image === undefined)).toBe(true);
    expect(mockProducts.some((product) => product.deliveryRegions.join(" · ").length > 25)).toBe(true);
    expect(new Set(mockProducts.map((product) => product.categoryId)).size).toBe(7);
    expect(mockProducts.some((product) => /[A-Za-z]+/.test(product.name) && /\d/.test(product.name))).toBe(true);
  });
});
