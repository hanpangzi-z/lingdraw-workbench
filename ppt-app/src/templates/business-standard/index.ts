import type { PresentationTemplate } from "../types";
import { businessRedLayoutVariants } from "../layoutPresets";

export const businessStandardTemplate: PresentationTemplate = {
  id: "business-standard",
  name: "商务标准",
  nameEn: "Business Standard",
  description: "信息密度高、栏头清晰，适合招标、采购和对照审核。",
  author: "灵绘",
  version: "2.0.0",
  tags: ["招标", "商务", "密集信息"],
  category: "business",
  defaultThemeId: "business-red",
  supportedThemes: ["business-red"],
  defaultLayoutMode: "force-single-image",
  showProductIdentifiers: false,
  layoutVariants: businessRedLayoutVariants,
};
