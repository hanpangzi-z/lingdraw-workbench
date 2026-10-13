import { resolvePptTheme } from "@/src/themes/registry";

/** @deprecated Use the theme registry. Kept for external imports during the 2.0 migration. */
export const BUSINESS_RED_THEME = resolvePptTheme("business-red");
export type BusinessRedTheme = typeof BUSINESS_RED_THEME;
export const colorWithHash = (color: string) => color.startsWith("#") ? color : `#${color}`;
