import type { CSSProperties } from "react";
import { pointsToCanvasWidthUnit } from "@/src/config/slideLayout";
import { getProductImages } from "@/src/lib/catalog/images";
import { formatPackageSequence } from "@/src/lib/catalog/numbering";
import { numericPriceTier } from "@/src/lib/catalog/project";
import type { ProductAnalysis } from "@/src/lib/layout/types";
import type { ProductCardVariant } from "@/src/lib/layout/layouts/configTypes";
import type { CatalogMeta, Product, ProductCategory } from "@/types/catalog";
import type { EditorInteraction } from "@/src/lib/editor/interaction";
import { useCanvasOverrideResolver, useCanvasTextResolver } from "@/src/lib/editor/CanvasOverrideContext";
import { isSectionHidden, type SlideEditState } from "@/types/editor";
import { getTemplate } from "@/src/templates/registry";

interface ProductCardProps {
  product: Product;
  meta: CatalogMeta;
  categories: ProductCategory[];
  variant?: ProductCardVariant;
  analysis?: ProductAnalysis;
  debug?: boolean;
  slideId: string;
  editState?: SlideEditState;
  interaction?: EditorInteraction;
}

type ProductCardStyle = CSSProperties & {
  "--product-title-size": string;
  "--product-detail-size": string;
  "--product-detail-line-height": string;
};

function getVariantTextStyle(variant: ProductCardVariant, density: ProductAnalysis["density"] = "medium") {
  const single = ["feature", "package", "image-focus"].includes(variant);
  const grid2 = variant === "grid-2" || variant === "grid-2-row" || variant === "mixed-primary";
  const titleFontSize = single
    ? ({ low: 26, medium: 23, high: 19, "very-high": 16 } as const)[density]
    : grid2
      ? ({ low: 20, medium: 18, high: 15, "very-high": 13 } as const)[density]
      : ({ low: 17.5, medium: 16, high: 13, "very-high": 11 } as const)[density];
  const itemFontSize = single
    ? ({ low: 12, medium: 11.5, high: 10.5, "very-high": 9.5 } as const)[density]
    : grid2
      ? ({ low: 11, medium: 10.5, high: 9.8, "very-high": 9.2 } as const)[density]
      : ({ low: 10, medium: 9.8, high: 9.3, "very-high": 9 } as const)[density];
  return { titleFontSize, itemFontSize, lineSpacing: itemFontSize * 1.24 };
}

export function ProductCard({ product, meta, categories, slideId, editState, interaction, variant = "grid-3", analysis, debug = false }: ProductCardProps) {
  const canvasOverride = useCanvasOverrideResolver();
  const canvasText = useCanvasTextResolver();
  const category = categories.find((item) => item.id === product.categoryId);
  const template = getTemplate(meta.design.templateId);
  const showIdentifiers = template.showProductIdentifiers;
  const textStyle = getVariantTextStyle(variant, analysis?.density);
  const imageOverride = canvasOverride(`product.${product.id}.image`)?.image ?? editState?.imageOverrides?.[product.id];
  const images = imageOverride?.source ? [imageOverride.source] : getProductImages(product);
  let detailOffset = 0;
  const componentGroups = product.components?.map((component, index) => {
    const detailIndexes = component.details.map((_, localIndex) => detailOffset + localIndex);
    detailOffset += component.details.length;
    return { component, index, detailIndexes };
  }) ?? [];
  const priceZoneHidden = Boolean(canvasOverride(`product.${product.id}.prices`)?.hidden);
  const hidden = {
    number: isSectionHidden(editState, product.id, "number"),
    sku: isSectionHidden(editState, product.id, "sku"),
    market: priceZoneHidden || isSectionHidden(editState, product.id, "marketPrice") || Boolean(canvasOverride(`product.${product.id}.marketPrice`)?.hidden),
    sale: priceZoneHidden || isSectionHidden(editState, product.id, "salePrice") || Boolean(canvasOverride(`product.${product.id}.salePrice`)?.hidden),
    details: isSectionHidden(editState, product.id, "details"),
  };
  const selected = interaction?.selection?.type === "product" && interaction.selection.productId === product.id;
  const imageSelected = interaction?.selection?.type === "image" && interaction.selection.productId === product.id;
  const style: ProductCardStyle = {
    "--product-title-size": pointsToCanvasWidthUnit(textStyle.titleFontSize),
    "--product-detail-size": pointsToCanvasWidthUnit(textStyle.itemFontSize),
    "--product-detail-line-height": pointsToCanvasWidthUnit(textStyle.lineSpacing),
  };

  return (
    <article
      className={`br-product-card variant-${variant} density-${analysis?.density ?? "medium"} ${showIdentifiers ? "with-product-identifiers" : "without-product-identifiers"} ${selected ? "is-editor-selected" : ""} ${hidden.market && hidden.sale ? "is-price-hidden" : ""} ${hidden.details ? "is-details-hidden" : ""}`}
      style={style}
      data-canvas-element={`product.${product.id}.card`}
      data-canvas-type="group"
      data-canvas-label="商品卡片"
      onClick={(event) => { if (!interaction?.enabled) return; event.stopPropagation(); interaction.onSelect({ type: "product", slideId, productId: product.id }); }}
    >
      {showIdentifiers && <div className="br-product-card-bar" data-canvas-element={`product.${product.id}.bar`} data-canvas-type="shape" data-canvas-label="商品卡片顶部栏">
        {!hidden.number && <strong data-canvas-element={`product.${product.id}.number`} data-canvas-type="text" data-canvas-label="商品序号">{canvasText(`product.${product.id}.number`, `NO.${product.productNumber}`)}</strong>}
        <span data-canvas-element={`product.${product.id}.packageCode`} data-canvas-type="text" data-canvas-label="套餐编号">{canvasText(`product.${product.id}.packageCode`, `套餐编号 ${product.packageCode}`)}</span>
      </div>}
      <div
        className={`br-product-image image-count-${images.length === 4 ? 4 : Math.min(images.length, 3)} ${imageSelected ? "is-editor-selected" : ""}`}
        data-canvas-element={`product.${product.id}.image`}
        data-canvas-type="image"
        data-canvas-label={`${product.name}图片`}
        onClick={(event) => { if (!interaction?.enabled) return; event.stopPropagation(); interaction.onSelect({ type: "image", slideId, productId: product.id }); }}
      >
        {images.length ? (
          images.map((source, index) => <img
            src={source}
            alt={`${product.name} ${index + 1}`}
            loading="lazy"
            key={index}
            style={imageOverride ? {
              objectFit: imageOverride.fit,
              transform: `translate(${imageOverride.offsetX}%, ${imageOverride.offsetY}%) scale(${imageOverride.scale})`,
            } : undefined}
          />)
        ) : (
          <div className="br-image-placeholder" role="img" aria-label={`${product.name} 暂无图片`}>
            <strong>×</strong>
            <span>暂无商品图片</span>
          </div>
        )}
      </div>
      <div className="br-product-content">
        {showIdentifiers && !hidden.sku && <p className="br-product-sku" data-canvas-element={`product.${product.id}.sku`} data-canvas-type="text" data-canvas-label="SKU 与分类">{canvasText(`product.${product.id}.sku`, `${product.sku}${category ? ` · ${category.name}` : ""}`)}</p>}
        {!showIdentifiers && !hidden.number && <p className="br-product-sequence" data-canvas-element={`product.${product.id}.sequence`} data-canvas-type="text" data-canvas-label="套餐序号">{canvasText(`product.${product.id}.sequence`, formatPackageSequence(product.productNumber))}</p>}
        <h3
          data-canvas-element={`product.${product.id}.title`}
          data-canvas-type="text"
          data-canvas-label="商品名称"
          contentEditable={interaction?.enabled}
          suppressContentEditableWarning
          onDoubleClick={(event) => { if (interaction?.enabled) { event.stopPropagation(); event.currentTarget.focus(); } }}
          onBlur={(event) => { const name = event.currentTarget.textContent?.trim(); if (interaction?.enabled && name && name !== product.name) interaction.onProductChange(product.id, { name }); }}
        >{canvasText(`product.${product.id}.title`, product.name)}</h3>
        {!hidden.details && (componentGroups.length ? (
          <div className={`br-product-components count-${componentGroups.length}`} data-canvas-element={`product.${product.id}.details`} data-canvas-type="group" data-canvas-label="套餐商品与明细">
            {componentGroups.map(({ component, index, detailIndexes }) => <section className="br-product-component" key={`${index}-${component.name}`}>
              {component.name && <h4 data-canvas-element={`product.${product.id}.component.${index}.title`} data-canvas-type="text" data-canvas-label={`商品名称 ${index + 1}`}>{canvasText(`product.${product.id}.component.${index}.title`, component.name)}</h4>}
              {component.details.length > 0 && <ul>
                {component.details.map((detail, localIndex) => {
                  const detailIndex = detailIndexes[localIndex];
                  return <li key={`${detailIndex}-${detail}`} data-canvas-element={`product.${product.id}.detail.${detailIndex}`} data-canvas-type="text" data-canvas-label={`商品明细 ${detailIndex + 1}`}>{canvasText(`product.${product.id}.detail.${detailIndex}`, detail)}</li>;
                })}
              </ul>}
            </section>)}
          </div>
        ) : <ul data-canvas-element={`product.${product.id}.details`} data-canvas-type="group" data-canvas-label="商品明细列表">
          {product.details.map((detail, index) => <li key={`${index}-${detail}`} data-canvas-element={`product.${product.id}.detail.${index}`} data-canvas-type="text" data-canvas-label={`商品明细 ${index + 1}`}>{canvasText(`product.${product.id}.detail.${index}`, detail)}</li>)}
        </ul>)}
      </div>
      {(!hidden.market || !hidden.sale) && <div className="br-product-prices" data-canvas-element={`product.${product.id}.prices`} data-canvas-type="group" data-canvas-label="价格区" onClick={(event) => { if (interaction?.enabled) { event.stopPropagation(); interaction.onSelect({ type: "element", slideId, elementId: `product.${product.id}.prices`, elementType: "group", label: "价格区" }); } }}>
        {!hidden.market && <div data-canvas-element={`product.${product.id}.marketPrice`} data-canvas-type="group" data-canvas-label="市场价">
          <span data-canvas-element={`product.${product.id}.marketLabel`} data-canvas-type="text" data-canvas-label="市场价标签">{canvasText(`product.${product.id}.marketLabel`, "市场价")}</span>
          <del data-canvas-element={`product.${product.id}.marketValue`} data-canvas-type="text" data-canvas-label="市场价数值">{canvasText(`product.${product.id}.marketValue`, product.price.market === undefined ? "—" : `¥${product.price.market}`)}</del>
        </div>}
        {!hidden.sale && <div data-canvas-element={`product.${product.id}.salePrice`} data-canvas-type="group" data-canvas-label="组合价">
          <span data-canvas-element={`product.${product.id}.saleLabel`} data-canvas-type="text" data-canvas-label="组合价标签">{canvasText(`product.${product.id}.saleLabel`, "组合价")}</span>
          <strong data-canvas-element={`product.${product.id}.saleValue`} data-canvas-type="text" data-canvas-label="组合价数值">{canvasOverride(`product.${product.id}.saleValue`)?.text ?? (product.price.package === undefined ? "—" : <><small>¥</small>{product.price.package}</>)}</strong>
        </div>}
      </div>}
      {interaction?.enabled && <div className="editor-card-toolbar" aria-label={`${product.name} 快速操作`}>
        <button type="button" onClick={(event) => { event.stopPropagation(); interaction.onSelect({ type: "image", slideId, productId: product.id }); }}>换图</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); interaction.onSelect({ type: "product", slideId, productId: product.id }); }}>编辑</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); interaction.onSlideEdit(slideId, { hiddenSections: [...new Set([...(editState?.hiddenSections ?? []), `${product.id}.details`])] }); }}>隐藏</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); interaction.onSelect({ type: "product", slideId, productId: product.id }); }}>更多</button>
      </div>}
      <span className="sr-only">统一价格档位 {product.price.package ?? numericPriceTier(product.priceTier) ?? meta.priceTier} 元</span>
      {debug && analysis && <span className="br-product-debug">{analysis.density} · {analysis.itemCount} 项 · {analysis.itemTextLength} 字 · {analysis.imageType}</span>}
    </article>
  );
}
