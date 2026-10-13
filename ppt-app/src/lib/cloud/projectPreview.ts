import type { CloudProjectSnapshot } from "@/src/server/projects/types";
import { withInferredPriceTier } from "@/src/lib/catalog/project";
import { getProjectCategories } from "@/src/lib/catalog/categories";
import { createSlidePlan } from "@/src/lib/layout/createSlidePlan";
import { createFinalPresentationModel } from "@/src/lib/editor/createFinalPresentationModel";
import { resolveTemplateLayoutMode } from "@/src/templates/registry";

/** The exact editor pipeline, including page order, hidden pages and local edits. */
export function createProjectPreview(snapshot: CloudProjectSnapshot) {
  const meta = withInferredPriceTier(snapshot.project, snapshot.products);
  const categories = getProjectCategories(snapshot.products);
  const slidePlans = createSlidePlan(snapshot.products, { mode: resolveTemplateLayoutMode(meta.design.templateId, snapshot.layoutMode), overrides: snapshot.layoutOverrides });
  const model = createFinalPresentationModel({ project: meta, products: snapshot.products, categories, slidePlans, editorState: snapshot.editorState });
  const slide = model.slides[0];
  const products = model.products.filter((product) => slide?.kind !== "products" || slide.plan.productIds.includes(product.id)).map(({ rawData, aiMetadata, sources, importMetadata, ...product }) => product);
  return { slide, meta: model.project, products, categories: model.categories, totalSlides: model.slides.length };
}
export type ProjectPagePreview = ReturnType<typeof createProjectPreview>;
