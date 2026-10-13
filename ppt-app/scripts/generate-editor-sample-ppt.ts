import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { catalogMeta, productCategories } from "../data/catalog";
import { mockProducts } from "../data/mock-products";
import { createFinalPresentationModel } from "../src/lib/editor/createFinalPresentationModel";
import { createSlidePlan } from "../src/lib/layout/createSlidePlan";
import { buildPpt } from "../src/lib/ppt/generatePpt";
import { emptyEditorState, sectionOverrideKey, type EditorState } from "../types/editor";

async function main() {
  const outputDirectory = resolve("output");
  await mkdir(outputDirectory, { recursive: true });

  const products = mockProducts.map((product, index) => index === 0 ? {
    ...product,
    name: "五常稻花香大米组合 · 编辑验收",
    price: { ...product.price, package: 188 },
  } : product);
  const slidePlans = createSlidePlan(products, { mode: "smart" });
  const firstPlan = slidePlans[0];
  const firstProduct = products[0];
  const manualId = "manual-editor-qa";
  const editorState: EditorState = {
    ...emptyEditorState(),
    slides: {
      cover: { slideId: "cover", customTitle: "结构化 PPT 编辑验收版", styleOverrides: { titleFontSize: 31, titleColor: "#F7E7C1" } },
      [firstPlan.id]: {
        slideId: firstPlan.id,
        hiddenSections: [sectionOverrideKey(firstProduct.id, "marketPrice"), sectionOverrideKey(firstProduct.id, "delivery")],
        imageOverrides: {
          [firstProduct.id]: {
            source: firstProduct.images?.[0] ?? firstProduct.image,
            fit: "cover",
            scale: 1.08,
            offsetX: 4,
            offsetY: -3,
          },
        },
      },
      [manualId]: { slideId: manualId, styleOverrides: { titleColor: "#A81F2D", titleFontSize: 30 } },
    },
    manualSlides: {
      [manualId]: {
        id: manualId,
        type: "text",
        data: {
          title: "编辑验收说明页",
          subtitle: "Final Presentation Model",
          body: "此页由轻量结构化编辑器新增。\n网页预览与 PPTX 导出共用同一份最终演示数据。\n文字、图片、形状在 PowerPoint 中仍可编辑。",
        },
        createdAt: 1,
      },
    },
    slideOrder: ["cover", manualId],
    hiddenSlideIds: [],
    lockedSlideIds: [firstPlan.id],
  };
  const presentationModel = createFinalPresentationModel({
    project: catalogMeta,
    products,
    categories: productCategories,
    slidePlans,
    editorState,
  });
  const result = await buildPpt({
    meta: presentationModel.project,
    products: presentationModel.products,
    categories: presentationModel.categories,
    slidePlans: presentationModel.slidePlans,
    editorState,
    presentationModel,
  });
  const outputPath = resolve(outputDirectory, "phase8-structured-editor-sample.pptx");
  await result.presentation.writeFile({ fileName: outputPath, compression: true });
  console.log(JSON.stringify({ outputPath, slideCount: result.slideCount, warnings: result.warnings }, null, 2));
}

main().catch((error) => {
  console.error("Failed to generate editor sample PPTX", error);
  process.exitCode = 1;
});
