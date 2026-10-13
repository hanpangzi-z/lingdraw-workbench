import { parseDeliveryRules, parseImageSources, parseProductItems, parsePrice } from "@/src/lib/excel/cleaners";
import type { CandidateField, ImportedTable, ProductBlock, ProductCandidate, ProductSource, RawImportedDocument } from "../types";
import { detectProductBlocks } from "./productBlocks";

const headerAliases: Record<CandidateField, RegExp> = {
  sku: /^(?:sku|套餐编号|商品编号|产品编号|商品编码|产品编码)$/i,
  name: /^(?:商品名称|产品名称|套餐名称|名称|品名)$/i,
  items: /^(?:商品明细|产品明细|套餐内容|商品内容|规格|内容)$/i,
  marketPrice: /^(?:市场价|零售价|原价|建议零售价)$/i,
  salePrice: /^(?:组合价|套餐价|售价|福利价)$/i,
  delivery: /^(?:配送区域|配送范围|可配送区域|可配送范围|配送)$/i,
  category: /^(?:分类|品类|商品分类|产品分类)$/i,
  image: /^(?:图片|商品图|产品图|商品图片)$/i,
};

const clean = (value: unknown) => String(value ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
const candidateId = (source: ProductSource, index: number) => `${source.type}-${source.page ?? source.slide ?? source.sheet ?? "document"}-${source.row ?? index + 1}-${index + 1}`;

function tableIndex(table: ImportedTable, field: CandidateField) {
  return table.headers.findIndex((header) => headerAliases[field].test(clean(header).replace(/\s/g, "")));
}

function valuesAt(row: ImportedTable["rows"][number], table: ImportedTable) {
  const get = (field: CandidateField) => {
    const index = tableIndex(table, field);
    return index >= 0 ? clean(row[index]) : "";
  };
  return { get };
}

export function candidatesFromTable(table: ImportedTable, document: RawImportedDocument): ProductCandidate[] {
  return table.rows.flatMap((row, rowIndex) => {
    const { get } = valuesAt(row, table);
    const name = get("name");
    const sku = get("sku");
    if (!name && !sku) return [];
    const source: ProductSource = {
      type: document.sourceType,
      fileName: document.fileName,
      page: table.sourcePage,
      slide: table.sourceSlide,
      row: rowIndex + 2,
      fields: table.headers,
    };
    const imageText = get("image");
    const images = parseImageSources(imageText).filter((value) => /^(?:data:image\/|blob:|https?:\/\/)/.test(value));
    const fieldConfidence: ProductCandidate["fieldConfidence"] = {
      name: name ? 0.99 : 0,
      sku: sku ? 0.99 : 0,
      items: get("items") ? 0.96 : 0,
      marketPrice: parsePrice(get("marketPrice")) !== undefined ? 0.99 : 0,
      salePrice: parsePrice(get("salePrice")) !== undefined ? 0.99 : 0,
      delivery: get("delivery") ? 0.96 : 0,
      category: get("category") ? 0.95 : 0,
      image: images.length ? 0.98 : 0,
    };
    const meaningful = Object.values(fieldConfidence).filter((value) => value > 0);
    return [{
      id: candidateId(source, rowIndex),
      sku,
      name,
      items: parseProductItems(get("items")),
      marketPrice: parsePrice(get("marketPrice")),
      salePrice: parsePrice(get("salePrice")),
      delivery: parseDeliveryRules(get("delivery")).join("；"),
      category: get("category"),
      images,
      source,
      sources: [source],
      fieldConfidence,
      confidence: meaningful.length ? meaningful.reduce((sum, value) => sum + value, 0) / meaningful.length : 0.3,
      rawText: row.map(clean).join(" | "),
    }];
  });
}

function labeledValue(text: string, labels: string[]) {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.match(new RegExp(`(?:${escaped})\\s*[:：]?\\s*([^\\n|]+)`, "i"))?.[1]?.trim() ?? "";
}

function multiLineLabeledValue(text: string, labels: string[]) {
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const stopPattern = "(?:商品名称|产品名称|套餐名称|品名|SKU|套餐编号|商品编号|产品编号|商品编码|产品编码|市场价|零售价|原价|建议零售价|组合价|套餐价|福利价|售价|配送区域|配送范围|可配送范围|可配送区域|商品分类|产品分类|分类|品类)";
  const lines = text.split(/\r?\n|\|/).map((line) => line.trim()).filter(Boolean);
  const start = lines.findIndex((line) => new RegExp(`^(?:${labelPattern})\\s*[:：]?`, "i").test(line));
  if (start < 0) return "";
  const first = lines[start].replace(new RegExp(`^(?:${labelPattern})\\s*[:：]?\\s*`, "i"), "").trim();
  const values = first ? [first] : [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (new RegExp(`^${stopPattern}\\s*[:：]?`, "i").test(lines[index]) || /^(?:NO\.?\s*\d+|商品\s*(?:[一二三四五六七八九十]+|\d+)\s*[:：])/i.test(lines[index])) break;
    values.push(lines[index]);
  }
  return values.join("\n");
}

function chooseName(lines: string[], sku: string) {
  const labeled = labeledValue(lines.join("\n"), ["商品名称", "产品名称", "套餐名称", "品名"]);
  if (labeled) return labeled;
  const ordinal = lines.join("\n").match(/(?:^|\n)商品\s*(?:[一二三四五六七八九十]+|\d+)\s*[:：]\s*([^\n]+)/i)?.[1]?.trim();
  if (ordinal) return ordinal;
  return lines
    .filter((line) => line !== sku && line.length >= 3 && line.length <= 46)
    .filter((line) => !/(?:NO\.?\s*\d+|市场价|组合价|套餐价|配送|编号|编码|SKU|\uffe5|\u00a5\s*\d)/i.test(line))
    .sort((a, b) => (/[一-鿿]/.test(b) ? 1 : 0) - (/[一-鿿]/.test(a) ? 1 : 0) || b.length - a.length)[0] ?? "";
}

export function candidateFromBlock(block: ProductBlock, index: number): ProductCandidate | undefined {
  const text = block.text.replace(/[ \t]+/g, " ").trim();
  const lines = text.split(/\r?\n|\|/).map((line) => line.trim()).filter(Boolean);
  const sku = labeledValue(text, ["SKU", "套餐编号", "商品编号", "产品编号", "商品编码", "产品编码"])
    || text.match(/\b(?:[A-Z]{1,5}[-_])?\d{5,10}(?:[-_]\d{1,4})?\b/i)?.[0]
    || "";
  const name = chooseName(lines, sku);
  if (!name && !sku) return undefined;
  const itemsText = multiLineLabeledValue(text, ["商品明细", "产品明细", "套餐内容", "商品内容", "规格", "包含"]);
  const marketText = labeledValue(text, ["市场价", "零售价", "原价", "建议零售价"]);
  const saleText = labeledValue(text, ["组合价", "套餐价", "福利价", "售价"]);
  const delivery = labeledValue(text, ["配送区域", "配送范围", "可配送范围", "可配送区域", "配送"]);
  const category = labeledValue(text, ["商品分类", "产品分类", "分类", "品类"]);
  const images = block.images.filter((image) => !["possibleLogo", "decoration"].includes(image.classification)).map((image) => image.url);
  const fieldConfidence: ProductCandidate["fieldConfidence"] = {
    name: name ? (labeledValue(text, ["商品名称", "产品名称", "套餐名称", "品名"]) ? 0.95 : 0.72) : 0,
    sku: sku ? 0.9 : 0,
    items: itemsText ? 0.84 : 0.35,
    marketPrice: parsePrice(marketText) !== undefined ? 0.94 : 0,
    salePrice: parsePrice(saleText) !== undefined ? 0.94 : 0,
    delivery: delivery ? 0.86 : 0,
    category: category ? 0.82 : 0,
    image: images.length ? 0.76 : 0,
  };
  const source: ProductSource = { type: block.sourceType, fileName: block.fileName, page: block.page, slide: block.slide, blockId: block.id };
  const meaningful = Object.values(fieldConfidence).filter((value) => value > 0);
  return {
    id: candidateId(source, index), sku, name,
    items: itemsText ? parseProductItems(itemsText) : [],
    marketPrice: parsePrice(marketText), salePrice: parsePrice(saleText), delivery, category, images,
    source, sources: [source], fieldConfidence,
    confidence: meaningful.length ? meaningful.reduce((sum, value) => sum + value, 0) / meaningful.length : 0.3,
    rawText: text,
  };
}

export function extractProductCandidates(document: RawImportedDocument) {
  const tableCandidates = (document.tables ?? []).flatMap((table) => candidatesFromTable(table, document));
  const blockCandidates = detectProductBlocks(document).flatMap((block, index) => candidateFromBlock(block, index) ?? []);
  return tableCandidates.length ? tableCandidates : blockCandidates;
}
