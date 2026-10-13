import { businessRedTheme } from "./business-red";
import { corporateBlueTheme } from "./corporate-blue";
import { festivalRedTheme } from "./festival-red";
import { freshGreenTheme } from "./fresh-green";
import { minimalLightTheme } from "./minimal-light";
import { premiumDarkTheme } from "./premium-dark";
import { normalizeHexColor, toPptColor, type PresentationTheme, type ResolvedPresentationTheme, type ThemeId, type ThemeOverrides } from "./types";

const themes: Record<ThemeId, PresentationTheme> = {
  "business-red": businessRedTheme,
  "corporate-blue": corporateBlueTheme,
  "minimal-light": minimalLightTheme,
  "premium-dark": premiumDarkTheme,
  "festival-red": festivalRedTheme,
  "fresh-green": freshGreenTheme,
};

export function getTheme(id: ThemeId = "business-red") {
  return themes[id] ?? businessRedTheme;
}

export function getAvailableThemes() {
  return Object.values(themes);
}

export function resolveTheme(id: ThemeId, overrides: ThemeOverrides = {}, brandColor?: string): ResolvedPresentationTheme {
  const base = getTheme(id);
  const primary = normalizeHexColor(brandColor ?? overrides.primary ?? "") ?? base.colors.primary;
  const accent = normalizeHexColor(overrides.accent ?? "") ?? base.colors.accent;
  const priceBackground = normalizeHexColor(overrides.priceBackground ?? "") ?? base.colors.priceBackground;
  const typography = {
    ...base.typography,
    title: overrides.titleFont?.trim() || base.typography.title,
    body: overrides.bodyFont?.trim() || base.typography.body,
    number: overrides.numberFont?.trim() || base.typography.number,
    fontFallbacks: {
      title: [...base.typography.fontFallbacks.title],
      body: [...base.typography.fontFallbacks.body],
      number: [...base.typography.fontFallbacks.number],
    },
  };
  const colors = {
    ...base.colors,
    primary,
    accent,
    priceBackground,
    card: base.colors.surface,
    text: base.colors.textPrimary,
    secondaryText: base.colors.textSecondary,
    priceArea: priceBackground,
    imageArea: base.colors.imageBackground,
  };
  return {
    ...base,
    colors,
    typography,
    fonts: typography,
  };
}

export function resolvePptTheme(id: ThemeId, overrides: ThemeOverrides = {}, brandColor?: string): ResolvedPresentationTheme {
  const theme = resolveTheme(id, overrides, brandColor);
  const colors = Object.fromEntries(Object.entries(theme.colors).map(([key, value]) => [key, toPptColor(value)])) as ResolvedPresentationTheme["colors"];
  return { ...theme, colors };
}

export { businessRedTheme, corporateBlueTheme, festivalRedTheme, freshGreenTheme, minimalLightTheme, premiumDarkTheme };
export type { PresentationTheme, ResolvedPresentationTheme, ThemeId, ThemeOverrides } from "./types";
