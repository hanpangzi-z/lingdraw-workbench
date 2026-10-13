import type { ImportFieldDefinition } from "./fields";
import { autoMapFields } from "./mapping";
import { detectHeaderRow, getSheetHeaders } from "./parser";
import { convertSheetToProducts, renumberProducts } from "./transform";
import type { Product } from "@/types/catalog";
import type { ExcelImportConfig, ExcelSheetData, ExcelWorkbookData } from "@/types/import";

function normalizedTier(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount}元` : undefined;
}

export function inferSheetPriceTier(sheet: ExcelSheetData) {
  const labels = [sheet.name, ...sheet.rows.slice(0, 3).flatMap((row) => row.map((cell) => String(cell ?? "").trim()))].filter(Boolean);
  for (const label of labels) {
    const explicit = label.match(/(\d+(?:\.\d+)?)\s*(?:元)?\s*档(?:位)?/);
    if (explicit) return normalizedTier(explicit[1]);
  }

  const sheetName = sheet.name.trim().match(/^(\d+(?:\.\d+)?)\s*(?:元)?(?:套餐)?$/);
  return sheetName ? normalizedTier(sheetName[1]) : undefined;
}

function configForSheet(
  workbook: ExcelWorkbookData,
  sheet: ExcelSheetData,
  activeConfig: ExcelImportConfig,
  definitions: ImportFieldDefinition[],
) {
  if (sheet.name === activeConfig.sheetName) return activeConfig;
  const headerRow = detectHeaderRow(sheet);
  return {
    fileName: workbook.fileName,
    sourceType: workbook.sourceType ?? "excel",
    sheetName: sheet.name,
    headerRow,
    fieldMappings: autoMapFields(getSheetHeaders(sheet, headerRow), definitions),
    splitItemsBySlash: activeConfig.splitItemsBySlash,
  } satisfies ExcelImportConfig;
}

export function convertWorkbookToProducts(
  workbook: ExcelWorkbookData,
  activeConfig: ExcelImportConfig,
  definitions: ImportFieldDefinition[],
): Product[] {
  const sheets = workbook.sheets.filter((sheet) => sheet.nonEmptyRowCount > 0);
  const multipleSheets = sheets.length > 1;

  return sheets.flatMap((sheet, sheetIndex) => {
    const config = configForSheet(workbook, sheet, activeConfig, definitions);
    const hasPackageName = config.fieldMappings.some((mapping) => mapping.targetField === "name" && mapping.sourceColumn);
    if (!hasPackageName) return [];

    const inferredPriceTier = inferSheetPriceTier(sheet);
    return renumberProducts(convertSheetToProducts(sheet, config)).map((product) => ({
      ...product,
      id: multipleSheets ? `sheet-${sheetIndex + 1}-${product.id}` : product.id,
      priceTier: product.priceTier || inferredPriceTier,
    }));
  });
}
