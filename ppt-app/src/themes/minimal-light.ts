import type { PresentationTheme } from "./types";

export const minimalLightTheme: PresentationTheme = {
  id: "minimal-light",
  name: "极简亮色",
  nameEn: "Minimal Light",
  description: "黑白中性色，沿用商务红的完整栏头、内容区与价格层级。",
  isDark: false,
  colors: {
    primary: "#202426", primaryDark: "#101214", background: "#FCFCFA", surface: "#FFFFFF", surfaceAlt: "#F4F4F0",
    textPrimary: "#171918", textSecondary: "#747875", accent: "#8E9B8B", border: "#DFE1DC", priceBackground: "#F4F5F1",
    imageBackground: "#FFFFFF", onPrimary: "#FFFFFF", onPrimaryMuted: "#E9ECE8", success: "#3B7454",
  },
  typography: {
    title: "PingFang SC", body: "PingFang SC", number: "Helvetica Neue",
    fontFallbacks: { title: ["Microsoft YaHei", "Noto Sans CJK SC", "sans-serif"], body: ["Microsoft YaHei", "Noto Sans CJK SC", "sans-serif"], number: ["Arial", "sans-serif"] },
    titleWeight: 600, bodyWeight: 400, letterSpacing: 0.02,
  },
  radius: { card: 2, image: 2, badge: 12 }, border: { width: 0.5, opacity: 0.75 }, spacing: { density: "spacious", scale: 1.06 },
  decoration: { headerStyle: "solid", cardStyle: "flat", priceStyle: "panel", imageStyle: "paper", showTopBar: true, showFooterLine: true, showPageNumber: true, geometry: "line", shadow: "none" },
};
