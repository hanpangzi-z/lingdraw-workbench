import type { CatalogMeta, Product, ProductPrice } from "@/types/catalog";
import type { EditorState } from "@/types/editor";
import type { ManualLayoutOverride, SlidePlan } from "@/src/lib/layout/types";
import type { TemplateId } from "@/src/templates/types";
import type { ThemeId } from "@/src/themes/types";

export type GenerationMode = "single" | "batch";

export type BatchDimensionField = "region" | "priceTier" | "packageType" | "customerGroup";

export interface BatchDimension {
  field: BatchDimensionField;
  enabled: boolean;
}

export type BatchGroupDimensions = Partial<Record<BatchDimensionField, string>>;

export interface BatchProductPatch extends Partial<Omit<Product, "id" | "price">> {
  price?: Partial<ProductPrice>;
}

export interface BatchProjectConfig {
  projectName?: string;
  title?: string;
  subtitle?: string;
  brand?: string;
  logo?: string;
  city?: string;
  year?: number;
  priceTier?: number;
  tierName?: string;
  version?: string;
  templateId?: TemplateId;
  themeId?: ThemeId;
  productDefaults?: BatchProductPatch;
}

export type BatchProjectStatus = "ready" | "warning" | "error" | "generating" | "completed";

export type BatchCheckCode =
  | "missing-image"
  | "missing-price"
  | "missing-name"
  | "text-overflow"
  | "layout-error"
  | "duplicate-sku"
  | "empty-project";

export interface BatchCheckIssue {
  code: BatchCheckCode;
  severity: "warning" | "error";
  message: string;
  productIds?: string[];
}

export interface BatchCheckReport {
  status: Extract<BatchProjectStatus, "ready" | "warning" | "error">;
  issues: BatchCheckIssue[];
  checkedAt: number;
}

export interface BatchEditorSession {
  project: CatalogMeta;
  products: Product[];
  editorState: EditorState;
  layoutOverrides: Record<string, ManualLayoutOverride>;
}

export interface BatchSlidePlanCache {
  dataHash: string;
  plans: SlidePlan[];
}

export interface BatchGroup {
  id: string;
  name: string;
  dimensions: BatchGroupDimensions;
  productIds: string[];
  productCount: number;
  enabled: boolean;
  projectConfig?: BatchProjectConfig;
  status: BatchProjectStatus;
  checkReport?: BatchCheckReport;
  slidePlanCache?: BatchSlidePlanCache;
  editorSession?: BatchEditorSession;
  copiedFromId?: string;
  manual?: boolean;
}

export interface ProductProjectOverride {
  batchGroupId: string;
  productId: string;
  overrides: BatchProductPatch;
}

export interface GlobalBatchConfig {
  dimensions: BatchDimension[];
  filenameRule: string;
  titleRule: string;
  subtitleRule: string;
  version: string;
  exportFormat: "pptx";
  templateId: TemplateId;
  themeId: ThemeId;
  logo?: string;
}

export interface BatchDimensionAnalysis {
  values: Record<BatchDimensionField, string[]>;
  theoreticalCombinations: number;
  detectedDimensions: BatchDimensionField[];
}

export interface ResolvedBatchProject {
  group: BatchGroup;
  project: CatalogMeta;
  products: Product[];
  slidePlans: SlidePlan[];
  dataHash: string;
  fileName: string;
  pageCount: number;
}

export type BatchExportItemStatus = "queued" | "generating" | "completed" | "failed";

export interface BatchExportLog {
  groupId: string;
  projectName: string;
  fileName: string;
  status: BatchExportItemStatus;
  startedAt?: number;
  completedAt?: number;
  pageCount?: number;
  error?: string;
}

export interface BatchExportState {
  running: boolean;
  current: number;
  total: number;
  currentName?: string;
  succeeded: number;
  failed: number;
  zipName?: string;
  logs: BatchExportLog[];
}
