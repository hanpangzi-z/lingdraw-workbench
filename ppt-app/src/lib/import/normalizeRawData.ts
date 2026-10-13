import type { ImportedPage, ImportedTable, RawImportedDocument } from "./types";

function cleanText(value: string) {
  return value.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeTable(table: ImportedTable): ImportedTable {
  const headers = table.headers.map((header, index) => cleanText(String(header || `未命名列${index + 1}`)));
  const rows = table.rows
    .map((row) => headers.map((_, index) => typeof row[index] === "string" ? cleanText(row[index] as string) : row[index] ?? null))
    .filter((row) => row.some((value) => String(value ?? "").trim()));
  return { ...table, headers, rows };
}

function normalizePage(page: ImportedPage): ImportedPage {
  return {
    ...page,
    text: cleanText(page.text),
    textElements: page.textElements?.map((element) => ({ ...element, text: cleanText(element.text) })).filter((element) => element.text),
    tables: page.tables?.map(normalizeTable),
  };
}

export function normalizeRawData(document: RawImportedDocument): RawImportedDocument {
  const pages = document.pages?.map(normalizePage);
  const tables = (document.tables ?? pages?.flatMap((page) => page.tables ?? []) ?? []).map(normalizeTable);
  const images = document.images ?? pages?.flatMap((page) => page.images ?? []) ?? [];
  return {
    ...document,
    pages,
    tables,
    images,
    rawText: cleanText(document.rawText ?? pages?.map((page) => page.text).join("\n\n") ?? ""),
    warnings: [...new Set(document.warnings)],
  };
}
