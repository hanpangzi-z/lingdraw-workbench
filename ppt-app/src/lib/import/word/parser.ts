import JSZip from "jszip";
import { hashBytes, mimeFromFileName, readImageDimensions, resolvePartPath, textFromXml } from "../common/xml";
import type { ImportedImage, ImportedPage, ImportedTable, ImportedTextElement, RawImportedDocument } from "../types";

function relationshipMap(xml: string) {
  return new Map([...xml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>(?:<\/Relationship>)?/g)].map((match) => [match[1], match[2]]));
}

function parseTables(documentXml: string): ImportedTable[] {
  return [...documentXml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/g)].map((tableMatch, tableIndex) => {
    const rows = [...tableMatch[0].matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((rowMatch) =>
      [...rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((cellMatch) => textFromXml(cellMatch[0], "w:t")),
    );
    const headers = rows[0] ?? [];
    return {
      id: `word-table-${tableIndex + 1}`,
      headers: headers.map((value, index) => value || `未命名列${index + 1}`),
      rows: rows.slice(1),
    };
  }).filter((table) => table.headers.length > 0 && table.rows.length > 0);
}

export async function parseDocxDocument(file: File): Promise<RawImportedDocument> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentEntry = zip.file("word/document.xml");
  if (!documentEntry) throw new Error("无法读取 Word 主文档结构。");
  const documentXml = await documentEntry.async("text");
  const relationshipXml = await zip.file("word/_rels/document.xml.rels")?.async("text") ?? "";
  const relationships = relationshipMap(relationshipXml);
  const paragraphs = [...documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
  const images: ImportedImage[] = [];
  const imageByPath = new Map<string, ImportedImage>();
  const paragraphTexts: string[] = [];
  const textElements: ImportedTextElement[] = [];

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraphXml = paragraphs[paragraphIndex][0];
    const text = textFromXml(paragraphXml, "w:t");
    if (text) {
      paragraphTexts.push(text);
      textElements.push({ id: `word-paragraph-${paragraphIndex + 1}`, text });
    }
    const relationIds = [...paragraphXml.matchAll(/<a:blip\b[^>]*r:embed="([^"]+)"/g)].map((match) => match[1]);
    for (const relationId of relationIds) {
      const target = relationships.get(relationId);
      if (!target) continue;
      const path = resolvePartPath("word", target);
      const entry = zip.file(path);
      if (!entry) continue;
      let image = imageByPath.get(path);
      if (!image) {
        const bytes = await entry.async("uint8array");
        const dimensions = readImageDimensions(bytes, path);
        const base64 = await entry.async("base64");
        image = {
          id: `word-image-${images.length + 1}`,
          sourceParagraph: paragraphIndex + 1,
          fileName: path.split("/").pop(),
          url: `data:${mimeFromFileName(path)};base64,${base64}`,
          ...dimensions,
          hash: hashBytes(bytes),
          classification: paragraphIndex < 3 && (dimensions.width ?? 0) < 500 ? "possibleLogo" : "possibleProductImage",
        };
        imageByPath.set(path, image);
        images.push(image);
      }
    }
  }

  const tables = parseTables(documentXml);
  const rawText = paragraphTexts.join("\n");
  const page: ImportedPage = {
    pageNumber: 1,
    text: rawText,
    textElements,
    tables,
    images,
  };
  return {
    sourceType: "word",
    fileName: file.name,
    pages: [page],
    tables,
    images,
    rawText,
    metadata: { paragraphCount: paragraphs.length, tableCount: tables.length, imageCount: images.length },
    warnings: images.some((image) => image.classification === "possibleLogo") ? ["已识别可能的 Logo，不会默认当作商品图。"] : [],
  };
}
