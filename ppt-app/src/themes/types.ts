export type ThemeId =
  | "business-red"
  | "corporate-blue"
  | "minimal-light"
  | "premium-dark"
  | "festival-red"
  | "fresh-green";

export type ThemeHeaderStyle = "solid" | "line" | "minimal" | "ornamental";
export type ThemeCardStyle = "bordered" | "flat" | "elevated" | "translucent";
export type ThemePriceStyle = "panel" | "line" | "badge" | "restrained";
export type ThemeImageStyle = "neutral" | "paper" | "dark-surface" | "tinted";

export interface PresentationTheme {
  id: ThemeId;
  name: string;
  nameEn: string;
  description: string;
  isDark: boolean;
  colors: {
    primary: string;
    primaryDark: string;
    background: string;
    surface: string;
    surfaceAlt: string;
    textPrimary: string;
    textSecondary: string;
    accent: string;
    border: string;
    priceBackground: string;
    imageBackground: string;
    onPrimary: string;
    onPrimaryMuted: string;
    success: string;
  };
  typography: {
    title: string;
    body: string;
    number: string;
    fontFallbacks: {
      title: string[];
      body: string[];
      number: string[];
    };
    titleWeight: 500 | 600 | 700;
    bodyWeight: 400 | 500;
    letterSpacing: number;
  };
  radius: {
    card: number;
    image: number;
    badge: number;
  };
  border: {
    width: number;
    opacity: number;
  };
  spacing: {
    density: "compact" | "comfortable" | "spacious";
    scale: number;
  };
  decoration: {
    headerStyle: ThemeHeaderStyle;
    cardStyle: ThemeCardStyle;
    priceStyle: ThemePriceStyle;
    imageStyle: ThemeImageStyle;
    showTopBar: boolean;
    showFooterLine: boolean;
    showPageNumber: boolean;
    geometry: "none" | "line" | "corner" | "seal";
    shadow: string;
  };
}

export interface ThemeOverrides {
  primary?: string;
  accent?: string;
  priceBackground?: string;
  titleFont?: string;
  bodyFont?: string;
  numberFont?: string;
}

export type ResolvedPresentationTheme = PresentationTheme & {
  /** Transitional aliases used by the native PPT renderers while they migrate to semantic token names. */
  fonts: PresentationTheme["typography"];
  colors: PresentationTheme["colors"] & {
    card: string;
    text: string;
    secondaryText: string;
    priceArea: string;
    imageArea: string;
  };
};

export function normalizeHexColor(value: string) {
  const normalized = value.trim().replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? `#${normalized}` : undefined;
}

export function toPptColor(value: string) {
  return value.replace(/^#/, "").toUpperCase();
}

export function withAlpha(hex: string, alpha: number) {
  const value = normalizeHexColor(hex) ?? "#000000";
  const channel = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0");
  return `${value}${channel}`;
}

export function themeFontStack(primary: string, fallbacks: string[]) {
  return [primary, ...fallbacks].map((font) => font.includes(" ") ? `"${font}"` : font).join(", ");
}
