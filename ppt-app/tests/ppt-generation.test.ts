import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { catalogMeta, productCategories } from "@/data/catalog";
import { mockProducts } from "@/data/mock-products";
import { buildPpt } from "@/src/lib/ppt/generatePpt";
import { createSlidePlan } from "@/src/lib/layout/createSlidePlan";

const onePixelPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlQn0YAAAAASUVORK5CYII=";
const secondPixelPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/58HAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

describe("PPTX generation", () => {
  it("creates an editable 13-slide widescreen package with native text, shapes and pictures", async () => {
    const products = mockProducts.map((product, index) => ({
      ...product,
      image: index === 31 ? undefined : onePixelPng,
      images: index === 0 ? [onePixelPng, secondPixelPng] : undefined,
    }));
    const categories = productCategories.map((category) => ({ ...category, coverImage: onePixelPng }));
    const slidePlans = createSlidePlan(products, { mode: "force-grid-3" });
    const result = await buildPpt({ meta: catalogMeta, products, categories, slidePlans });
    const output = await result.presentation.write({ outputType: "uint8array", compression: true });
    const zip = await JSZip.loadAsync(output as Uint8Array);
    const slideFiles = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));

    expect(result.slideCount).toBe(13);
    expect(slideFiles).toHaveLength(13);

    const productSlideXml = await zip.file("ppt/slides/slide2.xml")!.async("text");
    expect(productSlideXml).not.toContain("NO.01");
    expect(productSlideXml).not.toContain("LP-001");
    expect(productSlideXml).toContain("五常稻花香大米组合");
    expect(productSlideXml).toContain("套餐一");
    expect(productSlideXml).toContain("<p:sp>");
    expect(productSlideXml).toContain("<p:pic>");
    expect((productSlideXml.match(/<p:pic>/g) ?? []).length).toBeGreaterThanOrEqual(4);

    const edgeCaseSlideXml = await zip.file("ppt/slides/slide12.xml")!.async("text");
    expect(edgeCaseSlideXml).toContain("暂无商品图片");
    expect(edgeCaseSlideXml).not.toContain("价格待确认");
    expect(edgeCaseSlideXml).toContain("敏感肌温和清洁与保湿日常护理礼盒");

    const endingSlideXml = await zip.file(`ppt/slides/slide${result.slideCount}.xml`)!.async("text");
    expect(endingSlideXml).toContain("THANK YOU");
    expect(endingSlideXml).toContain("感谢浏览");
    expect(endingSlideXml).not.toContain("款套餐，一价任选");
    expect(endingSlideXml).not.toContain("folio:ending.image");
    expect(endingSlideXml).not.toContain("<p:pic>");

    const presentationXml = await zip.file("ppt/presentation.xml")!.async("text");
    const sizeMatch = presentationXml.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
    expect(sizeMatch).not.toBeNull();
    expect(Number(sizeMatch![1]) / Number(sizeMatch![2])).toBeCloseTo(16 / 9, 3);
  }, 30_000);

  it("uses the identifier-free image-focus product layout by default", async () => {
    const products = mockProducts.map((product) => ({ ...product, image: onePixelPng, images: [onePixelPng] }));
    const result = await buildPpt({ meta: catalogMeta, products, categories: productCategories.map((category) => ({ ...category, coverImage: onePixelPng })) });
    const output = await result.presentation.write({ outputType: "uint8array", compression: true });
    const zip = await JSZip.loadAsync(output as Uint8Array);
    const productSlideXml = await zip.file("ppt/slides/slide2.xml")!.async("text");

    expect(result.slideCount).toBe(35);
    expect(productSlideXml).toContain("PRODUCT-IMAGE-FOCUS");
    expect(productSlideXml).toContain("五常稻花香大米组合");
    expect(productSlideXml).not.toContain("NO.01");
    expect(productSlideXml).not.toContain("LP-001");
    expect(productSlideXml).not.toContain("SH-100-01");
  }, 30_000);

  it("exports all six adaptive product layouts as editable PowerPoint elements", async () => {
    const products = mockProducts.slice(0, 11).map((product, index) => ({ ...product, image: onePixelPng, images: [onePixelPng], id: `ppt-layout-${index}` }));
    const anchors = [0, 3, 5, 6, 7, 8] as const;
    const types = ["product-grid-3", "product-grid-2", "product-feature", "package-detail", "product-image-focus", "mixed-product"] as const;
    const overrides = Object.fromEntries(anchors.map((index, position) => [products[index].id, { anchorProductId: products[index].id, type: types[position] }]));
    const slidePlans = createSlidePlan(products, { overrides });
    expect(slidePlans.map((plan) => plan.type)).toEqual(types);

    const result = await buildPpt({ meta: catalogMeta, products, categories: productCategories.map((category) => ({ ...category, coverImage: onePixelPng })), slidePlans });
    const output = await result.presentation.write({ outputType: "uint8array", compression: true });
    const zip = await JSZip.loadAsync(output as Uint8Array);
    expect(result.slideCount).toBe(8);
    for (let slideNumber = 2; slideNumber <= 7; slideNumber += 1) {
      const xml = await zip.file(`ppt/slides/slide${slideNumber}.xml`)!.async("text");
      expect(xml).toContain("<p:sp>");
      expect(xml).toContain("<p:pic>");
    }
  }, 30_000);

  it("exports grouped component names, summed market price and a 500-yuan tier without delivery text", async () => {
    const product = {
      ...mockProducts[0],
      id: "grouped-package",
      name: "生鲜组合",
      image: onePixelPng,
      images: [onePixelPng, secondPixelPng],
      components: [
        { name: "【云仓】天萃庭牛肉炖煮组合2.5kg", details: ["天萃庭进口草饲牛腩块500g/袋*1", "天萃庭进口草饲牛腱子500g/袋*1"], marketPrice: 488 },
        { name: "【云仓】OCEAN SIR码头直供精选海鲜礼包1.9kg", details: ["OCEAN SIR生冻南美白对虾200g"], marketPrice: 188 },
      ],
      details: ["天萃庭进口草饲牛腩块500g/袋*1", "天萃庭进口草饲牛腱子500g/袋*1", "OCEAN SIR生冻南美白对虾200g"],
      price: { currency: "CNY" as const, market: 676, package: 500 },
      deliveryRegions: [],
    };
    const result = await buildPpt({ meta: catalogMeta, products: [product], categories: productCategories.map((category) => ({ ...category, coverImage: onePixelPng })) });
    const output = await result.presentation.write({ outputType: "uint8array", compression: true });
    const zip = await JSZip.loadAsync(output as Uint8Array);
    const xml = await zip.file("ppt/slides/slide2.xml")!.async("text");

    expect(result.slideCount).toBe(3);
    expect(result.fileName).toContain("500元档位");
    expect(xml).toContain("500元档位");
    expect(xml).toContain("套餐一");
    expect(xml).toContain("生鲜组合");
    expect(xml).toContain("【云仓】天萃庭牛肉炖煮组合2.5kg");
    expect(xml).toContain("OCEAN SIR生冻南美白对虾200g");
    expect(xml).toContain("676");
    expect(xml).not.toContain("配送：");
    expect(xml).toContain("folio:product.grouped-package.component.0.title");
  }, 30_000);

  it("uses an inferred sheet tier in the product header when the package price is blank", async () => {
    const product = {
      ...mockProducts[0],
      id: "sheet-tier-fallback",
      image: onePixelPng,
      images: [onePixelPng],
      priceTier: "600元",
      price: { ...mockProducts[0].price, package: undefined },
    };
    const result = await buildPpt({ meta: catalogMeta, products: [product], categories: productCategories.map((category) => ({ ...category, coverImage: onePixelPng })) });
    const output = await result.presentation.write({ outputType: "uint8array", compression: true });
    const zip = await JSZip.loadAsync(output as Uint8Array);
    const xml = await zip.file("ppt/slides/slide2.xml")!.async("text");

    expect(xml).toContain("600元档位");
  }, 30_000);

  it("exports a divider page before each 500/600 tier section", async () => {
    const products = mockProducts.slice(0, 2).map((product, index) => {
      const priceTier = index === 0 ? 500 : 600;
      return {
        ...product,
        id: `tier-divider-${priceTier}`,
        image: onePixelPng,
        images: [onePixelPng],
        priceTier: `${priceTier}元`,
        price: { ...product.price, package: priceTier },
      };
    });
    const result = await buildPpt({ meta: catalogMeta, products, categories: productCategories.map((category) => ({ ...category, coverImage: onePixelPng })) });
    const output = await result.presentation.write({ outputType: "uint8array", compression: true });
    const zip = await JSZip.loadAsync(output as Uint8Array);
    const firstDivider = await zip.file("ppt/slides/slide1.xml")!.async("text");
    const firstProduct = await zip.file("ppt/slides/slide2.xml")!.async("text");
    const secondDivider = await zip.file("ppt/slides/slide3.xml")!.async("text");
    const secondProduct = await zip.file("ppt/slides/slide4.xml")!.async("text");

    expect(result.slideCount).toBe(5);
    expect(firstDivider).toContain("500元档位");
    expect(firstDivider).toContain("1款套餐");
    expect(firstProduct).toContain("500元档位");
    expect(secondDivider).toContain("600元档位");
    expect(secondDivider).toContain("1款套餐");
    expect(secondProduct).toContain("600元档位");
  }, 30_000);
});
