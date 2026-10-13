import type { CSSProperties } from "react";
import { groupProductsByDeliveryRule } from "@/src/lib/ppt/helpers";
import type { CatalogMeta, CatalogSlide, Product, ProductCategory } from "@/types/catalog";
import { getProjectDisplayName, getTierDividerLabel, getTierDividerProjectLine, numericPriceTier } from "@/src/lib/catalog/project";
import { getSlideCatalogMeta, getSlideProducts } from "@/src/lib/catalog/tiers";
import { createRenderContext, getEffectiveBrand, renderContextCssVariables } from "@/src/render/context";
import type { RenderContext } from "@/src/render/types";
import { ProductGrid3Preview } from "@/src/lib/layout/layouts/productGrid3/Preview";
import { ProductGrid2Preview } from "@/src/lib/layout/layouts/productGrid2/Preview";
import { ProductFeaturePreview } from "@/src/lib/layout/layouts/productFeature/Preview";
import { PackageDetailPreview } from "@/src/lib/layout/layouts/packageDetail/Preview";
import { ProductImageFocusPreview } from "@/src/lib/layout/layouts/productImageFocus/Preview";
import { MixedProductPreview } from "@/src/lib/layout/layouts/mixedProduct/Preview";
import type { EditorInteraction } from "@/src/lib/editor/interaction";
import { useCanvasOverrideResolver, useCanvasTextResolver } from "@/src/lib/editor/CanvasOverrideContext";
import type { ProductImageOverride } from "@/types/editor";

interface PresentationSlideProps {
  slide: CatalogSlide;
  meta: CatalogMeta;
  products: Product[];
  categories: ProductCategory[];
  totalSlides: number;
  debug?: boolean;
  interaction?: EditorInteraction;
}

function slideClassName(context: RenderContext, page: string) {
  const pageNumberClass = context.slide.editor?.styleOverrides?.showPageNumber === false ? "hide-page-number" : "";
  return `catalog-slide br-slide ${page} ${pageNumberClass} template-${context.template.id} theme-${context.theme.id} cover-${context.template.layoutVariants.cover} overview-${context.template.layoutVariants.overview} delivery-${context.template.layoutVariants.delivery} ending-${context.template.layoutVariants.ending}`;
}

function editableImageStyle(image?: ProductImageOverride): CSSProperties | undefined {
  return image ? {
    objectFit: image.fit,
    transform: `translate(${image.offsetX}%, ${image.offsetY}%) scale(${image.scale})`,
    transformOrigin: "center",
  } : undefined;
}

function SlideHeader({ slide, title, label, meta, totalSlides, interaction }: { slide: CatalogSlide; title: string; label: string; meta: CatalogMeta; totalSlides: number; interaction?: EditorInteraction }) {
  const canvasText = useCanvasTextResolver();
  const displayTitle = slide.editor?.customTitle || title;
  return (
    <header className="br-slide-header" data-canvas-element="header.group" data-canvas-type="shape" data-canvas-label="顶部栏">
      <strong data-canvas-element="header.brand" data-canvas-type="text" data-canvas-label="顶部品牌">{canvasText("header.brand", getEffectiveBrand(meta))}</strong>
      <span data-canvas-element="header.label" data-canvas-type="text" data-canvas-label="章节标签">{canvasText("header.label", label)}</span>
      <h2
        data-canvas-element="header.title"
        data-canvas-type="text"
        data-canvas-label="页面标题"
        className={interaction?.selection?.type === "title" && interaction.selection.slideId === slide.id ? "is-editor-selected" : ""}
        contentEditable={interaction?.enabled}
        suppressContentEditableWarning
        onClick={(event) => { if (interaction?.enabled) { event.stopPropagation(); interaction.onSelect({ type: "title", slideId: slide.id }); } }}
        onBlur={(event) => { const value = event.currentTarget.textContent?.trim(); if (interaction?.enabled && value && value !== displayTitle) interaction.onSlideEdit(slide.id, { customTitle: value }); }}
      >{canvasText("header.title", displayTitle)}</h2>
      <small data-canvas-element="header.page" data-canvas-type="text" data-canvas-label="页码">{canvasText("header.page", `${String(slide.pageNumber).padStart(2, "0")} / ${totalSlides}`)}</small>
    </header>
  );
}

function SlideFooter({ meta }: { meta: CatalogMeta }) {
  const canvasText = useCanvasTextResolver();
  return <footer className="br-slide-footer" data-canvas-element="footer.text" data-canvas-type="text" data-canvas-label="页脚">{canvasText("footer.text", `${meta.year} ${getProjectDisplayName(meta)} · ${meta.tierName}`)}</footer>;
}

function CoverSlide({ context, interaction }: { context: RenderContext; interaction?: EditorInteraction }) {
  const canvasText = useCanvasTextResolver();
  const { project: meta, products } = context;
  const title = context.slide.editor?.customTitle || meta.tierName || `${meta.priceTier}元档位`;
  return (
    <div className={slideClassName(context, "br-cover-slide")} style={renderContextCssVariables(context)}>
      <section className="br-cover-intro" data-canvas-element="cover.visual" data-canvas-type="group" data-canvas-label="项目信息区">
        <div className="br-cover-brand">
          <i data-canvas-element="cover.topbar" data-canvas-type="shape" data-canvas-label="品牌色标" />
          <strong data-canvas-element="brand.name" data-canvas-type="text" data-canvas-label="品牌名称">{canvasText("brand.name", getEffectiveBrand(meta))}</strong>
        </div>
        <p data-canvas-element="cover.project" data-canvas-type="text" data-canvas-label="项目名称">{canvasText("cover.project", getTierDividerProjectLine(meta))}</p>
      </section>
      <section className="br-cover-copy" data-canvas-element="cover.left" data-canvas-type="shape" data-canvas-label="档位分栏色带">
        <h1
          data-canvas-element="cover.title"
          data-canvas-type="text"
          data-canvas-label="档位标题"
          className={interaction?.selection?.type === "title" ? "is-editor-selected" : ""}
          contentEditable={interaction?.enabled}
          suppressContentEditableWarning
          onClick={(event) => { if (interaction?.enabled) { event.stopPropagation(); interaction.onSelect({ type: "title", slideId: context.slide.id }); } }}
          onBlur={(event) => { const value = event.currentTarget.textContent?.trim(); if (interaction?.enabled && value) interaction.onSlideEdit(context.slide.id, { customTitle: value }); }}
        >{canvasText("cover.title", title)}</h1>
        <h2 data-canvas-element="cover.subtitle" data-canvas-type="text" data-canvas-label="档位套餐数量">{canvasText("cover.subtitle", `${products.length}款套餐 · 一价任选`)}</h2>
      </section>
      <section className="br-cover-section-meta" data-canvas-element="cover.meta" data-canvas-type="group" data-canvas-label="分栏页标识">
        <p data-canvas-element="cover.edition" data-canvas-type="text" data-canvas-label="分栏英文标识">{canvasText("cover.edition", getTierDividerLabel(meta))}</p>
        <i data-canvas-element="cover.divider" data-canvas-type="shape" data-canvas-label="底部分隔线" />
      </section>
    </div>
  );
}

function OverviewSlide({ context, interaction }: { context: RenderContext & { slide: Extract<CatalogSlide, { kind: "category-overview" }> }; interaction?: EditorInteraction }) {
  const canvasOverride = useCanvasOverrideResolver();
  const canvasText = useCanvasTextResolver();
  const { slide, project: meta, products, categories, totalSlides } = context;
  return (
    <div className={slideClassName(context, "br-overview-slide")} style={renderContextCssVariables(context)}>
      <SlideHeader slide={slide} title="套餐分类总览" label="02 / OVERVIEW" meta={meta} totalSlides={totalSlides} interaction={interaction} />
      <div className="br-overview-stats" data-canvas-element="overview.stats" data-canvas-type="group" data-canvas-label="总览统计区">
        <div data-canvas-element="overview.stat.products" data-canvas-type="group" data-canvas-label="套餐总数"><span data-canvas-element="overview.stat.products.label" data-canvas-type="text" data-canvas-label="套餐总数标签">{canvasText("overview.stat.products.label", "套餐总数")}</span><strong data-canvas-element="overview.stat.products.value" data-canvas-type="text" data-canvas-label="套餐总数数值">{canvasText("overview.stat.products.value", `${products.length} 款`)}</strong></div>
        <div data-canvas-element="overview.stat.price" data-canvas-type="group" data-canvas-label="统一组合价"><span data-canvas-element="overview.stat.price.label" data-canvas-type="text" data-canvas-label="统一组合价标签">{canvasText("overview.stat.price.label", "统一组合价")}</span><strong data-canvas-element="overview.stat.price.value" data-canvas-type="text" data-canvas-label="统一组合价数值">{canvasText("overview.stat.price.value", `¥${meta.priceTier}`)}</strong></div>
        <div data-canvas-element="overview.stat.categories" data-canvas-type="group" data-canvas-label="商品分类数"><span data-canvas-element="overview.stat.categories.label" data-canvas-type="text" data-canvas-label="商品分类标签">{canvasText("overview.stat.categories.label", "商品分类")}</span><strong data-canvas-element="overview.stat.categories.value" data-canvas-type="text" data-canvas-label="商品分类数值">{canvasText("overview.stat.categories.value", `${categories.length} 类`)}</strong></div>
        <p data-canvas-element="overview.note" data-canvas-type="text" data-canvas-label="总览说明">{canvasText("overview.note", context.template.showProductIdentifiers ? "每个分类均展示套餐 SKU 与商品名称，便于快速核对招标清单。" : "按分类展示商品名称，便于快速浏览与核对招标清单。")}</p>
      </div>
      <div className={`br-overview-grid ${categories.length > 7 ? "has-eight" : ""} ${context.template.showProductIdentifiers ? "" : "without-product-identifiers"}`}>
        {categories.map((category, index) => {
          const categoryProducts = products.filter((product) => product.categoryId === category.id);
          return (
            <article key={category.id} data-canvas-element={`overview.category.${category.id}`} data-canvas-type="group" data-canvas-label={`${category.name}分类卡片`}>
              <header><span data-canvas-element={`overview.category.${category.id}.number`} data-canvas-type="text" data-canvas-label="分类序号">{canvasText(`overview.category.${category.id}.number`, String(index + 1).padStart(2, "0"))}</span><h3 data-canvas-element={`overview.category.${category.id}.title`} data-canvas-type="text" data-canvas-label="分类名称">{canvasText(`overview.category.${category.id}.title`, category.name)}</h3><small data-canvas-element={`overview.category.${category.id}.count`} data-canvas-type="text" data-canvas-label="分类数量">{canvasText(`overview.category.${category.id}.count`, `${categoryProducts.length} 款`)}</small></header>
              <ul>{categoryProducts.map((product) => {
                const elementId = `overview.product.${product.id}`;
                return <li key={product.id} data-canvas-element={elementId} data-canvas-type="text" data-canvas-label={`${product.name}条目`}>{canvasOverride(elementId)?.text ?? (context.template.showProductIdentifiers ? <><strong>{product.sku}</strong>{product.name}</> : product.name)}</li>;
              })}</ul>
            </article>
          );
        })}
      </div>
      <SlideFooter meta={meta} />
    </div>
  );
}

function ProductGridSlide({ context, debug, interaction }: { context: RenderContext & { slide: Extract<CatalogSlide, { kind: "products" }> }; debug?: boolean; interaction?: EditorInteraction }) {
  const { slide, project: meta, categories, totalSlides } = context;
  const packagePrice = slide.products[0]?.price.package ?? numericPriceTier(slide.products[0]?.priceTier) ?? meta.priceTier;
  const previewProps = { products: slide.products, analyses: slide.plan.analyses, meta, categories, slideId: slide.id, editState: slide.editor, interaction, debug };
  const visualVariant = context.template.layoutVariants.product[slide.plan.type];
  return (
    <div className={`${slideClassName(context, "br-products-slide")} product-visual-${visualVariant}`} style={renderContextCssVariables(context)}>
      <SlideHeader slide={slide} title={`${packagePrice}元档位`} label={`02 / ${slide.plan.type.toUpperCase()}${context.template.showProductIdentifiers ? ` · ${String(slide.sectionPage).padStart(2, "0")}` : ""}`} meta={meta} totalSlides={totalSlides} interaction={interaction} />
      {slide.plan.type === "product-grid-3" && <ProductGrid3Preview {...previewProps} />}
      {slide.plan.type === "product-grid-2" && <ProductGrid2Preview {...previewProps} />}
      {slide.plan.type === "product-feature" && <ProductFeaturePreview {...previewProps} />}
      {slide.plan.type === "package-detail" && <PackageDetailPreview {...previewProps} />}
      {slide.plan.type === "product-image-focus" && <ProductImageFocusPreview {...previewProps} />}
      {slide.plan.type === "mixed-product" && <MixedProductPreview {...previewProps} />}
      <SlideFooter meta={meta} />
    </div>
  );
}

function DeliverySlide({ context, interaction }: { context: RenderContext & { slide: Extract<CatalogSlide, { kind: "delivery" }> }; interaction?: EditorInteraction }) {
  const canvasText = useCanvasTextResolver();
  const { slide, project: meta, products, totalSlides } = context;
  const groups = groupProductsByDeliveryRule(products);
  return (
    <div className={slideClassName(context, "br-delivery-slide")} style={renderContextCssVariables(context)}>
      <SlideHeader slide={slide} title="配送范围说明" label="04 / DELIVERY RULES" meta={meta} totalSlides={totalSlides} interaction={interaction} />
      <section className="br-delivery-intro" data-canvas-element="delivery.intro" data-canvas-type="group" data-canvas-label="配送说明区">
        <h2 data-canvas-element="delivery.heading" data-canvas-type="text" data-canvas-label="配送说明标题">{canvasText("delivery.heading", context.template.showProductIdentifiers ? "配送规则与商品编号清晰对应" : "配送规则与适用商品清晰对应")}</h2>
        <i data-canvas-element="delivery.divider" data-canvas-type="shape" data-canvas-label="配送标题分隔线" />
        <p data-canvas-element="delivery.description" data-canvas-type="text" data-canvas-label="配送说明文字">{canvasText("delivery.description", context.template.showProductIdentifiers ? "同一商品可对应多条规则；编号会同时出现在相关配送范围中，便于招标文件复核。" : "同一商品可对应多条规则；商品名称会列在相关配送范围中，便于快速核对。")}</p>
        <div data-canvas-element="delivery.total" data-canvas-type="group" data-canvas-label="配送统计"><strong data-canvas-element="delivery.total.value" data-canvas-type="text" data-canvas-label="配送统计数值">{canvasText("delivery.total.value", `${products.length}`)}</strong><span data-canvas-element="delivery.total.label" data-canvas-type="text" data-canvas-label="配送统计标签">{canvasText("delivery.total.label", "款套餐已完成配送规则整理")}</span></div>
      </section>
      <section className="br-delivery-groups" data-canvas-element="delivery.groups" data-canvas-type="group" data-canvas-label="配送规则列表">
        {groups.map((group, index) => (
          <article key={group.rule} data-canvas-element={`delivery.rule.${index}`} data-canvas-type="group" data-canvas-label={`${group.rule}规则`}>
            <span data-canvas-element={`delivery.rule.${index}.number`} data-canvas-type="text" data-canvas-label="配送规则序号">{canvasText(`delivery.rule.${index}.number`, String(index + 1).padStart(2, "0"))}</span>
            <h3 data-canvas-element={`delivery.rule.${index}.title`} data-canvas-type="text" data-canvas-label="配送范围">{canvasText(`delivery.rule.${index}.title`, group.rule)}</h3>
            <small data-canvas-element={`delivery.rule.${index}.label`} data-canvas-type="text" data-canvas-label="对应商品标签">{canvasText(`delivery.rule.${index}.label`, "对应商品")}</small>
            <p data-canvas-element={`delivery.rule.${index}.products`} data-canvas-type="text" data-canvas-label="对应商品">{canvasText(`delivery.rule.${index}.products`, context.template.showProductIdentifiers ? (group.productNumbers.length ? group.productNumbers.map((number) => `NO.${number}`).join(" · ") : "—") : (group.productNames.join(" · ") || "—"))}</p>
          </article>
        ))}
        <footer data-canvas-element="delivery.notice" data-canvas-type="text" data-canvas-label="配送备注">{canvasText("delivery.notice", "* 最终配送范围与履约时效以招标文件、供应商可达范围及下单确认结果为准。")}</footer>
      </section>
      <SlideFooter meta={meta} />
    </div>
  );
}

function EndingSlide({ context, interaction }: { context: RenderContext; interaction?: EditorInteraction }) {
  const canvasText = useCanvasTextResolver();
  const { project: meta, totalSlides } = context;
  return (
    <div className={slideClassName(context, "br-ending-slide")} style={renderContextCssVariables(context)}>
      <section className="br-ending-thanks" data-canvas-element="ending.copy" data-canvas-type="group" data-canvas-label="致谢页文案区">
        <header>
          <strong data-canvas-element="brand.name" data-canvas-type="text" data-canvas-label="品牌名称">{canvasText("brand.name", getEffectiveBrand(meta))}</strong>
          <p data-canvas-element="ending.edition" data-canvas-type="text" data-canvas-label="版本名称">{canvasText("ending.edition", meta.edition)}</p>
        </header>
        <h2 data-canvas-element="ending.thanks" data-canvas-type="text" data-canvas-label="感谢文字">{canvasText("ending.thanks", "THANK YOU")}</h2>
        <h3
          data-canvas-element="ending.title"
          data-canvas-type="text"
          data-canvas-label="结束页主标题"
          contentEditable={interaction?.enabled}
          suppressContentEditableWarning
          onClick={(event) => { if (interaction?.enabled) { event.stopPropagation(); interaction.onSelect({ type: "title", slideId: context.slide.id }); } }}
          onBlur={(event) => { const value = event.currentTarget.textContent?.trim(); if (interaction?.enabled && value) interaction.onSlideEdit(context.slide.id, { customTitle: value }); }}
        >{canvasText("ending.title", context.slide.editor?.customTitle || "感谢浏览")}</h3>
        <i data-canvas-element="ending.divider" data-canvas-type="shape" data-canvas-label="结束页分隔线" />
        <p data-canvas-element="ending.project" data-canvas-type="text" data-canvas-label="项目名称">{canvasText("ending.project", `${meta.year} 年${getProjectDisplayName(meta)}`)}</p>
        <p data-canvas-element="ending.service" data-canvas-type="text" data-canvas-label="服务专线">{canvasText("ending.service", `礼品服务专线  ${meta.serviceLine}`)}</p>
        <small data-canvas-element="ending.page" data-canvas-type="text" data-canvas-label="结束页页码">{canvasText("ending.page", `${totalSlides} / ${totalSlides}`)}</small>
      </section>
    </div>
  );
}

function ManualSlideView({ context, interaction }: { context: RenderContext & { slide: Extract<CatalogSlide, { kind: "manual" }> }; interaction?: EditorInteraction }) {
  const canvasText = useCanvasTextResolver();
  const { slide, project: meta, totalSlides } = context;
  const title = slide.editor?.customTitle || slide.manual.data.title || ({ title: "标题页", text: "文字说明", product: "精选商品", category: "商品分类", ending: "感谢浏览" } as const)[slide.manual.type];
  return (
    <div className={slideClassName(context, `br-manual-slide manual-${slide.manual.type}`)} style={renderContextCssVariables(context)}>
      <SlideHeader slide={slide} title={title} label="MANUAL / CUSTOM" meta={meta} totalSlides={totalSlides} interaction={interaction} />
      <section className="br-manual-content" data-canvas-element="manual.content" data-canvas-type="group" data-canvas-label="自定义内容区">
        <p data-canvas-element="manual.subtitle" data-canvas-type="text" data-canvas-label="自定义副标题">{canvasText("manual.subtitle", slide.manual.data.subtitle || "自定义页面")}</p>
        <h1 data-canvas-element="manual.title" data-canvas-type="text" data-canvas-label="自定义标题">{canvasText("manual.title", title)}</h1>
        <i data-canvas-element="manual.divider" data-canvas-type="shape" data-canvas-label="自定义分隔线" />
        <div data-canvas-element="manual.body" data-canvas-type="text" data-canvas-label="自定义正文">{canvasText("manual.body", slide.manual.data.body || "在右侧属性面板编辑本页标题与正文。")}</div>
      </section>
      <SlideFooter meta={meta} />
    </div>
  );
}

export function BusinessRedSlide({ slide, meta, products, categories, totalSlides, debug, interaction }: PresentationSlideProps) {
  const slideMeta = getSlideCatalogMeta(meta, slide);
  const slideProducts = getSlideProducts(products, slide);
  const context = createRenderContext({ project: slideMeta, slide, products: slideProducts, categories, totalSlides });
  switch (slide.kind) {
    case "cover": return <CoverSlide context={context} interaction={interaction} />;
    case "category-overview": return <OverviewSlide context={{ ...context, slide }} interaction={interaction} />;
    case "products": return <ProductGridSlide context={{ ...context, slide }} debug={debug} interaction={interaction} />;
    case "delivery": return <DeliverySlide context={{ ...context, slide }} interaction={interaction} />;
    case "end": return <EndingSlide context={context} interaction={interaction} />;
    case "manual": return <ManualSlideView context={{ ...context, slide }} interaction={interaction} />;
  }
}
