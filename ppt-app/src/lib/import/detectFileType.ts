import { importLimits, rejectedMacroExtensions, supportedPrimaryExtensions } from "./config";
import type { ImportSourceType } from "./types";

export function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function detectFileType(fileName: string): ImportSourceType | "image" | "archive" | "unknown" {
  const extension = getFileExtension(fileName);
  if (["xlsx", "xls"].includes(extension)) return "excel";
  if (extension === "pdf") return "pdf";
  if (extension === "docx") return "word";
  if (extension === "pptx") return "ppt";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return "image";
  if (extension === "zip") return "archive";
  return "unknown";
}

export function validatePrimaryFile(file: File) {
  const extension = getFileExtension(file.name);
  if (rejectedMacroExtensions.includes(extension as typeof rejectedMacroExtensions[number])) {
    throw new Error(`为避免宏安全风险，第一版不支持 .${extension} 文件，请另存为无宏格式。`);
  }
  if (!supportedPrimaryExtensions.includes(extension as typeof supportedPrimaryExtensions[number])) {
    throw new Error("支持 .xlsx、.xls、.pdf、.docx 和 .pptx 主资料文件。");
  }
  if (file.size > importLimits.primaryMaxBytes) throw new Error("主资料文件超过 100MB 限制。");
  if (extension === "docx" && file.size > importLimits.wordMaxBytes) throw new Error("Word 文件超过 50MB 限制。");
  return detectFileType(file.name) as Exclude<ImportSourceType, "manual">;
}
