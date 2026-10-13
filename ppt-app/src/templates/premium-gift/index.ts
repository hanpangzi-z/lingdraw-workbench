import type { PresentationTemplate } from "../types";
import { businessRedLayoutVariants } from "../layoutPresets";

export const premiumGiftTemplate: PresentationTemplate = {
  id: "premium-gift",
  name: "臻选礼遇",
  nameEn: "Premium Gift",
  description: "商品图主导、价格更克制，用深色与金色营造高级礼赠感。",
  author: "灵绘",
  version: "2.0.0",
  tags: ["礼品", "高级", "图片优先"],
  category: "gift",
  defaultThemeId: "premium-dark",
  supportedThemes: ["premium-dark"],
  defaultLayoutMode: "force-single-image",
  showProductIdentifiers: false,
  layoutVariants: businessRedLayoutVariants,
};
