import { slideLayout } from "@/src/config/slideLayout";
import { addBusinessHeader, addCanvasShape, addCanvasText, addSlideFooter, addSourceNotes } from "../helpers";
import type { LayoutContext } from "../types";

export function addOverviewSlide(context: LayoutContext) {
  const { pptx, slide, theme, template, products, categories, meta } = context;
  slide.background = { color: theme.colors.background };
  addBusinessHeader(context, "套餐分类总览", "02 / OVERVIEW");
  const statsParent = [{ id: "overview.stats", box: { x: slideLayout.slidePadding, y: slideLayout.overview.statsY, w: slideLayout.width - slideLayout.slidePadding * 2, h: 0.62 } }];

  const stats = [
    { label: "套餐总数", value: `${products.length} 款` },
    { label: "统一组合价", value: `¥${meta.priceTier}` },
    { label: "商品分类", value: `${categories.length} 类` },
  ];
  stats.forEach((stat, index) => {
    const x = slideLayout.slidePadding + index * 2.18;
    const statId = ["overview.stat.products", "overview.stat.price", "overview.stat.categories"][index];
    const statParents = [...statsParent, { id: statId, box: { x, y: slideLayout.overview.statsY, w: 1.55, h: 0.57 } }];
    addCanvasText(context, `${statId}.label`, stat.label, {
      x,
      y: slideLayout.overview.statsY,
      w: 0.82,
      h: 0.2,
      fontFace: theme.fonts.body,
      fontSize: 8,
      color: theme.colors.secondaryText,
      margin: 0,
    }, statParents);
    addCanvasText(context, `${statId}.value`, stat.value, {
      x,
      y: slideLayout.overview.statsY + 0.22,
      w: 1.55,
      h: 0.35,
      fontFace: theme.fonts.number,
      fontSize: 20,
      bold: true,
      color: theme.colors.primary,
      margin: 0,
    }, statParents);
  });
  addCanvasText(context, "overview.note", template.showProductIdentifiers ? "每个分类均展示套餐 SKU 与商品名称，便于快速核对招标清单。" : "按分类展示商品名称，便于快速浏览与核对招标清单。", {
    x: 7.6,
    y: slideLayout.overview.statsY + 0.14,
    w: 5.27,
    h: 0.3,
    fontFace: theme.fonts.body,
    fontSize: 10.5,
    align: "right",
    color: theme.colors.secondaryText,
    margin: 0,
  }, statsParent);

  categories.forEach((category, index) => {
    const listVariant = template.layoutVariants.overview === "list";
    const statisticsVariant = template.layoutVariants.overview === "statistics";
    const isTopRow = index < 4;
    const columns = listVariant ? 2 : isTopRow || categories.length > 7 ? 4 : 3;
    const cardWidth =
      (slideLayout.width - slideLayout.slidePadding * 2 - (columns - 1) * 0.18) / columns;
    const columnIndex = listVariant ? index % 2 : isTopRow ? index : index - 4;
    const x = slideLayout.slidePadding + columnIndex * (cardWidth + 0.18);
    const y = listVariant
      ? 2.0 + Math.floor(index / 2) * 1.18
      : slideLayout.overview.gridY + (isTopRow ? 0 : slideLayout.overview.rowHeight + slideLayout.overview.rowGap);
    const cardHeight = listVariant ? 1.08 : slideLayout.overview.rowHeight;
    const categoryProducts = products.filter((product) => product.categoryId === category.id);
    const categoryId = `overview.category.${category.id}`;
    const categoryBox = { x, y, w: cardWidth, h: cardHeight };
    const categoryParent = [{ id: categoryId, box: categoryBox }];

    addCanvasShape(context, categoryId, pptx.ShapeType.rect, {
      x,
      y,
      w: cardWidth,
      h: cardHeight,
      line: { color: theme.colors.border, pt: 0.8, transparency: statisticsVariant ? 100 : 0 },
      fill: { color: statisticsVariant ? theme.colors.background : theme.colors.card },
    });
    addCanvasShape(context, `${categoryId}.accent`, pptx.ShapeType.rect, {
      x,
      y,
      w: 0.08,
      h: cardHeight,
      line: { color: theme.colors.primary, transparency: 100 },
      fill: { color: theme.colors.primary },
    }, categoryParent);
    addCanvasText(context, `${categoryId}.number`, String(index + 1).padStart(2, "0"), {
      x: x + 0.2,
      y: y + 0.16,
      w: 0.36,
      h: 0.24,
      fontFace: theme.fonts.number,
      fontSize: 10,
      bold: true,
      color: theme.colors.primary,
      margin: 0,
    }, categoryParent);
    addCanvasText(context, `${categoryId}.title`, category.name, {
      x: x + 0.64,
      y: y + 0.12,
      w: cardWidth - 1.35,
      h: 0.3,
      fontFace: theme.fonts.title,
      fontSize: 15,
      bold: true,
      color: theme.colors.text,
      margin: 0,
      fit: "shrink",
    }, categoryParent);
    addCanvasText(context, `${categoryId}.count`, `${categoryProducts.length} 款`, {
      x: x + cardWidth - 0.66,
      y: y + 0.16,
      w: 0.45,
      h: 0.2,
      fontFace: theme.fonts.number,
      fontSize: 8.5,
      bold: true,
      align: "right",
      color: theme.colors.secondaryText,
      margin: 0,
    }, categoryParent);
    addCanvasShape(context, `${categoryId}.divider`, pptx.ShapeType.line, {
      x: x + 0.2,
      y: y + (listVariant ? 0.44 : 0.52),
      w: cardWidth - 0.4,
      h: 0,
      line: { color: theme.colors.border, pt: 0.6 },
    }, categoryParent);
    addCanvasText(
      context,
      `${categoryId}.products`,
      categoryProducts
        .filter((product) => !context.currentSlide.editor?.elementOverrides?.[`overview.product.${product.id}`]?.hidden)
        .map((product) => context.currentSlide.editor?.elementOverrides?.[`overview.product.${product.id}`]?.text ?? (template.showProductIdentifiers ? `${product.sku}  ${product.name}` : product.name))
        .join("\n"),
      {
        x: x + 0.2,
        y: y + (listVariant ? 0.54 : 0.68),
        w: cardWidth - 0.4,
        h: listVariant ? 0.42 : 1.38,
        fontFace: theme.fonts.body,
        fontSize: listVariant ? 7.2 : isTopRow ? 8.2 : 8.8,
        lineSpacing: listVariant ? 8.6 : isTopRow ? 12.2 : 12.8,
        color: theme.colors.secondaryText,
        margin: 0,
        breakLine: false,
        fit: "shrink",
        valign: "top",
      },
      categoryParent,
    );
  });

  addSlideFooter(context);
  addSourceNotes(slide, categories.map((category) => category.coverImage));
}
