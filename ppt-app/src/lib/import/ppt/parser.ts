import JSZip from "jszip";
import { importLimits } from "../config";
import { hashBytes, mimeFromFileName, readImageDimensions, resolvePartPath, textFromXml } from "../common/xml";
import type { ImportedImage, ImportedPage, ImportedTable, ImportedTextElement, RawImportedDocument } from "../types";

const EMU_PER_INCH = 914400;

function relationshipMap(xml: string) {
  return new Map([...xml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>(?:<\/Relationship>)?/g)].map((match) => [match[1], match[2]]));
}

function bboxFromXml(xml: string) {
  const offset = xml.match(/<a:off\b[^>]*x="(\d+)"[^>]*y="(\d+)"/);
  const extent = xml.match(/<a:ext\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  if (!offset || !extent) return undefined;
  return { x: Number(offset[1]), y: Number(offset[2]), width: Number(extent[1]), height: Number(extent[2]) };
}

function parseTables(slideXml: string, slideNumber: number): ImportedTable[] {
  return [...slideXml.matchAll(/<a:tbl\b[\s\S]*?<\/a:tbl>/g)].map((tableMatch, index) => {
    const rows = [...tableMatch[0].matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map((rowMatch) =>
      [...rowMatch[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((cellMatch) => textFromXml(cellMatch[0], "a:t")),
    );
    return { id: `ppt-table-${slideNumber}-${index + 1}`, sourceSlide: slideNumber, headers: rows[0] ?? [], rows: rows.slice(1) };
  }).filter((table) => table.headers.length && table.rows.length);
}

async function getSlidePaths(zip: JSZip) {
  const presentationXml = await zip.file("ppt/presentation.xml")?.async("text") ?? "";
  const relationXml = await zip.file("ppt/_rels/presentation.xml.rels")?.async("text") ?? "";
  const relationships = relationshipMap(relationXml);
  const paths = [...presentationXml.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)]
    .map((match) => relationships.get(match[1]))
    .filter((target): target is string => Boolean(target))
    .map((target) => resolvePartPath("ppt", target));
  if (paths.length) return paths;
  return Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path)).sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
}

export async function parsePptxDocument(file: File): Promise<RawImportedDocument> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const presentationXml = await zip.file("ppt/presentation.xml")?.async("text") ?? "";
  const slideSize = presentationXml.match(/<p:sldSz\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  const width = Number(slideSize?.[1] ?? 13.333 * EMU_PER_INCH);
  const height = Number(slideSize?.[2] ?? 7.5 * EMU_PER_INCH);
  const slidePaths = await getSlidePaths(zip);
  if (slidePaths.length > importLimits.pptMaxSlides) throw new Error(`PPT 共 ${slidePaths.length} 页，超过当前 ${importLimits.pptMaxSlides} 页限制。`);
  const pages: ImportedPage[] = [];
  const allImages: ImportedImage[] = [];
  const allTables: ImportedTable[] = [];

  for (let index = 0; index < slidePaths.length; index += 1) {
    const slideNumber = index + 1;
    const slidePath = slidePaths[index];
    const slideXml = await zip.file(slidePath)?.async("text") ?? "";
    const relPath = slidePath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
    const relationships = relationshipMap(await zip.file(relPath)?.async("text") ?? "");
    const textElements: ImportedTextElement[] = [...slideXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].flatMap((match, shapeIndex) => {
      const text = textFromXml(match[0], "a:t");
      return text ? [{ id: `ppt-text-${slideNumber}-${shapeIndex + 1}`, text, ...bboxFromXml(match[0]) }] : [];
    });
    const images: ImportedImage[] = [];
    const pictures = [...slideXml.matchAll(/<p:pic\b[\s\S]*?<\/p:pic>/g)];
    for (let pictureIndex = 0; pictureIndex < pictures.length; pictureIndex += 1) {
      const pictureXml = pictures[pictureIndex][0];
      const relationId = pictureXml.match(/<a:blip\b[^>]*r:embed="([^"]+)"/)?.[1];
      const target = relationId ? relationships.get(relationId) : undefined;
      if (!target) continue;
      const mediaPath = resolvePartPath("ppt/slides", target);
      const entry = zip.file(mediaPath);
      if (!entry) continue;
      const bytes = await entry.async("uint8array");
      const dimensions = readImageDimensions(bytes, mediaPath);
      const base64 = await entry.async("base64");
      const bbox = bboxFromXml(pictureXml);
      const image: ImportedImage = {
        id: `ppt-image-${slideNumber}-${pictureIndex + 1}`,
        sourceSlide: slideNumber,
        fileName: mediaPath.split("/").pop(),
        url: `data:${mimeFromFileName(mediaPath)};base64,${base64}`,
        ...dimensions,
        bbox,
        hash: hashBytes(bytes),
        classification: "unknown",
      };
      images.push(image);
      allImages.push(image);
    }
    const tables = parseTables(slideXml, slideNumber);
    allTables.push(...tables);
    pages.push({ pageNumber: slideNumber, text: textElements.map((element) => element.text).join("\n"), textElements, images, tables, width, height });
  }

  const hashCounts = new Map<string, number>();
  allImages.forEach((image) => image.hash && hashCounts.set(image.hash, (hashCounts.get(image.hash) ?? 0) + 1));
  allImages.forEach((image) => {
    const count = image.hash ? hashCounts.get(image.hash) ?? 1 : 1;
    image.occurrenceCount = count;
    const areaRatio = image.bbox ? (image.bbox.width * image.bbox.height) / (width * height) : 0;
    const topLeft = image.bbox ? image.bbox.x < width * 0.25 && image.bbox.y < height * 0.2 : false;
    if (count >= Math.max(3, Math.ceil(pages.length * 0.35))) image.classification = topLeft ? "possibleLogo" : "decoration";
    else image.classification = areaRatio >= 0.025 ? "possibleProductImage" : "unknown";
  });

  if (!pages.length) throw new Error("无法从 PPTX 中读取幻灯片。");
  const filteredCount = allImages.filter((image) => image.classification === "possibleLogo" || image.classification === "decoration").length;
  return {
    sourceType: "ppt",
    fileName: file.name,
    pages,
    tables: allTables,
    images: allImages,
    rawText: pages.map((page) => page.text).join("\n\n"),
    metadata: { slideCount: pages.length, width, height, filteredDecorationCount: filteredCount },
    warnings: filteredCount ? [`已标记 ${filteredCount} 张重复 Logo / 装饰图，不参与默认商品匹配。`] : [],
  };
}
