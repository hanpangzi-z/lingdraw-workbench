import type { PresentationTemplate } from "../types";
import { businessRedLayoutVariants } from "../layoutPresets";

export const corporateBlueTemplate: PresentationTemplate = {
  id: "corporate-blue",
  name: "商务蓝",
  nameEn: "Corporate Blue",
  description: "沿用商务红版式，以沉稳蓝灰配色呈现企业采购、招标与内部汇报内容。",
  author: "灵绘",
  version: "2.0.0",
  tags: ["企业", "商务", "蓝色"],
  category: "business",
  defaultThemeId: "corporate-blue",
  supportedThemes: ["corporate-blue"],
  defaultLayoutMode: "force-single-image",
  showProductIdentifiers: false,
  layoutVariants: businessRedLayoutVariants,
};
