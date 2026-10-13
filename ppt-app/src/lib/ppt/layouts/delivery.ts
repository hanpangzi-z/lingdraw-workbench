import { slideLayout } from "@/src/config/slideLayout";
import { addBusinessHeader, addCanvasShape, addCanvasText, addSlideFooter, groupProductsByDeliveryRule } from "../helpers";
import type { LayoutContext } from "../types";

function addListDeliverySlide(context: LayoutContext) {
  const { pptx, slide, theme, products, template } = context;
  slide.background = { color: theme.colors.background };
  addBusinessHeader(context, "配送范围说明", "04 / DELIVERY RULES");
  slide.addText(template.showProductIdentifiers ? "配送规则与商品编号清晰对应" : "配送规则与适用商品清晰对应", { x: slideLayout.slidePadding, y: 0.92, w: 4.2, h: 0.42, fontFace: theme.fonts.title, fontSize: 20, bold: true, color: theme.colors.textPrimary, margin: 0 });
  slide.addText(template.showProductIdentifiers ? "同一商品可对应多条规则；编号会同时出现在相关配送范围中。" : "同一商品可对应多条规则；商品名称会列在相关配送范围中。", { x: 4.75, y: 1.0, w: 5.7, h: 0.28, fontFace: theme.fonts.body, fontSize: 9.5, color: theme.colors.textSecondary, margin: 0, fit: "shrink" });
  slide.addText(`${products.length} 款套餐`, { x: 10.9, y: 0.92, w: 1.95, h: 0.36, fontFace: theme.fonts.number, fontSize: 18, bold: true, color: theme.colors.primary, align: "right", margin: 0 });
  const groups = groupProductsByDeliveryRule(products);
  const rowHeight = Math.min(0.78, 4.9 / Math.max(groups.length, 1));
  groups.forEach((group, index) => {
    const x = slideLayout.slidePadding;
    const y = 1.68 + index * rowHeight;
    slide.addShape(pptx.ShapeType.rect, { x, y, w: slideLayout.width - slideLayout.slidePadding * 2, h: rowHeight - 0.05, line: { color: theme.colors.border, pt: 0.6, transparency: template.layoutVariants.delivery === "minimal" ? 100 : 0 }, fill: { color: index % 2 === 0 ? theme.colors.surface : theme.colors.background } });
    slide.addText(String(index + 1).padStart(2, "0"), { x: x + 0.18, y: y + 0.18, w: 0.4, h: 0.18, fontFace: theme.fonts.number, fontSize: 8.5, bold: true, color: theme.colors.primary, margin: 0 });
    slide.addText(group.rule, { x: x + 0.75, y: y + 0.13, w: 2.05, h: 0.28, fontFace: theme.fonts.title, fontSize: 13, bold: true, color: theme.colors.textPrimary, margin: 0, fit: "shrink" });
    slide.addText("对应商品", { x: x + 3.0, y: y + 0.18, w: 0.7, h: 0.16, fontFace: theme.fonts.body, fontSize: 7, color: theme.colors.textSecondary, margin: 0 });
    slide.addText(template.showProductIdentifiers ? (group.productNumbers.map((number) => `NO.${number}`).join(" · ") || "—") : (group.productNames.join(" · ") || "—"), { x: x + 3.85, y: y + 0.13, w: 8.05, h: 0.32, fontFace: template.showProductIdentifiers ? theme.fonts.number : theme.fonts.body, fontSize: 9, color: theme.colors.textSecondary, margin: 0, fit: "shrink", valign: "middle" });
  });
  slide.addText("* 最终配送范围与履约时效以招标文件、供应商可达范围及下单确认结果为准。", { x: slideLayout.slidePadding, y: 6.62, w: 9.2, h: 0.2, fontFace: theme.fonts.body, fontSize: 8, color: theme.colors.textSecondary, margin: 0 });
  addSlideFooter(context);
}

export function addDeliverySlide(context: LayoutContext) {
  if (context.template.layoutVariants.delivery !== "split") return addListDeliverySlide(context);
  const { pptx, slide, theme, products } = context;
  slide.background = { color: theme.colors.background };
  addBusinessHeader(context, "配送范围说明", "04 / DELIVERY RULES");
  const introBox = { x: slideLayout.slidePadding, y: 1.12, w: 2.88, h: 4.58 };
  const introParent = [{ id: "delivery.intro", box: introBox }];
  const totalBox = { x: slideLayout.slidePadding, y: 4.45, w: 2.85, h: 1.25 };
  const totalParents = [...introParent, { id: "delivery.total", box: totalBox }];
  const groupsBox = { x: 4.02, y: slideLayout.delivery.contentY, w: 8.84, h: 4.69 };
  const groupsParent = [{ id: "delivery.groups", box: groupsBox }];

  addCanvasText(context, "delivery.heading", context.template.showProductIdentifiers ? "配送规则与商品编号清晰对应" : "配送规则与适用商品清晰对应", {
    x: slideLayout.slidePadding,
    y: 1.12,
    w: 3.25,
    h: 0.72,
    fontFace: theme.fonts.title,
    fontSize: 26,
    bold: true,
    color: theme.colors.text,
    margin: 0,
    fit: "shrink",
  }, introParent);
  addCanvasShape(context, "delivery.divider", pptx.ShapeType.line, {
    x: slideLayout.slidePadding,
    y: 2.05,
    w: 0.82,
    h: 0,
    line: { color: theme.colors.primary, pt: 2.2 },
  }, introParent);
  addCanvasText(context, "delivery.description", context.template.showProductIdentifiers ? "同一商品可对应多条规则；编号会同时出现在相关配送范围中，便于招标文件复核。" : "同一商品可对应多条规则；商品名称会列在相关配送范围中，便于快速核对。", {
    x: slideLayout.slidePadding,
    y: 2.28,
    w: 2.88,
    h: 0.82,
    fontFace: theme.fonts.body,
    fontSize: 12,
    lineSpacing: 18,
    color: theme.colors.secondaryText,
    margin: 0,
  }, introParent);
  addCanvasShape(context, "delivery.total", pptx.ShapeType.rect, {
    x: slideLayout.slidePadding,
    y: 4.45,
    w: 2.85,
    h: 1.25,
    line: { color: theme.colors.primary, transparency: 100 },
    fill: { color: theme.colors.primary },
  }, introParent);
  addCanvasText(context, "delivery.total.value", `${products.length}`, {
    x: slideLayout.slidePadding + 0.22,
    y: 4.62,
    w: 0.85,
    h: 0.54,
    fontFace: theme.fonts.number,
    fontSize: 33,
    bold: true,
    color: theme.colors.onPrimary,
    margin: 0,
  }, totalParents);
  addCanvasText(context, "delivery.total.label", "款套餐已完成配送规则整理", {
    x: slideLayout.slidePadding + 1.12,
    y: 4.68,
    w: 1.42,
    h: 0.46,
    fontFace: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.onPrimaryMuted,
    margin: 0,
    fit: "shrink",
  }, totalParents);

  const groups = groupProductsByDeliveryRule(products);
  groups.forEach((group, index) => {
    const x = 4.02;
    const y = slideLayout.delivery.contentY + index * slideLayout.delivery.rowHeight;
    const productLabel = context.template.showProductIdentifiers
      ? (group.productNumbers.length ? group.productNumbers.map((number) => `NO.${number}`).join(" · ") : "—")
      : (group.productNames.join(" · ") || "—");

    const ruleBox = { x, y, w: 8.84, h: slideLayout.delivery.rowHeight - 0.08 };
    const ruleParents = [...groupsParent, { id: `delivery.rule.${index}`, box: ruleBox }];
    addCanvasShape(context, `delivery.rule.${index}`, pptx.ShapeType.rect, {
      x,
      y,
      w: 8.84,
      h: slideLayout.delivery.rowHeight - 0.08,
      line: { color: theme.colors.border, pt: 0.7 },
      fill: { color: index % 2 === 0 ? theme.colors.card : theme.colors.background },
    }, groupsParent);
    addCanvasText(context, `delivery.rule.${index}.number`, String(index + 1).padStart(2, "0"), {
      x: x + 0.18,
      y: y + 0.21,
      w: 0.35,
      h: 0.2,
      fontFace: theme.fonts.number,
      fontSize: 9,
      bold: true,
      color: theme.colors.primary,
      margin: 0,
    }, ruleParents);
    addCanvasText(context, `delivery.rule.${index}.title`, group.rule, {
      x: x + 0.68,
      y: y + 0.17,
      w: 1.72,
      h: 0.28,
      fontFace: theme.fonts.title,
      fontSize: 14,
      bold: true,
      color: theme.colors.text,
      margin: 0,
      fit: "shrink",
    }, ruleParents);
    addCanvasText(context, `delivery.rule.${index}.label`, "对应商品", {
      x: x + 2.62,
      y: y + 0.18,
      w: 0.65,
      h: 0.18,
      fontFace: theme.fonts.body,
      fontSize: 7.5,
      color: theme.colors.secondaryText,
      margin: 0,
    }, ruleParents);
    addCanvasText(context, `delivery.rule.${index}.products`, productLabel, {
      x: x + 3.35,
      y: y + 0.14,
      w: 5.2,
      h: 0.4,
      fontFace: context.template.showProductIdentifiers ? theme.fonts.number : theme.fonts.body,
      fontSize: 9.5,
      color: theme.colors.secondaryText,
      margin: 0,
      fit: "shrink",
      valign: "middle",
    }, ruleParents);
  });

  addCanvasText(context, "delivery.notice", "* 最终配送范围与履约时效以招标文件、供应商可达范围及下单确认结果为准。", {
    x: 4.02,
    y: 6.0,
    w: 8.84,
    h: 0.24,
    fontFace: theme.fonts.body,
    fontSize: 8.5,
    color: theme.colors.secondaryText,
    margin: 0,
  }, groupsParent);
  addSlideFooter(context);
}
