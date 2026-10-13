import type { ExcelCellValue, ExcelSheetData, ExcelWorkbookData } from "@/types/import";
import { importLimits } from "@/src/lib/import/config";
import type { ImportedImage, ImportedPage, ImportedTable, ImportedTextElement, OCRProvider, RawImportedDocument } from "@/src/lib/import/types";
import { withBasePath } from "@/src/lib/basePath";

interface PositionedText {
  text: string;
  x: number;
  y: number;
  width: number;
}

interface RowMarker {
  no: string;
  y: number;
}

interface PdfImageBox {
  x: number;
  y: number;
  width: number;
  height: number;
  centerY: number;
  source?: string;
  objectName?: string;
  inlineImage?: PdfImageObject;
  flipX: boolean;
  flipY: boolean;
}

interface PdfImageObject {
  width: number;
  height: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: CanvasImageSource;
}

type Matrix = [number, number, number, number, number, number];

const PDF_HEADERS = ["序号", "套餐编号", "套餐名称", "商品名称", "商品明细", "市场价", "组合价", "配送区域", "图片"];

function extractProductCode(text: string) {
  const prefixed = text.match(/^\d{1,2}((?:26|27)\d{5})/);
  return prefixed?.[1] ?? text.match(/(?:26|27)\d{5}/)?.[0] ?? "";
}

function groupTextLines(items: PositionedText[], separator = "\n") {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PositionedText[][] = [];
  for (const item of sorted) {
    const line = lines.find((candidate) => Math.abs(candidate[0].y - item.y) <= 2.4);
    if (line) line.push(item);
    else lines.push([item]);
  }
  return lines
    .sort((a, b) => b[0].y - a[0].y)
    .map((line) => line.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(separator)
    .trim();
}

function pickColumn(items: PositionedText[], minX: number, maxX: number, separator = "\n") {
  return groupTextLines(items.filter((item) => item.x >= minX && item.x < maxX), separator);
}

function multiplyMatrix(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function transformPoint(matrix: Matrix, x: number, y: number) {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  };
}

function embeddedImageToDataUrl(image: PdfImageObject | undefined, flipX: boolean, flipY: boolean) {
  if (!image || typeof window === "undefined" || image.width < 1 || image.height < 1) return undefined;
  const canvas = window.document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return undefined;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (image.bitmap) {
    context.save();
    context.translate(flipX ? image.width : 0, flipY ? image.height : 0);
    context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    context.drawImage(image.bitmap, 0, 0, image.width, image.height);
    context.restore();
  } else if (image.data) {
    const pixelCount = image.width * image.height;
    const bytesPerPixel = image.data.length / pixelCount;
    if (bytesPerPixel !== 3 && bytesPerPixel !== 4) return undefined;
    const pixels = context.createImageData(image.width, image.height);
    for (let sourceY = 0; sourceY < image.height; sourceY += 1) {
      for (let sourceX = 0; sourceX < image.width; sourceX += 1) {
      const sourcePixelIndex = sourceY * image.width + sourceX;
      const targetX = flipX ? image.width - sourceX - 1 : sourceX;
      const targetY = flipY ? image.height - sourceY - 1 : sourceY;
      const sourceIndex = sourcePixelIndex * bytesPerPixel;
      const targetIndex = (targetY * image.width + targetX) * 4;
      const alpha = bytesPerPixel === 4 ? image.data[sourceIndex + 3] / 255 : 1;
      pixels.data[targetIndex] = Math.round(image.data[sourceIndex] * alpha + 255 * (1 - alpha));
      pixels.data[targetIndex + 1] = Math.round(image.data[sourceIndex + 1] * alpha + 255 * (1 - alpha));
      pixels.data[targetIndex + 2] = Math.round(image.data[sourceIndex + 2] * alpha + 255 * (1 - alpha));
      pixels.data[targetIndex + 3] = 255;
      }
    }
    context.putImageData(pixels, 0, 0);
  } else {
    return undefined;
  }

  return canvas.toDataURL("image/jpeg", 0.97);
}

async function getPageImageObject(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof import("pdfjs-dist/legacy/build/pdf.mjs")["getDocument"]>["promise"]>["getPage"]>>,
  objectName: string,
) {
  try {
    return page.objs.get(objectName) as unknown as PdfImageObject;
  } catch {
    return new Promise<PdfImageObject | undefined>((resolve) => {
      let settled = false;
      const finish = (value?: PdfImageObject) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      window.setTimeout(() => finish(), 3_000);
      try {
        page.objs.get(objectName, (value: unknown) => finish(value as PdfImageObject));
      } catch {
        finish();
      }
    });
  }
}

async function extractPageImageBoxes(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof import("pdfjs-dist/legacy/build/pdf.mjs")["getDocument"]>["promise"]>["getPage"]>>,
  pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs"),
): Promise<PdfImageBox[]> {
  const operatorList = await page.getOperatorList();
  const identity: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  let current: Matrix = identity;
  const boxes: PdfImageBox[] = [];
  const pageViewport = page.getViewport({ scale: 1 });

  operatorList.fnArray.forEach((operator, index) => {
    if (operator === pdfjs.OPS.save) {
      stack.push([...current] as Matrix);
      return;
    }
    if (operator === pdfjs.OPS.restore) {
      current = stack.pop() ?? identity;
      return;
    }
    if (operator === pdfjs.OPS.transform) {
      const values = operatorList.argsArray[index] as number[];
      if (values?.length === 6) current = multiplyMatrix(current, values as unknown as Matrix);
      return;
    }
    if (operator !== pdfjs.OPS.paintImageXObject && operator !== pdfjs.OPS.paintInlineImageXObject) return;

    const corners = [
      transformPoint(current, 0, 0),
      transformPoint(current, 1, 0),
      transformPoint(current, 0, 1),
      transformPoint(current, 1, 1),
    ];
    const minX = Math.min(...corners.map((point) => point.x));
    const maxX = Math.max(...corners.map((point) => point.x));
    const minY = Math.min(...corners.map((point) => point.y));
    const maxY = Math.max(...corners.map((point) => point.y));
    const width = maxX - minX;
    const height = maxY - minY;
    const centerX = minX + width / 2;

    // Product pictures occupy the image column. This excludes page logos and tiny drawing assets.
    if (width < 18 || height < 18 || centerX < pageViewport.width * 0.48 || centerX > pageViewport.width * 0.76) return;
    const operatorArgs = operatorList.argsArray[index];
    boxes.push({
      x: minX,
      y: minY,
      width,
      height,
      centerY: minY + height / 2,
      objectName: operator === pdfjs.OPS.paintImageXObject && typeof operatorArgs?.[0] === "string" ? operatorArgs[0] : undefined,
      inlineImage: operator === pdfjs.OPS.paintInlineImageXObject ? operatorArgs?.[0] as PdfImageObject : undefined,
      flipX: current[0] < 0,
      flipY: current[3] < 0,
    });
  });

  if (!boxes.length || typeof window === "undefined") return boxes;

  await Promise.all(boxes.map(async (box) => {
    const embedded = box.inlineImage ?? (box.objectName ? await getPageImageObject(page, box.objectName) : undefined);
    box.source = embeddedImageToDataUrl(embedded, box.flipX, box.flipY);
  }));

  const missingBoxes = boxes.filter((box) => !box.source);
  if (!missingBoxes.length) return boxes;

  // Fallback for masks or unusual PDF image objects: crop a higher-resolution page render.
  const scale = 3.2;
  const viewport = page.getViewport({ scale });
  const pageCanvas = window.document.createElement("canvas");
  pageCanvas.width = Math.ceil(viewport.width);
  pageCanvas.height = Math.ceil(viewport.height);
  const pageContext = pageCanvas.getContext("2d", { alpha: false });
  if (!pageContext) return boxes;

  await page.render({ canvas: pageCanvas, canvasContext: pageContext, viewport }).promise;

  missingBoxes.forEach((box) => {
    const firstPoint = viewport.convertToViewportPoint(box.x, box.y);
    const secondPoint = viewport.convertToViewportPoint(box.x + box.width, box.y + box.height);
    const viewportRect = [firstPoint[0], firstPoint[1], secondPoint[0], secondPoint[1]];
    const sx = Math.max(0, Math.floor(Math.min(viewportRect[0], viewportRect[2])));
    const sy = Math.max(0, Math.floor(Math.min(viewportRect[1], viewportRect[3])));
    const sw = Math.min(pageCanvas.width - sx, Math.ceil(Math.abs(viewportRect[2] - viewportRect[0])));
    const sh = Math.min(pageCanvas.height - sy, Math.ceil(Math.abs(viewportRect[3] - viewportRect[1])));
    if (sw < 2 || sh < 2) return;
    const imageCanvas = window.document.createElement("canvas");
    imageCanvas.width = sw;
    imageCanvas.height = sh;
    const imageContext = imageCanvas.getContext("2d", { alpha: false });
    if (!imageContext) return;
    imageContext.fillStyle = "#ffffff";
    imageContext.fillRect(0, 0, sw, sh);
    imageContext.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    box.source = imageCanvas.toDataURL("image/jpeg", 0.96);
  });

  pageCanvas.width = 1;
  pageCanvas.height = 1;
  return boxes;
}

function extractRow(items: PositionedText[], marker: RowMarker, top: number, bottom: number, images: string[]): ExcelCellValue[] {
  const rowItems = items.filter((item) => item.y <= top && item.y > bottom && item.text.trim());
  const packageCell = pickColumn(rowItems, 58, 123, " ");
  const code = rowItems.map((item) => extractProductCode(item.text)).find(Boolean) ?? "";
  const packageName = packageCell
    .replace(code, "")
    .replace(new RegExp(`^${marker.no}`), "")
    .replace(new RegExp(`(^|\\s)${marker.no}(?=\\s|$)`, "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
  const productName = pickColumn(rowItems, 108, 195, "\n");
  const details = pickColumn(rowItems, 190, 410, "\n");
  const combinedDetails = [...new Set((details || productName).split("\n").map((value) => value.trim()).filter(Boolean))].join("\n");

  return [
    marker.no,
    code,
    packageName || productName.split("\n")[0] || `PDF 套餐 ${marker.no}`,
    productName,
    combinedDetails,
    pickColumn(rowItems, 410, 455, " / "),
    pickColumn(rowItems, 455, 500, " / "),
    pickColumn(rowItems, 500, 596, ""),
    images,
  ];
}

export async function readPdfFile(file: File): Promise<ExcelWorkbookData> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined") pdfjs.GlobalWorkerOptions.workerSrc = withBasePath("/pdf.worker.min.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    disableWorker: true,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]);
  const document = await loadingTask.promise;
  const dataRows: ExcelCellValue[][] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const [textContent, pageImages] = await Promise.all([
      page.getTextContent(),
      extractPageImageBoxes(page, pdfjs),
    ]);
    const items: PositionedText[] = textContent.items.flatMap((item) => {
      if (!("str" in item) || !item.str.trim()) return [];
      return [{ text: item.str.trim(), x: item.transform[4], y: item.transform[5], width: item.width }];
    });
    const directMarkers = items
      .filter((item) => item.x >= 55 && item.x <= 75 && /^\d{1,3}$/.test(item.text))
      .map<RowMarker>((item) => ({ no: String(Number(item.text)), y: item.y }));
    const codeMarkers = items.flatMap<RowMarker>((item) => {
      const code = extractProductCode(item.text);
      if (!code || item.x > 125) return [];
      return [{ no: String(Number(code.slice(-2))), y: item.y }];
    });
    const markers = [...directMarkers, ...codeMarkers]
      .filter((marker, index, all) => all.findIndex((candidate) => candidate.no === marker.no) === index)
      .sort((a, b) => b.y - a.y);
    const headerY = pageNumber === 1
      ? items.find((item) => item.text === "序号")?.y
      : undefined;

    markers.forEach((marker, index) => {
      const previous = markers[index - 1];
      const next = markers[index + 1];
      const top = previous
        ? (previous.y + marker.y) / 2
        : headerY
          ? headerY - 10
          : Math.min(viewport.height - 25, marker.y + 92);
      const bottom = next ? (marker.y + next.y) / 2 : Math.max(35, marker.y - 92);
      const images = pageImages
        .filter((image) => image.source && image.centerY <= top && image.centerY > bottom)
        .sort((a, b) => b.centerY - a.centerY)
        .map((image) => image.source!);
      dataRows.push(extractRow(items, marker, top, bottom, images));
    });
  }

  await loadingTask.destroy();
  if (!dataRows.length) throw new Error("未在 PDF 中识别到带序号的商品表格；扫描件暂不支持，请先转换为可检索文字 PDF");

  const sheet: ExcelSheetData = {
    name: "PDF识别结果",
    rows: [PDF_HEADERS, ...dataRows],
    nonEmptyRowCount: dataRows.length + 1,
  };
  return { fileName: file.name, sourceType: "pdf", sheets: [sheet] };
}

async function renderPagePreview(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof import("pdfjs-dist/legacy/build/pdf.mjs")["getDocument"]>["promise"]>["getPage"]>>,
) {
  if (typeof window === "undefined") return undefined;
  const viewport = page.getViewport({ scale: 0.92 });
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return undefined;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const result = canvas.toDataURL("image/jpeg", 0.72);
  canvas.width = 1;
  canvas.height = 1;
  return result;
}

function toImportedImages(boxes: PdfImageBox[], pageNumber: number, pageWidth: number, pageHeight: number): ImportedImage[] {
  return boxes.flatMap((box, index) => {
    if (!box.source) return [];
    const bbox = { x: box.x, y: pageHeight - box.y - box.height, width: box.width, height: box.height };
    const areaRatio = (box.width * box.height) / (pageWidth * pageHeight);
    return [{
      id: `pdf-image-${pageNumber}-${index + 1}`,
      sourcePage: pageNumber,
      fileName: `pdf-page-${pageNumber}-image-${index + 1}.jpg`,
      url: box.source,
      width: Math.round(box.width),
      height: Math.round(box.height),
      bbox,
      classification: areaRatio > 0.02 ? "possibleProductImage" as const : "unknown" as const,
    }];
  });
}

export async function parsePdfDocument(file: File, options: {
  enableOcr?: boolean;
  ocrProvider?: OCRProvider;
  onProgress?: (page: number, total: number) => void;
} = {}): Promise<RawImportedDocument> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined") pdfjs.GlobalWorkerOptions.workerSrc = withBasePath("/pdf.worker.min.mjs");
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableWorker: true } as unknown as Parameters<typeof pdfjs.getDocument>[0]);
  const document = await loadingTask.promise;
  if (document.numPages > importLimits.pdfMaxPages) {
    await loadingTask.destroy();
    throw new Error(`PDF 共 ${document.numPages} 页，超过当前 ${importLimits.pdfMaxPages} 页限制。`);
  }
  const pages: ImportedPage[] = [];
  const allImages: ImportedImage[] = [];
  const allTables: ImportedTable[] = [];
  const warnings: string[] = [];
  const failedPages: number[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    try {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const [textContent, imageBoxes] = await Promise.all([page.getTextContent(), extractPageImageBoxes(page, pdfjs)]);
      const positionedItems: PositionedText[] = textContent.items.flatMap((item) => !(("str" in item) && item.str.trim()) ? [] : [{ text: item.str.trim(), x: item.transform[4], y: item.transform[5], width: item.width }]);
      let textElements: ImportedTextElement[] = positionedItems.map((item, index) => ({
        id: `pdf-text-${pageNumber}-${index + 1}`,
        text: item.text,
        x: item.x,
        y: viewport.height - item.y,
        width: item.width,
        height: Math.max(8, Math.abs((textContent.items[index] as { transform?: number[] }).transform?.[3] ?? 10)),
      }));
      let text = groupTextLines(positionedItems);
      let previewUrl = await renderPagePreview(page);
      const textDensity = text.length / Math.max(1, viewport.width * viewport.height);
      let requiresOcr = textDensity < importLimits.ocrTextDensityThreshold;
      if (requiresOcr && options.enableOcr && options.ocrProvider && previewUrl) {
        const blob = await fetch(previewUrl).then((response) => response.blob());
        const result = await options.ocrProvider.recognizePage(blob);
        if (result.text.trim()) {
          text = result.text;
          textElements = result.textElements ?? [{ id: `ocr-text-${pageNumber}`, text: result.text }];
          requiresOcr = false;
        }
      }
      if (requiresOcr) warnings.push(`第 ${pageNumber} 页文字密度较低，可能是扫描页。`);

      const images = toImportedImages(imageBoxes, pageNumber, viewport.width, viewport.height);
      allImages.push(...images);
      const directMarkers = positionedItems.filter((item) => item.x >= 55 && item.x <= 75 && /^\d{1,3}$/.test(item.text)).map<RowMarker>((item) => ({ no: String(Number(item.text)), y: item.y }));
      const codeMarkers = positionedItems.flatMap<RowMarker>((item) => {
        const code = extractProductCode(item.text);
        return code && item.x <= 125 ? [{ no: String(Number(code.slice(-2))), y: item.y }] : [];
      });
      const markers = [...directMarkers, ...codeMarkers].filter((marker, index, all) => all.findIndex((candidate) => candidate.no === marker.no) === index).sort((a, b) => b.y - a.y);
      const headerY = positionedItems.find((item) => item.text === "序号")?.y;
      const tableRows = markers.map((marker, index) => {
        const previous = markers[index - 1];
        const next = markers[index + 1];
        const top = previous ? (previous.y + marker.y) / 2 : headerY ? headerY - 10 : Math.min(viewport.height - 25, marker.y + 92);
        const bottom = next ? (marker.y + next.y) / 2 : Math.max(35, marker.y - 92);
        const rowImages = imageBoxes.filter((image) => image.source && image.centerY <= top && image.centerY > bottom).sort((a, b) => b.centerY - a.centerY).map((image) => image.source!);
        return extractRow(positionedItems, marker, top, bottom, rowImages);
      });
      const tables: ImportedTable[] = tableRows.length ? [{ id: `pdf-table-${pageNumber}`, sourcePage: pageNumber, headers: PDF_HEADERS, rows: tableRows.map((row) => row.map((value) => Array.isArray(value) ? value.join("\n") : typeof value === "number" ? value : value === null ? null : String(value))) }] : [];
      allTables.push(...tables);
      pages.push({ pageNumber, text, textElements, tables, images, width: viewport.width, height: viewport.height, previewUrl, textDensity, requiresOcr });
    } catch (error) {
      failedPages.push(pageNumber);
      const message = error instanceof Error ? error.message : "未知解析错误";
      warnings.push(`第 ${pageNumber} 页解析失败：${message}`);
      pages.push({ pageNumber, text: "", requiresOcr: true, parseError: message });
    }
    options.onProgress?.(pageNumber, document.numPages);
  }
  await loadingTask.destroy();
  return {
    sourceType: "pdf",
    fileName: file.name,
    pages,
    tables: allTables,
    images: allImages,
    rawText: pages.map((page) => page.text).join("\n\n"),
    metadata: { pageCount: document.numPages, failedPages, scannedPageCount: pages.filter((page) => page.requiresOcr).length },
    warnings,
  };
}
