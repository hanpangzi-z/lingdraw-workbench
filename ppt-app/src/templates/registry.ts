import { businessStandardTemplate } from "./business-standard";
import { corporateBlueTemplate } from "./corporate-blue";
import { freshGreenTemplate } from "./fresh-green";
import { modernCatalogTemplate } from "./modern-catalog";
import { premiumGiftTemplate } from "./premium-gift";
import type { PresentationTemplate, TemplateId } from "./types";
import type { LayoutMode } from "@/src/lib/layout/types";
import type { ProjectDesign } from "@/types/catalog";

const templates: Record<TemplateId, PresentationTemplate> = {
  "business-standard": businessStandardTemplate,
  "modern-catalog": modernCatalogTemplate,
  "premium-gift": premiumGiftTemplate,
  "corporate-blue": corporateBlueTemplate,
  "fresh-green": freshGreenTemplate,
};

export function getTemplate(id: TemplateId = "business-standard") {
  return templates[id] ?? businessStandardTemplate;
}

export function getAvailableTemplates() {
  return Object.values(templates);
}

export function resolveTemplateLayoutMode(templateId: TemplateId, requestedMode: LayoutMode = "smart"): LayoutMode {
  if (requestedMode !== "smart") return requestedMode;
  return getTemplate(templateId).defaultLayoutMode ?? "smart";
}

export function getCompatibleThemeId(template: PresentationTemplate, requested?: string) {
  return template.supportedThemes.find((id) => id === requested) ?? template.defaultThemeId;
}

export function applyTemplateToDesign(design: ProjectDesign, templateId: TemplateId): ProjectDesign {
  return createTemplatePreviewDesign(design, templateId);
}

export function createTemplatePreviewDesign(
  design: ProjectDesign,
  templateId: TemplateId,
): ProjectDesign {
  const template = getTemplate(templateId);
  return {
    ...design,
    templateId,
    themeId: template.defaultThemeId,
    themeOverrides: {},
    brandColor: undefined,
  };
}

export function resetTemplateDesign(design: ProjectDesign, templateId: TemplateId): ProjectDesign {
  const template = getTemplate(templateId);
  return {
    templateId,
    themeId: template.defaultThemeId,
    themeOverrides: {},
    logo: design.logo,
    brandName: design.brandName,
    brandColor: undefined,
    pageRatio: "16:9",
  };
}

export { businessStandardTemplate, corporateBlueTemplate, freshGreenTemplate, modernCatalogTemplate, premiumGiftTemplate };
export type { PresentationTemplate, TemplateId } from "./types";
