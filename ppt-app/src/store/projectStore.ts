"use client";

import { create } from "zustand";
import { catalogMeta } from "@/data/catalog";
import { productCategories } from "@/data/catalog";
import { mockProducts } from "@/data/mock-products";
import { scanProductsForAI } from "@/src/lib/ai/analyze";
import { processInBatches } from "@/src/lib/ai/batch";
import { requestAIFieldDetection, requestAIProductNormalization } from "@/src/lib/ai/client";
import { applyProductSuggestion, proposalsToMetadata } from "@/src/lib/ai/normalize";
import { autoMapFields } from "@/src/lib/excel/mapping";
import { renumberProducts } from "@/src/lib/excel/transform";
import { detectHeaderRow, getDataRecords, getFirstDataSheet, getSheetHeaders } from "@/src/lib/excel/parser";
import { BATCH_IMPORT_FIELD_DEFINITIONS, IMPORT_FIELD_DEFINITIONS } from "@/src/lib/excel/fields";
import { convertWorkbookToProducts } from "@/src/lib/excel/workbook";
import type { CatalogMeta, Product, ProductCategoryId, ProjectDesign } from "@/types/catalog";
import type { AIProcessingState, AIScanSummary, AIUsageSummary } from "@/types/ai";
import type { ExcelImportConfig, ExcelWorkbookData, FieldMapping } from "@/types/import";
import type { LayoutMode, ManualLayoutOverride, ProductLayoutType } from "@/src/lib/layout/types";
import { applyTemplateToDesign, resetTemplateDesign } from "@/src/templates/registry";
import type { TemplateId } from "@/src/templates/types";
import type { ThemeId, ThemeOverrides } from "@/src/themes/types";
import { emptyEditorState, sectionOverrideKey, type CanvasElementOverride, type EditableSection, type EditorSnapshot, type EditorState, type ManualSlide, type ProductImageOverride, type SlideEditState } from "@/types/editor";
import { detectFileType } from "@/src/lib/import/detectFileType";
import { candidatesToProducts } from "@/src/lib/import/productAdapter";
import { preferLibraryImagesForCandidates, preferLibraryImagesForProducts } from "@/src/lib/import/libraryImages";
import type { ImportProgress, ImportSession, ImportedImage, ProductCandidate, ProductDataConflict, RawImportedDocument } from "@/src/lib/import/types";
import { useBatchStore } from "@/src/store/batchStore";
import { withInferredPriceTier } from "@/src/lib/catalog/project";
import { withDerivedProductComponents } from "@/src/lib/catalog/components";

export type WorkflowStep = "upload" | "mapping" | "confirm" | "batch" | "preview";

interface ProjectStoreState {
  step: WorkflowStep;
  project: CatalogMeta;
  products: Product[];
  workbook?: ExcelWorkbookData;
  importConfig?: ExcelImportConfig;
  selectedProductIds: string[];
  layoutMode: LayoutMode;
  layoutOverrides: Record<string, ManualLayoutOverride>;
  layoutRevision: number;
  aiScan?: AIScanSummary;
  aiProcessing: AIProcessingState;
  aiUsage: AIUsageSummary;
  aiFieldDetection: { status: "idle" | "processing" | "completed" | "failed"; error?: string };
  rawImportedDocument?: RawImportedDocument;
  productCandidates: ProductCandidate[];
  importConflicts: ProductDataConflict[];
  importSession?: ImportSession;
  importProgress: ImportProgress;
  supportingImages: ImportedImage[];
  editorState: EditorState;
  editorPast: EditorSnapshot[];
  editorFuture: EditorSnapshot[];
  initialSnapshot?: EditorSnapshot;
  saveStatus: "saved" | "saving" | "error";
  lastSavedAt?: number;
  setStep: (step: WorkflowStep) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setPageLayoutOverride: (anchorProductId: string, type?: ProductLayoutType) => void;
  regenerateSmartLayout: () => void;
  setTemplate: (templateId: TemplateId) => void;
  setTheme: (themeId: ThemeId) => void;
  updateDesign: (patch: Partial<ProjectDesign>) => void;
  updateThemeOverrides: (patch: Partial<ThemeOverrides>) => void;
  resetDesign: () => void;
  setWorkbook: (workbook: ExcelWorkbookData) => void;
  startDocumentImport: (primaryFile: File, supportingFiles?: File[], enableOcr?: boolean) => Promise<void>;
  startManualImport: () => void;
  resolveImportConflict: (conflictId: string, candidateId: string) => void;
  setSheet: (sheetName: string) => void;
  setHeaderRow: (headerRow: number) => void;
  setFieldMapping: (targetField: FieldMapping["targetField"], sourceColumn?: string) => void;
  detectFieldMappingsWithAI: () => Promise<void>;
  setSplitItemsBySlash: (enabled: boolean) => void;
  convertImport: () => Promise<void>;
  updateProject: (patch: Partial<CatalogMeta>) => void;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  updateProductPrice: (id: string, patch: Partial<Product["price"]>) => void;
  toggleProduct: (id: string) => void;
  selectProducts: (ids: string[]) => void;
  clearSelection: () => void;
  bulkUpdate: (patch: { categoryId?: ProductCategoryId; packagePrice?: number; delivery?: string[] }) => void;
  moveProduct: (id: string, direction: -1 | 1) => void;
  runAIReview: (productIds?: string[]) => Promise<void>;
  retryFailedAI: () => Promise<void>;
  resolveAISuggestion: (productId: string, suggestionId: string, accept: boolean) => void;
  acceptHighConfidenceSuggestions: () => void;
  useMockProducts: () => void;
  resetImport: () => void;
  cancelDocumentImport: () => void;
  initializeEditor: () => void;
  editorUpdateProduct: (id: string, patch: Partial<Product>) => void;
  editorUpdateProductPrice: (id: string, patch: Partial<Product["price"]>) => void;
  editorMoveProduct: (id: string, direction: -1 | 1) => void;
  updateSlideEdit: (slideId: string, patch: Partial<SlideEditState>) => void;
  setCanvasElementOverride: (slideId: string, elementId: string, patch: Partial<CanvasElementOverride>) => void;
  resetCanvasElementOverride: (slideId: string, elementId: string) => void;
  toggleSlideSection: (slideId: string, productId: string, section: EditableSection, visible: boolean) => void;
  setSectionsVisibilityForSlides: (slideIds: string[], sections: EditableSection[], visible: boolean) => void;
  setPriceZonesVisibility: (slideIds: string[], visible: boolean) => void;
  setPriceZoneBackground: (fillColor: string) => void;
  setSlideImageOverride: (slideId: string, productId: string, override?: ProductImageOverride) => void;
  addManualSlide: (type: ManualSlide["type"], data?: ManualSlide["data"], afterSlideId?: string, currentOrder?: string[]) => string;
  updateManualSlide: (slideId: string, patch: Partial<ManualSlide["data"]>) => void;
  hideSlide: (slideId: string) => void;
  restoreAutoSlides: () => void;
  moveSlide: (slideId: string, direction: -1 | 1, currentOrder: string[]) => void;
  setSlideOrder: (order: string[]) => void;
  toggleSlideLock: (slideId: string) => void;
  resetSlideEdit: (slideId: string) => void;
  undoEditor: () => void;
  redoEditor: () => void;
  restoreInitialSnapshot: () => void;
  persistEditor: () => void;
  hydrateEditor: () => void;
  editorSetTemplate: (templateId: TemplateId) => void;
  editorSetTheme: (themeId: ThemeId) => void;
  editorUpdateDesign: (patch: Partial<ProjectDesign>) => void;
  editorUpdateThemeOverrides: (patch: Partial<ThemeOverrides>) => void;
  editorResetDesign: () => void;
  loadEditorSnapshot: (snapshot: EditorSnapshot, step?: WorkflowStep) => void;
  getEditorSnapshot: () => EditorSnapshot;
}

const idleAIProcessing: AIProcessingState = {
  status: "idle",
  total: 0,
  processed: 0,
  failed: 0,
  currentBatch: 0,
  batchCount: 0,
  failedProductIds: [],
};

const emptyAIUsage: AIUsageSummary = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimated: false,
};

const EDITOR_STORAGE_KEY = "folio.editor.v1";

function snapshotFromState(state: Pick<ProjectStoreState, "project" | "products" | "layoutOverrides" | "editorState">): EditorSnapshot {
  return {
    project: state.project,
    products: state.products,
    layoutOverrides: state.layoutOverrides,
    editorState: state.editorState,
  };
}

function sanitizeSnapshotForStorage(snapshot: EditorSnapshot): EditorSnapshot {
  const keepSource = (source?: string) => source && !source.startsWith("blob:") && !source.startsWith("data:") ? source : undefined;
  return {
    ...snapshot,
    products: snapshot.products.map((product) => ({
      ...product,
      image: keepSource(product.image),
      images: product.images?.map(keepSource).filter((value): value is string => Boolean(value)),
    })),
    editorState: {
      ...snapshot.editorState,
      slides: Object.fromEntries(Object.entries(snapshot.editorState.slides).map(([id, edit]) => [id, {
        ...edit,
        imageOverrides: edit.imageOverrides ? Object.fromEntries(Object.entries(edit.imageOverrides).map(([productId, override]) => [productId, {
          ...override,
          source: keepSource(override.source),
        }])) : undefined,
        elementOverrides: edit.elementOverrides ? Object.fromEntries(Object.entries(edit.elementOverrides).map(([elementId, override]) => [elementId, {
          ...override,
          image: override.image ? { ...override.image, source: keepSource(override.image.source) } : undefined,
        }])) : undefined,
      }])),
    },
  };
}

function buildImportConfig(workbook: ExcelWorkbookData, sheetName: string): ExcelImportConfig {
  const sheet = workbook.sheets.find((item) => item.name === sheetName) ?? workbook.sheets[0];
  const headerRow = detectHeaderRow(sheet);
  const definitions = useBatchStore.getState().generationMode === "batch" ? BATCH_IMPORT_FIELD_DEFINITIONS : IMPORT_FIELD_DEFINITIONS;
  return {
    fileName: workbook.fileName,
    sourceType: workbook.sourceType ?? "excel",
    sheetName: sheet.name,
    headerRow,
    fieldMappings: autoMapFields(getSheetHeaders(sheet, headerRow), definitions),
    splitItemsBySlash: false,
  };
}

export const useProjectStore = create<ProjectStoreState>((set, get) => {
  let importRun = 0;
  const commitEditor = (mutate: (snapshot: EditorSnapshot) => EditorSnapshot) => set((state) => {
    const current = snapshotFromState(state);
    const next = mutate(current);
    return {
      ...next,
      editorPast: [...state.editorPast, current].slice(-50),
      editorFuture: [],
      saveStatus: "saving" as const,
    };
  });

  return ({
  step: "upload",
  project: catalogMeta,
  products: [],
  workbook: undefined,
  importConfig: undefined,
  selectedProductIds: [],
  layoutMode: "smart",
  layoutOverrides: {},
  layoutRevision: 0,
  aiScan: undefined,
  aiProcessing: idleAIProcessing,
  aiUsage: emptyAIUsage,
  aiFieldDetection: { status: "idle" },
  rawImportedDocument: undefined,
  productCandidates: [],
  importConflicts: [],
  importSession: undefined,
  importProgress: { phase: "idle", percent: 0, message: "等待导入" },
  supportingImages: [],
  editorState: emptyEditorState(),
  editorPast: [],
  editorFuture: [],
  initialSnapshot: undefined,
  saveStatus: "saved",
  setStep: (step) => set({ step }),
  setLayoutMode: (layoutMode) => set({ layoutMode }),
  setPageLayoutOverride: (anchorProductId, type) => {
    commitEditor((current) => {
      const layoutOverrides = { ...current.layoutOverrides };
      if (type) layoutOverrides[anchorProductId] = { anchorProductId, type };
      else delete layoutOverrides[anchorProductId];
      return { ...current, layoutOverrides };
    });
    set((state) => ({ layoutRevision: state.layoutRevision + 1 }));
  },
  regenerateSmartLayout: () => set((state) => ({ layoutRevision: state.layoutRevision + 1 })),
  setTemplate: (templateId) => set((state) => ({
    project: { ...state.project, design: applyTemplateToDesign(state.project.design, templateId) },
  })),
  setTheme: (themeId) => set((state) => ({
    project: { ...state.project, design: { ...state.project.design, themeId } },
  })),
  updateDesign: (patch) => set((state) => ({
    project: { ...state.project, design: { ...state.project.design, ...patch } },
  })),
  updateThemeOverrides: (patch) => set((state) => ({
    project: {
      ...state.project,
      design: { ...state.project.design, themeOverrides: { ...state.project.design.themeOverrides, ...patch } },
    },
  })),
  resetDesign: () => set((state) => ({
    project: {
      ...state.project,
      design: resetTemplateDesign(state.project.design, state.project.design.templateId),
    },
  })),
  setWorkbook: (workbook) => {
    const sheetName = getFirstDataSheet(workbook);
    if (!sheetName) throw new Error("Excel 中没有可导入的工作表");
    set({ workbook, importConfig: buildImportConfig(workbook, sheetName), products: [], selectedProductIds: [], layoutOverrides: {}, layoutRevision: 0, aiScan: undefined, aiProcessing: idleAIProcessing, aiFieldDetection: { status: "idle" } });
  },
  startDocumentImport: async (primaryFile, supportingFiles = [], enableOcr = false) => {
    const run = ++importRun;
    const isCurrent = () => run === importRun;
    const sourceType = detectFileType(primaryFile.name);
    const sessionId = `import-${Date.now()}`;
    const sourceFiles = [primaryFile, ...supportingFiles].map((file, index) => ({
      id: `${sessionId}-file-${index + 1}`,
      name: file.name,
      type: index === 0 ? sourceType : detectFileType(file.name),
      size: file.size,
      primary: index === 0,
    }));
    set({
      importProgress: { phase: "parsing", percent: 2, message: "正在解析文件" },
      importSession: { id: sessionId, sourceFiles, status: "parsing", extractedProductCount: 0, extractedImageCount: 0, matchedImageCount: 0, warnings: [], conflicts: [], failedUnits: [], startedAt: Date.now() },
      rawImportedDocument: undefined,
      productCandidates: [],
      importConflicts: [],
      supportingImages: [],
    });
    try {
      const hasSupportingDocuments = supportingFiles.some((file) => ["excel", "pdf", "word", "ppt"].includes(detectFileType(file.name)));
      if (sourceType === "excel" && !hasSupportingDocuments) {
        const { parseExcelDocument } = await import("@/src/lib/import/excel/parser");
        const { document, workbook } = await parseExcelDocument(primaryFile);
        if (!isCurrent()) return;
        const sheetName = getFirstDataSheet(workbook);
        if (!sheetName) throw new Error("Excel 中没有可导入的工作表");
        const importConfig = buildImportConfig(workbook, sheetName);
        const definitions = useBatchStore.getState().generationMode === "batch" ? BATCH_IMPORT_FIELD_DEFINITIONS : IMPORT_FIELD_DEFINITIONS;
        const extractedProductCount = convertWorkbookToProducts(workbook, importConfig, definitions).length;
        set({
          workbook,
          importConfig,
          rawImportedDocument: document,
          importProgress: { phase: "completed", percent: 100, message: "Excel 解析完成，请确认字段匹配" },
          importSession: { ...get().importSession!, status: "review", extractedProductCount, extractedImageCount: workbook.embeddedImageCount ?? 0, warnings: document.warnings, completedAt: Date.now() },
        });
        return;
      }
      const { runImportPipeline } = await import("@/src/lib/import/importPipeline");
      const result = await runImportPipeline(primaryFile, {
        supportingFiles,
        enableOcr,
        onProgress: (importProgress) => { if (isCurrent()) set({ importProgress, importSession: get().importSession ? { ...get().importSession!, status: importProgress.phase === "parsing" ? "parsing" : "extracting" } : undefined }); },
      });
      if (!isCurrent()) return;
      if (!result.mergedCandidates.length) {
        const scanned = result.document.pages?.some((page) => page.requiresOcr);
        throw new Error(scanned ? "未识别到商品；文档可能是扫描版，请配置 OCR 或上传可检索文字版本。" : "未从文档中识别到商品候选，请检查文档内容。");
      }
      const libraryImages = await preferLibraryImagesForCandidates(result.mergedCandidates);
      if (!isCurrent()) return;
      const mergedCandidates = libraryImages.candidates;
      const products = candidatesToProducts(mergedCandidates);
      const tableWorkbook: ExcelWorkbookData | undefined = result.document.sourceType === "word" && !result.document.relatedDocuments?.length && result.document.tables?.length ? {
        fileName: result.document.fileName,
        sourceType: "word",
        sheets: result.document.tables.map((table, index) => ({
          name: `Word表格${index + 1}`,
          rows: [table.headers, ...table.rows],
          nonEmptyRowCount: table.rows.length + 1,
        })),
      } : undefined;
      const tableSheetName = tableWorkbook ? getFirstDataSheet(tableWorkbook) : undefined;
      const failedUnits = (result.document.metadata?.failedPages as number[] | undefined) ?? [];
      const extractedImages = result.documents.reduce((sum, document) => sum + (document.images?.length ?? 0), 0) + result.supportingImages.length;
      const matchedImages = mergedCandidates.filter((candidate) => candidate.images?.length).length;
      set({
        products,
        workbook: tableWorkbook,
        importConfig: tableWorkbook && tableSheetName ? buildImportConfig(tableWorkbook, tableSheetName) : undefined,
        rawImportedDocument: result.document,
        productCandidates: mergedCandidates,
        importConflicts: result.conflicts,
        supportingImages: result.supportingImages,
        selectedProductIds: [],
        layoutOverrides: {},
        layoutRevision: 0,
        aiScan: undefined,
        aiProcessing: idleAIProcessing,
        editorState: emptyEditorState(),
        editorPast: [],
        editorFuture: [],
        initialSnapshot: undefined,
        importProgress: { phase: "completed", percent: 100, message: `解析完成，识别 ${products.length} 个商品` },
        importSession: {
          ...get().importSession!, status: "review", extractedProductCount: products.length,
          extractedImageCount: extractedImages, matchedImageCount: matchedImages,
          warnings: result.document.warnings, conflicts: result.conflicts, failedUnits, completedAt: Date.now(),
        },
      });
    } catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : "文件导入失败";
      console.error("[Import Pipeline] 导入失败", error);
      set({ importProgress: { phase: "failed", percent: 0, message }, importSession: get().importSession ? { ...get().importSession!, status: "failed", warnings: [...get().importSession!.warnings, message], completedAt: Date.now() } : undefined });
    }
  },
  startManualImport: () => {
    const source = { type: "manual" as const, fileName: "手动创建" };
    const candidate: ProductCandidate = { id: "manual-1", sku: "", name: "", items: [], source, sources: [source], confidence: 1, fieldConfidence: { name: 1 } };
    set({
      products: candidatesToProducts([candidate]), productCandidates: [candidate], importConflicts: [], rawImportedDocument: { sourceType: "manual", fileName: "手动创建", warnings: [] },
      importSession: { id: `manual-${Date.now()}`, sourceFiles: [], status: "review", extractedProductCount: 1, extractedImageCount: 0, matchedImageCount: 0, warnings: [], conflicts: [], failedUnits: [], startedAt: Date.now(), completedAt: Date.now() },
      importProgress: { phase: "completed", percent: 100, message: "已创建空白商品" }, step: "confirm",
    });
  },
  resolveImportConflict: (conflictId, candidateId) => set((state) => {
    const conflict = state.importConflicts.find((item) => item.id === conflictId);
    const alternative = conflict?.alternatives.find((item) => item.candidateId === candidateId);
    if (!conflict || !alternative) return state;
    const productCandidates = state.productCandidates.map((candidate) => candidate.sku === conflict.sku ? { ...candidate, [conflict.field]: alternative.value } : candidate);
    const importConflicts = state.importConflicts.map((item) => item.id === conflictId ? { ...item, resolved: true, selectedCandidateId: candidateId } : item);
    const regenerated = candidatesToProducts(productCandidates).find((product) => product.sku === conflict.sku);
    const products = state.products.map((product) => {
      if (product.sku !== conflict.sku || !regenerated) return product;
      if (conflict.field === "name") return { ...product, name: regenerated.name };
      if (conflict.field === "items") return { ...product, details: regenerated.details };
      if (conflict.field === "marketPrice") return { ...product, price: { ...product.price, market: regenerated.price.market } };
      if (conflict.field === "salePrice") return { ...product, price: { ...product.price, package: regenerated.price.package } };
      if (conflict.field === "delivery") return { ...product, deliveryRaw: regenerated.deliveryRaw, deliveryRegions: regenerated.deliveryRegions };
      if (conflict.field === "category") return { ...product, categoryId: regenerated.categoryId };
      if (conflict.field === "image") return { ...product, image: regenerated.image, images: regenerated.images };
      return product;
    });
    return { productCandidates, products, importConflicts, importSession: state.importSession ? { ...state.importSession, conflicts: importConflicts } : undefined };
  }),
  setSheet: (sheetName) => {
    const workbook = get().workbook;
    if (!workbook) return;
    set({ importConfig: buildImportConfig(workbook, sheetName), products: [], selectedProductIds: [], layoutOverrides: {}, layoutRevision: 0, aiScan: undefined, aiProcessing: idleAIProcessing, aiFieldDetection: { status: "idle" } });
  },
  setHeaderRow: (headerRow) => {
    const { workbook, importConfig } = get();
    const sheet = workbook?.sheets.find((item) => item.name === importConfig?.sheetName);
    if (!sheet || !importConfig) return;
    const definitions = useBatchStore.getState().generationMode === "batch" ? BATCH_IMPORT_FIELD_DEFINITIONS : IMPORT_FIELD_DEFINITIONS;
    set({
      importConfig: {
        ...importConfig,
        headerRow,
        fieldMappings: autoMapFields(getSheetHeaders(sheet, headerRow), definitions),
      },
      products: [],
      selectedProductIds: [],
      layoutOverrides: {},
      layoutRevision: 0,
      aiScan: undefined,
      aiProcessing: idleAIProcessing,
      aiFieldDetection: { status: "idle" },
    });
  },
  setFieldMapping: (targetField, sourceColumn) => set((state) => ({
    importConfig: state.importConfig ? {
      ...state.importConfig,
      fieldMappings: state.importConfig.fieldMappings.map((mapping) =>
        mapping.targetField === targetField ? {
          ...mapping,
          sourceColumn,
          source: sourceColumn ? "manual" : undefined,
          confidence: sourceColumn ? 1 : undefined,
          reason: sourceColumn ? "用户手动选择" : undefined,
        } : mapping,
      ),
    } : undefined,
  })),
  detectFieldMappingsWithAI: async () => {
    const run = importRun;
    const { workbook, importConfig } = get();
    const sheet = workbook?.sheets.find((item) => item.name === importConfig?.sheetName);
    if (!sheet || !importConfig) return;
    const definitions = useBatchStore.getState().generationMode === "batch" ? BATCH_IMPORT_FIELD_DEFINITIONS : IMPORT_FIELD_DEFINITIONS;
    const unmatchedTargets = definitions.filter((field) =>
      !importConfig.fieldMappings.some((mapping) => mapping.targetField === field.key && mapping.sourceColumn));
    if (!unmatchedTargets.length) {
      set({ aiFieldDetection: { status: "completed" } });
      return;
    }
    set({ aiFieldDetection: { status: "processing" } });
    try {
      const records = getDataRecords(sheet, importConfig.headerRow).slice(0, 5).map((record) => record.values);
      const claimedHeaders = new Set(importConfig.fieldMappings.flatMap((mapping) => mapping.sourceColumn ? [mapping.sourceColumn] : []));
      const availableHeaders = getSheetHeaders(sheet, importConfig.headerRow).filter((header) => !claimedHeaders.has(header));
      const response = await requestAIFieldDetection({
        headers: availableHeaders,
        unmatchedTargets: unmatchedTargets.map(({ key, label, description }) => ({ key, label, description })),
        sampleRows: records,
      });
      if (run !== importRun) return;
      const headers = new Set(availableHeaders);
      set((state) => ({
        importConfig: state.importConfig ? {
          ...state.importConfig,
          fieldMappings: state.importConfig.fieldMappings.map((mapping) => {
            if (mapping.sourceColumn) return mapping;
            const proposal = response.data.mappings.find((item) => item.targetField === mapping.targetField);
            if (!proposal?.sourceColumn || proposal.confidence < 0.7 || !headers.has(proposal.sourceColumn)) return mapping;
            return {
              ...mapping,
              sourceColumn: proposal.sourceColumn,
              source: "ai" as const,
              confidence: proposal.confidence,
              reason: proposal.reason,
            };
          }),
        } : undefined,
        aiFieldDetection: { status: "completed" },
        aiUsage: response.usage ? {
          requests: state.aiUsage.requests + 1,
          inputTokens: state.aiUsage.inputTokens + response.usage.inputTokens,
          outputTokens: state.aiUsage.outputTokens + response.usage.outputTokens,
          totalTokens: state.aiUsage.totalTokens + response.usage.totalTokens,
          estimated: state.aiUsage.estimated || Boolean(response.usage.estimated),
        } : state.aiUsage,
      }));
    } catch (error) {
      if (run !== importRun) return;
      console.error("AI field mapping failed", error);
      set({ aiFieldDetection: { status: "failed", error: error instanceof Error ? error.message : "AI 字段识别失败" } });
    }
  },
  setSplitItemsBySlash: (splitItemsBySlash) => set((state) => ({
    importConfig: state.importConfig ? { ...state.importConfig, splitItemsBySlash } : undefined,
  })),
  convertImport: async () => {
    const run = importRun;
    const { workbook, importConfig } = get();
    if (!workbook || !importConfig) return;
    const definitions = useBatchStore.getState().generationMode === "batch" ? BATCH_IMPORT_FIELD_DEFINITIONS : IMPORT_FIELD_DEFINITIONS;
    const converted = convertWorkbookToProducts(workbook, importConfig, definitions);
    const libraryImages = await preferLibraryImagesForProducts(converted);
    if (run !== importRun) return;
    const products = libraryImages.products;
    set((state) => ({ project: withInferredPriceTier(state.project, products), products, selectedProductIds: [], layoutOverrides: {}, layoutRevision: 0, step: "confirm", aiScan: undefined, aiProcessing: idleAIProcessing, importSession: state.importSession ? { ...state.importSession, extractedProductCount: products.length, matchedImageCount: Math.max(state.importSession.matchedImageCount, libraryImages.matched) } : undefined }));
  },
  updateProject: (patch) => set((state) => ({ project: { ...state.project, ...patch } })),
  updateProduct: (id, patch) => set((state) => ({
    products: state.products.map((product) => product.id === id ? { ...product, ...patch } : product),
  })),
  updateProductPrice: (id, patch) => set((state) => ({
    products: state.products.map((product) => product.id === id
      ? { ...product, price: { ...product.price, ...patch } }
      : product),
  })),
  toggleProduct: (id) => set((state) => ({
    selectedProductIds: state.selectedProductIds.includes(id)
      ? state.selectedProductIds.filter((item) => item !== id)
      : [...state.selectedProductIds, id],
  })),
  selectProducts: (selectedProductIds) => set({ selectedProductIds }),
  clearSelection: () => set({ selectedProductIds: [] }),
  bulkUpdate: (patch) => set((state) => ({
    products: state.products.map((product) => {
      if (!state.selectedProductIds.includes(product.id)) return product;
      return {
        ...product,
        categoryId: patch.categoryId ?? product.categoryId,
        deliveryRegions: patch.delivery ?? product.deliveryRegions,
        price: patch.packagePrice === undefined ? product.price : { ...product.price, package: patch.packagePrice },
      };
    }),
  })),
  moveProduct: (id, direction) => set((state) => {
    const index = state.products.findIndex((product) => product.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= state.products.length) return state;
    const products = [...state.products];
    [products[index], products[nextIndex]] = [products[nextIndex], products[index]];
    return { products: renumberProducts(products) };
  }),
  runAIReview: async (productIds) => {
    const run = importRun;
    const snapshot = get().products;
    const scan = scanProductsForAI(snapshot);
    const targetIds = productIds?.length ? productIds : scan.problemProductIds;
    const targets = snapshot.filter((product) => targetIds.includes(product.id));
    set((state) => ({
      aiScan: scan,
      aiProcessing: {
        status: targets.length ? "processing" : "completed",
        total: targets.length,
        processed: 0,
        failed: 0,
        currentBatch: 0,
        batchCount: Math.ceil(targets.length / 12),
        failedProductIds: [],
        message: targets.length ? "正在分批分析问题商品…" : "规则扫描未发现需要 AI 处理的问题",
      },
      products: state.products.map((product) => targetIds.includes(product.id)
        ? { ...product, aiMetadata: { ...product.aiMetadata, status: "processing", suggestions: product.aiMetadata?.suggestions ?? [], issues: product.aiMetadata?.issues ?? [] } }
        : product),
    }));
    if (!targets.length) return;

    const result = await processInBatches<Product, { proposal: Awaited<ReturnType<typeof requestAIProductNormalization>>["data"]["products"][number]; provider: "openai" | "mock" }>({
      items: targets,
      processBatch: async (batch, { requestId }) => {
        if (run !== importRun) return [];
        const response = await requestAIProductNormalization({
          products: batch.map((product) => ({
            id: product.id,
            sku: product.sku,
            name: product.name,
            details: product.details,
            price: product.price,
            deliveryRegions: product.deliveryRegions,
            deliveryRaw: product.deliveryRaw,
            categoryId: product.categoryId,
          })),
          categoryCandidates: productCategories.map(({ id, name }) => ({ id, name })),
          requestId,
        });
        if (run !== importRun) return [];
        const returnedIds = new Set(response.data.products.map((item) => item.productId));
        if (batch.some((product) => !returnedIds.has(product.id))) throw new Error("AI 返回结果缺少部分商品");
        set((state) => ({ aiUsage: response.usage ? {
          requests: state.aiUsage.requests + 1,
          inputTokens: state.aiUsage.inputTokens + response.usage.inputTokens,
          outputTokens: state.aiUsage.outputTokens + response.usage.outputTokens,
          totalTokens: state.aiUsage.totalTokens + response.usage.totalTokens,
          estimated: state.aiUsage.estimated || Boolean(response.usage.estimated),
        } : state.aiUsage }));
        console.info("AI batch completed", { provider: response.provider, count: batch.length, usage: response.usage });
        return response.data.products.map((proposal) => ({ proposal, provider: response.provider }));
      },
      onBatchSuccess: (_batch, outputs) => { if (run !== importRun) return; set((state) => ({
        products: state.products.map((product) => {
          const output = outputs.find((item) => item.proposal.productId === product.id);
          return output ? {
            ...product,
            aiMetadata: proposalsToMetadata(
              product,
              output.proposal,
              output.provider,
              scan.issues.filter((item) => item.productId === product.id),
            ),
          } : product;
        }),
      })); },
      onProgress: (progress) => { if (run !== importRun) return; set((state) => ({ aiProcessing: {
        ...state.aiProcessing,
        ...progress,
        status: "processing",
        message: `已处理 ${progress.processed + progress.failed} / ${targets.length} 个商品`,
      } })); },
    });

    if (run !== importRun) return;
    set((state) => ({
      products: state.products.map((product) => result.failedIds.includes(product.id) ? {
        ...product,
        aiMetadata: {
          status: "failed",
          suggestions: product.aiMetadata?.suggestions ?? [],
          issues: product.aiMetadata?.issues ?? scan.issues.filter((item) => item.productId === product.id),
          error: "该批次在重试 2 次后仍失败",
        },
      } : product),
      aiProcessing: {
        ...state.aiProcessing,
        status: result.failedIds.length ? "partial" : "completed",
        processed: targets.length - result.failedIds.length,
        failed: result.failedIds.length,
        failedProductIds: result.failedIds,
        message: result.failedIds.length
          ? `已完成 ${targets.length - result.failedIds.length} 个，${result.failedIds.length} 个失败，可单独重试`
          : `AI 检查完成，共处理 ${targets.length} 个问题商品`,
      },
    }));
  },
  retryFailedAI: async () => {
    const failedProductIds = get().aiProcessing.failedProductIds;
    if (failedProductIds.length) await get().runAIReview(failedProductIds);
  },
  resolveAISuggestion: (productId, suggestionId, accept) => set((state) => ({
    products: state.products.map((product) => product.id === productId
      ? applyProductSuggestion(product, suggestionId, accept)
      : product),
  })),
  acceptHighConfidenceSuggestions: () => set((state) => ({
    products: state.products.map((product) => {
      const ids = product.aiMetadata?.suggestions
        .filter((suggestion) => suggestion.status === "pending" && suggestion.canApply && suggestion.confidence >= 0.85)
        .map((suggestion) => suggestion.id) ?? [];
      return ids.reduce((current, id) => applyProductSuggestion(current, id, true), product);
    }),
  })),
  useMockProducts: () => set({ products: mockProducts, project: catalogMeta, selectedProductIds: [], layoutMode: "smart", layoutOverrides: {}, layoutRevision: 0, step: "preview", aiScan: undefined, aiProcessing: idleAIProcessing, editorState: emptyEditorState(), editorPast: [], editorFuture: [], initialSnapshot: undefined, rawImportedDocument: undefined, productCandidates: [], importConflicts: [], importSession: undefined, importProgress: { phase: "idle", percent: 0, message: "等待导入" }, supportingImages: [] }),
  cancelDocumentImport: () => { importRun += 1; },
  resetImport: () => { importRun += 1; set({ step: "upload", workbook: undefined, importConfig: undefined, products: [], selectedProductIds: [], layoutMode: "smart", layoutOverrides: {}, layoutRevision: 0, aiScan: undefined, aiProcessing: idleAIProcessing, aiUsage: emptyAIUsage, aiFieldDetection: { status: "idle" }, editorState: emptyEditorState(), editorPast: [], editorFuture: [], initialSnapshot: undefined, saveStatus: "saved", rawImportedDocument: undefined, productCandidates: [], importConflicts: [], importSession: undefined, importProgress: { phase: "idle", percent: 0, message: "等待导入" }, supportingImages: [] }); },
  initializeEditor: () => set((state) => state.initialSnapshot ? state : {
    initialSnapshot: snapshotFromState(state),
    editorPast: [],
    editorFuture: [],
    saveStatus: "saved",
  }),
  editorUpdateProduct: (id, patch) => commitEditor((current) => ({
    ...current,
    products: current.products.map((product) => product.id === id ? { ...product, ...patch } : product),
  })),
  editorUpdateProductPrice: (id, patch) => commitEditor((current) => ({
    ...current,
    products: current.products.map((product) => product.id === id ? { ...product, price: { ...product.price, ...patch } } : product),
  })),
  editorMoveProduct: (id, direction) => commitEditor((current) => {
    const index = current.products.findIndex((product) => product.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.products.length) return current;
    const products = [...current.products];
    [products[index], products[nextIndex]] = [products[nextIndex], products[index]];
    return { ...current, products: renumberProducts(products) };
  }),
  updateSlideEdit: (slideId, patch) => commitEditor((current) => ({
    ...current,
    editorState: {
      ...current.editorState,
      slides: {
        ...current.editorState.slides,
        [slideId]: { ...current.editorState.slides[slideId], slideId, ...patch },
      },
    },
  })),
  setCanvasElementOverride: (slideId, elementId, patch) => commitEditor((current) => {
    const existingSlide = current.editorState.slides[slideId] ?? { slideId };
    const existingElement = existingSlide.elementOverrides?.[elementId] ?? {
      id: elementId,
      type: patch.type ?? "group",
    };
    return {
      ...current,
      editorState: {
        ...current.editorState,
        slides: {
          ...current.editorState.slides,
          [slideId]: {
            ...existingSlide,
            elementOverrides: {
              ...existingSlide.elementOverrides,
              [elementId]: { ...existingElement, ...patch, id: elementId },
            },
          },
        },
      },
    };
  }),
  resetCanvasElementOverride: (slideId, elementId) => commitEditor((current) => {
    const existingSlide = current.editorState.slides[slideId];
    if (!existingSlide?.elementOverrides?.[elementId]) return current;
    const elementOverrides = { ...existingSlide.elementOverrides };
    delete elementOverrides[elementId];
    return {
      ...current,
      editorState: {
        ...current.editorState,
        slides: {
          ...current.editorState.slides,
          [slideId]: { ...existingSlide, elementOverrides },
        },
      },
    };
  }),
  toggleSlideSection: (slideId, productId, section, visible) => commitEditor((current) => {
    const existing = current.editorState.slides[slideId] ?? { slideId };
    const key = sectionOverrideKey(productId, section);
    const hidden = new Set(existing.hiddenSections ?? []);
    if (visible) hidden.delete(key);
    else hidden.add(key);
    return {
      ...current,
      editorState: {
        ...current.editorState,
        slides: { ...current.editorState.slides, [slideId]: { ...existing, hiddenSections: [...hidden] } },
      },
    };
  }),
  setSectionsVisibilityForSlides: (slideIds, sections, visible) => {
    const uniqueSlideIds = [...new Set(slideIds.filter(Boolean))];
    const uniqueSections = [...new Set(sections)];
    if (!uniqueSlideIds.length || !uniqueSections.length) return;
    commitEditor((current) => {
      const slides = { ...current.editorState.slides };
      for (const slideId of uniqueSlideIds) {
        const existing = slides[slideId] ?? { slideId };
        const hidden = new Set(existing.hiddenSections ?? []);
        for (const section of uniqueSections) {
          if (visible) hidden.delete(section);
          else hidden.add(section);
        }
        slides[slideId] = { ...existing, hiddenSections: [...hidden] };
      }
      return {
        ...current,
        editorState: { ...current.editorState, slides },
      };
    });
  },
  setPriceZonesVisibility: (slideIds, visible) => {
    const uniqueSlideIds = [...new Set(slideIds.filter(Boolean))];
    if (!uniqueSlideIds.length) return;
    commitEditor((current) => {
      const slides = { ...current.editorState.slides };
      for (const slideId of uniqueSlideIds) {
        const existing = slides[slideId] ?? { slideId };
        const hidden = new Set(existing.hiddenSections ?? []);
        if (visible) {
          for (const section of [...hidden]) {
            if (
              section === "marketPrice" ||
              section === "salePrice" ||
              /\.(?:marketPrice|salePrice)$/.test(section)
            ) {
              hidden.delete(section);
            }
          }
        } else {
          hidden.add("marketPrice");
          hidden.add("salePrice");
        }

        let elementOverrides = existing.elementOverrides;
        if (visible && elementOverrides) {
          for (const [elementId, override] of Object.entries(elementOverrides)) {
            if (!/^product\..+\.prices$/.test(elementId) || !override.hidden) continue;
            elementOverrides = { ...elementOverrides };
            const { hidden: _hidden, ...restoredOverride } = override;
            elementOverrides[elementId] = restoredOverride;
          }
        }

        slides[slideId] = {
          ...existing,
          hiddenSections: [...hidden],
          ...(elementOverrides ? { elementOverrides } : {}),
        };
      }
      return {
        ...current,
        editorState: { ...current.editorState, slides },
      };
    });
  },
  setPriceZoneBackground: (fillColor) => commitEditor((current) => {
    const slides = Object.fromEntries(
      Object.entries(current.editorState.slides).map(([slideId, slideEdit]) => {
        if (!slideEdit.elementOverrides) return [slideId, slideEdit];

        let changed = false;
        const elementOverrides = Object.fromEntries(
          Object.entries(slideEdit.elementOverrides).map(([elementId, override]) => {
            if (!/^product\..+\.prices$/.test(elementId) || !override.style?.fillColor) {
              return [elementId, override];
            }

            changed = true;
            const { fillColor: _fillColor, ...remainingStyle } = override.style;
            const { style: _style, ...remainingOverride } = override;
            return [
              elementId,
              Object.keys(remainingStyle).length
                ? { ...remainingOverride, style: remainingStyle }
                : remainingOverride,
            ];
          }),
        );

        return [slideId, changed ? { ...slideEdit, elementOverrides } : slideEdit];
      }),
    );

    return {
      ...current,
      project: {
        ...current.project,
        design: {
          ...current.project.design,
          themeOverrides: {
            ...current.project.design.themeOverrides,
            priceBackground: fillColor,
          },
        },
      },
      editorState: { ...current.editorState, slides },
    };
  }),
  setSlideImageOverride: (slideId, productId, override) => commitEditor((current) => {
    const existing = current.editorState.slides[slideId] ?? { slideId };
    const imageOverrides = { ...existing.imageOverrides };
    if (override) imageOverrides[productId] = override;
    else delete imageOverrides[productId];
    return {
      ...current,
      editorState: {
        ...current.editorState,
        slides: { ...current.editorState.slides, [slideId]: { ...existing, imageOverrides } },
      },
    };
  }),
  addManualSlide: (type, data = {}, afterSlideId, currentOrder = []) => {
    const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    commitEditor((current) => {
      const manual: ManualSlide = { id, type, data, createdAt: Date.now() };
      const baseOrder = currentOrder.length ? currentOrder : current.editorState.slideOrder;
      const order = [...baseOrder];
      const afterIndex = afterSlideId ? order.indexOf(afterSlideId) : -1;
      if (afterIndex >= 0) order.splice(afterIndex + 1, 0, id);
      else order.push(id);
      return {
        ...current,
        editorState: {
          ...current.editorState,
          manualSlides: { ...current.editorState.manualSlides, [id]: manual },
          slideOrder: order,
        },
      };
    });
    return id;
  },
  updateManualSlide: (slideId, patch) => commitEditor((current) => {
    const manual = current.editorState.manualSlides[slideId];
    if (!manual) return current;
    return {
      ...current,
      editorState: {
        ...current.editorState,
        manualSlides: { ...current.editorState.manualSlides, [slideId]: { ...manual, data: { ...manual.data, ...patch } } },
      },
    };
  }),
  hideSlide: (slideId) => commitEditor((current) => ({
    ...current,
    editorState: {
      ...current.editorState,
      hiddenSlideIds: [...new Set([...current.editorState.hiddenSlideIds, slideId])],
    },
  })),
  restoreAutoSlides: () => commitEditor((current) => ({
    ...current,
    editorState: { ...current.editorState, hiddenSlideIds: [] },
  })),
  moveSlide: (slideId, direction, currentOrder) => commitEditor((current) => {
    const order = [...currentOrder];
    const index = order.indexOf(slideId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return current;
    [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
    return { ...current, editorState: { ...current.editorState, slideOrder: order } };
  }),
  setSlideOrder: (slideOrder) => commitEditor((current) => ({
    ...current,
    editorState: { ...current.editorState, slideOrder },
  })),
  toggleSlideLock: (slideId) => commitEditor((current) => {
    const locked = new Set(current.editorState.lockedSlideIds);
    if (locked.has(slideId)) locked.delete(slideId);
    else locked.add(slideId);
    return { ...current, editorState: { ...current.editorState, lockedSlideIds: [...locked] } };
  }),
  resetSlideEdit: (slideId) => commitEditor((current) => {
    const slides = { ...current.editorState.slides };
    delete slides[slideId];
    const anchor = slideId.startsWith("products-") ? slideId.slice("products-".length) : undefined;
    const layoutOverrides = { ...current.layoutOverrides };
    if (anchor) delete layoutOverrides[anchor];
    return { ...current, layoutOverrides, editorState: { ...current.editorState, slides } };
  }),
  undoEditor: () => set((state) => {
    const previous = state.editorPast.at(-1);
    if (!previous) return state;
    return {
      ...previous,
      editorPast: state.editorPast.slice(0, -1),
      editorFuture: [snapshotFromState(state), ...state.editorFuture].slice(0, 50),
      layoutRevision: state.layoutRevision + 1,
      saveStatus: "saving" as const,
    };
  }),
  redoEditor: () => set((state) => {
    const next = state.editorFuture[0];
    if (!next) return state;
    return {
      ...next,
      editorPast: [...state.editorPast, snapshotFromState(state)].slice(-50),
      editorFuture: state.editorFuture.slice(1),
      layoutRevision: state.layoutRevision + 1,
      saveStatus: "saving" as const,
    };
  }),
  restoreInitialSnapshot: () => set((state) => state.initialSnapshot ? {
    ...state.initialSnapshot,
    editorPast: [...state.editorPast, snapshotFromState(state)].slice(-50),
    editorFuture: [],
    layoutRevision: state.layoutRevision + 1,
    saveStatus: "saving" as const,
  } : state),
  persistEditor: () => {
    if (typeof window === "undefined") return;
    try {
      const snapshot = sanitizeSnapshotForStorage(snapshotFromState(get()));
      const initialSnapshot = get().initialSnapshot ? sanitizeSnapshotForStorage(get().initialSnapshot!) : snapshot;
      window.localStorage.setItem(EDITOR_STORAGE_KEY, JSON.stringify({ version: 2, savedAt: Date.now(), snapshot, initialSnapshot }));
      set({ saveStatus: "saved", lastSavedAt: Date.now() });
    } catch (error) {
      console.error("[Editor] 自动保存失败", error);
      set({ saveStatus: "error" });
    }
  },
  hydrateEditor: () => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(EDITOR_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { version: number; savedAt?: number; snapshot?: EditorSnapshot; initialSnapshot?: EditorSnapshot };
      if (![1, 2].includes(parsed.version) || !parsed.snapshot?.project || !Array.isArray(parsed.snapshot.products)) return;
      set({ ...parsed.snapshot, step: "preview", initialSnapshot: parsed.initialSnapshot ?? parsed.snapshot, editorPast: [], editorFuture: [], saveStatus: "saved", lastSavedAt: parsed.savedAt });
    } catch (error) {
      console.warn("[Editor] 忽略损坏的本地编辑记录", error);
    }
  },
  editorSetTemplate: (templateId) => commitEditor((current) => ({
    ...current,
    project: { ...current.project, design: applyTemplateToDesign(current.project.design, templateId) },
  })),
  editorSetTheme: (themeId) => commitEditor((current) => ({
    ...current,
    project: { ...current.project, design: { ...current.project.design, themeId } },
  })),
  editorUpdateDesign: (patch) => commitEditor((current) => ({
    ...current,
    project: { ...current.project, design: { ...current.project.design, ...patch } },
  })),
  editorUpdateThemeOverrides: (patch) => commitEditor((current) => ({
    ...current,
    project: { ...current.project, design: { ...current.project.design, themeOverrides: { ...current.project.design.themeOverrides, ...patch } } },
  })),
  editorResetDesign: () => commitEditor((current) => ({
    ...current,
    project: { ...current.project, design: resetTemplateDesign(current.project.design, current.project.design.templateId) },
  })),
  loadEditorSnapshot: (snapshot, step = "preview") => { importRun += 1; set((state) => ({
    ...snapshot,
    products: snapshot.products.map(withDerivedProductComponents),
    step,
    selectedProductIds: [],
    editorPast: [],
    editorFuture: [],
    initialSnapshot: { ...snapshot, products: snapshot.products.map(withDerivedProductComponents) },
    layoutRevision: state.layoutRevision + 1,
    saveStatus: "saved",
  })); },
  getEditorSnapshot: () => snapshotFromState(get()),
  });
});
