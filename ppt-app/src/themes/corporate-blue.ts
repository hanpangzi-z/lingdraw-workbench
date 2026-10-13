import type { PresentationTheme } from "./types";

export const corporateBlueTheme: PresentationTheme = {
  id: "corporate-blue",
  name: "企业蓝",
  nameEn: "Corporate Blue",
  description: "沉稳蓝灰配色，适合企业采购与内部汇报。",
  isDark: false,
  colors: {
    primary: "#184E77", primaryDark: "#103752", background: "#F3F6F8", surface: "#FFFFFF", surfaceAlt: "#E8EFF4",
    textPrimary: "#17222B", textSecondary: "#60717E", accent: "#4BA3C7", border: "#C8D5DE", priceBackground: "#E8F2F7",
    imageBackground: "#FFFFFF", onPrimary: "#FFFFFF", onPrimaryMuted: "#D9EDF5", success: "#28735A",
  },
  typography: {
    title: "Microsoft YaHei", body: "Microsoft YaHei", number: "Arial",
    fontFallbacks: { title: ["PingFang SC", "Noto Sans CJK SC", "sans-serif"], body: ["PingFang SC", "Noto Sans CJK SC", "sans-serif"], number: ["Helvetica Neue", "sans-serif"] },
    titleWeight: 700, bodyWeight: 400, letterSpacing: 0,
  },
  radius: { card: 4, image: 2, badge: 10 }, border: { width: 0.7, opacity: 0.9 }, spacing: { density: "comfortable", scale: 1 },
  decoration: { headerStyle: "solid", cardStyle: "flat", priceStyle: "panel", imageStyle: "tinted", showTopBar: true, showFooterLine: true, showPageNumber: true, geometry: "line", shadow: "0 10px 28px rgba(21, 58, 82, .08)" },
};
