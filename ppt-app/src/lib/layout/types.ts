import type { Product, ProductCategoryId } from "@/types/catalog";

export const PRODUCT_LAYOUT_TYPES = [
  "product-grid-3",
  "product-grid-2",
  "product-feature",
  "package-detail",
  "product-image-focus",
  "mixed-product",
] as const;

export type ProductLayoutType = (typeof PRODUCT_LAYOUT_TYPES)[number];
export type ProductDensity = "low" | "medium" | "high" | "very-high";
export type ProductImageType = "unknown" | "square" | "portrait" | "landscape" | "wide" | "tall";
export type RecommendedCardSize = "compact" | "standard" | "large" | "full";
export type LayoutSource = "auto" | "manual";
export type LayoutMode = "smart" | "force-grid-3" | "force-grid-2" | "force-single-image";

export interface ImageAnalysis {
  hasImage: boolean;
  width?: number;
  height?: number;
  aspectRatio?: number;
  imageType: ProductImageType;
  quality: "unknown" | "low" | "good" | "excellent";
}

export interface ProductAnalysis {
  productId: string;
  titleLength: number;
  itemCount: number;
  itemTextLength: number;
  deliveryLength: number;
  hasImage: boolean;
  imageAspectRatio?: number;
  imageType: ProductImageType;
  imageQuality: ImageAnalysis["quality"];
  density: ProductDensity;
  recommendedCardSize: RecommendedCardSize;
  categoryId: ProductCategoryId;
  featured: boolean;
}

export interface LayoutScore {
  layout: ProductLayoutType;
  total: number;
  textSpace: number;
  imageSpace: number;
  productCount: number;
  imageRatio: number;
  categoryAffinity: number;
  reasons: string[];
}

export interface SlideOverflowCheck {
  overflow: boolean;
  fields: Array<"title" | "items" | "delivery" | "price">;
  messages: string[];
}

export interface SlidePlan {
  id: string;
  type: ProductLayoutType;
  productIds: string[];
  layoutVariant: string;
  reason: string;
  score: number;
  source: LayoutSource;
  layoutOverride?: ProductLayoutType;
  overflow: SlideOverflowCheck;
  analyses: ProductAnalysis[];
}

export interface ManualLayoutOverride {
  anchorProductId: string;
  type: ProductLayoutType;
}

export interface LayoutPlanningOptions {
  mode?: LayoutMode;
  overrides?: Record<string, ManualLayoutOverride>;
}

export interface LayoutRecommendation {
  type: ProductLayoutType;
  reason: string;
  score: LayoutScore;
}

export interface LayoutAdvisor {
  analyze(products: Product[]): ProductAnalysis[];
  recommend(products: Product[], analyses?: ProductAnalysis[]): LayoutRecommendation;
  createPlan(products: Product[], options?: LayoutPlanningOptions): SlidePlan[];
}
