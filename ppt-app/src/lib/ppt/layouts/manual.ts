import { addBusinessHeader, addSlideFooter } from "../helpers";
import type { LayoutContext } from "../types";

export function addManualSlide(context: LayoutContext) {
  if (context.currentSlide.kind !== "manual") return;
  const { pptx, slide, theme, currentSlide } = context;
  const manual = currentSlide.manual;
  const title = currentSlide.editor?.customTitle || manual.data.title || ({ title: "标题页", text: "文字说明", product: "精选商品", category: "商品分类", ending: "感谢浏览" } as const)[manual.type];
  const background = currentSlide.editor?.styleOverrides?.backgroundColor?.replace(/^#/, "") || theme.colors.background;
  const titleColor = currentSlide.editor?.styleOverrides?.titleColor?.replace(/^#/, "") || theme.colors.textPrimary;
  slide.background = { color: background };
  addBusinessHeader(context, title, "MANUAL / CUSTOM");
  slide.addText(manual.data.subtitle || "自定义页面", {
    x: 0.82, y: 1.55, w: 4.2, h: 0.3, fontFace: theme.fonts.number, fontSize: 10, color: theme.colors.accent, charSpacing: 1.2, margin: 0,
  });
  slide.addText(title, {
    x: 0.82, y: 2.02, w: 7.8, h: 0.9, fontFace: theme.fonts.title,
    fontSize: currentSlide.editor?.styleOverrides?.titleFontSize ?? 34,
    bold: (currentSlide.editor?.styleOverrides?.titleFontWeight ?? 700) >= 600,
    color: titleColor, margin: 0, fit: "shrink",
    align: currentSlide.editor?.styleOverrides?.textAlign ?? "left",
  });
  slide.addShape(pptx.ShapeType.line, { x: 0.82, y: 3.18, w: 1.05, h: 0, line: { color: theme.colors.accent, pt: 2 } });
  slide.addText(manual.data.body || "在编辑器右侧属性面板编辑本页标题与正文。", {
    x: 0.82, y: 3.62, w: 8.4, h: 1.8, fontFace: theme.fonts.body, fontSize: 18, color: theme.colors.textSecondary, margin: 0, breakLine: false, fit: "shrink", valign: "top",
  });
  slide.addText(manual.type.toUpperCase(), { x: 10.3, y: 5.4, w: 2.1, h: 0.58, fontFace: theme.fonts.number, fontSize: 22, bold: true, color: theme.colors.border, align: "right", margin: 0 });
  addSlideFooter(context);
}
