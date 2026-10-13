import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import { catalogMeta, productCategories } from "@/data/catalog";
import { mockProducts } from "@/data/mock-products";
import { createFinalPresentationModel } from "@/src/lib/editor/createFinalPresentationModel";
import { createSlidePlan } from "@/src/lib/layout/createSlidePlan";
import { buildPpt } from "@/src/lib/ppt/generatePpt";
import { getTransformedImageSizing } from "@/src/lib/ppt/helpers";
import { useProjectStore } from "@/src/store/projectStore";
import { emptyEditorState, sectionOverrideKey, type EditorState } from "@/types/editor";
import { moveCanvasTransform, resizeCanvasTransform, resolveCanvasTransform, stepCanvasViewportZoom } from "@/src/lib/editor/canvas";
import { clampSlideIndex } from "@/src/lib/editor/slideSelection";

const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlQn0YAAAAASUVORK5CYII=";
const categories = productCategories.map((category) => ({ ...category, coverImage: onePixelPng }));

function makeModel(products = mockProducts.slice(0, 3), editorState: EditorState = emptyEditorState()) {
  const slidePlans = createSlidePlan(products, { mode: "force-grid-3" });
  return createFinalPresentationModel({ project: catalogMeta, products, categories, slidePlans, editorState });
}

async function pptXml(model: ReturnType<typeof makeModel>, slideNumber = 2) {
  const result = await buildPpt({ meta: model.project, products: model.products, categories: model.categories, slidePlans: model.slidePlans, presentationModel: model });
  const output = await result.presentation.write({ outputType: "uint8array", compression: true });
  const zip = await JSZip.loadAsync(output as Uint8Array);
  return { result, xml: await zip.file(`ppt/slides/slide${slideNumber}.xml`)!.async("text") };
}

function slideObjectXml(xml: string, elementId: string) {
  const marker = `name="folio:${elementId}"`;
  const markerIndex = xml.indexOf(marker);
  expect(markerIndex, `missing PPT object ${elementId}`).toBeGreaterThanOrEqual(0);
  const shapeStart = xml.lastIndexOf("<p:sp>", markerIndex);
  const pictureStart = xml.lastIndexOf("<p:pic>", markerIndex);
  const start = Math.max(shapeStart, pictureStart);
  const closing = start === pictureStart ? "</p:pic>" : "</p:sp>";
  const end = xml.indexOf(closing, markerIndex);
  return xml.slice(start, end + closing.length);
}

function objectPosition(xml: string, elementId: string) {
  const object = slideObjectXml(xml, elementId);
  const match = object.match(/<a:off x="(\d+)" y="(\d+)"\/>/);
  expect(match, `missing position for ${elementId}`).not.toBeNull();
  return { x: Number(match![1]) / 914400, y: Number(match![2]) / 914400 };
}

describe("Phase 8 structured editor", () => {
  it("steps the slide viewport zoom in either wheel direction and respects its limits", () => {
    expect(stepCanvasViewportZoom("fit", "in")).toBe(125);
    expect(stepCanvasViewportZoom("fit", "out")).toBe(75);
    expect(stepCanvasViewportZoom(50, "out")).toBe(50);
    expect(stepCanvasViewportZoom(125, "in")).toBe(125);
  });

  it("clamps a stale selected index when the presentation becomes shorter", () => {
    const model = makeModel(mockProducts.slice(0, 1));
    const selectedIndex = clampSlideIndex(99, model.slides.length);

    expect(selectedIndex).toBe(model.slides.length - 1);
    expect(model.slides[selectedIndex]).toBeDefined();
    expect(clampSlideIndex(-1, model.slides.length)).toBe(0);
  });

  it("clips zoomed PPT images to the same frame used by the web preview", () => {
    const frame = { x: 0.46, y: 0.92, w: 7.82, h: 5.98 };
    const sizing = getTransformedImageSizing(
      { data: onePixelPng, width: 1536, height: 1024, source: onePixelPng },
      frame,
      "contain",
      true,
      { fit: "contain", scale: 1.25, offsetX: 0, offsetY: 0 },
    );
    expect(sizing).toBeDefined();
    expect(Number(sizing!.x)).toBe(frame.x);
    expect(Number(sizing!.y)).toBe(frame.y);
    expect(sizing!.sizing?.type).toBe("crop");
    expect(Number(sizing!.sizing?.w)).toBe(frame.w);
    expect(Number(sizing!.sizing?.h)).toBe(frame.h);
    expect(Number(sizing!.sizing?.x)).toBeGreaterThanOrEqual(0);
    expect(Number(sizing!.sizing?.y)).toBeGreaterThanOrEqual(0);
    expect(Number(sizing!.sizing?.x) + frame.w).toBeLessThanOrEqual(Number(sizing!.w) + 0.001);
    expect(Number(sizing!.sizing?.y) + frame.h).toBeLessThanOrEqual(Number(sizing!.h) + 0.001);
    expect(Number(sizing!.w) / Number(sizing!.h)).toBeCloseTo(1536 / 1024, 4);
  });

  it("keeps the single-product PPT layout aligned with the web preview tokens", async () => {
    const base = mockProducts[0];
    const product = {
      ...base,
      id: "preview-parity-product",
      productNumber: "01",
      name: "生鲜组合",
      image: onePixelPng,
      images: [onePixelPng],
      details: ["明细一", "明细二", "明细三"],
      components: [
        { name: "【云仓】天萃庭牛肉炖煮组合2.5kg", details: ["牛腩块500g/袋*1", "牛腱子500g/袋*1"] },
        { name: "【云仓】OCEAN SIR精选海鲜礼包1.9kg", details: ["南美白对虾200g", "深海大黄鱼400g"] },
        { name: "第三个商品名称", details: ["中文 English 500g"] },
      ],
      price: { ...base.price, market: 676, package: 500 },
    };
    const slidePlans = createSlidePlan([product], { mode: "force-single-image" });
    const model = createFinalPresentationModel({ project: catalogMeta, products: [product], categories, slidePlans, editorState: emptyEditorState() });
    const { xml } = await pptXml(model);

    expect(slideObjectXml(xml, `product.${product.id}.content`)).toContain("F4F1EB");
    expect(slideObjectXml(xml, `product.${product.id}.prices`)).toContain("F7E4E5");
    expect(slideObjectXml(xml, `product.${product.id}.title`)).not.toContain(' b="1"');
    expect(slideObjectXml(xml, `product.${product.id}.component.0.title`)).not.toContain(' b="1"');

    const sequence = objectPosition(xml, `product.${product.id}.sequence`);
    const title = objectPosition(xml, `product.${product.id}.title`);
    const headerTitle = objectPosition(xml, "header.title");
    expect(sequence.y).toBeCloseTo(1.127, 2);
    expect(title.y).toBeCloseTo(1.363, 2);
    expect(headerTitle.x).toBeCloseTo(5.484, 2);
    expect(slideObjectXml(xml, "header.title")).toContain('sz="1286"');

    const firstComponent = objectPosition(xml, `product.${product.id}.component.0.title`);
    const thirdComponent = objectPosition(xml, `product.${product.id}.component.2.title`);
    expect(thirdComponent.x).toBeCloseTo(firstComponent.x, 2);
    expect(thirdComponent.y).toBeGreaterThan(firstComponent.y);
  }, 30_000);

  beforeEach(() => {
    useProjectStore.setState({
      project: catalogMeta,
      products: mockProducts.slice(0, 5),
      layoutOverrides: {},
      layoutRevision: 0,
      editorState: emptyEditorState(),
      editorPast: [],
      editorFuture: [],
      initialSnapshot: undefined,
      saveStatus: "saved",
    });
    useProjectStore.getState().initializeEditor();
  });

  it("keeps business edits in Product data and supports 50-step undo/redo history", () => {
    const first = mockProducts[0];
    useProjectStore.getState().editorUpdateProduct(first.id, { name: "编辑后的商品名称" });
    useProjectStore.getState().editorUpdateProductPrice(first.id, { package: 188 });
    expect(useProjectStore.getState().products[0]).toMatchObject({ name: "编辑后的商品名称", price: { package: 188 } });
    useProjectStore.getState().undoEditor();
    expect(useProjectStore.getState().products[0].price.package).not.toBe(188);
    useProjectStore.getState().redoEditor();
    expect(useProjectStore.getState().products[0].price.package).toBe(188);
    expect(useProjectStore.getState().editorPast.length).toBeLessThanOrEqual(50);
  });

  it("exports edited names and prices from the same final model used by preview", async () => {
    const products = mockProducts.slice(0, 3).map((product, index) => index ? product : { ...product, name: "中英文编辑同步 Edited Product", price: { ...product.price, package: 188 } });
    const model = makeModel(products);
    expect(model.slides.find((slide) => slide.kind === "products")?.products[0].name).toBe("中英文编辑同步 Edited Product");
    const { xml } = await pptXml(model);
    expect(xml).toContain("中英文编辑同步 Edited Product");
    expect(xml).toContain("188");
  }, 30_000);

  it("applies image replacement, fit transform, hidden market price and hidden delivery to PPTX", async () => {
    const products = mockProducts.slice(0, 3).map((product, index) => ({ ...product, image: onePixelPng, images: [onePixelPng], deliveryRegions: index === 0 ? ["仅测试配送"] : product.deliveryRegions, price: index === 0 ? { ...product.price, market: 9876 } : product.price }));
    const plan = createSlidePlan(products, { mode: "force-grid-3" })[0];
    const first = products[0];
    const editorState: EditorState = {
      ...emptyEditorState(),
      slides: {
        [plan.id]: {
          slideId: plan.id,
          hiddenSections: [sectionOverrideKey(first.id, "marketPrice"), sectionOverrideKey(first.id, "delivery")],
          imageOverrides: { [first.id]: { source: onePixelPng, fit: "cover", scale: 1.2, offsetX: 8, offsetY: -5 } },
        },
      },
    };
    const model = makeModel(products, editorState);
    const { xml } = await pptXml(model);
    expect(xml).toContain("<p:pic>");
    expect(xml).not.toContain("9876");
    expect(xml).not.toContain(`配送：${first.deliveryRegions.join(" · ")}`);
  }, 30_000);

  it("preserves manual layout and content edits while switching templates", () => {
    const first = mockProducts[0];
    useProjectStore.getState().setPageLayoutOverride(first.id, "product-grid-2");
    useProjectStore.getState().editorUpdateProduct(first.id, { name: "模板切换后保留" });
    useProjectStore.getState().editorUpdateDesign({
      brandColor: "#FF6600",
      brandName: "测试品牌",
    });
    useProjectStore
      .getState()
      .editorUpdateThemeOverrides({ primary: "#123456", titleFont: "Arial" });
    useProjectStore.getState().editorSetTemplate("premium-gift");
    const state = useProjectStore.getState();
    expect(state.layoutOverrides[first.id].type).toBe("product-grid-2");
    expect(state.products[0].name).toBe("模板切换后保留");
    expect(state.project.design).toMatchObject({
      templateId: "premium-gift",
      themeId: "premium-dark",
      themeOverrides: {},
      brandName: "测试品牌",
    });
    expect(state.project.design.brandColor).toBeUndefined();
  });

  it("supports manual slides, slide ordering, hiding and native PPTX export", async () => {
    const base = makeModel();
    const manualId = "manual-test";
    const editorState: EditorState = {
      ...emptyEditorState(),
      manualSlides: { [manualId]: { id: manualId, type: "text", data: { title: "人工说明页", body: "本页由轻量编辑器新增并导出。" }, createdAt: 1 } },
      slideOrder: ["cover", manualId, ...base.slides.filter((slide) => slide.id !== "cover").map((slide) => slide.id)],
      hiddenSlideIds: ["end"],
    };
    const model = makeModel(undefined, editorState);
    expect(model.slides[1]).toMatchObject({ id: manualId, kind: "manual", pageNumber: 2 });
    expect(model.slides.some((slide) => slide.id === "end")).toBe(false);
    const { result, xml } = await pptXml(model, 2);
    expect(result.slideCount).toBe(base.slides.length);
    expect(xml).toContain("人工说明页");
    expect(xml).toContain("<p:sp>");
  }, 30_000);

  it("resets page overrides without restoring business Product edits", () => {
    const first = mockProducts[0];
    const slideId = `products-${first.id}`;
    useProjectStore.getState().editorUpdateProduct(first.id, { name: "业务数据保留" });
    useProjectStore.getState().updateSlideEdit(slideId, { customTitle: "局部标题", hiddenSections: [sectionOverrideKey(first.id, "details")] });
    useProjectStore.getState().resetSlideEdit(slideId);
    expect(useProjectStore.getState().editorState.slides[slideId]).toBeUndefined();
    expect(useProjectStore.getState().products[0].name).toBe("业务数据保留");
  });

  it("hides and restores the price zone on every product slide in one undoable edit", () => {
    const slideIds = createSlidePlan(mockProducts.slice(0, 5), { mode: "force-grid-3" }).map((plan) => plan.id);
    const first = mockProducts[0];
    useProjectStore.getState().toggleSlideSection(slideIds[0], first.id, "details", false);
    const historyBeforeBulkEdit = useProjectStore.getState().editorPast.length;

    useProjectStore.getState().setPriceZonesVisibility(slideIds, false);

    for (const slideId of slideIds) {
      const hidden = useProjectStore.getState().editorState.slides[slideId].hiddenSections;
      expect(hidden).toEqual(expect.arrayContaining(["marketPrice", "salePrice"]));
    }
    expect(useProjectStore.getState().editorPast).toHaveLength(historyBeforeBulkEdit + 1);

    useProjectStore.getState().undoEditor();
    expect(useProjectStore.getState().editorState.slides[slideIds[0]].hiddenSections).toContain(sectionOverrideKey(first.id, "details"));
    expect(useProjectStore.getState().editorState.slides[slideIds[0]].hiddenSections).not.toContain("marketPrice");

    const secondSlideProduct = mockProducts[3];
    const legacyPriceElementId = `product.${secondSlideProduct.id}.prices`;
    useProjectStore.getState().setCanvasElementOverride(slideIds[1], legacyPriceElementId, {
      type: "group",
      hidden: true,
    });
    useProjectStore.getState().toggleSlideSection(slideIds[1], secondSlideProduct.id, "marketPrice", false);
    useProjectStore.getState().setPriceZonesVisibility(slideIds, false);
    useProjectStore.getState().setPriceZonesVisibility(slideIds, true);
    for (const slideId of slideIds) {
      const hidden = useProjectStore.getState().editorState.slides[slideId].hiddenSections ?? [];
      expect(hidden).not.toContain("marketPrice");
      expect(hidden).not.toContain("salePrice");
    }
    expect(useProjectStore.getState().editorState.slides[slideIds[0]].hiddenSections).toContain(sectionOverrideKey(first.id, "details"));
    expect(useProjectStore.getState().editorState.slides[slideIds[1]].hiddenSections).not.toContain(sectionOverrideKey(secondSlideProduct.id, "marketPrice"));
    expect(useProjectStore.getState().editorState.slides[slideIds[1]].elementOverrides?.[legacyPriceElementId]?.hidden).toBeUndefined();
  });

  it("changes the price-zone background globally and clears legacy page-level colors", () => {
    const slideIds = createSlidePlan(mockProducts.slice(0, 5), { mode: "force-grid-3" }).map((plan) => plan.id);
    const firstPriceId = `product.${mockProducts[0].id}.prices`;
    const secondPriceId = `product.${mockProducts[3].id}.prices`;
    const titleId = `product.${mockProducts[0].id}.title`;
    useProjectStore.getState().setCanvasElementOverride(slideIds[0], firstPriceId, {
      type: "group",
      transform: { x: 1, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      style: { fillColor: "#AA0000" },
    });
    useProjectStore.getState().setCanvasElementOverride(slideIds[1], secondPriceId, {
      type: "group",
      style: { fillColor: "#00AA00", color: "#111111" },
    });
    useProjectStore.getState().setCanvasElementOverride(slideIds[0], titleId, {
      type: "text",
      style: { fillColor: "#ABCDEF" },
    });
    const historyBefore = useProjectStore.getState().editorPast.length;

    useProjectStore.getState().setPriceZoneBackground("#DCEEFF");

    const state = useProjectStore.getState();
    expect(state.project.design.themeOverrides.priceBackground).toBe("#DCEEFF");
    expect(state.editorState.slides[slideIds[0]].elementOverrides?.[firstPriceId]?.style?.fillColor).toBeUndefined();
    expect(state.editorState.slides[slideIds[0]].elementOverrides?.[firstPriceId]?.transform?.x).toBe(1);
    expect(state.editorState.slides[slideIds[1]].elementOverrides?.[secondPriceId]?.style).toEqual({ color: "#111111" });
    expect(state.editorState.slides[slideIds[0]].elementOverrides?.[titleId]?.style?.fillColor).toBe("#ABCDEF");
    expect(state.editorPast).toHaveLength(historyBefore + 1);

    useProjectStore.getState().undoEditor();
    expect(useProjectStore.getState().project.design.themeOverrides.priceBackground).toBeUndefined();
    expect(useProjectStore.getState().editorState.slides[slideIds[0]].elementOverrides?.[firstPriceId]?.style?.fillColor).toBe("#AA0000");
  });

  it("flags long content and remains deterministic with 100 products", () => {
    const products = Array.from({ length: 100 }, (_, index) => ({
      ...mockProducts[index % mockProducts.length],
      id: `perf-${index}`,
      productNumber: String(index + 1).padStart(2, "0"),
      name: index === 0 ? "这是一个经过用户编辑后非常非常长并且混合 English Product Collection 2026 的商品名称" : mockProducts[index % mockProducts.length].name,
    }));
    const started = performance.now();
    const plans = createSlidePlan(products, { mode: "smart" });
    const model = createFinalPresentationModel({ project: catalogMeta, products, categories, slidePlans: plans, editorState: emptyEditorState() });
    expect(model.slides.filter((slide) => slide.kind === "products").length).toBe(plans.length);
    expect(plans.some((plan) => plan.overflow.overflow || plan.analyses.some((analysis) => analysis.titleLength > 20))).toBe(true);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("stores freeform element edits with undo and reset support", () => {
    const slideId = `products-${mockProducts[0].id}`;
    const elementId = `product.${mockProducts[0].id}.title`;
    useProjectStore.getState().setCanvasElementOverride(slideId, elementId, {
      type: "text",
      label: "商品名称",
      text: "自由编辑后的标题",
      transform: { x: 3, y: -2, scaleX: 1.2, scaleY: 1, rotation: 0 },
      style: { fontSize: 20, fontWeight: 700, color: "#C62D42" },
    });
    expect(useProjectStore.getState().editorState.slides[slideId].elementOverrides?.[elementId]?.text).toBe("自由编辑后的标题");
    useProjectStore.getState().undoEditor();
    expect(useProjectStore.getState().editorState.slides[slideId]?.elementOverrides?.[elementId]).toBeUndefined();
    useProjectStore.getState().redoEditor();
    useProjectStore.getState().resetCanvasElementOverride(slideId, elementId);
    expect(useProjectStore.getState().editorState.slides[slideId].elementOverrides?.[elementId]).toBeUndefined();
  });

  it("keeps freeform movement normalized and clamps resize scale", () => {
    const moved = moveCanvasTransform(resolveCanvasTransform(), 2.5, -1.25);
    expect(moved).toMatchObject({ x: 2.5, y: -1.25, scaleX: 1, scaleY: 1 });
    const resized = resizeCanvasTransform(moved, "se", 200, 200, 10, 10);
    expect(resized.scaleX).toBe(4);
    expect(resized.scaleY).toBe(4);
  });

  it("exports freeform product text, styling and editable object names to PPTX", async () => {
    const products = mockProducts.slice(0, 3).map((product) => ({ ...product, image: onePixelPng, images: [onePixelPng] }));
    const plan = createSlidePlan(products, { mode: "force-grid-3" })[0];
    const elementId = `product.${products[0].id}.title`;
    const editorState: EditorState = {
      ...emptyEditorState(),
      slides: {
        [plan.id]: {
          slideId: plan.id,
          elementOverrides: {
            [elementId]: {
              id: elementId,
              type: "text",
              text: "PPT 自由元素同步测试",
              transform: { x: 1.5, y: 0.5, scaleX: 1.1, scaleY: 1, rotation: 3 },
              style: { fontSize: 21, fontWeight: 700, color: "#C62D42" },
            },
          },
        },
      },
    };
    const model = makeModel(products, editorState);
    const { xml } = await pptXml(model);
    expect(xml).toContain("PPT 自由元素同步测试");
    expect(xml).toContain(`folio:${elementId}`);
    expect(xml).toContain("C62D42");
  }, 30_000);

  it("exports one customized price-zone background color across every product slide", async () => {
    const products = mockProducts.slice(0, 5).map((product) => ({
      ...product,
      image: onePixelPng,
      images: [onePixelPng],
    }));
    const slidePlans = createSlidePlan(products, { mode: "force-grid-3" });
    const project = {
      ...catalogMeta,
      design: {
        ...catalogMeta.design,
        themeOverrides: {
          ...catalogMeta.design.themeOverrides,
          priceBackground: "#DCEEFF",
        },
      },
    };
    const model = createFinalPresentationModel({ project, products, categories, slidePlans, editorState: emptyEditorState() });
    const result = await buildPpt({ meta: model.project, products: model.products, categories: model.categories, slidePlans: model.slidePlans, presentationModel: model });
    const output = await result.presentation.write({ outputType: "uint8array", compression: true });
    const zip = await JSZip.loadAsync(output as Uint8Array);

    for (let index = 0; index < slidePlans.length; index += 1) {
      const xml = await zip.file(`ppt/slides/slide${index + 2}.xml`)!.async("text");
      for (const productId of slidePlans[index].productIds) {
        expect(slideObjectXml(xml, `product.${productId}.prices`)).toContain("DCEEFF");
      }
    }
  }, 30_000);

  it("exports freeform cover and ending text from the shared canvas model", async () => {
    const base = makeModel();
    const endingId = base.slides.find((slide) => slide.kind === "end")!.id;
    const overrides = [
      ["cover", "cover.title", "自由封面标题"],
      [endingId, "ending.thanks", "自由结束页文字"],
    ] as const;
    const editorState: EditorState = {
      ...emptyEditorState(),
      slides: Object.fromEntries(overrides.map(([slideId, elementId, value]) => [slideId, {
        slideId,
        elementOverrides: {
          [elementId]: {
            id: elementId,
            type: "text" as const,
            text: value,
            transform: { x: 0.5, y: 0.25, scaleX: 1, scaleY: 1, rotation: 0 },
          },
        },
      }])),
    };
    const model = makeModel(undefined, editorState);
    const result = await buildPpt({ meta: model.project, products: model.products, categories: model.categories, slidePlans: model.slidePlans, presentationModel: model });
    const output = await result.presentation.write({ outputType: "uint8array", compression: true });
    const zip = await JSZip.loadAsync(output as Uint8Array);
    for (const [slideId, elementId, value] of overrides) {
      const page = model.slides.findIndex((slide) => slide.id === slideId) + 1;
      const xml = await zip.file(`ppt/slides/slide${page}.xml`)!.async("text");
      expect(xml).toContain(value);
      expect(xml).toContain(`folio:${elementId}`);
    }
  }, 30_000);

  it("replaces a selected canvas image and exports it as an editable PPT picture", async () => {
    const products = mockProducts.slice(0, 3).map((product) => ({ ...product, image: undefined, images: [] }));
    const plan = createSlidePlan(products, { mode: "force-grid-3" })[0];
    const elementId = `product.${products[0].id}.image`;
    const editorState: EditorState = {
      ...emptyEditorState(),
      slides: {
        [plan.id]: {
          slideId: plan.id,
          elementOverrides: {
            [elementId]: {
              id: elementId,
              type: "image",
              image: { source: onePixelPng, fit: "contain", scale: 1, offsetX: 0, offsetY: 0 },
            },
          },
        },
      },
    };
    const model = makeModel(products, editorState);
    const { xml } = await pptXml(model);
    expect(xml).toContain("<p:pic>");
    expect(xml).toContain(`folio:${elementId}.0`);
  }, 30_000);
});
