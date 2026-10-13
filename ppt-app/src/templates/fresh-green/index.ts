import type { PresentationTemplate } from "../types";
import { businessRedLayoutVariants } from "../layoutPresets";

export const freshGreenTemplate: PresentationTemplate = {
  id: "fresh-green",
  name: "清新绿",
  nameEn: "Fresh Green",
  description: "沿用商务红版式，以稳重松绿色呈现食品、健康、生态与员工福利项目。",
  author: "灵绘",
  version: "2.0.0",
  tags: ["清新", "健康", "绿色"],
  category: "business",
  defaultThemeId: "fresh-green",
  supportedThemes: ["fresh-green"],
  defaultLayoutMode: "force-single-image",
  showProductIdentifiers: false,
  layoutVariants: businessRedLayoutVariants,
};
