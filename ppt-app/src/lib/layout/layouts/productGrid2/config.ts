import type { ProductLayoutConfig } from "../configTypes";

export const productGrid2Config: ProductLayoutConfig = {
  type: "product-grid-2",
  label: "双商品",
  capacity: 2,
  cards: [
    { x: 0.46, y: 0.92, w: 12.413, h: 2.86, variant: "grid-2-row" },
    { x: 0.46, y: 4.04, w: 12.413, h: 2.86, variant: "grid-2-row" },
  ],
  minimumTitleFontSize: 13,
  minimumBodyFontSize: 11,
};
