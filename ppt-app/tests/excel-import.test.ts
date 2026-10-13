import path from "node:path";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildCatalogSlides } from "@/lib/pagination";
import { parseImageSources, parsePrice, parseProductItems } from "@/src/lib/excel/cleaners";
import { extractExcelEmbeddedImages, resolveExcelImageCell } from "@/src/lib/excel/embeddedImages";
import { IMPORT_FIELD_DEFINITIONS, PRODUCT_LIBRARY_IMPORT_FIELD_DEFINITIONS } from "@/src/lib/excel/fields";
import { autoMapFields } from "@/src/lib/excel/mapping";
import { detectHeaderRow, getDataRecords, getSheetHeaders } from "@/src/lib/excel/parser";
import { convertSheetToProducts } from "@/src/lib/excel/transform";
import { convertWorkbookToProducts, inferSheetPriceTier } from "@/src/lib/excel/workbook";
import { validateProduct } from "@/src/lib/excel/validation";
import { withDerivedProductComponents } from "@/src/lib/catalog/components";
import { withInferredPriceTier } from "@/src/lib/catalog/project";
import { catalogMeta } from "@/data/catalog";
import type { ExcelImportConfig, ExcelSheetData, ExcelWorkbookData } from "@/types/import";

function loadExample(): ExcelWorkbookData {
  const fileName = "product-import-example.xlsx";
  const workbook = XLSX.readFile(path.join(process.cwd(), "public/examples", fileName));
  return {
    fileName,
    sheets: workbook.SheetNames.map((name) => {
      const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(workbook.Sheets[name], {
        header: 1,
        raw: false,
        defval: "",
        blankrows: true,
      });
      return { name, rows, nonEmptyRowCount: rows.filter((row) => row.some((cell) => String(cell ?? "").trim())).length };
    }),
  };
}

function makeConfig(sheet: ExcelSheetData, headerRow: number): ExcelImportConfig {
  return {
    fileName: "fixture.xlsx",
    sheetName: sheet.name,
    headerRow,
    fieldMappings: autoMapFields(getSheetHeaders(sheet, headerRow), PRODUCT_LIBRARY_IMPORT_FIELD_DEFINITIONS),
    splitItemsBySlash: false,
  };
}

function makeBasicConfig(sheet: ExcelSheetData, headerRow: number): ExcelImportConfig {
  return {
    ...makeConfig(sheet, headerRow),
    fieldMappings: autoMapFields(getSheetHeaders(sheet, headerRow), IMPORT_FIELD_DEFINITIONS),
  };
}

describe("Excel import pipeline", () => {
  it("loads a multi-sheet workbook and detects a third-row header", () => {
    const workbook = loadExample();
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(["100元套餐", "200元套餐", "300元套餐"]);
    expect(detectHeaderRow(workbook.sheets[0])).toBe(3);
    expect(detectHeaderRow(workbook.sheets[1])).toBe(1);
  });

  it("filters completely empty rows without dropping incomplete products", () => {
    const sheet = loadExample().sheets[0];
    const records = getDataRecords(sheet, 3);
    const products = convertSheetToProducts(sheet, makeConfig(sheet, 3));

    expect(records).toHaveLength(13);
    expect(products).toHaveLength(13);
    expect(products.some((product) => !product.sku)).toBe(true);
    expect(products.find((product) => !product.sku)?.name).toContain("生态黑猪肉");
  });

  it("auto-matches non-standard aliases without AI", () => {
    const sheet = loadExample().sheets[1];
    const mapping = autoMapFields(getSheetHeaders(sheet, 1), PRODUCT_LIBRARY_IMPORT_FIELD_DEFINITIONS);
    const sourceFor = (target: string) => mapping.find((item) => item.targetField === target)?.sourceColumn;

    expect(sourceFor("sku")).toBe("产品编码");
    expect(sourceFor("marketPrice")).toBe("零售价");
    expect(sourceFor("salePrice")).toBe("福利价");
    expect(sourceFor("delivery")).toBe("可配送范围");
  });

  it("matches the single-project import fields to the downloadable template", () => {
    expect(IMPORT_FIELD_DEFINITIONS.map((field) => field.label)).toEqual([
      "序号", "套餐名称", "品类", "品牌", "商品名称", "商品明细", "商品图片（高清图）", "市场价", "组合价", "可配送区域",
    ]);
  });

  it("ships an Excel template with the same fields as the 500-tier source workbook", () => {
    const workbook = XLSX.readFile(path.join(process.cwd(), "public/examples/product-import-template.xlsx"));
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
    });

    expect(rows[1]).toEqual([
      "序号", "套餐名称", "品类", "品牌", "商品名称", "商品明细", "商品图片（高清图）", "市场价", "组合价", "可配送区域",
    ]);
    expect(detectHeaderRow({ name: workbook.SheetNames[0], rows, nonEmptyRowCount: rows.filter((row) => row.some(Boolean)).length })).toBe(2);
    const mapping = autoMapFields(rows[1].map(String), IMPORT_FIELD_DEFINITIONS);
    expect(Object.fromEntries(mapping.map((item) => [item.targetField, item.sourceColumn]))).toMatchObject({
      no: "序号",
      name: "套餐名称",
      category: "品类",
      brand: "品牌",
      productName: "商品名称",
      items: "商品明细",
      image: "商品图片（高清图）",
      marketPrice: "市场价",
      salePrice: "组合价",
      delivery: "可配送区域",
    });
  });

  it("groups merged package rows while retaining component names, details and pictures", () => {
    const sheet: ExcelSheetData = {
      name: "500",
      nonEmptyRowCount: 5,
      rows: [
        ["500 档位"],
        ["序号", "套餐名称", "商品名称", "商品明细", "商品图片", "市场价", "组合价"],
        ["1", "生鲜组合", "牛肉礼盒", "牛腩500g\n牛腱500g", "data:image/png;base64,beef", "488", "500"],
        ["", "", "海鲜礼盒", "白虾200g\n黄鱼400g", "data:image/png;base64,seafood", "188", ""],
        ["2", "粮油组合", "大米", "东北大米5kg", "data:image/png;base64,rice", "168元", "500"],
      ],
    };
    const products = convertSheetToProducts(sheet, makeBasicConfig(sheet, 2));

    expect(products).toHaveLength(2);
    expect(products[0].productNumber).toBe("01");
    expect(products[0].name).toBe("生鲜组合");
    expect(products[0].components?.map((component) => component.name)).toEqual(["牛肉礼盒", "海鲜礼盒"]);
    expect(products[0].details).toEqual(["牛腩500g", "牛腱500g", "白虾200g", "黄鱼400g"]);
    expect(products[0].images).toHaveLength(2);
    expect(products[0].price).toMatchObject({ market: 676, package: 500 });
    expect(withInferredPriceTier(catalogMeta, products)).toMatchObject({ priceTier: 500, tierName: "500元档位" });

    const restored = withDerivedProductComponents({ ...products[0], components: undefined, price: { ...products[0].price, market: 488 } });
    expect(restored.components?.map((component) => component.name)).toEqual(["牛肉礼盒", "海鲜礼盒"]);
    expect(restored.price.market).toBe(676);
  });

  it("merges price-tier sheets and infers 500/600 tiers from sheet headings", () => {
    const workbook: ExcelWorkbookData = {
      fileName: "multi-tier.xlsx",
      sourceType: "excel",
      sheets: ["500", "600"].map((name) => ({
        name,
        nonEmptyRowCount: 3,
        rows: [
          ["", "", `${name}档`],
          ["序号", "套餐名称", "商品名称", "商品明细", "市场价", "组合价"],
          [1, `${name}元套餐`, `${name}元商品`, "商品A 500g", Number(name) + 88, Number(name)],
        ],
      })),
    };
    const config = makeBasicConfig(workbook.sheets[0], 2);
    const products = convertWorkbookToProducts(workbook, config, IMPORT_FIELD_DEFINITIONS);

    expect(inferSheetPriceTier(workbook.sheets[0])).toBe("500元");
    expect(inferSheetPriceTier(workbook.sheets[1])).toBe("600元");
    expect(products.map((product) => product.name)).toEqual(["500元套餐", "600元套餐"]);
    expect(products.map((product) => product.priceTier)).toEqual(["500元", "600元"]);
    expect(new Set(products.map((product) => product.id))).toHaveLength(2);
    expect(products.map((product) => product.sources?.[0]?.sheet)).toEqual(["500", "600"]);
  });

  it("extracts WPS DISPIMG cell images at their original bytes", async () => {
    const zip = new JSZip();
    zip.file("xl/cellimages.xml", `<etc:cellImages xmlns:etc="x"><etc:cellImage><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="ID_TEST"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></etc:cellImage></etc:cellImages>`);
    zip.file("xl/_rels/cellimages.xml.rels", `<Relationships><Relationship Id="rId1" Target="media/image1.png"/></Relationships>`);
    zip.file("xl/media/image1.png", new Uint8Array([137, 80, 78, 71]));
    const input = await zip.generateAsync({ type: "arraybuffer" });
    const images = await extractExcelEmbeddedImages(input);

    expect(images.get("ID_TEST")).toBe("data:image/png;base64,iVBORw==");
    expect(resolveExcelImageCell('=DISPIMG("ID_TEST",1)', images)).toBe("data:image/png;base64,iVBORw==");
  });

  it("parses prices with currency symbols, suffixes and missing markers", () => {
    expect(parsePrice("¥168")).toBe(168);
    expect(parsePrice("￥168")).toBe(168);
    expect(parsePrice("168元")).toBe(168);
    expect(parsePrice("市场价168元")).toBe(168);
    expect(parsePrice("-")).toBeUndefined();
    expect(parsePrice("未标注")).toBeUndefined();
  });

  it("parses line breaks and semicolons while keeping specification slashes intact by default", () => {
    expect(parseProductItems("云耳120g\n珍珠菇80g\n鹿茸菇70g")).toEqual(["云耳120g", "珍珠菇80g", "鹿茸菇70g"]);
    expect(parseProductItems("云耳120g；珍珠菇80g;鹿茸菇70g")).toHaveLength(3);
    expect(parseProductItems("云耳120g|珍珠菇80g|鹿茸菇70g")).toHaveLength(3);
    expect(parseProductItems("500g×2 / 300g×1", true)).toEqual(["500g×2 / 300g×1"]);
  });

  it("retains multiple image sources for one product", () => {
    expect(parseImageSources(["data:image/png;base64,one", "data:image/png;base64,two"])).toEqual([
      "data:image/png;base64,one",
      "data:image/png;base64,two",
    ]);
    expect(parseImageSources("https://example.com/a.png\nhttps://example.com/b.png")).toHaveLength(2);
  });

  it("marks missing values as warnings and a missing name as an error", () => {
    const sheet = loadExample().sheets[0];
    const products = convertSheetToProducts(sheet, makeConfig(sheet, 3));
    const missingSku = products.find((product) => !product.sku)!;
    const missingMarket = products.find((product) => product.price.market === undefined)!;

    expect(validateProduct(missingSku).messages).not.toContain("SKU 为空");
    expect(validateProduct(missingMarket).messages).toContain("市场价为空");
    expect(validateProduct({ ...products[0], name: "" }).status).toBe("error");
    expect(validateProduct({ ...products[0], image: undefined, images: ["data:image/png;base64,one"] }).messages).not.toContain("商品图片为空");
  });

  it("retains long names and multiline item details during conversion", () => {
    const sheet = loadExample().sheets[0];
    const products = convertSheetToProducts(sheet, makeConfig(sheet, 3));
    expect(products.some((product) => product.name.length > 25)).toBe(true);
    expect(products.find((product) => product.name === "菌菇山珍礼盒")?.details).toHaveLength(3);
  });

  it("paginates non-multiples and 100 imported products without changing the parser result", () => {
    const sheet = loadExample().sheets[0];
    const products = convertSheetToProducts(sheet, makeConfig(sheet, 3));
    const nonMultipleSlides = buildCatalogSlides(products).filter((slide) => slide.kind === "products");
    const hundred = Array.from({ length: 100 }, (_, index) => ({
      ...products[index % products.length],
      id: `bulk-${index}`,
      productNumber: String(index + 1).padStart(2, "0"),
    }));
    const hundredSlides = buildCatalogSlides(hundred).filter((slide) => slide.kind === "products");

    expect(products.length % 3).not.toBe(0);
    expect(nonMultipleSlides.at(-1)?.products).toHaveLength(1);
    expect(hundredSlides).toHaveLength(34);
    expect(hundredSlides.at(-1)?.products).toHaveLength(1);
  });

  it("converts and paginates 300 rows without a second parser pass", () => {
    const sheet: ExcelSheetData = {
      name: "300-row-performance",
      nonEmptyRowCount: 301,
      rows: [
        ["套餐编号", "套餐名称", "套餐内容", "市场价", "组合价", "配送区域", "分类"],
        ...Array.from({ length: 300 }, (_, index) => [
          `SKU-${index + 1}`,
          `性能测试套餐 ${index + 1}`,
          "商品A 100g\n商品B 200g",
          "¥168",
          "100元",
          "全国配送 A 类",
          "粮油调味",
        ]),
      ],
    };
    const products = convertSheetToProducts(sheet, makeConfig(sheet, 1));
    const productSlides = buildCatalogSlides(products).filter((slide) => slide.kind === "products");

    expect(products).toHaveLength(300);
    expect(productSlides).toHaveLength(100);
  });
});
