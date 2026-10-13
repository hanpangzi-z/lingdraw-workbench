import type { ProductDensity, ProductLayoutType } from "./types";

export const LAYOUT_RULES = {
  density: {
    low: { maxItems: 3, maxItemText: 79, maxTitle: 31, maxDelivery: 59 },
    medium: { maxItems: 5, maxItemText: 149, maxTitle: 41, maxDelivery: 99 },
    veryHigh: { minItems: 8, minItemText: 240, minTitle: 54, minDelivery: 160 },
  },
  imageRatio: {
    tall: 0.55,
    squareMin: 0.85,
    squareMax: 1.15,
    wide: 1.8,
  },
  minimumFontSize: {
    title: 11,
    body: 10,
  },
  layoutCapacity: {
    "product-grid-3": 3,
    "product-grid-2": 2,
    "product-feature": 1,
    "package-detail": 1,
    "product-image-focus": 1,
    "mixed-product": 3,
  } satisfies Record<ProductLayoutType, number>,
  overflow: {
    "product-grid-3": { title: 38, items: 7, itemText: 220, delivery: 45 },
    "product-grid-2": { title: 60, items: 12, itemText: 380, delivery: 95 },
    "product-feature": { title: 72, items: 12, itemText: 390, delivery: 170 },
    "package-detail": { title: 120, items: 26, itemText: 920, delivery: 260 },
    "product-image-focus": { title: 46, items: 5, itemText: 160, delivery: 120 },
    "mixed-product": { title: 46, items: 7, itemText: 230, delivery: 70 },
  } satisfies Record<ProductLayoutType, { title: number; items: number; itemText: number; delivery: number }>,
} as const;

export const DENSITY_LABELS: Record<ProductDensity, string> = {
  low: "低密度",
  medium: "中密度",
  high: "高密度",
  "very-high": "超高密度",
};

export const LAYOUT_LABELS: Record<ProductLayoutType, string> = {
  "product-grid-3": "三栏商品",
  "product-grid-2": "双栏商品",
  "product-feature": "单品精选",
  "package-detail": "套餐详情",
  "product-image-focus": "图片优先",
  "mixed-product": "混合编排",
};
