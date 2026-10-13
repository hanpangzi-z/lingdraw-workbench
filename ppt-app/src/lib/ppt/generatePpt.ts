import PptxGenJS from "pptxgenjs";
import { buildCatalogSlides } from "@/lib/pagination";
import { slideLayout } from "@/src/config/slideLayout";
import { getCatalogFileName, preloadImages } from "./helpers";
import { getProductImages } from "@/src/lib/catalog/images";
import { addCoverSlide } from "./layouts/cover";
import { addDeliverySlide } from "./layouts/delivery";
import { addEndingSlide } from "./layouts/ending";
import { addOverviewSlide } from "./layouts/overview";
import { createSlidePlan } from "@/src/lib/layout/createSlidePlan";
import { exportProductGrid3 } from "@/src/lib/layout/layouts/productGrid3/exportPpt";
import { exportProductGrid2 } from "@/src/lib/layout/layouts/productGrid2/exportPpt";
import { exportProductFeature } from "@/src/lib/layout/layouts/productFeature/exportPpt";
import { exportPackageDetail } from "@/src/lib/layout/layouts/packageDetail/exportPpt";
import { exportProductImageFocus } from "@/src/lib/layout/layouts/productImageFocus/exportPpt";
import { exportMixedProduct } from "@/src/lib/layout/layouts/mixedProduct/exportPpt";
import { getTemplate } from "@/src/templates/registry";
import { resolvePptTheme } from "@/src/themes/registry";
import { getEffectiveBrand, getEffectiveLogo } from "@/src/render/context";
import { createFinalPresentationModel } from "@/src/lib/editor/createFinalPresentationModel";
import { emptyEditorState } from "@/types/editor";
import { addManualSlide } from "./layouts/manual";
import { withInferredPriceTier } from "@/src/lib/catalog/project";
import { getSlideCatalogMeta, getSlideProducts } from "@/src/lib/catalog/tiers";
import type { LayoutContext, PptBlobResult, PptBuildResult, PptExportResult, PptGenerationInput } from "./types";

export async function buildPpt(input: PptGenerationInput): Promise<PptBuildResult> {
  const pptx = new PptxGenJS();
  const resolvedInputMeta = withInferredPriceTier(input.meta, input.products);
  const requestedTemplate = getTemplate(resolvedInputMeta.design.templateId);
  const slidePlans = input.presentationModel?.slidePlans ?? input.slidePlans ?? createSlidePlan(input.products, { mode: requestedTemplate.defaultLayoutMode ?? "smart" });
  const model = input.presentationModel ?? createFinalPresentationModel({ project: resolvedInputMeta, products: input.products, categories: input.categories, slidePlans, editorState: input.editorState ?? emptyEditorState() });
  const slides = model.slides;
  const meta = withInferredPriceTier(model.project, model.products);
  const products = model.products;
  const categories = model.categories;
  const fileName = getCatalogFileName(meta);
  const template = getTemplate(meta.design.templateId);
  const theme = resolvePptTheme(meta.design.themeId, meta.design.themeOverrides, meta.design.brandColor);
  const brand = getEffectiveBrand(meta);

  pptx.defineLayout({
    name: slideLayout.name,
    width: slideLayout.width,
    height: slideLayout.height,
  });
  pptx.layout = slideLayout.name;
  pptx.author = brand;
  pptx.company = brand;
  pptx.subject = `${meta.year} 年${meta.projectName}产品手册`;
  pptx.title = fileName.replace(/\.pptx$/i, "");
  pptx.revision = "1";
  pptx.theme = {
    headFontFace: theme.typography.title,
    bodyFontFace: theme.typography.body,
  };

  const { assets } = await preloadImages([
    getEffectiveLogo(meta),
    ...categories.map((category) => category.coverImage),
    ...products.flatMap(getProductImages),
    ...slides.flatMap((current) => Object.values(current.editor?.imageOverrides ?? {}).map((override) => override.source)),
    ...slides.flatMap((current) => Object.values(current.editor?.elementOverrides ?? {}).map((override) => override.image?.source)),
  ]);
  const warnings: string[] = [];

  for (const currentSlide of slides) {
    const imageFailures = new Set<string>();
    const slide = pptx.addSlide();
    const slideMeta = getSlideCatalogMeta(meta, currentSlide);
    const slideProducts = getSlideProducts(products, currentSlide);
    const context: LayoutContext = {
      meta: slideMeta,
      products: slideProducts,
      categories,
      slidePlans,
      editorState: model.editorState,
      presentationModel: model,
      pptx,
      slide,
      theme,
      template,
      assets,
      currentSlide,
      totalSlides: slides.length,
      imageFailures,
    };

    switch (currentSlide.kind) {
      case "cover":
        addCoverSlide(context);
        break;
      case "category-overview":
        addOverviewSlide(context);
        break;
      case "products":
        if (currentSlide.plan.type === "product-grid-3") exportProductGrid3(context);
        else if (currentSlide.plan.type === "product-grid-2") exportProductGrid2(context);
        else if (currentSlide.plan.type === "product-feature") exportProductFeature(context);
        else if (currentSlide.plan.type === "package-detail") exportPackageDetail(context);
        else if (currentSlide.plan.type === "product-image-focus") exportProductImageFocus(context);
        else exportMixedProduct(context);
        break;
      case "delivery":
        addDeliverySlide(context);
        break;
      case "end":
        addEndingSlide(context);
        break;
      case "manual":
        addManualSlide(context);
        break;
    }
    const localBackground = currentSlide.editor?.styleOverrides?.backgroundColor?.replace(/^#/, "");
    for (const source of imageFailures) {
      const label = source.startsWith("data:") || source.startsWith("blob:") ? "本地图片" : source;
      warnings.push(`第 ${currentSlide.pageNumber} 页 · 图片加载失败：${label}`);
    }
    if (localBackground) slide.background = { color: localBackground };
  }

  return {
    presentation: pptx,
    fileName,
    slideCount: slides.length,
    warnings,
  };
}

export async function generatePpt(input: PptGenerationInput): Promise<PptExportResult> {
  const result = await buildPpt(input);
  await result.presentation.writeFile({ fileName: result.fileName, compression: true });

  return {
    fileName: result.fileName,
    slideCount: result.slideCount,
    warnings: result.warnings,
  };
}

export async function generatePptBlob(input: PptGenerationInput): Promise<PptBlobResult> {
  const result = await buildPpt(input);
  const output = await result.presentation.write({ outputType: "blob", compression: true });
  const blob = output instanceof Blob ? output : new Blob([output as BlobPart], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  return { fileName: result.fileName, slideCount: result.slideCount, warnings: result.warnings, blob };
}

export function downloadPptBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}
