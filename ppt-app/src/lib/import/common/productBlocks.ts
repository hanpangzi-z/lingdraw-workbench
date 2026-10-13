import type { ImportBoundingBox, ImportedPage, ProductBlock, RawImportedDocument } from "../types";

const anchorPattern = /(?:^|\s)(?:NO\.?\s*\d{1,3}|SKU\s*[:：]?|(?:套餐|商品|产品)(?:编号|编码)\s*[:：]?|商品\s*(?:[一二三四五六七八九十]+|\d+)\s*[:：])/i;

function unionBox(boxes: ImportBoundingBox[]): ImportBoundingBox | undefined {
  if (!boxes.length) return undefined;
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x, y, width: right - x, height: bottom - y };
}

function makeBlock(document: RawImportedDocument, page: ImportedPage, index: number, elements = page.textElements ?? [], bbox?: ImportBoundingBox): ProductBlock {
  const selectedImages = (page.images ?? []).filter((image) => {
    if (["possibleLogo", "decoration"].includes(image.classification)) return false;
    if (!bbox || !image.bbox) return true;
    const centerX = image.bbox.x + image.bbox.width / 2;
    const centerY = image.bbox.y + image.bbox.height / 2;
    return centerX >= bbox.x && centerX <= bbox.x + bbox.width && centerY >= bbox.y && centerY <= bbox.y + bbox.height;
  });
  return {
    id: `${document.sourceType}-${page.pageNumber}-block-${index + 1}`,
    sourceType: document.sourceType,
    fileName: document.fileName,
    page: document.sourceType === "ppt" ? undefined : page.pageNumber,
    slide: document.sourceType === "ppt" ? page.pageNumber : undefined,
    text: elements.length ? elements.map((element) => element.text).join("\n") : page.text,
    textElements: elements,
    images: selectedImages,
    bbox,
  };
}

function positionedBlocks(document: RawImportedDocument, page: ImportedPage) {
  const elements = (page.textElements ?? []).filter((element) => element.x !== undefined && element.y !== undefined && element.width !== undefined && element.height !== undefined);
  const anchors = elements.filter((element) => anchorPattern.test(element.text));
  if (!page.width || !page.height || !anchors.length) return [];
  const xRange = (Math.max(...anchors.map((element) => element.x!)) - Math.min(...anchors.map((element) => element.x!))) / page.width;
  const yRange = (Math.max(...anchors.map((element) => element.y!)) - Math.min(...anchors.map((element) => element.y!))) / page.height;
  const horizontal = xRange > yRange && anchors.length <= 8;
  const axisSize = horizontal ? page.width : page.height;
  const sorted = [...anchors].sort((a, b) => horizontal ? a.x! - b.x! : a.y! - b.y!);
  const consolidated = sorted.reduce<typeof sorted>((groups, anchor) => {
    const position = horizontal ? anchor.x! + anchor.width! / 2 : anchor.y! + anchor.height! / 2;
    const previous = groups.at(-1);
    const previousPosition = previous ? (horizontal ? previous.x! + previous.width! / 2 : previous.y! + previous.height! / 2) : undefined;
    if (previousPosition === undefined || Math.abs(position - previousPosition) > axisSize * 0.08) groups.push(anchor);
    return groups;
  }, []);
  const anchorPositions = consolidated.map((anchor) => horizontal ? anchor.x! + anchor.width! / 2 : anchor.y! + anchor.height! / 2);
  const boundaries = [0, ...anchorPositions.slice(0, -1).map((position, index) => (position + anchorPositions[index + 1]) / 2), axisSize];
  return consolidated.map((_, index) => {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const selected = elements.filter((element) => {
      const center = horizontal ? element.x! + element.width! / 2 : element.y! + element.height! / 2;
      return center >= start && center < end;
    });
    const bbox = horizontal ? { x: start, y: 0, width: end - start, height: page.height! } : { x: 0, y: start, width: page.width!, height: end - start };
    return makeBlock(document, page, index, selected, unionBox([bbox, ...selected.map((element) => ({ x: element.x!, y: element.y!, width: element.width!, height: element.height! }))]) ?? bbox);
  }).filter((block) => block.text.trim().length >= 8);
}

function textualBlocks(document: RawImportedDocument, page: ImportedPage) {
  if (document.sourceType === "word" && page.textElements?.length) {
    const elements = page.textElements;
    const primaryAnchorPattern = /(?:^|\s)(?:NO\.?\s*\d{1,3}|商品\s*(?:[一二三四五六七八九十]+|\d+)\s*[:：])/i;
    const primaryAnchorIndexes = elements.flatMap((element, index) => primaryAnchorPattern.test(element.text) ? [index] : []);
    const anchorIndexes = primaryAnchorIndexes.length ? primaryAnchorIndexes : elements.flatMap((element, index) => anchorPattern.test(element.text) ? [index] : []);
    if (anchorIndexes.length) {
      return anchorIndexes.map((start, index) => {
        const end = anchorIndexes[index + 1] ?? elements.length;
        const selected = elements.slice(start, end);
        const paragraphNumbers = selected.map((element) => Number(element.id?.match(/word-paragraph-(\d+)/)?.[1])).filter(Number.isFinite);
        const firstParagraph = Math.min(...paragraphNumbers);
        const nextAnchorParagraph = elements[anchorIndexes[index + 1]]?.id?.match(/word-paragraph-(\d+)/)?.[1];
        const lastParagraph = nextAnchorParagraph ? Number(nextAnchorParagraph) - 1 : Number(document.metadata?.paragraphCount ?? Math.max(...paragraphNumbers));
        const images = (page.images ?? []).filter((image) => image.classification !== "possibleLogo" && image.classification !== "decoration" && image.sourceParagraph !== undefined && image.sourceParagraph >= firstParagraph && image.sourceParagraph <= lastParagraph);
        return { ...makeBlock(document, page, index, selected), images };
      }).filter((block) => block.text.trim().length >= 8);
    }
  }
  const chunks = page.text
    .split(/(?=(?:^|\n)\s*(?:NO\.?\s*\d{1,3}|(?:套餐|商品|产品)(?:编号|编码)\s*[:：]|商品\s*(?:[一二三四五六七八九十]+|\d+)\s*[:：]))/gim)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= 8);
  if (chunks.length <= 1) return page.text.trim() ? [makeBlock(document, page, 0)] : [];
  return chunks.map((text, index) => ({ ...makeBlock(document, page, index), text }));
}

export function detectProductBlocks(document: RawImportedDocument): ProductBlock[] {
  return (document.pages ?? []).flatMap((page) => {
    if (page.tables?.length) return [];
    const positioned = positionedBlocks(document, page);
    return positioned.length ? positioned : textualBlocks(document, page);
  });
}
