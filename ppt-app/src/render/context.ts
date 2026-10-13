import type { CSSProperties } from "react";
import { pointsToCanvasWidthUnit, slideCssVariables, slideLayout } from "@/src/config/slideLayout";
import { getTemplate } from "@/src/templates/registry";
import { resolveTheme } from "@/src/themes/registry";
import { themeFontStack } from "@/src/themes/types";
import type { CatalogMeta, CatalogSlide, Product, ProductCategory } from "@/types/catalog";
import type { RenderContext } from "./types";

type SlideCssProperties = CSSProperties & Record<`--${string}`, string>;

export function createRenderContext(input: {
  project: CatalogMeta;
  slide: CatalogSlide;
  products: Product[];
  categories: ProductCategory[];
  totalSlides: number;
}): RenderContext {
  const template = getTemplate(input.project.design.templateId);
  const theme = resolveTheme(input.project.design.themeId, input.project.design.themeOverrides, input.project.design.brandColor);
  return { ...input, theme, template };
}

export function getEffectiveBrand(project: CatalogMeta) {
  return project.design.brandName?.trim() || project.brand;
}

export function getEffectiveLogo(project: CatalogMeta) {
  return project.design.logo || project.logo;
}

export function renderContextCssVariables(context: RenderContext): SlideCssProperties {
  const { theme, template } = context;
  const style = context.slide.editor?.styleOverrides;
  const background = style?.backgroundColor || theme.colors.background;
  return {
    ...slideCssVariables,
    "--theme-primary": theme.colors.primary,
    "--theme-primary-dark": theme.colors.primaryDark,
    "--theme-background": background,
    "--theme-surface": theme.colors.surface,
    "--theme-surface-alt": theme.colors.surfaceAlt,
    "--theme-text": theme.colors.textPrimary,
    "--theme-secondary": theme.colors.textSecondary,
    "--theme-accent": theme.colors.accent,
    "--theme-border": theme.colors.border,
    "--theme-price": theme.colors.priceBackground,
    "--theme-image": theme.colors.imageBackground,
    "--theme-product-content-background": theme.colors.background,
    "--theme-product-content-text": theme.colors.textPrimary,
    "--theme-product-content-secondary": theme.colors.textSecondary,
    "--theme-on-primary": theme.colors.onPrimary,
    "--theme-on-primary-muted": theme.colors.onPrimaryMuted,
    "--theme-title-font": themeFontStack(theme.typography.title, theme.typography.fontFallbacks.title),
    "--theme-body-font": themeFontStack(theme.typography.body, theme.typography.fontFallbacks.body),
    "--theme-number-font": themeFontStack(theme.typography.number, theme.typography.fontFallbacks.number),
    "--theme-card-radius": `${theme.radius.card}px`,
    "--theme-image-radius": `${theme.radius.image}px`,
    "--theme-shadow": theme.decoration.shadow,
    "--editor-title-color": style?.titleColor || theme.colors.textPrimary,
    "--editor-cover-title-color": style?.titleColor || theme.colors.onPrimary,
    "--editor-cover-title-size": pointsToCanvasWidthUnit(style?.titleFontSize ?? slideLayout.coverDivider.titleFontSize),
    "--editor-cover-title-weight": `${style?.titleFontWeight ?? 400}`,
    "--editor-header-title-color": theme.colors.onPrimary,
    "--editor-title-size": pointsToCanvasWidthUnit(style?.titleFontSize ?? 34),
    "--editor-title-weight": `${style?.titleFontWeight ?? theme.typography.titleWeight}`,
    "--editor-title-align": style?.textAlign ?? "left",
    "--template-spacing-scale": `${theme.spacing.scale}`,
    "--template-id": template.id,
    /* Compatibility aliases keep the existing layout CSS stable while all values come from the resolved theme. */
    "--br-primary": theme.colors.primary,
    "--br-primary-dark": theme.colors.primaryDark,
    "--br-background": background,
    "--br-card": theme.colors.surface,
    "--br-text": theme.colors.textPrimary,
    "--br-secondary": theme.colors.textSecondary,
    "--br-accent": theme.colors.accent,
    "--br-border": theme.colors.border,
    "--br-price": theme.colors.priceBackground,
    "--br-image": theme.colors.imageBackground,
  };
}
