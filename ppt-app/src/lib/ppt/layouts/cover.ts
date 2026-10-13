import { slideLayout } from "@/src/config/slideLayout";
import { addCanvasShape, addCanvasText, addImageOrPlaceholder, addSourceNotes, getImageSizingContain, resolveCanvasBox } from "../helpers";
import type { LayoutContext } from "../types";
import { getProjectDisplayName, getTierDividerLabel, getTierDividerProjectLine } from "@/src/lib/catalog/project";
import { getEffectiveBrand, getEffectiveLogo } from "@/src/render/context";

function countCatalogItems(products: LayoutContext["products"]) {
  return products.reduce((total, product) => total + (product.components?.length || 1), 0);
}

function localCoverTitle(context: LayoutContext, fallbackSize: number, fallbackColor: string) {
  const style = context.currentSlide.editor?.styleOverrides;
  return {
    fontSize: Math.max(18, Math.min(58, style?.titleFontSize ?? fallbackSize)),
    bold: (style?.titleFontWeight ?? 700) >= 600,
    color: style?.titleColor?.replace(/^#/, "") || fallbackColor,
    align: style?.textAlign,
  };
}

function addCenteredCoverSlide(context: LayoutContext) {
  const { pptx, slide, theme, meta, products, categories, totalSlides, currentSlide } = context;
  const brand = getEffectiveBrand(meta);
  const logo = getEffectiveLogo(meta);
  const itemCount = countCatalogItems(products);
  slide.background = { color: theme.colors.background };
  slide.addShape(pptx.ShapeType.line, { x: 0.58, y: 0.5, w: 12.16, h: 0, line: { color: theme.colors.border, pt: 0.7 } });
  slide.addText(brand, { x: 0.58, y: 0.18, w: 2.3, h: 0.24, fontFace: theme.fonts.title, fontSize: 13, bold: true, color: theme.colors.textPrimary, margin: 0 });
  if (logo && context.assets.get(logo)) slide.addImage(getImageSizingContain(context.assets.get(logo)!, { x: 0.58, y: 0.08, w: 0.28, h: 0.28 }));
  slide.addText(meta.edition, { x: 4.2, y: 0.78, w: 4.93, h: 0.2, fontFace: theme.fonts.number, fontSize: 8, color: theme.colors.textSecondary, charSpacing: 1.5, align: "center", margin: 0 });
  slide.addText(`${meta.year} 年${getProjectDisplayName(meta)}`, { x: 2.2, y: 1.15, w: 8.93, h: 0.42, fontFace: theme.fonts.title, fontSize: 22, color: theme.colors.textPrimary, align: "center", margin: 0 });
  slide.addText(currentSlide.editor?.customTitle || meta.title, { x: 1.3, y: 1.62, w: 10.73, h: 0.78, fontFace: theme.fonts.title, ...localCoverTitle(context, 34, theme.colors.textPrimary), align: currentSlide.editor?.styleOverrides?.textAlign ?? "center", fit: "shrink", valign: "middle", margin: 0 });
  slide.addShape(pptx.ShapeType.line, { x: 6.12, y: 2.55, w: 1.1, h: 0, line: { color: theme.colors.accent, pt: 2.4 } });
  slide.addText(`${products.length} 款套餐 · 一价任选 · ¥${meta.priceTier}`, { x: 3.6, y: 2.75, w: 6.13, h: 0.3, fontFace: theme.fonts.body, fontSize: 13, color: theme.colors.textSecondary, align: "center", margin: 0 });
  const coverCategories = [categories[0], categories[Math.floor(categories.length / 2)], categories.at(-1)].filter(Boolean);
  coverCategories.forEach((category, index) => addImageOrPlaceholder(context, category?.coverImage, { x: 0.58 + index * 4.14, y: 3.35, w: 3.95, h: 2.82 }, "crop"));
  slide.addText(`${products.length} 款套餐  ·  ${itemCount} 个商品`, { x: 0.58, y: 6.48, w: 3.2, h: 0.24, fontFace: theme.fonts.number, fontSize: 10, color: theme.colors.textPrimary, margin: 0 });
  slide.addText(`PROJECT CATALOG  ·  ${String(currentSlide.pageNumber).padStart(2, "0")} / ${String(totalSlides).padStart(2, "0")}`, { x: 9.1, y: 6.48, w: 3.62, h: 0.24, fontFace: theme.fonts.number, fontSize: 8, color: theme.colors.textSecondary, align: "right", charSpacing: 1, margin: 0 });
  addSourceNotes(slide, [...coverCategories.map((category) => category?.coverImage), logo]);
}

function addCollageCoverSlide(context: LayoutContext) {
  const { pptx, slide, theme, meta, products, categories, totalSlides, currentSlide } = context;
  const brand = getEffectiveBrand(meta);
  const logo = getEffectiveLogo(meta);
  const itemCount = countCatalogItems(products);
  slide.background = { color: theme.colors.background };
  slide.addText(brand, { x: 0.62, y: 0.52, w: 2.4, h: 0.3, fontFace: theme.fonts.title, fontSize: 15, bold: true, color: theme.colors.textPrimary, margin: 0 });
  if (logo && context.assets.get(logo)) slide.addImage(getImageSizingContain(context.assets.get(logo)!, { x: 0.62, y: 0.16, w: 0.32, h: 0.32 }));
  slide.addText(meta.edition, { x: 0.62, y: 1.34, w: 3.2, h: 0.2, fontFace: theme.fonts.number, fontSize: 8, color: theme.colors.textSecondary, charSpacing: 1.4, margin: 0 });
  slide.addText(`${meta.year} · ${meta.tierName}`, { x: 0.62, y: 1.8, w: 3.6, h: 0.36, fontFace: theme.fonts.title, fontSize: 20, color: theme.colors.accent, margin: 0 });
  slide.addText(currentSlide.editor?.customTitle || meta.title, { x: 0.62, y: 2.26, w: 4.25, h: 1.25, fontFace: theme.fonts.title, ...localCoverTitle(context, 31, theme.colors.textPrimary), fit: "shrink", valign: "middle", margin: 0 });
  slide.addText(`${products.length}`, { x: 0.62, y: 4.05, w: 1.65, h: 1.08, fontFace: theme.fonts.number, fontSize: 58, bold: true, color: theme.colors.accent, margin: 0 });
  slide.addText("款套餐，一价任选", { x: 2.3, y: 4.5, w: 2.5, h: 0.35, fontFace: theme.fonts.title, fontSize: 15, color: theme.colors.textPrimary, margin: 0 });
  slide.addText(`¥${meta.priceTier}  ·  ${itemCount} 个商品`, { x: 0.62, y: 5.45, w: 3.5, h: 0.32, fontFace: theme.fonts.number, fontSize: 14, color: theme.colors.textSecondary, margin: 0 });
  const collage = [categories[0], categories[1], categories[2]].filter(Boolean);
  addImageOrPlaceholder(context, collage[0]?.coverImage, { x: 5.65, y: 0, w: 4.45, h: 7.5 }, "crop");
  addImageOrPlaceholder(context, collage[1]?.coverImage, { x: 10.1, y: 0, w: 3.233, h: 3.75 }, "crop");
  addImageOrPlaceholder(context, collage[2]?.coverImage, { x: 10.1, y: 3.75, w: 3.233, h: 3.75 }, "crop");
  slide.addText(`${String(currentSlide.pageNumber).padStart(2, "0")} / ${String(totalSlides).padStart(2, "0")}`, { x: 0.62, y: 6.72, w: 1.3, h: 0.2, fontFace: theme.fonts.number, fontSize: 8, color: theme.colors.textSecondary, margin: 0 });
  addSourceNotes(slide, [...collage.map((category) => category?.coverImage), logo]);
}

function addTierDividerCoverSlide(context: LayoutContext) {
  const { pptx, slide, theme, meta, products, currentSlide } = context;
  const layout = slideLayout.coverDivider;
  const bandParent = [{ id: "cover.left", box: { x: 0, y: layout.bandY, w: slideLayout.width, h: layout.bandHeight } }];
  const introParent = [{ id: "cover.visual", box: { x: 0, y: 0, w: slideLayout.width, h: layout.bandY } }];
  const metaParent = [{ id: "cover.meta", box: { x: 0, y: layout.bandY + layout.bandHeight, w: slideLayout.width, h: slideLayout.height - layout.bandY - layout.bandHeight } }];

  slide.background = { color: theme.colors.background };
  addCanvasShape(context, "cover.left", pptx.ShapeType.rect, {
    x: 0,
    y: layout.bandY,
    w: slideLayout.width,
    h: layout.bandHeight,
    line: { color: theme.colors.primary, transparency: 100 },
    fill: { color: theme.colors.primary },
  });
  addCanvasShape(context, "cover.topbar", pptx.ShapeType.rect, {
    x: layout.paddingX,
    y: layout.brandY,
    w: layout.brandAccentWidth,
    h: layout.brandAccentHeight,
    line: { color: theme.colors.accent, transparency: 100 },
    fill: { color: theme.colors.accent },
  }, introParent);
  addCanvasText(context, "brand.name", getEffectiveBrand(meta), {
    x: layout.paddingX + layout.brandAccentWidth + 0.12,
    y: layout.brandY - 0.01,
    w: 2.3,
    h: 0.3,
    fontFace: theme.fonts.title,
    fontSize: 15,
    bold: true,
    charSpacing: 0.8,
    color: theme.colors.textPrimary,
    margin: 0,
  }, introParent);
  addCanvasText(context, "cover.project", getTierDividerProjectLine(meta), {
    x: layout.paddingX,
    y: layout.projectY,
    w: 5.8,
    h: 0.3,
    fontFace: theme.fonts.title,
    fontSize: 13,
    color: theme.colors.textPrimary,
    margin: 0,
    fit: "shrink",
  }, introParent);
  addCanvasText(context, "cover.title", currentSlide.editor?.customTitle || meta.tierName || `${meta.priceTier}元档位`, {
    x: layout.paddingX,
    y: layout.titleY,
    w: 4.6,
    h: 0.55,
    fontFace: theme.fonts.title,
    ...localCoverTitle(context, layout.titleFontSize, theme.colors.onPrimary),
    bold: (currentSlide.editor?.styleOverrides?.titleFontWeight ?? 400) >= 600,
    margin: 0,
    fit: "shrink",
    valign: "middle",
  }, bandParent);
  addCanvasText(context, "cover.subtitle", `${products.length}款套餐 · 一价任选`, {
    x: layout.summaryX,
    y: layout.summaryY,
    w: slideLayout.width - layout.summaryX - layout.paddingX,
    h: 0.32,
    fontFace: theme.fonts.body,
    fontSize: layout.summaryFontSize,
    color: theme.colors.onPrimary,
    align: "right",
    margin: 0,
    fit: "shrink",
  }, bandParent);
  addCanvasText(context, "cover.edition", getTierDividerLabel(meta), {
    x: layout.paddingX,
    y: layout.sectionLabelY,
    w: 2.9,
    h: 0.22,
    fontFace: theme.fonts.number,
    fontSize: 9,
    charSpacing: 0.7,
    color: theme.colors.textPrimary,
    margin: 0,
  }, metaParent);
  addCanvasShape(context, "cover.divider", pptx.ShapeType.line, {
    x: layout.paddingX,
    y: layout.dividerY,
    w: slideLayout.width - layout.paddingX * 2,
    h: 0,
    line: { color: theme.colors.border, pt: 0.8 },
  }, metaParent);
}

export function addCoverSlide(context: LayoutContext) {
  if (context.template.layoutVariants.cover === "left") return addTierDividerCoverSlide(context);
  if (context.template.layoutVariants.cover === "centered") return addCenteredCoverSlide(context);
  if (context.template.layoutVariants.cover === "product-collage") return addCollageCoverSlide(context);
  const { pptx, slide, theme, meta, products, categories, totalSlides, currentSlide } = context;
  const itemCount = countCatalogItems(products);
  slide.background = { color: theme.colors.background };
  const coverLeftParent = [{ id: "cover.left", box: { x: 0, y: 0, w: 5.15, h: slideLayout.height } }];
  const coverVisualParent = [{ id: "cover.visual", box: { x: 5.15, y: 0, w: slideLayout.width - 5.15, h: slideLayout.height } }];

  addCanvasShape(context, "cover.left", pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 5.15,
    h: slideLayout.height,
    line: { color: theme.colors.primary, transparency: 100 },
    fill: { color: theme.colors.primary },
  });
  addCanvasShape(context, "cover.topbar", pptx.ShapeType.rect, {
    x: 5.15,
    y: 0,
    w: slideLayout.width - 5.15,
    h: slideLayout.headerHeight,
    line: { color: theme.colors.primaryDark, transparency: 100 },
    fill: { color: theme.colors.primaryDark },
  });

  slide.addShape(pptx.ShapeType.rect, {
    x: 0.48,
    y: 0.42,
    w: 0.42,
    h: 0.42,
    line: { color: theme.colors.accent, transparency: 100 },
    fill: { color: theme.colors.accent },
  });
  const logoOverride = currentSlide.editor?.elementOverrides?.["brand.logo"]?.image;
  const effectiveLogo = logoOverride?.source ?? getEffectiveLogo(meta);
  const logoAsset = effectiveLogo ? context.assets.get(effectiveLogo) : undefined;
  if (logoAsset) {
    slide.addImage(getImageSizingContain(logoAsset, { x: 0.51, y: 0.45, w: 0.36, h: 0.36 }));
  } else {
    slide.addText(getEffectiveBrand(meta).slice(0, 1), {
      x: 0.48,
      y: 0.49,
      w: 0.42,
      h: 0.2,
      fontFace: theme.fonts.title,
      fontSize: 12,
      bold: true,
      align: "center",
      color: theme.colors.onPrimary,
      margin: 0,
    });
  }
  addCanvasText(context, "brand.name", getEffectiveBrand(meta), {
    x: 1.02,
    y: 0.46,
    w: 1.5,
    h: 0.26,
    fontFace: theme.fonts.title,
    fontSize: 15,
    bold: true,
    color: theme.colors.onPrimary,
    margin: 0,
  }, coverLeftParent);
  addCanvasText(context, "cover.edition", meta.edition, {
    x: 0.48,
    y: 1.55,
    w: 2.4,
    h: 0.22,
    fontFace: theme.fonts.number,
    fontSize: 8.5,
    charSpacing: 1.5,
    color: theme.colors.onPrimaryMuted,
    margin: 0,
  }, coverLeftParent);
  addCanvasText(context, "cover.project", `${meta.year} 年${meta.city}职工乐品`, {
    x: 0.48,
    y: 2.02,
    w: 3.9,
    h: 0.38,
    fontFace: theme.fonts.title,
    fontSize: 21,
    color: theme.colors.onPrimary,
    margin: 0,
  }, coverLeftParent);
  addCanvasText(context, "cover.title", currentSlide.editor?.customTitle || meta.title, {
    x: 0.48,
    y: 2.45,
    w: 4.05,
    h: 1.08,
    fontFace: theme.fonts.title,
    ...localCoverTitle(context, 27, theme.colors.onPrimary),
    margin: 0,
    breakLine: false,
    fit: "shrink",
    valign: "middle",
  }, coverLeftParent);
  addCanvasShape(context, "cover.divider", pptx.ShapeType.line, {
    x: 0.48,
    y: 3.78,
    w: 0.82,
    h: 0,
    line: { color: theme.colors.accent, pt: 2.2 },
  }, coverLeftParent);
  addCanvasText(context, "cover.subtitle", `${products.length} 款套餐 · 一价任选`, {
    x: 0.48,
    y: 4.03,
    w: 2.65,
    h: 0.26,
    fontFace: theme.fonts.body,
    fontSize: 13,
    color: theme.colors.onPrimaryMuted,
    margin: 0,
  }, coverLeftParent);

  addCanvasText(context, "cover.stat.price.label", "价格档位", {
    x: 0.48,
    y: 4.82,
    w: 0.92,
    h: 0.2,
    fontFace: theme.fonts.body,
    fontSize: 8.5,
    color: theme.colors.onPrimaryMuted,
    margin: 0,
  }, coverLeftParent);
  addCanvasText(context, "cover.stat.price.value", `¥${meta.priceTier}`, {
    x: 0.48,
    y: 5.03,
    w: 1.82,
    h: 0.75,
    fontFace: theme.fonts.number,
    fontSize: 44,
    bold: true,
    color: theme.colors.accent,
    margin: 0,
  }, coverLeftParent);
  addCanvasText(context, "cover.stat.products.value", `${products.length}`, {
    x: 2.62,
    y: 5.14,
    w: 0.72,
    h: 0.42,
    fontFace: theme.fonts.number,
    fontSize: 26,
    color: theme.colors.onPrimary,
    margin: 0,
  }, coverLeftParent);
  addCanvasText(context, "cover.stat.products.label", "款套餐", {
    x: 2.64,
    y: 5.61,
    w: 0.8,
    h: 0.18,
    fontFace: theme.fonts.body,
    fontSize: 8,
    color: theme.colors.onPrimaryMuted,
    margin: 0,
  }, coverLeftParent);
  addCanvasText(context, "cover.stat.categories.value", `${itemCount}`, {
    x: 3.55,
    y: 5.14,
    w: 0.55,
    h: 0.42,
    fontFace: theme.fonts.number,
    fontSize: 26,
    color: theme.colors.onPrimary,
    margin: 0,
  }, coverLeftParent);
  addCanvasText(context, "cover.stat.categories.label", "个商品", {
    x: 3.57,
    y: 5.61,
    w: 0.8,
    h: 0.18,
    fontFace: theme.fonts.body,
    fontSize: 8,
    color: theme.colors.onPrimaryMuted,
    margin: 0,
  }, coverLeftParent);

  const coverCategories = [categories[0], categories[3], categories[6]];
  const imageY = 1.08;
  const imageHeight = 4.82;
  const imageWidth = 2.42;
  coverCategories.forEach((category, index) => {
    const x = 5.56 + index * (imageWidth + 0.17);
    const imageId = `cover.image.${category.id}`;
    const imageBox = { x, y: imageY, w: imageWidth, h: imageHeight };
    const imageOverride = currentSlide.editor?.elementOverrides?.[imageId]?.image;
    const editableImageBox = resolveCanvasBox(context, imageId, imageBox, coverVisualParent);
    const imageParents = [...coverVisualParent, { id: imageId, box: imageBox }];
    if (editableImageBox) addImageOrPlaceholder(context, imageOverride?.source ?? category.coverImage, editableImageBox, "crop", true, imageOverride, imageId);
    addCanvasShape(context, `${imageId}.overlay`, pptx.ShapeType.rect, {
      x,
      y: imageY + imageHeight - 0.56,
      w: imageWidth,
      h: 0.56,
      line: { color: theme.colors.primaryDark, transparency: 100 },
      fill: { color: theme.colors.primaryDark, transparency: 12 },
    }, imageParents);
    addCanvasText(context, `cover.caption.${category.id}`, category.name, {
      x: x + 0.16,
      y: imageY + imageHeight - 0.39,
      w: imageWidth - 0.32,
      h: 0.22,
      fontFace: theme.fonts.title,
      fontSize: 12.5,
      bold: true,
      color: theme.colors.onPrimary,
      margin: 0,
    }, imageParents);
  });

  addCanvasText(context, "cover.tier", `${meta.tierName} · ${getProjectDisplayName(meta)}`, {
    x: 5.56,
    y: 6.24,
    w: 5.3,
    h: 0.33,
    fontFace: theme.fonts.title,
    fontSize: 17,
    bold: true,
    color: theme.colors.text,
    margin: 0,
  }, coverVisualParent);
  addCanvasText(context, "cover.page", `项目产品手册  ·  ${String(currentSlide.pageNumber).padStart(2, "0")} / ${String(totalSlides).padStart(2, "0")}`, {
    x: 5.56,
    y: 6.69,
    w: 5.4,
    h: 0.2,
    fontFace: theme.fonts.number,
    fontSize: 8,
    charSpacing: 1.2,
    color: theme.colors.secondaryText,
    margin: 0,
  }, coverVisualParent);

  addSourceNotes(slide, [...coverCategories.map((category) => category.coverImage), effectiveLogo]);
}
