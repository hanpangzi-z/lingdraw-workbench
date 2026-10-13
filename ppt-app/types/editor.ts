import type { ProductCategoryId } from "@/types/catalog";
import type { ProductLayoutType } from "@/src/lib/layout/types";

export type EditableSection = "number" | "sku" | "marketPrice" | "salePrice" | "delivery" | "details" | "category";
export type ImageFit = "contain" | "cover";

export type CanvasElementType = "text" | "image" | "shape" | "group";

export interface CanvasElementTransform {
  /** Translation in slide-width percentages so zoom never changes the saved position. */
  x: number;
  /** Translation in slide-height percentages. */
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface CanvasElementStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: 400 | 500 | 600 | 700;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  fillColor?: string;
  textAlign?: "left" | "center" | "right";
}

export interface CanvasElementOverride {
  id: string;
  type: CanvasElementType;
  label?: string;
  transform?: CanvasElementTransform;
  style?: CanvasElementStyle;
  text?: string;
  image?: ProductImageOverride;
  hidden?: boolean;
  locked?: boolean;
}

export interface ProductImageOverride {
  source?: string;
  fit: ImageFit;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface SlideStyleOverrides {
  titleFontSize?: number;
  titleFontWeight?: 400 | 500 | 600 | 700;
  titleColor?: string;
  backgroundColor?: string;
  textAlign?: "left" | "center" | "right";
  showPageNumber?: boolean;
}

export interface SlideEditState {
  slideId: string;
  layoutOverride?: ProductLayoutType;
  hiddenSections?: string[];
  textOverrides?: Record<string, string>;
  styleOverrides?: SlideStyleOverrides;
  productOrder?: string[];
  imageOverrides?: Record<string, ProductImageOverride>;
  elementOverrides?: Record<string, CanvasElementOverride>;
  customTitle?: string;
}

export type ManualSlideType = "title" | "text" | "product" | "category" | "ending";

export interface ManualSlide {
  id: string;
  type: ManualSlideType;
  data: {
    title?: string;
    subtitle?: string;
    body?: string;
    productIds?: string[];
    categoryId?: ProductCategoryId;
  };
  sourceSlideId?: string;
  createdAt: number;
}

export interface EditorState {
  slides: Record<string, SlideEditState>;
  manualSlides: Record<string, ManualSlide>;
  slideOrder: string[];
  hiddenSlideIds: string[];
  lockedSlideIds: string[];
}

export interface EditorSnapshot {
  project: import("@/types/catalog").CatalogMeta;
  products: import("@/types/catalog").Product[];
  layoutOverrides: Record<string, import("@/src/lib/layout/types").ManualLayoutOverride>;
  editorState: EditorState;
}

export type EditorSelection =
  | { type: "page"; slideId: string }
  | { type: "title"; slideId: string }
  | { type: "product"; slideId: string; productId: string }
  | { type: "image"; slideId: string; productId: string }
  | { type: "price"; slideId: string; productId: string }
  | { type: "delivery"; slideId: string; productId: string }
  | { type: "element"; slideId: string; elementId: string; elementType: CanvasElementType; label: string };

export const defaultCanvasElementTransform = (): CanvasElementTransform => ({
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
});

export const emptyEditorState = (): EditorState => ({
  slides: {},
  manualSlides: {},
  slideOrder: [],
  hiddenSlideIds: [],
  lockedSlideIds: [],
});

export function sectionOverrideKey(productId: string, section: EditableSection) {
  return `${productId}.${section}`;
}

export function isSectionHidden(edit: SlideEditState | undefined, productId: string, section: EditableSection) {
  const hidden = edit?.hiddenSections ?? [];
  return hidden.includes(section) || hidden.includes(sectionOverrideKey(productId, section));
}
