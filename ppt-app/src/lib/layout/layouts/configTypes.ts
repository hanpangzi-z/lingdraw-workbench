import type { ProductLayoutType } from "../types";

export type ProductCardVariant =
  | "grid-3"
  | "grid-2"
  | "grid-2-row"
  | "feature"
  | "package"
  | "image-focus"
  | "mixed-primary"
  | "mixed-secondary";

export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
  variant: ProductCardVariant;
}

export interface ProductLayoutConfig {
  type: ProductLayoutType;
  label: string;
  capacity: number;
  cards: LayoutBox[];
  minimumTitleFontSize: number;
  minimumBodyFontSize: number;
}
