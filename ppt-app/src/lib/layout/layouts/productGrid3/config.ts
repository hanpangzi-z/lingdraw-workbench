import type { ProductLayoutConfig } from "../configTypes";

export const productGrid3Config: ProductLayoutConfig = {
  type: "product-grid-3",
  label: "三栏商品",
  capacity: 3,
  cards: [
    { x: 0.46, y: 0.92, w: 4.018, h: 5.98, variant: "grid-3" },
    { x: 4.658, y: 0.92, w: 4.018, h: 5.98, variant: "grid-3" },
    { x: 8.856, y: 0.92, w: 4.017, h: 5.98, variant: "grid-3" },
  ],
  minimumTitleFontSize: 11,
  minimumBodyFontSize: 10,
};
