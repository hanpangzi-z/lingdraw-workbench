import { File as NodeFile } from "node:buffer";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { candidatesToProducts } from "@/src/lib/import/productAdapter";
import { candidatesFromTable, extractProductCandidates } from "@/src/lib/import/common/candidates";
import { detectProductBlocks } from "@/src/lib/import/common/productBlocks";
import { mergeProductCandidates } from "@/src/lib/import/common/merge";
import { validatePrimaryFile } from "@/src/lib/import/detectFileType";
import { normalizeRawData } from "@/src/lib/import/normalizeRawData";
import { runImportPipeline } from "@/src/lib/import/importPipeline";
import { parseDocxDocument } from "@/src/lib/import/word/parser";
import { parsePptxDocument } from "@/src/lib/import/ppt/parser";
import type { ImportedTable, ProductCandidate, RawImportedDocument } from "@/src/lib/import/types";

const asFile = (bytes: Uint8Array, name: string, type: string) => new NodeFile([bytes], name, { type }) as unknown as File;
const xmlEscape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paragraph = (text: string) => `<w:p><w:r><w:t>${xmlEscape(text)}</w:t></w:r></w:p>`;
const imageParagraph = (relationId: string) => `<w:p><w:r><w:drawing><a:blip r:embed="${relationId}"/></w:drawing></w:r></w:p>`;

async function makeDocx(body: string, relationships = "", media: Record<string, Uint8Array> = {}, name = "products.docx") {
  const zip = new JSZip();
  zip.file("word/document.xml", `<w:document xmlns:w="w" xmlns:a="a" xmlns:r="r"><w:body>${body}</w:body></w:document>`);
  zip.file("word/_rels/document.xml.rels", `<Relationships>${relationships}</Relationships>`);
  Object.entries(media).forEach(([name, bytes]) => zip.file(`word/media/${name}`, bytes));
  return asFile(await zip.generateAsync({ type: "uint8array" }), name, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}

const shape = (text: string, x: number, y: number, width = 1_800_000, height = 350_000) => `<p:sp><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>${xmlEscape(text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
const picture = (relationId: string, x: number, y: number) => `<p:pic><p:blipFill><a:blip r:embed="${relationId}"/></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="1200000" cy="900000"/></a:xfrm></p:spPr></p:pic>`;

async function makePptx(slides: string[], repeatedDecoration = false) {
  const zip = new JSZip();
  const ids = slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join("");
  const rels = slides.map((_, index) => `<Relationship Id="rId${index + 1}" Target="slides/slide${index + 1}.xml"/>`).join("");
  zip.file("ppt/presentation.xml", `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<Relationships>${rels}</Relationships>`);
  slides.forEach((content, index) => {
    const decoration = repeatedDecoration ? picture("rDecor", 100_000, 80_000) : "";
    zip.file(`ppt/slides/slide${index + 1}.xml`, `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>${content}${decoration}</p:spTree></p:cSld></p:sld>`);
    if (repeatedDecoration) zip.file(`ppt/slides/_rels/slide${index + 1}.xml.rels`, `<Relationships><Relationship Id="rDecor" Target="../media/logo.png"/></Relationships>`);
  });
  if (repeatedDecoration) zip.file("ppt/media/logo.png", Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA", "base64")));
  return asFile(await zip.generateAsync({ type: "uint8array" }), "legacy.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
}

function tableDocument(rows: ImportedTable["rows"], sourceType: RawImportedDocument["sourceType"] = "pdf"): RawImportedDocument {
  const table: ImportedTable = {
    id: "table-1",
    sourcePage: sourceType === "pdf" ? 1 : undefined,
    headers: ["套餐编号", "套餐名称", "套餐内容", "市场价", "组合价", "配送区域", "分类"],
    rows,
  };
  return { sourceType, fileName: `source.${sourceType}`, tables: [table], pages: [{ pageNumber: 1, text: "", tables: [table] }], warnings: [] };
}

const candidate = (id: string, sku: string, marketPrice: number, sourceType: "excel" | "pdf"): ProductCandidate => ({
  id, sku, name: "菌菇礼盒", items: ["云耳120g"], marketPrice, salePrice: 100, delivery: "全国", category: "粮油调味",
  source: { type: sourceType, fileName: `${sourceType}.source`, page: sourceType === "pdf" ? 2 : undefined, sheet: sourceType === "excel" ? "Sheet1" : undefined },
  sources: [{ type: sourceType, fileName: `${sourceType}.source` }], confidence: 0.95,
  fieldConfidence: { sku: 0.99, name: 0.95, items: 0.9, marketPrice: 0.99, salePrice: 0.99 },
});

describe("Unified PDF / Word / PPT import", () => {
  it("1. extracts candidates from a text PDF-style table", () => {
    const document = tableDocument([["2610001", "菌菇礼盒", "云耳120g\n珍珠菇80g", "¥168", "100元", "全国", "粮油调味"]]);
    const products = candidatesToProducts(extractProductCandidates(document));
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ sku: "2610001", name: "菌菇礼盒" });
    expect(products[0].details).toEqual(["云耳120g", "珍珠菇80g"]);
    expect(products[0].sources?.[0]).toMatchObject({ type: "pdf", page: 1 });
  });

  it("keeps a complete Base64 image URL from a parsed PDF table", () => {
    const imageUrl = "data:image/jpeg;base64,/9j/example";
    const document = tableDocument([["2610001", "有图套餐", "商品A", "168", "100", "全国", "粮油调味", imageUrl]]);
    document.tables![0].headers.push("图片");
    expect(extractProductCandidates(document)[0].images).toEqual([imageUrl]);
  });

  it("2. preserves a scanned PDF page and marks it for OCR fallback", () => {
    const document = normalizeRawData({ sourceType: "pdf", fileName: "scan.pdf", pages: [{ pageNumber: 1, text: "", previewUrl: "data:image/jpeg;base64,page", textDensity: 0, requiresOcr: true }], warnings: ["第 1 页文字密度较低，可能是扫描页。"] });
    expect(document.pages?.[0].requiresOcr).toBe(true);
    expect(document.pages?.[0].previewUrl).toContain("data:image/jpeg");
    expect(extractProductCandidates(document)).toHaveLength(0);
  });

  it("3. parses a Word table into reusable raw table data", async () => {
    const table = `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>产品编码</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>产品名称</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>福利价</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>W-001</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>山珍礼盒</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>100元</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const document = await parseDocxDocument(await makeDocx(table));
    expect(document.tables?.[0].headers).toEqual(["产品编码", "产品名称", "福利价"]);
    expect(document.tables?.[0].rows[0]).toEqual(["W-001", "山珍礼盒", "100元"]);
  });

  it("4. splits Word paragraphs into products and associates only nearby images", async () => {
    const body = [
      paragraph("商品一：山珍礼盒"), paragraph("套餐编号：W-001"), paragraph("商品明细：云耳120g；珍珠菇80g"), imageParagraph("rId1"),
      paragraph("商品二：海鲜礼盒"), paragraph("套餐编号：W-002"), paragraph("商品明细：鲍鱼200g；海参300g"), imageParagraph("rId2"),
    ].join("");
    const relationships = `<Relationship Id="rId1" Target="media/one.png"/><Relationship Id="rId2" Target="media/two.png"/>`;
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA", "base64"));
    const document = await parseDocxDocument(await makeDocx(body, relationships, { "one.png": png, "two.png": Uint8Array.from([...png, 1]) }));
    const blocks = detectProductBlocks(document);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.images.length)).toEqual([1, 1]);
    expect(extractProductCandidates(document).map((item) => item.name)).toEqual(["山珍礼盒", "海鲜礼盒"]);
  });

  it("5. detects three horizontal product cards on one old PPT slide", async () => {
    const columns = [300_000, 4_300_000, 8_300_000].map((x, index) => [
      shape(`NO.0${index + 1}`, x, 200_000), shape(`套餐编号：P-00${index + 1}`, x + 40_000, 650_000),
      shape(`商品名称：套餐${index + 1}`, x, 1_050_000), shape("商品明细：商品A100g；商品B200g", x, 1_450_000), shape("组合价：100", x, 1_850_000),
    ].join("")).join("");
    const document = await parsePptxDocument(await makePptx([columns]));
    const candidates = extractProductCandidates(document);
    expect(candidates).toHaveLength(3);
    expect(candidates.map((item) => item.sku)).toEqual(["P-001", "P-002", "P-003"]);
  });

  it("6. detects one product on a single-product PPT slide", async () => {
    const content = shape("NO.01", 400_000, 200_000) + shape("套餐编号：P-101", 430_000, 650_000) + shape("商品名称：单品礼盒", 400_000, 1_050_000) + shape("市场价：168", 400_000, 1_450_000);
    const candidates = extractProductCandidates(await parsePptxDocument(await makePptx([content])));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ sku: "P-101", name: "单品礼盒", marketPrice: 168 });
  });

  it("7. filters a repeated PPT logo or decoration from product images", async () => {
    const slides = Array.from({ length: 3 }, (_, index) => shape(`商品名称：套餐${index + 1}`, 2_000_000, 1_000_000) + shape(`套餐编号：R-00${index + 1}`, 2_000_000, 1_400_000));
    const document = await parsePptxDocument(await makePptx(slides, true));
    expect(document.images).toHaveLength(3);
    expect(document.images?.every((image) => ["possibleLogo", "decoration"].includes(image.classification))).toBe(true);
    expect(extractProductCandidates(document).every((item) => !item.images?.length)).toBe(true);
  });

  it("8. retains a PDF product when the product image is missing", () => {
    const candidate = candidatesFromTable(tableDocument([["2610002", "无图套餐", "商品A", "", "100", "全国", "休闲糕点"]]).tables![0], tableDocument([]))[0];
    expect(candidate.name).toBe("无图套餐");
    expect(candidate.images).toEqual([]);
    expect(candidatesToProducts([candidate])[0].image).toBeUndefined();
  });

  it("9. extracts 30 PDF products without joining the whole document into one product", () => {
    const rows = Array.from({ length: 30 }, (_, index) => [`26${String(index + 1).padStart(5, "0")}`, `套餐${index + 1}`, "商品A100g", "168", "100", "全国", "粮油调味"]);
    expect(extractProductCandidates(tableDocument(rows))).toHaveLength(30);
  });

  it("10. merges duplicate SKUs from two sources and keeps both provenance records", () => {
    const merged = mergeProductCandidates([candidate("excel-one", "SKU-1", 168, "excel"), candidate("pdf-one", "SKU-1", 168, "pdf")]);
    expect(merged.mergedCandidates).toHaveLength(1);
    expect(merged.mergedCandidates[0].sources).toHaveLength(2);
  });

  it("11. creates an unresolved conflict instead of choosing a conflicting price", () => {
    const merged = mergeProductCandidates([candidate("excel-one", "SKU-1", 168, "excel"), candidate("pdf-one", "SKU-1", 158, "pdf")]);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]).toMatchObject({ field: "marketPrice", resolved: false });
    expect(merged.conflicts[0].alternatives.map((item) => item.value)).toEqual([168, 158]);
  });

  it("12. preserves a very long Word description without truncation", async () => {
    const longItems = Array.from({ length: 16 }, (_, index) => `第${index + 1}项商品规格${"很长".repeat(8)}`).join("；");
    const document = await parseDocxDocument(await makeDocx(paragraph("商品一：超长组合套餐") + paragraph("套餐编号：LONG-001") + paragraph(`商品明细：${longItems}`)));
    const result = extractProductCandidates(document)[0];
    expect(result.items).toHaveLength(16);
    expect(result.rawText).toContain("第16项商品规格");
  });

  it("13. tolerates slightly irregular text positions inside PPT columns", async () => {
    const content = [300_000, 4_300_000, 8_300_000].map((x, index) => shape(`NO.${index + 1}`, x, 200_000) + shape(`套餐编号：IR-${index + 1}`, x + 300_000, 620_000) + shape(`商品名称：不规则套餐${index + 1}`, x - 120_000, 1_050_000)).join("");
    expect(extractProductCandidates(await parsePptxDocument(await makePptx([content])))).toHaveLength(3);
  });

  it("14. processes a 100-page parsed document and rejects macro files", () => {
    const pages = Array.from({ length: 100 }, (_, index) => ({ pageNumber: index + 1, text: `NO.${index + 1}\n套餐编号：PAGE-${index + 1}\n商品名称：第${index + 1}页套餐\n组合价：100` }));
    const document: RawImportedDocument = { sourceType: "pdf", fileName: "100-pages.pdf", pages, warnings: [] };
    expect(extractProductCandidates(document)).toHaveLength(100);
    expect(() => validatePrimaryFile({ name: "unsafe.docm", size: 1024 } as File)).toThrow(/宏安全风险/);
  });

  it("jointly imports a primary document and a supporting document before conflict review", async () => {
    const primary = await makeDocx(paragraph("商品一：联合套餐") + paragraph("套餐编号：JOINT-001") + paragraph("市场价：168"), "", {}, "primary.docx");
    const supporting = await makeDocx(paragraph("商品一：联合套餐") + paragraph("套餐编号：JOINT-001") + paragraph("市场价：158"), "", {}, "supporting.docx");
    const result = await runImportPipeline(primary, { supportingFiles: [supporting] });
    expect(result.documents.map((item) => item.fileName)).toEqual(["primary.docx", "supporting.docx"]);
    expect(result.mergedCandidates).toHaveLength(1);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ sku: "JOINT-001", field: "marketPrice", resolved: false });
  });
});
