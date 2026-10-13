import type { CatalogMeta, CatalogSlide, Product, ProductCategory } from "@/types/catalog";
import type { PresentationTemplate } from "@/src/templates/types";
import type { PresentationTheme } from "@/src/themes/types";

export interface RenderContext {
  theme: PresentationTheme;
  template: PresentationTemplate;
  project: CatalogMeta;
  slide: CatalogSlide;
  products: Product[];
  categories: ProductCategory[];
  totalSlides: number;
}
