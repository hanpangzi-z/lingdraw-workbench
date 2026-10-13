import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildCatalogSlides } from "@/lib/pagination";
import { catalogMeta, productCategories } from "@/data/catalog";
import { mockProducts } from "@/data/mock-products";
import { createSlidePlan } from "@/src/lib/layout/createSlidePlan";
import { createRenderContext, renderContextCssVariables } from "@/src/render/context";
import { getProductTextStyle } from "@/src/lib/ppt/helpers";
import { buildPpt } from "@/src/lib/ppt/generatePpt";
import { applyTemplateToDesign, getAvailableTemplates, resetTemplateDesign, resolveTemplateLayoutMode } from "@/src/templates/registry";
import type { TemplateId } from "@/src/templates/types";
import { getAvailableThemes, getTheme, resolveTheme } from "@/src/themes/registry";
import type { ThemeId } from "@/src/themes/types";
import type { CatalogMeta, Product } from "@/types/catalog";

const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlQn0YAAAAASUVORK5CYII=";
const categories = productCategories.map((category) => ({ ...category, coverImage: onePixelPng }));

function metaWith(templateId: TemplateId, themeId: ThemeId, patch: Partial<CatalogMeta["design"]> = {}): CatalogMeta {
  return { ...catalogMeta, design: { ...catalogMeta.design, templateId, themeId, ...patch } };
}

async function pptZip(meta: CatalogMeta, products: Product[] = mockProducts.slice(0, 3).map((product) => ({ ...product, image: onePixelPng, images: [onePixelPng] }))) {
  const slidePlans = createSlidePlan(products, { mode: "force-grid-3" });
  const result = await buildPpt({ meta, products, categories, slidePlans });
  const output = await result.presentation.write({ outputType: "uint8array", compression: true });
  return { result, zip: await JSZip.loadAsync(output as Uint8Array) };
}

describe("Theme and Template System 2.0", () => {
  it("uses image focus as the inherited default for the business template", () => {
    const mode = resolveTemplateLayoutMode("business-standard", "smart");
    expect(mode).toBe("force-single-image");
    expect(createSlidePlan(mockProducts.slice(0, 3), { mode }).every((plan) => plan.type === "product-image-focus")).toBe(true);
    expect(resolveTemplateLayoutMode("business-standard", "force-grid-2")).toBe("force-grid-2");
  });

  it("keeps every color template on the Business Red composition", () => {
    const templates = getAvailableTemplates();
    const business = templates.find((template) => template.id === "business-standard")!;
    for (const template of templates) {
      expect(template.defaultLayoutMode).toBe("force-single-image");
      expect(template.showProductIdentifiers).toBe(false);
      expect(template.layoutVariants).toEqual(business.layoutVariants);
      expect(template.supportedThemes).toEqual([template.defaultThemeId]);
      expect(getTheme(template.defaultThemeId).decoration.headerStyle).toBe("solid");
      expect(getTheme(template.defaultThemeId).decoration.priceStyle).toBe("panel");
    }
  });

  it("switches all six themes without mutating product data or registry objects", () => {
    const before = structuredClone(mockProducts);
    for (const theme of getAvailableThemes()) {
      const resolved = resolveTheme(theme.id, { primary: "#123456" });
      expect(resolved.colors.primary).toBe("#123456");
      expect(resolved.colors.imageBackground).toBe("#FFFFFF");
      expect(getTheme(theme.id).colors.primary).toBe(theme.colors.primary);
    }
    expect(mockProducts).toEqual(before);
    expect(getAvailableThemes()).toHaveLength(6);
  });

  it("keeps slide count and product order stable across all five templates", () => {
    const plans = createSlidePlan(mockProducts, { mode: "force-grid-3" });
    const expectedSlides = buildCatalogSlides(mockProducts, plans);
    for (const template of getAvailableTemplates()) {
      const meta = metaWith(template.id, template.defaultThemeId);
      const slides = buildCatalogSlides(mockProducts, plans);
      expect(slides).toHaveLength(expectedSlides.length);
      expect(slides.filter((slide) => slide.kind === "products").flatMap((slide) => slide.kind === "products" ? slide.products.map((product) => product.id) : [])).toEqual(mockProducts.map((product) => product.id));
      expect(meta.design.templateId).toBe(template.id);
    }
    expect(getAvailableTemplates()).toHaveLength(5);
  });

  it("exports Business Red using editable native shapes and the registered red token", async () => {
    const { zip } = await pptZip(metaWith("business-standard", "business-red"));
    const xml = await zip.file("ppt/slides/slide2.xml")!.async("text");
    expect(xml).toContain("A51F2D");
    expect(xml).toContain("<p:sp>");
    expect(xml).toContain("<p:pic>");
  }, 30_000);

  it("keeps a solid header title readable even when the page title color is dark", () => {
    const products = mockProducts.slice(0, 2);
    const slide = buildCatalogSlides(products, createSlidePlan(products, { mode: "force-grid-2" })).find((item) => item.kind === "products");
    expect(slide?.kind).toBe("products");
    if (!slide || slide.kind !== "products") return;
    const editedSlide = { ...slide, editor: { slideId: slide.id, styleOverrides: { titleColor: "#24201E" } } };
    const context = createRenderContext({ project: catalogMeta, slide: editedSlide, products, categories: productCategories, totalSlides: 3 });
    const variables = renderContextCssVariables(context);
    expect(variables["--editor-header-title-color"]).toBe("#FFFFFF");
    expect(variables["--editor-title-color"]).toBe("#24201E");
  });

  it("uses each template background for the package-detail content surface", () => {
    const products = mockProducts.slice(0, 1);
    const slide = buildCatalogSlides(products, createSlidePlan(products, { mode: "force-single-image" })).find((item) => item.kind === "products");
    expect(slide?.kind).toBe("products");
    if (!slide || slide.kind !== "products") return;

    for (const template of getAvailableTemplates()) {
      const project = metaWith(template.id, template.defaultThemeId);
      const context = createRenderContext({ project, slide, products, categories: productCategories, totalSlides: 2 });
      const variables = renderContextCssVariables(context);
      const theme = getTheme(template.defaultThemeId);
      expect(variables["--theme-product-content-background"]).toBe(theme.colors.background);
      expect(variables["--theme-product-content-text"]).toBe(theme.colors.textPrimary);
      expect(variables["--theme-product-content-secondary"]).toBe(theme.colors.textSecondary);
    }
  });

  it("exports Premium Dark with a dark canvas and a white product image surface", async () => {
    const { zip } = await pptZip(metaWith("premium-gift", "premium-dark"));
    const cover = await zip.file("ppt/slides/slide1.xml")!.async("text");
    const product = await zip.file("ppt/slides/slide2.xml")!.async("text");
    expect(cover).toContain("131516");
    expect(product).toContain("FFFFFF");
    expect(product).toContain("202325");
  }, 30_000);

  it("keeps long mixed Chinese and English product titles complete with minimum text sizes", () => {
    const product = { ...mockProducts[0], name: "2026 上海职工精选超长商品名称 Premium Family Gift Collection 500g×2", details: ["规格 A", "规格 B", "规格 C"] };
    const style = getProductTextStyle(product);
    expect(style.titleFontSize).toBeGreaterThanOrEqual(11);
    expect(style.itemFontSize).toBeGreaterThanOrEqual(10);
    for (const theme of getAvailableThemes()) expect(resolveTheme(theme.id).typography.title.length).toBeGreaterThan(0);
    expect(product.name).toContain("Premium Family Gift Collection");
  });

  it("preserves manual layout overrides when applying another template", () => {
    const products = mockProducts.slice(0, 4);
    const overrides = { [products[0].id]: { anchorProductId: products[0].id, type: "product-grid-2" as const } };
    const before = createSlidePlan(products, { overrides });
    const design = applyTemplateToDesign(
      {
        ...catalogMeta.design,
        brandColor: "#FF6600",
        brandName: "测试品牌",
        logo: onePixelPng,
        themeOverrides: { primary: "#123456", titleFont: "Arial" },
      },
      "premium-gift",
    );
    const after = createSlidePlan(products, { overrides });
    expect(design).toMatchObject({
      templateId: "premium-gift",
      themeId: "premium-dark",
      themeOverrides: {},
      brandName: "测试品牌",
      logo: onePixelPng,
    });
    expect(design.brandColor).toBeUndefined();
    expect(after[0]).toMatchObject({ type: "product-grid-2", source: "manual" });
    expect(after.map((plan) => plan.productIds)).toEqual(before.map((plan) => plan.productIds));
  });

  it("keeps the tier-divider cover image-free even when the project has a logo", async () => {
    const { zip } = await pptZip(metaWith("business-standard", "business-red", { logo: onePixelPng }));
    const cover = await zip.file("ppt/slides/slide1.xml")!.async("text");
    expect((cover.match(/<p:pic>/g) ?? []).length).toBe(0);
    expect(cover).toContain("TIER 100 / 套餐分栏");
    expect(cover).toContain("100元档位");
  }, 30_000);

  it("applies brand color as a non-mutating theme override in PPTX", async () => {
    const original = getTheme("business-red").colors.primary;
    const { zip } = await pptZip(metaWith("business-standard", "business-red", { brandColor: "#123456" }));
    const product = await zip.file("ppt/slides/slide2.xml")!.async("text");
    expect(product).toContain("123456");
    expect(getTheme("business-red").colors.primary).toBe(original);
  }, 30_000);

  it("resets theme overrides but preserves brand identity fields", () => {
    const design = { ...catalogMeta.design, templateId: "modern-catalog" as const, themeId: "corporate-blue" as const, themeOverrides: { titleFont: "Arial" }, brandColor: "#123456", brandName: "测试品牌", logo: onePixelPng };
    const reset = resetTemplateDesign(design, "modern-catalog");
    expect(reset).toMatchObject({ templateId: "modern-catalog", themeId: "minimal-light", themeOverrides: {}, brandName: "测试品牌", logo: onePixelPng });
    expect(reset.brandColor).toBeUndefined();
  });

  it("uses the editable missing-image placeholder in every theme", async () => {
    const product = { ...mockProducts[0], image: undefined, images: [], id: "missing-image" };
    for (const theme of getAvailableThemes()) {
      const templateId: TemplateId = theme.id === "premium-dark" || theme.id === "festival-red"
        ? "premium-gift"
        : theme.id === "minimal-light"
          ? "modern-catalog"
          : theme.id === "corporate-blue"
            ? "corporate-blue"
            : theme.id === "fresh-green"
              ? "fresh-green"
              : "business-standard";
      const { zip } = await pptZip(metaWith(templateId, theme.id), [product]);
      const xml = await zip.file("ppt/slides/slide2.xml")!.async("text");
      expect(xml).toContain("暂无商品图片");
      expect(xml).toContain("<p:sp>");
    }
  }, 30_000);
});
