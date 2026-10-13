import type { TemplateLayoutVariants } from "./types";

/**
 * All built-in colorways share the Business Red composition.
 * Themes may change color, typography and decoration, but never page geometry.
 */
export const businessRedLayoutVariants: TemplateLayoutVariants = {
  cover: "left",
  overview: "category-grid",
  product: {
    "product-grid-3": "grid3-card",
    "product-grid-2": "grid3-card",
    "product-feature": "grid3-card",
    "package-detail": "grid3-card",
    "product-image-focus": "image-heavy",
    "mixed-product": "grid3-card",
  },
  delivery: "split",
  ending: "brand",
};
