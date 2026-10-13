import { slideLayout } from "@/src/config/slideLayout";
import { getProductImages } from "@/src/lib/catalog/images";
import { numericPriceTier } from "@/src/lib/catalog/project";
import { formatPackageSequence } from "@/src/lib/catalog/numbering";
import type { LayoutBox, ProductCardVariant, ProductLayoutConfig } from "@/src/lib/layout/layouts/configTypes";
import type { ProductAnalysis } from "@/src/lib/layout/types";
import type { Product } from "@/types/catalog";
import { isSectionHidden } from "@/types/editor";
import { addBusinessHeader, addCanvasShape, addCanvasText, addImageOrPlaceholder, addSlideFooter, addSourceNotes, resolveCanvasBox, type CanvasParentBox } from "../helpers";
import type { ImageBox, LayoutContext } from "../types";

function getProductVisualVariant(context: LayoutContext) {
  return context.currentSlide.kind === "products"
    ? context.template.layoutVariants.product[context.currentSlide.plan.type]
    : "grid3-card";
}

function textSizes(variant: ProductCardVariant, analysis?: ProductAnalysis) {
  const density = analysis?.density ?? "medium";
  const single = ["feature", "package", "image-focus"].includes(variant);
  const wide = variant === "grid-2" || variant === "grid-2-row" || variant === "mixed-primary";
  const title = single
    ? ({ low: 26, medium: 23, high: 19, "very-high": 16 } as const)[density]
    : wide
      ? ({ low: 20, medium: 18, high: 15, "very-high": 13 } as const)[density]
      : ({ low: 17.5, medium: 16, high: 13, "very-high": 11 } as const)[density];
  const body = single
    ? ({ low: 12, medium: 11.5, high: 10.5, "very-high": 9.5 } as const)[density]
    : wide
      ? ({ low: 11, medium: 10.5, high: 9.8, "very-high": 9.2 } as const)[density]
      : ({ low: 10, medium: 9.8, high: 9.3, "very-high": 9 } as const)[density];
  return { title, body, line: body * 1.24 };
}

function getEditableProductDetails(context: LayoutContext, product: Product) {
  const overrides = context.currentSlide.editor?.elementOverrides;
  return product.details
    .map((detail, index) => ({ detail, override: overrides?.[`product.${product.id}.detail.${index}`] }))
    .filter(({ override }) => !override?.hidden)
    .map(({ detail, override }) => `• ${override?.text ?? detail}`)
    .join("\n");
}

function getEditableComponentGroups(context: LayoutContext, product: Product) {
  const overrides = context.currentSlide.editor?.elementOverrides;
  let detailOffset = 0;
  return (product.components ?? []).map((component, componentIndex) => {
    const titleOverride = overrides?.[`product.${product.id}.component.${componentIndex}.title`];
    const details = component.details.map((detail, localIndex) => {
      const detailIndex = detailOffset + localIndex;
      const override = overrides?.[`product.${product.id}.detail.${detailIndex}`];
      return { detailIndex, text: override?.text ?? detail, hidden: override?.hidden };
    }).filter((detail) => !detail.hidden);
    detailOffset += component.details.length;
    return {
      componentIndex,
      title: titleOverride?.text ?? component.name,
      titleHidden: titleOverride?.hidden,
      details,
    };
  }).filter((group) => (!group.titleHidden && group.title) || group.details.length);
}

function isSingleVariant(variant: ProductCardVariant) {
  return ["feature", "package", "image-focus"].includes(variant);
}

function componentColumnCount(count: number, variant: ProductCardVariant) {
  if (count <= 1) return 1;
  if (variant === "grid-2-row") return Math.min(3, count);
  return 2;
}

function textUnits(value: string) {
  return [...value].reduce((total, character) => {
    if (/\s/.test(character)) return total + 0.3;
    if (/[\u2e80-\u9fff\uf900-\ufaff\uff01-\uff60]/.test(character)) return total + 1;
    return total + 0.58;
  }, 0);
}

function estimateTextLines(value: string, widthInches: number, fontSize: number) {
  const capacity = Math.max(1, widthInches * 72 / fontSize);
  return Math.max(1, value.split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(textUnits(line) / capacity)), 0));
}

function estimatePptLines(value: string, widthInches: number, fontSize: number) {
  // PowerPoint's mixed Chinese/Latin wrapping is slightly wider than browser
  // shaping on both macOS and Windows. Reserve enough height so a wrapped line
  // never collides with the next editable text box.
  return estimateTextLines(value, widthInches, fontSize * 1.14);
}

function getCardEyebrow(context: LayoutContext, product: Product, categoryName?: string) {
  const edit = context.currentSlide.kind === "products" ? context.currentSlide.editor : undefined;
  if (!context.template.showProductIdentifiers) {
    return isSectionHidden(edit, product.id, "number")
      ? undefined
      : { id: `product.${product.id}.sequence`, text: formatPackageSequence(product.productNumber) };
  }
  if (isSectionHidden(edit, product.id, "sku")) return undefined;
  const category = isSectionHidden(edit, product.id, "category") ? "" : ` · ${categoryName ?? "未分类"}`;
  return { id: `product.${product.id}.sku`, text: `${product.sku}${category}` };
}

function addProductContentBackground(context: LayoutContext, product: Product, box: ImageBox, cardBox: LayoutBox) {
  const cardId = `product.${product.id}.card`;
  addCanvasShape(context, `product.${product.id}.content`, context.pptx.ShapeType.rect, {
    ...box,
    line: { color: context.theme.colors.background, transparency: 100 },
    fill: { color: context.theme.colors.background },
  }, [{ id: cardId, box: cardBox }]);
}

function addProductDetails(context: LayoutContext, product: Product, box: ImageBox, sizes: ReturnType<typeof textSizes>, variant: ProductCardVariant, cardParent: CanvasParentBox[]) {
  const groups = getEditableComponentGroups(context, product);
  if (!groups.length) {
    addCanvasText(context, `product.${product.id}.details`, getEditableProductDetails(context, product), {
      ...box,
      fontFace: context.theme.fonts.body,
      fontSize: sizes.body,
      lineSpacing: sizes.line,
      color: context.theme.colors.secondaryText,
      margin: 0,
      fit: "shrink",
      valign: "top",
      breakLine: false,
    }, cardParent);
    return;
  }

  const single = isSingleVariant(variant);
  const singleLayout = slideLayout.adaptiveProduct.single;
  const columns = componentColumnCount(groups.length, variant);
  const rows = Math.ceil(groups.length / columns);
  const columnGap = single ? singleLayout.componentColumnGap : columns === 3 ? 0.16 : 0.22;
  const rowGap = single ? singleLayout.componentRowGap : 0.16;
  const cellWidth = (box.w - columnGap * (columns - 1)) / columns;
  const fallbackCellHeight = (box.h - rowGap * (rows - 1)) / rows;
  // PowerPoint's Chinese font metrics are wider than the browser's at the same
  // nominal size, so a small optical correction keeps mixed Chinese/English
  // component titles on the same number of lines as the preview.
  const componentFontSize = single ? sizes.body * 1.02 : Math.max(9, sizes.body + 1);
  const componentLineSpacing = componentFontSize * 1.24;
  const titleGap = single ? singleLayout.componentTitleMarginBottom : 0.05;
  const itemGap = single ? singleLayout.componentItemGap : 0;
  const bulletSize = 0.035;
  const bulletIndent = 0.09;
  const detailWidth = Math.max(0.2, cellWidth - bulletIndent);
  const estimatedHeights = groups.map((group) => {
    const titleLines = !group.titleHidden && group.title ? estimatePptLines(group.title, cellWidth, componentFontSize) : 0;
    const detailLines = group.details.reduce((total, detail) => total + estimatePptLines(detail.text, detailWidth, sizes.body), 0);
    const titleHeight = titleLines * componentLineSpacing / 72;
    const detailsHeight = detailLines * sizes.line / 72 + group.details.length * 0.01 + Math.max(0, group.details.length - 1) * itemGap;
    return { titleHeight, detailsHeight, total: titleHeight + (titleLines && detailLines ? titleGap : 0) + detailsHeight };
  });
  const rowOffsets = Array.from({ length: rows }, () => 0);
  for (let row = 1; row < rows; row += 1) {
    const previousStart = (row - 1) * columns;
    const previousHeight = Math.max(...estimatedHeights.slice(previousStart, previousStart + columns).map((item) => item.total), 0);
    rowOffsets[row] = rowOffsets[row - 1] + previousHeight + rowGap;
  }
  groups.forEach((group, index) => {
    const x = box.x + (index % columns) * (cellWidth + columnGap);
    const row = Math.floor(index / columns);
    const y = single ? box.y + rowOffsets[row] : box.y + row * (fallbackCellHeight + rowGap);
    const availableHeight = single ? Math.max(0.15, box.h - rowOffsets[row]) : fallbackCellHeight;
    const titleHeight = single
      ? Math.min(availableHeight, Math.max(0.12, estimatedHeights[index].titleHeight + 0.015))
      : Math.min(0.46, Math.max(0.26, fallbackCellHeight * 0.24));
    if (!group.titleHidden && group.title) addCanvasText(context, `product.${product.id}.component.${group.componentIndex}.title`, group.title, {
      x,
      y,
      w: cellWidth,
      h: titleHeight,
      fontFace: context.theme.fonts.title,
      fontSize: componentFontSize,
      lineSpacing: componentLineSpacing,
      bold: false,
      color: context.theme.colors.text,
      margin: 0,
      fit: "shrink",
      valign: "top",
    }, cardParent);
    let detailY = y + titleHeight + (group.titleHidden || !group.title ? 0 : titleGap);
    group.details.forEach((detail) => {
      const detailHeight = estimatePptLines(detail.text, detailWidth, sizes.body) * sizes.line / 72 + 0.01;
      addCanvasShape(context, `product.${product.id}.detail.${detail.detailIndex}.bullet`, context.pptx.ShapeType.ellipse, {
        x,
        y: detailY + Math.max(0.02, (sizes.line / 72 - bulletSize) * 0.42),
        w: bulletSize,
        h: bulletSize,
        line: { color: context.theme.colors.primary, transparency: 100 },
        fill: { color: context.theme.colors.primary },
      }, cardParent);
      addCanvasText(context, `product.${product.id}.detail.${detail.detailIndex}`, detail.text, {
        x: x + bulletIndent,
        y: detailY,
        w: detailWidth,
        h: detailHeight,
        fontFace: context.theme.fonts.body,
        fontSize: sizes.body,
        lineSpacing: sizes.line,
        color: context.theme.colors.secondaryText,
        margin: 0,
        fit: "shrink",
        valign: "top",
      }, cardParent);
      detailY += detailHeight + itemGap;
    });
  });
}

function addImageGrid(context: LayoutContext, product: Product, box: ImageBox, cardBox: LayoutBox, allowUpscale = false) {
  const elementId = `product.${product.id}.image`;
  const imageOverride = context.currentSlide.kind === "products"
    ? context.currentSlide.editor?.elementOverrides?.[elementId]?.image ?? context.currentSlide.editor?.imageOverrides?.[product.id]
    : undefined;
  const sources = imageOverride?.source ? [imageOverride.source] : getProductImages(product);
  const editableBox = resolveCanvasBox(context, elementId, box, [{ id: `product.${product.id}.card`, box: cardBox }]);
  if (!editableBox) return;
  if (!sources.length) {
    addImageOrPlaceholder(context, undefined, editableBox, "contain", allowUpscale, imageOverride, elementId);
    return;
  }
  const columns = sources.length === 4 ? 2 : Math.min(3, sources.length);
  const rows = Math.ceil(sources.length / columns);
  const gap = 0.04;
  const w = (editableBox.w - gap * (columns - 1)) / columns;
  const h = (editableBox.h - gap * (rows - 1)) / rows;
  sources.forEach((source, index) => addImageOrPlaceholder(context, source, {
    x: editableBox.x + (index % columns) * (w + gap),
    y: editableBox.y + Math.floor(index / columns) * (h + gap),
    w,
    h,
  }, "contain", allowUpscale, imageOverride, `${elementId}.${index}`));
}

function addCardShell(context: LayoutContext, product: Product, box: LayoutBox) {
  const { pptx, slide, theme } = context;
  const visual = getProductVisualVariant(context);
  const minimal = visual === "minimal";
  const imageHeavy = visual === "image-heavy";
  const barFill = minimal ? theme.colors.surface : imageHeavy ? theme.colors.surfaceAlt : theme.colors.primary;
  const barText = minimal || imageHeavy ? theme.colors.textPrimary : theme.colors.onPrimary;
  const barMuted = minimal || imageHeavy ? theme.colors.textSecondary : theme.colors.onPrimaryMuted;
  const barHeight = 0.42;
  const cardId = `product.${product.id}.card`;
  const cardParent: CanvasParentBox[] = [{ id: cardId, box }];
  addCanvasShape(context, cardId, pptx.ShapeType.rect, { x: box.x, y: box.y, w: box.w, h: box.h, line: { color: theme.colors.border, pt: theme.border.width, transparency: minimal ? 100 : 0 }, fill: { color: theme.colors.card } });
  if (!context.template.showProductIdentifiers) return 0;
  addCanvasShape(context, `product.${product.id}.bar`, pptx.ShapeType.rect, { x: box.x, y: box.y, w: box.w, h: barHeight, line: { color: minimal ? theme.colors.border : barFill, transparency: minimal ? 0 : 100, pt: 0.5 }, fill: { color: barFill, transparency: minimal ? 100 : 0 } }, cardParent);
  const edit = context.currentSlide.kind === "products" ? context.currentSlide.editor : undefined;
  if (!isSectionHidden(edit, product.id, "number")) addCanvasText(context, `product.${product.id}.number`, `NO.${product.productNumber}`, { x: box.x + 0.15, y: box.y + 0.11, w: 0.75, h: 0.18, fontFace: theme.fonts.number, fontSize: 9, bold: true, color: barText, margin: 0 }, cardParent);
  addCanvasText(context, `product.${product.id}.packageCode`, `套餐编号 ${product.packageCode}`, { x: box.x + Math.min(1.02, box.w * 0.35), y: box.y + 0.11, w: Math.max(0.8, box.w - Math.min(1.18, box.w * 0.4)), h: 0.18, fontFace: theme.fonts.body, fontSize: 7.5, align: "right", color: barMuted, margin: 0, fit: "shrink" }, cardParent);
  return barHeight;
}

function addPriceArea(context: LayoutContext, product: Product, box: ImageBox, cardBox: LayoutBox, variant: ProductCardVariant, large = false) {
  const { pptx, slide, theme } = context;
  const edit = context.currentSlide.kind === "products" ? context.currentSlide.editor : undefined;
  const hideMarket = isSectionHidden(edit, product.id, "marketPrice");
  const hideSale = isSectionHidden(edit, product.id, "salePrice");
  if (hideMarket && hideSale) return;
  const single = isSingleVariant(variant);
  const priceFill = theme.colors.priceArea;
  const cardId = `product.${product.id}.card`;
  const priceId = `product.${product.id}.prices`;
  const priceParents: CanvasParentBox[] = [{ id: cardId, box: cardBox }];
  addCanvasShape(context, priceId, pptx.ShapeType.rect, { ...box, line: { color: theme.colors.primary, transparency: 100, pt: 0.5 }, fill: { color: priceFill } }, priceParents);
  const textParents = [...priceParents, { id: priceId, box }];
  if (box.w < 2.2) {
    if (!hideMarket) addCanvasText(context, `product.${product.id}.marketValue`, `市场价 ${product.price.market === undefined ? "—" : `¥${product.price.market}`}`, { x: box.x + 0.08, y: box.y + (hideSale ? box.h * 0.38 : 0.16), w: box.w - 0.16, h: 0.22, fontFace: theme.fonts.body, fontSize: 7.5, align: "center", color: theme.colors.secondaryText, margin: 0, fit: "shrink" }, textParents);
    if (!hideSale) {
      addCanvasText(context, `product.${product.id}.saleLabel`, "组合价", { x: box.x + 0.08, y: box.y + (hideMarket ? box.h * 0.2 : box.h * 0.46), w: box.w - 0.16, h: 0.2, fontFace: theme.fonts.body, fontSize: 8, bold: true, align: "center", color: theme.colors.primary, margin: 0 }, textParents);
      addCanvasText(context, `product.${product.id}.saleValue`, product.price.package === undefined ? "—" : `¥${product.price.package}`, { x: box.x + 0.08, y: box.y + (hideMarket ? box.h * 0.38 : box.h * 0.54), w: box.w - 0.16, h: Math.max(0.32, box.h * 0.32), fontFace: theme.fonts.number, fontSize: 18, bold: true, align: "center", color: theme.colors.primary, margin: 0, fit: "shrink" }, textParents);
    }
    return;
  }
  if (single) {
    const token = slideLayout.adaptiveProduct.single;
    const marketBlockHeight = 0.2;
    const saleBlockHeight = 0.38;
    const marketY = box.y + Math.max(0.04, (box.h - marketBlockHeight) / 2);
    const saleY = box.y + Math.max(0.04, (box.h - saleBlockHeight) / 2);
    if (!hideMarket) {
      addCanvasText(context, `product.${product.id}.marketLabel`, "市场价", { x: box.x + token.pricePaddingX, y: marketY, w: 0.75, h: 0.08, fontFace: theme.fonts.body, fontSize: token.priceLabelFontSize, color: theme.colors.secondaryText, margin: 0 }, textParents);
      addCanvasText(context, `product.${product.id}.marketValue`, product.price.market === undefined ? "—" : `¥${product.price.market}`, { x: box.x + token.pricePaddingX, y: marketY + 0.095, w: 1.25, h: 0.12, fontFace: theme.fonts.number, fontSize: token.marketValueFontSize, strike: product.price.market !== undefined, color: theme.colors.secondaryText, margin: 0 }, textParents);
    }
    if (!hideSale) {
      addCanvasText(context, `product.${product.id}.saleLabel`, "组合价", { x: box.x + box.w - token.pricePaddingX - 1.42, y: saleY, w: 1.42, h: 0.08, fontFace: theme.fonts.body, fontSize: token.priceLabelFontSize, bold: true, align: "right", color: theme.colors.primary, margin: 0 }, textParents);
      addCanvasText(context, `product.${product.id}.saleValue`, product.price.package === undefined ? "—" : `¥${product.price.package}`, { x: box.x + box.w - token.pricePaddingX - 1.82, y: saleY + 0.08, w: 1.82, h: 0.31, fontFace: theme.fonts.title, fontSize: token.saleValueFontSize, bold: true, align: "right", color: theme.colors.primary, margin: 0, fit: "shrink" }, textParents);
    }
    return;
  }
  if (!hideMarket) {
    addCanvasText(context, `product.${product.id}.marketLabel`, "市场价", { x: box.x + 0.2, y: box.y + 0.09, w: 0.75, h: 0.17, fontFace: theme.fonts.body, fontSize: 8, color: theme.colors.secondaryText, margin: 0 }, textParents);
    addCanvasText(context, `product.${product.id}.marketValue`, product.price.market === undefined ? "—" : `¥${product.price.market}`, { x: box.x + 0.2, y: box.y + 0.29, w: 1.25, h: 0.26, fontFace: theme.fonts.number, fontSize: large ? 14 : 12, strike: product.price.market !== undefined, color: theme.colors.secondaryText, margin: 0 }, textParents);
  }
  if (!hideSale) {
    addCanvasText(context, `product.${product.id}.saleLabel`, "组合价", { x: box.x + box.w - 1.65, y: box.y + 0.08, w: 1.42, h: 0.17, fontFace: theme.fonts.body, fontSize: 8, bold: true, align: "right", color: theme.colors.primary, margin: 0 }, textParents);
    addCanvasText(context, `product.${product.id}.saleValue`, product.price.package === undefined ? "—" : `¥${product.price.package}`, { x: box.x + box.w - 2.05, y: box.y + 0.23, w: 1.82, h: Math.max(0.34, box.h - 0.25), fontFace: theme.fonts.number, fontSize: large ? 27 : 22, bold: true, align: "right", color: theme.colors.primary, margin: 0, fit: "shrink" }, textParents);
  }
}

function addVerticalCard(context: LayoutContext, product: Product, analysis: ProductAnalysis | undefined, box: LayoutBox) {
  const { slide, theme, categories } = context;
  const barHeight = addCardShell(context, product, box);
  const wide = box.variant === "grid-2" || box.variant === "mixed-primary";
  const imageHeavy = getProductVisualVariant(context) === "image-heavy";
  const imageHeight = wide ? (imageHeavy ? 2.64 : 2.48) : (imageHeavy ? 2.5 : 2.28);
  const edit = context.currentSlide.kind === "products" ? context.currentSlide.editor : undefined;
  const priceHeight = isSectionHidden(edit, product.id, "marketPrice") && isSectionHidden(edit, product.id, "salePrice") ? 0 : wide ? 0.72 : 0.62;
  const pad = wide ? 0.28 : 0.22;
  const imageY = box.y + barHeight;
  const priceY = box.y + box.h - priceHeight;
  const sizes = textSizes(box.variant, analysis);
  const category = categories.find((item) => item.id === product.categoryId);
  const cardParent: CanvasParentBox[] = [{ id: `product.${product.id}.card`, box }];
  addImageGrid(context, product, { x: box.x, y: imageY, w: box.w, h: imageHeight }, box);
  addProductContentBackground(context, product, { x: box.x, y: imageY + imageHeight, w: box.w, h: Math.max(0, priceY - imageY - imageHeight) }, box);
  const eyebrow = getCardEyebrow(context, product, category?.name);
  if (eyebrow) addCanvasText(context, eyebrow.id, eyebrow.text, { x: box.x + pad, y: imageY + imageHeight + 0.12, w: box.w - pad * 2, h: 0.18, fontFace: theme.fonts.number, fontSize: 7.5, bold: true, color: theme.colors.primary, charSpacing: 0.6, margin: 0, fit: "shrink" }, cardParent);
  const titleY = imageY + imageHeight + (eyebrow ? 0.36 : 0.14);
  const titleHeight = wide ? 0.56 : 0.5;
  addCanvasText(context, `product.${product.id}.title`, product.name, { x: box.x + pad, y: titleY, w: box.w - pad * 2, h: titleHeight, fontFace: theme.fonts.title, fontSize: sizes.title, bold: false, color: theme.colors.text, margin: 0, fit: "shrink", valign: "middle" }, cardParent);
  const detailsY = titleY + titleHeight + 0.16;
  if (!isSectionHidden(edit, product.id, "details")) addProductDetails(context, product, { x: box.x + pad, y: detailsY, w: box.w - pad * 2, h: Math.max(0.65, priceY - detailsY - 0.12) }, sizes, box.variant, cardParent);
  if (priceHeight > 0) addPriceArea(context, product, { x: box.x, y: priceY, w: box.w, h: priceHeight }, box, box.variant, wide);
}

function addHorizontalCard(context: LayoutContext, product: Product, analysis: ProductAnalysis | undefined, box: LayoutBox) {
  const { slide, theme, categories } = context;
  const barHeight = addCardShell(context, product, box);
  const imageHeavy = getProductVisualVariant(context) === "image-heavy";
  const row2 = box.variant === "grid-2-row";
  const ratio = row2 ? 0.3 : box.variant === "image-focus" ? 0.63 : box.variant === "package" ? (imageHeavy ? 0.45 : 0.35) : box.variant === "mixed-secondary" ? 0.34 : (imageHeavy ? 0.56 : 0.48);
  const imageWidth = box.w * ratio;
  const rightX = box.x + imageWidth;
  const rightW = box.w - imageWidth;
  const compact = box.variant === "mixed-secondary" || row2;
  const single = isSingleVariant(box.variant);
  const edit = context.currentSlide.kind === "products" ? context.currentSlide.editor : undefined;
  const hidePrices = isSectionHidden(edit, product.id, "marketPrice") && isSectionHidden(edit, product.id, "salePrice");
  const priceHeight = hidePrices ? 0 : compact ? box.h - barHeight : 0.82;
  const contentPad = single ? slideLayout.adaptiveProduct.single.contentPaddingX : row2 ? 0.2 : compact ? 0.16 : 0.34;
  const priceY = compact ? box.y + barHeight : box.y + box.h - priceHeight;
  const contentRatio = row2 ? 0.76 : 0.66;
  const contentRight = compact && !hidePrices ? rightX + rightW * contentRatio : rightX;
  const contentWidth = compact && !hidePrices ? rightW * contentRatio : rightW;
  const priceX = compact ? contentRight : rightX;
  const priceW = compact ? rightW - contentWidth : rightW;
  const sizes = textSizes(box.variant, analysis);
  const category = categories.find((item) => item.id === product.categoryId);
  const cardParent: CanvasParentBox[] = [{ id: `product.${product.id}.card`, box }];
  addImageGrid(context, product, { x: box.x, y: box.y + barHeight, w: imageWidth, h: box.h - barHeight }, box, box.variant === "image-focus");
  addProductContentBackground(context, product, {
    x: rightX,
    y: box.y + barHeight,
    w: contentWidth,
    h: Math.max(0, (compact ? box.y + box.h : priceY) - box.y - barHeight),
  }, box);
  const eyebrow = getCardEyebrow(context, product, category?.name);
  const eyebrowY = box.y + barHeight + (single ? slideLayout.adaptiveProduct.single.contentPaddingTop : row2 ? 0.13 : compact ? 0.18 : 0.42);
  const eyebrowHeight = single ? slideLayout.adaptiveProduct.single.sequenceHeight : 0.18;
  if (eyebrow) addCanvasText(context, eyebrow.id, eyebrow.text, { x: rightX + contentPad, y: eyebrowY, w: contentWidth - contentPad * 2, h: eyebrowHeight, fontFace: theme.fonts.number, fontSize: single ? slideLayout.adaptiveProduct.single.sequenceFontSize : row2 ? 8.5 : compact ? 7 : 8, bold: true, color: theme.colors.primary, margin: 0, fit: "shrink" }, cardParent);
  const titleY = single
    ? box.y + barHeight + slideLayout.adaptiveProduct.single.contentPaddingTop + (eyebrow ? eyebrowHeight : 0) + slideLayout.adaptiveProduct.single.titleMarginTop
    : box.y + barHeight + (eyebrow ? (row2 ? 0.36 : compact ? 0.42 : 0.75) : (row2 ? 0.14 : compact ? 0.2 : 0.38));
  const titleLineSpacing = sizes.title * (single ? slideLayout.adaptiveProduct.single.titleLineHeight : 1.16);
  const titleHeight = single
    ? estimateTextLines(product.name, contentWidth - contentPad * 2, sizes.title) * titleLineSpacing / 72 + 0.02
    : row2 ? 0.38 : compact ? 0.42 : 0.72;
  addCanvasText(context, `product.${product.id}.title`, product.name, { x: rightX + contentPad, y: titleY, w: contentWidth - contentPad * 2, h: titleHeight, fontFace: theme.fonts.title, fontSize: sizes.title, lineSpacing: single ? titleLineSpacing : undefined, bold: false, color: theme.colors.text, margin: 0, fit: "shrink", valign: single ? "top" : "middle" }, cardParent);
  const detailMargin = single
    ? (product.components?.length ? slideLayout.adaptiveProduct.single.componentsMarginTop : slideLayout.adaptiveProduct.single.detailsListMarginTop)
    : row2 ? 0.08 : compact ? 0.1 : 0.2;
  const detailsY = titleY + titleHeight + detailMargin;
  const detailsBottom = compact ? box.y + box.h : priceY;
  if (!isSectionHidden(edit, product.id, "details")) addProductDetails(context, product, { x: rightX + contentPad, y: detailsY, w: contentWidth - contentPad * 2, h: Math.max(0.42, detailsBottom - detailsY - slideLayout.adaptiveProduct.single.contentPaddingBottom) }, sizes, box.variant, cardParent);
  if (priceHeight > 0) addPriceArea(context, product, { x: priceX, y: priceY, w: priceW, h: priceHeight }, box, box.variant, !compact);
}

export function addAdaptiveProductSlide(context: LayoutContext, config: ProductLayoutConfig) {
  const { slide, theme, currentSlide, meta } = context;
  if (currentSlide.kind !== "products") return;
  slide.background = { color: theme.colors.background };
  const packagePrice = currentSlide.products[0]?.price.package ?? numericPriceTier(currentSlide.products[0]?.priceTier) ?? meta.priceTier;
  addBusinessHeader(context, `${packagePrice}元档位`, `02 / ${config.type.toUpperCase()}${context.template.showProductIdentifiers ? ` · ${String(currentSlide.sectionPage).padStart(2, "0")}` : ""}`);
  config.cards.forEach((box, index) => {
    const product = currentSlide.products[index];
    if (!product) {
      slide.addShape(context.pptx.ShapeType.rect, { x: box.x, y: box.y, w: box.w, h: box.h, line: { color: theme.colors.border, pt: 0.8, transparency: 35 }, fill: { color: theme.colors.card, transparency: 38 } });
      return;
    }
    const analysis = currentSlide.plan.analyses[index];
    if (["feature", "package", "image-focus", "mixed-secondary", "grid-2-row"].includes(box.variant)) addHorizontalCard(context, product, analysis, box);
    else addVerticalCard(context, product, analysis, box);
  });
  addSlideFooter(context);
  addSourceNotes(slide, currentSlide.products.flatMap((product) => getProductImages(product)));
}
