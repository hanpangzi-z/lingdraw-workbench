import type PptxGenJS from "pptxgenjs";
import type { CatalogMeta, CatalogSlide, Product, ProductCategory } from "@/types/catalog";
import type { SlidePlan } from "@/src/lib/layout/types";
import type { ResolvedPresentationTheme } from "@/src/themes/types";
import type { PresentationTemplate } from "@/src/templates/types";
import type { EditorState } from "@/types/editor";
import type { FinalPresentationModel } from "@/src/lib/editor/createFinalPresentationModel";

export interface PreparedImageAsset {
  data: string;
  width: number;
  height: number;
  source: string;
}

export interface ImageBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProductTextStyle {
  titleFontSize: number;
  itemFontSize: number;
  lineSpacing: number;
  compact: boolean;
}

export interface DeliveryGroup {
  rule: string;
  productNumbers: string[];
  productNames: string[];
}

export interface PptGenerationInput {
  meta: CatalogMeta;
  products: Product[];
  categories: ProductCategory[];
  slidePlans?: SlidePlan[];
  editorState?: EditorState;
  presentationModel?: FinalPresentationModel;
}

export interface LayoutContext extends PptGenerationInput {
  pptx: PptxGenJS;
  slide: PptxGenJS.Slide;
  theme: ResolvedPresentationTheme;
  template: PresentationTemplate;
  assets: Map<string, PreparedImageAsset>;
  currentSlide: CatalogSlide;
  totalSlides: number;
  imageFailures?: Set<string>;
}

export interface PptBuildResult {
  presentation: PptxGenJS;
  fileName: string;
  slideCount: number;
  warnings: string[];
}

export interface PptExportResult {
  fileName: string;
  slideCount: number;
  warnings: string[];
}

export interface PptBlobResult extends PptExportResult {
  blob: Blob;
}
