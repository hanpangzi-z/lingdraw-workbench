export type ImportSourceType = "excel" | "pdf" | "word" | "ppt" | "manual";

export interface ImportBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImportedTextElement extends Partial<ImportBoundingBox> {
  id?: string;
  text: string;
}

export type ImportedImageClassification = "possibleProductImage" | "possibleLogo" | "decoration" | "unknown";

export interface ImportedImage {
  id: string;
  sourcePage?: number;
  sourceSlide?: number;
  sourceParagraph?: number;
  fileName?: string;
  url: string;
  width?: number;
  height?: number;
  bbox?: ImportBoundingBox;
  hash?: string;
  occurrenceCount?: number;
  classification: ImportedImageClassification;
}

export interface ImportedTable {
  id: string;
  sourcePage?: number;
  sourceSlide?: number;
  headers: string[];
  rows: Array<Array<string | number | null>>;
  bbox?: ImportBoundingBox;
}

export interface ImportedPage {
  pageNumber: number;
  text: string;
  textElements?: ImportedTextElement[];
  tables?: ImportedTable[];
  images?: ImportedImage[];
  width?: number;
  height?: number;
  previewUrl?: string;
  textDensity?: number;
  requiresOcr?: boolean;
  parseError?: string;
}

export interface RawImportedDocument {
  sourceType: ImportSourceType;
  fileName: string;
  pages?: ImportedPage[];
  tables?: ImportedTable[];
  images?: ImportedImage[];
  rawText?: string;
  metadata?: Record<string, unknown>;
  relatedDocuments?: RawImportedDocument[];
  warnings: string[];
}

export interface ProductSource {
  type: ImportSourceType;
  fileName: string;
  page?: number;
  slide?: number;
  sheet?: string;
  row?: number;
  blockId?: string;
  fields?: string[];
}

export type CandidateField = "sku" | "name" | "items" | "marketPrice" | "salePrice" | "delivery" | "category" | "image";

export interface ProductCandidate {
  id: string;
  sku?: string;
  name?: string;
  items?: string[];
  marketPrice?: number;
  salePrice?: number;
  delivery?: string;
  category?: string;
  images?: string[];
  source: ProductSource;
  sources: ProductSource[];
  confidence: number;
  fieldConfidence: Partial<Record<CandidateField, number>>;
  rawText?: string;
}

export interface ProductConflictAlternative {
  candidateId: string;
  source: ProductSource;
  value: unknown;
}

export interface ProductDataConflict {
  id: string;
  sku: string;
  field: CandidateField;
  alternatives: ProductConflictAlternative[];
  selectedCandidateId?: string;
  resolved: boolean;
}

export interface ImportProgress {
  phase: "idle" | "parsing" | "detecting" | "normalizing" | "matching-images" | "completed" | "failed";
  percent: number;
  message: string;
}

export interface SourceFileRecord {
  id: string;
  name: string;
  type: ImportSourceType | "image" | "archive" | "unknown";
  size: number;
  primary: boolean;
}

export interface ImportSession {
  id: string;
  sourceFiles: SourceFileRecord[];
  status: "parsing" | "extracting" | "review" | "completed" | "failed";
  extractedProductCount: number;
  extractedImageCount: number;
  matchedImageCount: number;
  warnings: string[];
  conflicts: ProductDataConflict[];
  failedUnits: number[];
  startedAt: number;
  completedAt?: number;
}

export interface ProductBlock {
  id: string;
  sourceType: ImportSourceType;
  fileName: string;
  page?: number;
  slide?: number;
  text: string;
  textElements: ImportedTextElement[];
  images: ImportedImage[];
  bbox?: ImportBoundingBox;
}

export interface OCRResult {
  text: string;
  confidence: number;
  textElements?: ImportedTextElement[];
}

export interface OCRProvider {
  id: string;
  recognizePage(image: Blob): Promise<OCRResult>;
}

export interface ImportPipelineOptions {
  supportingFiles?: File[];
  enableOcr?: boolean;
  ocrProvider?: OCRProvider;
  onProgress?: (progress: ImportProgress) => void;
}

export interface ImportPipelineResult {
  document: RawImportedDocument;
  documents: RawImportedDocument[];
  candidates: ProductCandidate[];
  mergedCandidates: ProductCandidate[];
  conflicts: ProductDataConflict[];
  supportingImages: ImportedImage[];
}
