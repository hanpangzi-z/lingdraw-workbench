import type { ProductLayoutConfig } from "../configTypes";

export const productImageFocusConfig: ProductLayoutConfig = {
  type: "product-image-focus",
  label: "图片优先",
  capacity: 1,
  cards: [{ x: 0.46, y: 0.92, w: 12.413, h: 5.98, variant: "image-focus" }],
  minimumTitleFontSize: 17,
  minimumBodyFontSize: 12,
};
