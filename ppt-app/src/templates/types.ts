import type { LayoutMode, ProductLayoutType } from "@/src/lib/layout/types";
import type { ThemeId } from "@/src/themes/types";

export type TemplateId =
  | "business-standard"
  | "modern-catalog"
  | "premium-gift"
  | "corporate-blue"
  | "fresh-green";
export type CoverVariant = "left" | "centered" | "product-collage";
export type OverviewVariant = "category-grid" | "statistics" | "list";
export type ProductVisualVariant = "grid3-card" | "minimal" | "image-heavy";
export type DeliveryVariant = "list" | "minimal" | "split";
export type EndingVariant = "brand" | "simple" | "large-number";

export interface TemplateLayoutVariants {
  cover: CoverVariant;
  overview: OverviewVariant;
  product: Record<ProductLayoutType, ProductVisualVariant>;
  delivery: DeliveryVariant;
  ending: EndingVariant;
}

export interface PresentationTemplate {
  id: TemplateId;
  name: string;
  nameEn: string;
  description: string;
  author: string;
  version: string;
  tags: string[];
  category: "business" | "catalog" | "gift";
  previewImage?: string;
  defaultThemeId: ThemeId;
  supportedThemes: ThemeId[];
  defaultLayoutMode?: LayoutMode;
  showProductIdentifiers: boolean;
  layoutVariants: TemplateLayoutVariants;
}
