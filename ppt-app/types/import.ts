import type { CatalogMeta, Product } from "@/types/catalog";

export type ExcelCellValue = string | number | boolean | string[] | null;

export interface ExcelSheetData {
  name: string;
  rows: ExcelCellValue[][];
  nonEmptyRowCount: number;
}

export interface ExcelWorkbookData {
  fileName: string;
  sourceType?: "excel" | "pdf" | "word" | "ppt";
  sheets: ExcelSheetData[];
  embeddedImageCount?: number;
}

export type ImportTargetField =
  | "no"
  | "sku"
  | "name"
  | "productName"
  | "items"
  | "marketPrice"
  | "salePrice"
  | "delivery"
  | "category"
  | "brand"
  | "image"
  | "region"
  | "priceTier"
  | "packageType"
  | "customerGroup";

export interface FieldMapping {
  targetField: ImportTargetField;
  sourceColumn?: string;
  source?: "rule" | "ai" | "manual";
  confidence?: number;
  reason?: string;
}

export interface ExcelImportConfig {
  fileName: string;
  sourceType?: "excel" | "pdf" | "word" | "ppt";
  sheetName: string;
  headerRow: number;
  fieldMappings: FieldMapping[];
  splitItemsBySlash: boolean;
}

export interface ProductValidation {
  status: "valid" | "warning" | "error";
  messages: string[];
}

export type ProductFilter =
  | "all"
  | "valid"
  | "needs-review"
  | "missing-image"
  | "missing-price"
  | "missing-category"
  | "ai-needs-review";

export interface ProjectStoreSnapshot {
  project: CatalogMeta;
  products: Product[];
  importConfig?: ExcelImportConfig;
  selectedSheet?: string;
  template: "business-red";
}
