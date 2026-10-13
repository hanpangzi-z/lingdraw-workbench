import type { PresentationTemplate } from "../types";
import { businessRedLayoutVariants } from "../layoutPresets";

export const modernCatalogTemplate: PresentationTemplate = {
  id: "modern-catalog",
  name: "现代目录",
  nameEn: "Modern Catalog",
  description: "更大图片、更少边框和充足留白，适合浏览型产品手册。",
  author: "灵绘",
  version: "2.0.0",
  tags: ["目录", "现代", "大图"],
  category: "catalog",
  defaultThemeId: "minimal-light",
  supportedThemes: ["minimal-light"],
  defaultLayoutMode: "force-single-image",
  showProductIdentifiers: false,
  layoutVariants: businessRedLayoutVariants,
};
