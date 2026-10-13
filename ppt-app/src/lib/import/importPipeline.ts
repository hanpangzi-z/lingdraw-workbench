import { normalizeRawData } from "./normalizeRawData";
import { detectFileType, validatePrimaryFile } from "./detectFileType";
import { parseExcelDocument } from "./excel/parser";
import { parsePdfDocument } from "./pdf/parser";
import { parsePptxDocument } from "./ppt/parser";
import { parseDocxDocument } from "./word/parser";
import { extractProductCandidates } from "./common/candidates";
import { mergeProductCandidates } from "./common/merge";
import { matchSupportingImages, readSupportingImages } from "./common/supportingFiles";
import type { ImportPipelineOptions, ImportPipelineResult, ImportProgress, RawImportedDocument } from "./types";

const report = (options: ImportPipelineOptions, progress: ImportProgress) => options.onProgress?.(progress);

export async function parsePrimaryDocument(file: File, options: ImportPipelineOptions = {}): Promise<RawImportedDocument> {
  const type = validatePrimaryFile(file);
  if (type === "excel") return (await parseExcelDocument(file)).document;
  if (type === "pdf") return parsePdfDocument(file, {
    enableOcr: options.enableOcr,
    ocrProvider: options.ocrProvider,
    onProgress: (page, total) => report(options, { phase: "parsing", percent: Math.round(8 + (page / total) * 28), message: `正在解析 PDF 第 ${page} / ${total} 页` }),
  });
  if (type === "word") return parseDocxDocument(file);
  if (type === "ppt") return parsePptxDocument(file);
  throw new Error("不支持的主资料文件。");
}

export async function runImportPipeline(file: File, options: ImportPipelineOptions = {}): Promise<ImportPipelineResult> {
  report(options, { phase: "parsing", percent: 5, message: "正在解析文件" });
  const primaryDocument = normalizeRawData(await parsePrimaryDocument(file, options));
  const supportingDocumentFiles = (options.supportingFiles ?? []).filter((supportingFile) => ["excel", "pdf", "word", "ppt"].includes(detectFileType(supportingFile.name)));
  const relatedDocuments: RawImportedDocument[] = [];
  for (let index = 0; index < supportingDocumentFiles.length; index += 1) {
    report(options, { phase: "parsing", percent: Math.round(18 + ((index + 1) / supportingDocumentFiles.length) * 18), message: `正在解析附加资料 ${index + 1} / ${supportingDocumentFiles.length}` });
    relatedDocuments.push(normalizeRawData(await parsePrimaryDocument(supportingDocumentFiles[index], options)));
  }
  const documents = [primaryDocument, ...relatedDocuments];
  const document: RawImportedDocument = {
    ...primaryDocument,
    relatedDocuments,
    warnings: [...new Set(documents.flatMap((item) => item.warnings))],
  };
  report(options, { phase: "detecting", percent: 42, message: "正在识别商品区块" });
  const candidates = documents.flatMap(extractProductCandidates);
  report(options, { phase: "normalizing", percent: 68, message: `检测到 ${candidates.length} 个商品候选，正在整理数据` });
  const supportingImages = await readSupportingImages((options.supportingFiles ?? []).filter((supportingFile) => ["image", "archive"].includes(detectFileType(supportingFile.name))));
  report(options, { phase: "matching-images", percent: 84, message: "正在匹配商品图片" });
  const matched = matchSupportingImages(candidates, supportingImages);
  const merged = mergeProductCandidates(matched.candidates);
  report(options, { phase: "completed", percent: 100, message: "准备完成" });
  return { document, documents, candidates: matched.candidates, mergedCandidates: merged.mergedCandidates, conflicts: merged.conflicts, supportingImages };
}
