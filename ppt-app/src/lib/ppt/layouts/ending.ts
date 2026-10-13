import { slideLayout } from "@/src/config/slideLayout";
import { getProjectDisplayName } from "@/src/lib/catalog/project";
import { getEffectiveBrand } from "@/src/render/context";
import { addCanvasShape, addCanvasText } from "../helpers";
import type { LayoutContext } from "../types";

export function addEndingSlide(context: LayoutContext) {
  const { pptx, slide, theme, meta, totalSlides } = context;
  const localStyle = context.currentSlide.editor?.styleOverrides;
  const copyParent = [{
    id: "ending.copy",
    box: { x: 0, y: 0, w: slideLayout.width, h: slideLayout.height },
  }];

  slide.background = { color: theme.colors.primaryDark };

  addCanvasShape(context, "ending.accent", pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.16,
    h: slideLayout.height,
    line: { color: theme.colors.accent, transparency: 100 },
    fill: { color: theme.colors.accent },
  });

  addCanvasText(context, "brand.name", getEffectiveBrand(meta), {
    x: 0.62,
    y: 0.48,
    w: 2.8,
    h: 0.26,
    fontFace: theme.fonts.title,
    fontSize: 13,
    bold: true,
    color: theme.colors.onPrimary,
    charSpacing: 1.1,
    margin: 0,
  }, copyParent);
  addCanvasText(context, "ending.edition", meta.edition, {
    x: 9.3,
    y: 0.5,
    w: 3.4,
    h: 0.22,
    fontFace: theme.fonts.number,
    fontSize: 8.5,
    charSpacing: 1.6,
    color: theme.colors.onPrimaryMuted,
    align: "right",
    margin: 0,
  }, copyParent);

  addCanvasText(context, "ending.thanks", "THANK YOU", {
    x: 1.2,
    y: 2,
    w: 10.93,
    h: 0.9,
    fontFace: theme.fonts.number,
    fontSize: 46,
    bold: true,
    color: theme.colors.onPrimary,
    charSpacing: 2,
    align: "center",
    margin: 0,
  }, copyParent);
  addCanvasText(context, "ending.title", context.currentSlide.editor?.customTitle || "感谢浏览", {
    x: 2.3,
    y: 3.3,
    w: 8.73,
    h: 0.55,
    fontFace: theme.fonts.title,
    fontSize: localStyle?.titleFontSize ?? 24,
    bold: (localStyle?.titleFontWeight ?? 500) >= 600,
    color: localStyle?.titleColor?.replace(/^#/, "") || theme.colors.onPrimaryMuted,
    align: localStyle?.textAlign ?? "center",
    margin: 0,
  }, copyParent);
  addCanvasShape(context, "ending.divider", pptx.ShapeType.line, {
    x: 6.1,
    y: 4.14,
    w: 1.13,
    h: 0,
    line: { color: theme.colors.accent, pt: 2.3 },
  }, copyParent);
  addCanvasText(context, "ending.project", `${meta.year} 年${getProjectDisplayName(meta)}`, {
    x: 3,
    y: 4.55,
    w: 7.33,
    h: 0.26,
    fontFace: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.onPrimaryMuted,
    align: "center",
    margin: 0,
  }, copyParent);
  addCanvasText(context, "ending.service", `礼品服务专线  ${meta.serviceLine}`, {
    x: 3,
    y: 4.95,
    w: 7.33,
    h: 0.26,
    fontFace: theme.fonts.body,
    fontSize: 10.5,
    color: theme.colors.onPrimaryMuted,
    align: "center",
    margin: 0,
  }, copyParent);
  addCanvasText(context, "ending.page", `${String(totalSlides).padStart(2, "0")} / ${String(totalSlides).padStart(2, "0")}`, {
    x: 11.5,
    y: 6.75,
    w: 1.2,
    h: 0.2,
    fontFace: theme.fonts.number,
    fontSize: 8,
    color: theme.colors.onPrimaryMuted,
    align: "right",
    margin: 0,
  }, copyParent);
}
