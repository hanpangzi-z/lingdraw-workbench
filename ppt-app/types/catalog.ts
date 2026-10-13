export type Currency = "CNY";

import type { AIProductMetadata } from "@/types/ai";
import type { SlidePlan } from "@/src/lib/layout/types";
import type { TemplateId } from "@/src/templates/types";
import type { ThemeId, ThemeOverrides } from "@/src/themes/types";
import type { ManualSlide, SlideEditState } from "@/types/editor";
import type { CandidateField, ProductSource } from "@/src/lib/import/types";

export type DeliveryRule =
  | "全国配送 A 类"
  | "全国配送 B 类"
  | "沪浙苏皖闽"
  | "江浙沪皖"
  | "江浙沪"
  | "按招标文件执行";

export type ProductCategoryId =
  | "grain-seasoning"
  | "snacks-pastry"
  | "braised-food"
  | "fresh-meat"
  | "kitchen-appliance"
  | "home-appliance"
  | "daily-care"
  | "uncategorized";

export interface ProductPrice {
  currency: Currency;
  market?: number;
  package?: number;
}

export interface ProductComponent {
  name: string;
  brand?: string;
  details: string[];
  marketPrice?: number;
}

export interface Product {
  id: string;
  /** Optional library source. Project data remains a detached snapshot. */
  globalProductId?: string;
  globalProductVersion?: number;
  productNumber: string;
  sku: string;
  packageCode: string;
  name: string;
  /** Source rows that make up one imported package. The slide still renders the flattened `details` list. */
  components?: ProductComponent[];
  /** All independently editable product pictures. `image` remains the primary/legacy picture. */
  images?: string[];
  image?: string;
  details: string[];
  price: ProductPrice;
  deliveryRegions: string[];
  categoryId: ProductCategoryId;
  /** Optional dimensions used by batch-project grouping. A value may contain `；` separated memberships. */
  region?: string;
  priceTier?: string;
  packageType?: string;
  customerGroup?: string;
  /** Manually promoted products receive a single-product feature layout in smart mode. */
  featured?: boolean;
  /** Optional primary-image dimensions used by the deterministic layout analyzer. */
  imageMetadata?: { width: number; height: number };
  /** Source values are retained so AI suggestions never destroy the imported record. */
  rawData?: Record<string, unknown>;
  deliveryRaw?: string;
  deliveryNormalized?: string;
  aiMetadata?: AIProductMetadata;
  /** Every parsed value keeps a trace back to its source document location. */
  sources?: ProductSource[];
  /** Confidence is advisory only; critical numeric conflicts always require a human choice. */
  importMetadata?: {
    confidence: number;
    fieldConfidence: Partial<Record<CandidateField, number>>;
    candidateId?: string;
  };
}

export interface ProductCategory {
  id: ProductCategoryId;
  name: string;
  englishName: string;
  description: string;
  coverImage: string;
}

export interface ProjectDesign {
  templateId: TemplateId;
  themeId: ThemeId;
  themeOverrides: ThemeOverrides;
  logo?: string;
  brandName?: string;
  brandColor?: string;
  pageRatio: "16:9";
  templateDefinitionId?: string;
  templateDefinitionVersion?: number;
  templateSnapshot?: unknown;
  themeDefinitionId?: string;
  themeDefinitionVersion?: number;
  themeSnapshot?: unknown;
}

export interface CatalogMeta {
  brand: string;
  city: string;
  year: number;
  priceTier: number;
  tierName: string;
  projectName: string;
  title: string;
  subtitle: string;
  edition: string;
  serviceLine: string;
  /** Optional manual revision suffix used by batch and single-project filenames. */
  version?: string;
  logo?: string;
  design: ProjectDesign;
}

interface BaseSlide {
  id: string;
  pageNumber: number;
  editor?: SlideEditState;
}

export interface CoverSlide extends BaseSlide {
  kind: "cover";
  priceTier?: number;
  tierName?: string;
  productIds?: string[];
  sectionIndex?: number;
  sectionCount?: number;
}

export interface CategoryOverviewSlide extends BaseSlide {
  kind: "category-overview";
  categoryCounts: Record<string, number>;
}

export interface ProductDetailSlide extends BaseSlide {
  kind: "products";
  products: Product[];
  sectionNumber: number;
  sectionPage: number;
  priceTier?: number;
  tierName?: string;
  plan: SlidePlan;
}

export interface DeliverySlide extends BaseSlide {
  kind: "delivery";
}

export interface EndSlide extends BaseSlide {
  kind: "end";
}

export interface ManualCatalogSlide extends BaseSlide {
  kind: "manual";
  manual: ManualSlide;
}

export type CatalogSlide =
  | CoverSlide
  | CategoryOverviewSlide
  | ProductDetailSlide
  | DeliverySlide
  | EndSlide
  | ManualCatalogSlide;
