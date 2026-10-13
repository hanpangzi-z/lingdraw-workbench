import { detectHeaderRow, getSheetHeaders, readExcelFile } from "@/src/lib/excel/parser";
import type { ImportedPage, ImportedTable, RawImportedDocument } from "../types";

export async function parseExcelDocument(file: File): Promise<{ document: RawImportedDocument; workbook: Awaited<ReturnType<typeof readExcelFile>> }> {
  const workbook = await readExcelFile(file);
  const displayValue = (value: unknown) => typeof value === "string" && value.startsWith("data:image/") ? "[已识别图片]" : String(value ?? "");
  const tables: ImportedTable[] = workbook.sheets.flatMap((sheet, index) => {
    const headerRow = detectHeaderRow(sheet);
    const headers = getSheetHeaders(sheet, headerRow);
    const rows = sheet.rows.slice(headerRow).filter((row) => row.some((value) => String(value ?? "").trim()));
    return headers.length ? [{ id: `excel-table-${index + 1}`, headers, rows: rows.map((row) => headers.map((_, column) => row[column] === null ? null : displayValue(row[column]))) }] : [];
  });
  const pages: ImportedPage[] = tables.map((table, index) => ({ pageNumber: index + 1, text: [table.headers.join(" | "), ...table.rows.map((row) => row.join(" | "))].join("\n"), tables: [table] }));
  return {
    workbook,
    document: {
      sourceType: "excel",
      fileName: file.name,
      pages,
      tables,
      rawText: pages.map((page) => page.text).join("\n\n"),
      metadata: { sheetNames: workbook.sheets.map((sheet) => sheet.name), embeddedImageCount: workbook.embeddedImageCount ?? 0 },
      warnings: [],
    },
  };
}
