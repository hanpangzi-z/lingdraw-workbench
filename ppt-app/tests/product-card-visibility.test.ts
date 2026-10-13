import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { catalogMeta, productCategories } from "@/data/catalog";
import { mockProducts } from "@/data/mock-products";
import { ProductCard } from "@/components/templates/business-red/ProductCard";
import { CanvasOverrideProvider } from "@/src/lib/editor/CanvasOverrideContext";
import type { CanvasElementOverride, SlideEditState } from "@/types/editor";

const slideId = "price-visibility-slide";
const product = mockProducts[0];

function renderCard(overrides: Record<string, CanvasElementOverride> = {}) {
  const editState: SlideEditState = { slideId, elementOverrides: overrides };
  return renderToStaticMarkup(
    createElement(
      CanvasOverrideProvider,
      { value: overrides },
      createElement(ProductCard, {
        product,
        meta: catalogMeta,
        categories: productCategories,
        slideId,
        editState,
        variant: "image-focus",
      }),
    ),
  );
}

function hiddenGroup(id: string): CanvasElementOverride {
  return { id, type: "group", hidden: true };
}

describe("product card price visibility", () => {
  it("collapses the price row when the freeform price zone is hidden", () => {
    const priceZoneId = `product.${product.id}.prices`;
    const html = renderCard({ [priceZoneId]: hiddenGroup(priceZoneId) });

    expect(html).toContain("is-price-hidden");
    expect(html).not.toContain(`data-canvas-element=\"${priceZoneId}\"`);
  });

  it("collapses the price row when both freeform price groups are hidden", () => {
    const marketPriceId = `product.${product.id}.marketPrice`;
    const salePriceId = `product.${product.id}.salePrice`;
    const html = renderCard({
      [marketPriceId]: hiddenGroup(marketPriceId),
      [salePriceId]: hiddenGroup(salePriceId),
    });

    expect(html).toContain("is-price-hidden");
    expect(html).not.toContain("br-product-prices");
  });

  it("keeps the price row when the freeform price zone is visible", () => {
    const html = renderCard();

    expect(html).not.toContain("is-price-hidden");
    expect(html).toContain("br-product-prices");
  });
});
