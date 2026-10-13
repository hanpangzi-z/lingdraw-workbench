import type { ProductLayoutConfig } from "../configTypes";

export const mixedProductConfig: ProductLayoutConfig = {
  type: "mixed-product",
  label: "混合编排",
  capacity: 3,
  cards: [
    { x: 0.46, y: 0.92, w: 6.05, h: 5.98, variant: "mixed-primary" },
    { x: 6.69, y: 0.92, w: 6.183, h: 2.9, variant: "mixed-secondary" },
    { x: 6.69, y: 4.0, w: 6.183, h: 2.9, variant: "mixed-secondary" },
  ],
  minimumTitleFontSize: 11,
  minimumBodyFontSize: 10,
};
