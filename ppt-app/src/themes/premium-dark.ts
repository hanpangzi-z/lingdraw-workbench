import type { PresentationTheme } from "./types";

export const premiumDarkTheme: PresentationTheme = {
  id: "premium-dark",
  name: "臻选暗色",
  nameEn: "Premium Dark",
  description: "深炭背景与香槟金点缀，白底商品图保留在独立灰色表面上。",
  isDark: true,
  colors: {
    primary: "#C7A36A", primaryDark: "#0C0D0E", background: "#131516", surface: "#202325", surfaceAlt: "#2A2D2F",
    textPrimary: "#F5F1E8", textSecondary: "#B5B0A7", accent: "#D5B77E", border: "#3C4143", priceBackground: "#24201B",
    imageBackground: "#FFFFFF", onPrimary: "#151310", onPrimaryMuted: "#3C3325", success: "#72A887",
  },
  typography: {
    title: "Microsoft YaHei", body: "Microsoft YaHei", number: "Arial",
    fontFallbacks: { title: ["PingFang SC", "Noto Sans CJK SC", "sans-serif"], body: ["PingFang SC", "Noto Sans CJK SC", "sans-serif"], number: ["Helvetica Neue", "sans-serif"] },
    titleWeight: 600, bodyWeight: 400, letterSpacing: 0.03,
  },
  radius: { card: 2, image: 2, badge: 10 }, border: { width: 0.6, opacity: 0.8 }, spacing: { density: "comfortable", scale: 1.02 },
  decoration: { headerStyle: "solid", cardStyle: "translucent", priceStyle: "panel", imageStyle: "dark-surface", showTopBar: true, showFooterLine: true, showPageNumber: true, geometry: "line", shadow: "0 18px 40px rgba(0, 0, 0, .28)" },
};
