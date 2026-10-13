import type { ExcelCellValue, ExcelSheetData, ExcelWorkbookData } from "@/types/import";
import { autoMapFields } from "./mapping";
import { extractExcelEmbeddedImages, resolveExcelImageCell } from "./embeddedImages";

const isBlankCell = (value: ExcelCellValue | undefined) =>
  value === null || value === undefined || String(value).trim() === "";

export function isEmptyExcelRow(row: ExcelCellValue[]) {
  return row.every(isBlankCell);
}

export function getFirstDataSheet(workbook: ExcelWorkbookData) {
  return workbook.sheets.find((sheet) => sheet.nonEmptyRowCount > 0)?.name ?? workbook.sheets[0]?.name;
}

export function getSheetHeaders(sheet: ExcelSheetData, headerRow: number) {
  const rawHeaders = sheet.rows[Math.max(0, headerRow - 1)] ?? [];
  const seen = new Map<string, number>();

  return rawHeaders.map((value, index) => {
    const base = String(value ?? "").trim() || `未命名列 ${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

export function detectHeaderRow(sheet: ExcelSheetData) {
  const candidates = sheet.rows.slice(0, 12).map((row, index) => {
    const headers = row.map((value) => String(value ?? "").trim()).filter(Boolean);
    const mappings = autoMapFields(headers);
    const matched = mappings.filter((mapping) => mapping.sourceColumn).length;
    return { row: index + 1, matched, populated: headers.length };
  });
  return candidates.sort((a, b) => b.matched - a.matched || b.populated - a.populated || a.row - b.row)[0]?.row ?? 1;
}

export function getDataRecords(sheet: ExcelSheetData, headerRow: number) {
  const headers = getSheetHeaders(sheet, headerRow);
  return sheet.rows
    .slice(headerRow)
    .filter((row) => !isEmptyExcelRow(row))
    .map((row, rowIndex) => ({
      sourceRow: headerRow + rowIndex + 1,
      values: Object.fromEntries(headers.map((header, columnIndex) => [header, row[columnIndex] ?? ""])),
    }));
}

export async function readExcelFile(file: File): Promise<ExcelWorkbookData> {
  const XLSX = await import("xlsx");
  const input = await file.arrayBuffer();
  const [embeddedImages, workbook] = await Promise.all([
    extractExcelEmbeddedImages(input),
    Promise.resolve(XLSX.read(input, { type: "array", cellDates: false })),
  ]);
  const sheets = workbook.SheetNames.map<ExcelSheetData>((name) => {
    const rows = XLSX.utils.sheet_to_json<ExcelCellValue[]>(workbook.Sheets[name], {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
    }).map((row) => row.map((value) => resolveExcelImageCell(value, embeddedImages) as ExcelCellValue));
    return {
      name,
      rows,
      nonEmptyRowCount: rows.filter((row) => !isEmptyExcelRow(row)).length,
    };
  });

  if (!sheets.length) throw new Error("Excel 中没有可读取的工作表");
  return { fileName: file.name, sourceType: "excel", sheets, embeddedImageCount: embeddedImages.size };
}
