import { buildCatalogSlides } from "@/lib/pagination";
import type { CatalogMeta, CatalogSlide, ManualCatalogSlide, Product, ProductCategory } from "@/types/catalog";
import type { EditorState, SlideEditState } from "@/types/editor";
import type { SlidePlan } from "@/src/lib/layout/types";
import { createSlidePlan } from "@/src/lib/layout/createSlidePlan";

export interface FinalPresentationModel {
  project: CatalogMeta;
  products: Product[];
  categories: ProductCategory[];
  slidePlans: SlidePlan[];
  slides: CatalogSlide[];
  editorState: EditorState;
}

function applyProductOrder(slide: Extract<CatalogSlide, { kind: "products" }>, edit?: SlideEditState) {
  if (!edit?.productOrder?.length) return slide;
  const rank = new Map(edit.productOrder.map((id, index) => [id, index]));
  const products = [...slide.products].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  const analysisById = new Map(slide.plan.analyses.map((analysis) => [analysis.productId, analysis]));
  return {
    ...slide,
    products,
    plan: {
      ...slide.plan,
      productIds: products.map((product) => product.id),
      analyses: products.map((product) => analysisById.get(product.id)).filter((value): value is NonNullable<typeof value> => Boolean(value)),
    },
  };
}

function makeManualSlide(manual: EditorState["manualSlides"][string], products: Product[], edit?: SlideEditState): CatalogSlide {
  if (manual.type === "product") {
    const requested = new Set(manual.data.productIds ?? []);
    const selected = (requested.size ? products.filter((product) => requested.has(product.id)) : products.slice(0, 3)).slice(0, 3);
    const plan = createSlidePlan(selected, { mode: "force-grid-3" })[0];
    if (plan) return { id: manual.id, kind: "products", pageNumber: 0, products: selected, sectionNumber: 3, sectionPage: 1, plan: { ...plan, id: manual.id, source: "manual" }, editor: edit };
  }
  return { id: manual.id, kind: "manual", pageNumber: 0, manual, editor: edit } satisfies ManualCatalogSlide;
}

export function createFinalPresentationModel(input: {
  project: CatalogMeta;
  products: Product[];
  categories: ProductCategory[];
  slidePlans: SlidePlan[];
  editorState: EditorState;
}): FinalPresentationModel {
  const automatic = buildCatalogSlides(input.products, input.slidePlans).map((slide) => {
    const edit = input.editorState.slides[slide.id];
    const withEdit = { ...slide, editor: edit } as CatalogSlide;
    return withEdit.kind === "products" ? applyProductOrder(withEdit, edit) : withEdit;
  });
  const manual = Object.values(input.editorState.manualSlides).map((slide) => makeManualSlide(slide, input.products, input.editorState.slides[slide.id]));
  const byId = new Map([...automatic, ...manual].map((slide) => [slide.id, slide]));
  const requestedOrder = input.editorState.slideOrder.filter((id) => byId.has(id));
  const missing = [...automatic, ...manual].map((slide) => slide.id).filter((id) => !requestedOrder.includes(id));
  const hidden = new Set(input.editorState.hiddenSlideIds);
  const visibleSlides = [...requestedOrder, ...missing]
    .map((id) => byId.get(id))
    .filter((slide): slide is CatalogSlide => slide !== undefined && !hidden.has(slide.id));
  const slides = (visibleSlides.length ? visibleSlides : automatic.slice(0, 1))
    .map((slide, index) => ({ ...slide, pageNumber: index + 1 }));

  return { ...input, slides };
}

export function hasSlideCustomizations(editorState: EditorState, slideId: string) {
  const edit = editorState.slides[slideId];
  return Boolean(edit && Object.keys(edit).some((key) => key !== "slideId"))
    || editorState.lockedSlideIds.includes(slideId)
    || Object.prototype.hasOwnProperty.call(editorState.manualSlides, slideId);
}
