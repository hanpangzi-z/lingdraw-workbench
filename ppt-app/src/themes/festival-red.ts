import type { PresentationTheme } from "./types";

export const festivalRedTheme: PresentationTheme = {
  id: "festival-red",
  name: "节庆红",
  nameEn: "Festival Red",
  description: "更鲜明的节日红与金色印记，适合福利礼品与节庆手册。",
  isDark: false,
  colors: {
    primary: "#C51D28", primaryDark: "#86101A", background: "#FFF8F0", surface: "#FFFFFF", surfaceAlt: "#FCEBDD",
    textPrimary: "#321B18", textSecondary: "#815E57", accent: "#D9A441", border: "#E7C7B6", priceBackground: "#FFF0DF",
    imageBackground: "#FFFFFF", onPrimary: "#FFFFFF", onPrimaryMuted: "#FFD9D2", success: "#397652",
  },
  typography: {
    title: "Microsoft YaHei", body: "Microsoft YaHei", number: "Arial",
    fontFallbacks: { title: ["PingFang SC", "Noto Sans CJK SC", "sans-serif"], body: ["PingFang SC", "Noto Sans CJK SC", "sans-serif"], number: ["Helvetica Neue", "sans-serif"] },
    titleWeight: 700, bodyWeight: 400, letterSpacing: 0,
  },
  radius: { card: 4, image: 3, badge: 20 }, border: { width: 0.8, opacity: 0.85 }, spacing: { density: "comfortable", scale: 1 },
  decoration: { headerStyle: "ornamental", cardStyle: "elevated", priceStyle: "badge", imageStyle: "paper", showTopBar: true, showFooterLine: false, showPageNumber: true, geometry: "seal", shadow: "0 14px 36px rgba(135, 16, 26, .12)" },
};
