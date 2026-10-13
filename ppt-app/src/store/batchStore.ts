"use client";

import { create } from "zustand";
import type { BatchDimensionAnalysis, BatchEditorSession, BatchExportState, BatchGroup, BatchProductPatch, GlobalBatchConfig, ProductProjectOverride, ResolvedBatchProject } from "@/types/batch";
import type { CatalogMeta, Product } from "@/types/catalog";
import type { EditorSnapshot } from "@/types/editor";
import { DEFAULT_BATCH_CONFIG } from "@/src/lib/batch/constants";
import { analyzeBatchDimensions, createBatchGroups, formatBatchGroupName } from "@/src/lib/batch/grouping";
import { resolveBatchMeta, resolveBatchProducts, resolveBatchProject } from "@/src/lib/batch/resolve";
import { validateBatchGroup } from "@/src/lib/batch/validation";
import { downloadBatchZip, runBatchExportQueue, type BatchExportOutput } from "@/src/lib/batch/exportQueue";
import { sanitizeBatchFileName } from "@/src/lib/batch/naming";
import { emptyEditorState } from "@/types/editor";

const EMPTY_ANALYSIS: BatchDimensionAnalysis = {
  values: { region: [], priceTier: [], packageType: [], customerGroup: [] },
  theoreticalCombinations: 0,
  detectedDimensions: [],
};

const EMPTY_EXPORT: BatchExportState = {
  running: false,
  current: 0,
  total: 0,
  succeeded: 0,
  failed: 0,
  logs: [],
};

interface BatchStoreState {
  generationMode: "single" | "batch";
  config: GlobalBatchConfig;
  analysis: BatchDimensionAnalysis;
  baseProject?: CatalogMeta;
  baseProducts: Product[];
  groups: BatchGroup[];
  productOverrides: ProductProjectOverride[];
  activeGroupId?: string;
  exportState: BatchExportState;
  failedGroupIds: string[];
  lastExportOutput?: BatchExportOutput;
  setGenerationMode: (mode: "single" | "batch") => void;
  setConfig: (patch: Partial<GlobalBatchConfig>) => void;
  setDimensionEnabled: (field: GlobalBatchConfig["dimensions"][number]["field"], enabled: boolean) => void;
  analyzeProducts: (products: Product[]) => void;
  initializeBatch: (project: CatalogMeta, products: Product[]) => void;
  rebuildGroups: () => void;
  toggleGroup: (id: string, enabled?: boolean) => void;
  setAllGroupsEnabled: (enabled: boolean) => void;
  updateGroup: (id: string, patch: Partial<BatchGroup>) => void;
  updateGroupConfig: (id: string, patch: NonNullable<BatchGroup["projectConfig"]>) => void;
  applyTemplateToAll: (templateId: GlobalBatchConfig["templateId"]) => void;
  applyThemeToAll: (themeId: GlobalBatchConfig["themeId"]) => void;
  applyLogoToAll: (logo?: string) => void;
  deleteGroup: (id: string) => void;
  duplicateGroup: (id: string) => void;
  addManualGroup: (dimensions?: BatchGroup["dimensions"], productIds?: string[]) => string;
  setGroupProducts: (id: string, productIds: string[]) => void;
  setProductOverride: (batchGroupId: string, productId: string, overrides?: BatchProductPatch) => void;
  updateSharedProduct: (productId: string, patch: BatchProductPatch) => void;
  getProductImpactCount: (productId: string) => number;
  getResolvedGroup: (id: string) => ResolvedBatchProject | undefined;
  checkAll: () => void;
  setActiveGroup: (id?: string) => void;
  saveEditorSession: (id: string, snapshot: EditorSnapshot) => void;
  exportAll: (onlyGroupIds?: string[]) => Promise<void>;
  retryFailed: () => Promise<void>;
  downloadLastExport: () => void;
  resetBatch: () => void;
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function buildProductPatch(base: Product, edited: Product): BatchProductPatch {
  const patch: BatchProductPatch = {};
  const keys: Array<keyof Omit<Product, "id" | "price">> = ["productNumber", "sku", "packageCode", "name", "components", "images", "image", "details", "deliveryRegions", "categoryId", "featured", "imageMetadata", "region", "priceTier", "packageType", "customerGroup"];
  keys.forEach((key) => {
    if (!same(base[key], edited[key])) (patch as Record<string, unknown>)[key] = edited[key];
  });
  if (!same(base.price, edited.price)) patch.price = { ...edited.price };
  return patch;
}

function createManualId() {
  return `batch-manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useBatchStore = create<BatchStoreState>((set, get) => ({
  generationMode: "single",
  config: { ...DEFAULT_BATCH_CONFIG, dimensions: DEFAULT_BATCH_CONFIG.dimensions.map((item) => ({ ...item })) },
  analysis: EMPTY_ANALYSIS,
  baseProducts: [],
  groups: [],
  productOverrides: [],
  exportState: EMPTY_EXPORT,
  failedGroupIds: [],
  lastExportOutput: undefined,
  setGenerationMode: (generationMode) => set({ generationMode }),
  setConfig: (patch) => set((state) => ({ config: { ...state.config, ...patch } })),
  setDimensionEnabled: (field, enabled) => set((state) => ({
    config: { ...state.config, dimensions: state.config.dimensions.map((dimension) => dimension.field === field ? { ...dimension, enabled } : dimension) },
  })),
  analyzeProducts: (products) => set({ analysis: analyzeBatchDimensions(products) }),
  initializeBatch: (baseProject, baseProducts) => {
    const analysis = analyzeBatchDimensions(baseProducts);
    const groups = createBatchGroups(baseProducts, get().config.dimensions);
    set({ baseProject, baseProducts, analysis, groups, productOverrides: [], activeGroupId: undefined, exportState: EMPTY_EXPORT, failedGroupIds: [] });
  },
  rebuildGroups: () => set((state) => {
    const previous = new Map(state.groups.map((group) => [group.id, group]));
    const generated = createBatchGroups(state.baseProducts, state.config.dimensions).map((group) => {
      const current = previous.get(group.id);
      return current ? { ...group, enabled: current.enabled, projectConfig: current.projectConfig, status: current.status, checkReport: current.checkReport, editorSession: current.editorSession } : group;
    });
    const manual = state.groups.filter((group) => group.manual);
    return { groups: [...generated, ...manual] };
  }),
  toggleGroup: (id, enabled) => set((state) => ({ groups: state.groups.map((group) => group.id === id ? { ...group, enabled: enabled ?? !group.enabled } : group) })),
  setAllGroupsEnabled: (enabled) => set((state) => ({ groups: state.groups.map((group) => ({ ...group, enabled })) })),
  updateGroup: (id, patch) => set((state) => ({ groups: state.groups.map((group) => group.id === id ? { ...group, ...patch, productCount: patch.productIds?.length ?? group.productCount } : group) })),
  updateGroupConfig: (id, patch) => set((state) => ({ groups: state.groups.map((group) => group.id === id ? { ...group, projectConfig: { ...group.projectConfig, ...patch }, slidePlanCache: undefined, status: "ready" } : group) })),
  applyTemplateToAll: (templateId) => set((state) => ({ config: { ...state.config, templateId }, groups: state.groups.map((group) => ({ ...group, projectConfig: group.projectConfig ? { ...group.projectConfig, templateId: undefined } : undefined, slidePlanCache: undefined })) })),
  applyThemeToAll: (themeId) => set((state) => ({ config: { ...state.config, themeId }, groups: state.groups.map((group) => ({ ...group, projectConfig: group.projectConfig ? { ...group.projectConfig, themeId: undefined } : undefined, slidePlanCache: undefined })) })),
  applyLogoToAll: (logo) => set((state) => ({ config: { ...state.config, logo }, groups: state.groups.map((group) => ({ ...group, projectConfig: group.projectConfig ? { ...group.projectConfig, logo: undefined } : undefined, slidePlanCache: undefined })) })),
  deleteGroup: (id) => set((state) => ({ groups: state.groups.filter((group) => group.id !== id), productOverrides: state.productOverrides.filter((item) => item.batchGroupId !== id), activeGroupId: state.activeGroupId === id ? undefined : state.activeGroupId })),
  duplicateGroup: (id) => set((state) => {
    const source = state.groups.find((group) => group.id === id);
    if (!source) return state;
    const copyId = createManualId();
    const copy: BatchGroup = { ...source, id: copyId, name: `${source.name}（副本）`, enabled: true, manual: true, copiedFromId: source.id, status: "ready", checkReport: undefined, slidePlanCache: undefined, editorSession: undefined };
    const copiedOverrides = state.productOverrides.filter((item) => item.batchGroupId === id).map((item) => ({ ...item, batchGroupId: copyId }));
    return { groups: [...state.groups, copy], productOverrides: [...state.productOverrides, ...copiedOverrides] };
  }),
  addManualGroup: (dimensions = {}, productIds = []) => {
    const id = createManualId();
    const group: BatchGroup = { id, name: formatBatchGroupName(dimensions), dimensions, productIds, productCount: productIds.length, enabled: true, status: "ready", manual: true };
    set((state) => ({ groups: [...state.groups, group] }));
    return id;
  },
  setGroupProducts: (id, productIds) => set((state) => ({ groups: state.groups.map((group) => group.id === id ? { ...group, productIds: [...new Set(productIds)], productCount: new Set(productIds).size, slidePlanCache: undefined, status: "ready" } : group) })),
  setProductOverride: (batchGroupId, productId, overrides) => set((state) => {
    const current = state.productOverrides.find((item) => item.batchGroupId === batchGroupId && item.productId === productId)?.overrides;
    const remaining = state.productOverrides.filter((item) => !(item.batchGroupId === batchGroupId && item.productId === productId));
    const merged = overrides ? { ...current, ...overrides, price: current?.price || overrides.price ? { ...current?.price, ...overrides.price } : undefined } : undefined;
    return {
      productOverrides: merged && Object.keys(merged).length ? [...remaining, { batchGroupId, productId, overrides: merged }] : remaining,
      groups: state.groups.map((group) => group.id === batchGroupId ? { ...group, slidePlanCache: undefined, status: "ready" } : group),
    };
  }),
  updateSharedProduct: (productId, patch) => set((state) => ({
    baseProducts: state.baseProducts.map((product) => product.id === productId ? { ...product, ...patch, price: { ...product.price, ...patch.price } } : product),
    groups: state.groups.map((group) => group.productIds.includes(productId) ? { ...group, slidePlanCache: undefined, status: "ready" } : group),
  })),
  getProductImpactCount: (productId) => get().groups.filter((group) => group.productIds.includes(productId)).length,
  getResolvedGroup: (id) => {
    const state = get();
    const group = state.groups.find((item) => item.id === id);
    if (!group || !state.baseProject) return undefined;
    return resolveBatchProject(state.baseProject, state.baseProducts, state.config, group, state.productOverrides);
  },
  checkAll: () => set((state) => {
    if (!state.baseProject) return state;
    const groups = state.groups.map((group) => {
      const resolved = resolveBatchProject(state.baseProject!, state.baseProducts, state.config, group, state.productOverrides);
      const checkReport = validateBatchGroup(group, resolved.products, resolved.slidePlans);
      return { ...group, productCount: resolved.products.length, status: checkReport.status, checkReport, slidePlanCache: { dataHash: resolved.dataHash, plans: resolved.slidePlans } };
    });
    return { groups };
  }),
  setActiveGroup: (activeGroupId) => set({ activeGroupId }),
  saveEditorSession: (id, snapshot) => set((state) => {
    const group = state.groups.find((item) => item.id === id);
    if (!group || !state.baseProject) return state;
    const resolvedWithoutOverrides = resolveBatchProducts(state.baseProducts, group, []);
    const nextOverrides = state.productOverrides.filter((item) => item.batchGroupId !== id);
    snapshot.products.forEach((product) => {
      const base = resolvedWithoutOverrides.find((item) => item.id === product.id);
      if (!base) return;
      const patch = buildProductPatch(base, product);
      if (Object.keys(patch).length) nextOverrides.push({ batchGroupId: id, productId: product.id, overrides: patch });
    });
    const session: BatchEditorSession = { project: snapshot.project, products: snapshot.products, editorState: snapshot.editorState, layoutOverrides: snapshot.layoutOverrides };
    const expected = resolveBatchMeta(state.baseProject, state.config, group);
    const projectConfig = { ...group.projectConfig };
    if (snapshot.project.projectName !== expected.projectName) projectConfig.projectName = snapshot.project.projectName;
    if (snapshot.project.title !== expected.title) projectConfig.title = snapshot.project.title;
    if (snapshot.project.subtitle !== expected.subtitle) projectConfig.subtitle = snapshot.project.subtitle;
    if (snapshot.project.brand !== expected.brand) projectConfig.brand = snapshot.project.brand;
    if (snapshot.project.logo !== expected.logo) projectConfig.logo = snapshot.project.logo;
    if (snapshot.project.city !== expected.city) projectConfig.city = snapshot.project.city;
    if (snapshot.project.year !== expected.year) projectConfig.year = snapshot.project.year;
    if (snapshot.project.priceTier !== expected.priceTier) projectConfig.priceTier = snapshot.project.priceTier;
    if (snapshot.project.tierName !== expected.tierName) projectConfig.tierName = snapshot.project.tierName;
    if (snapshot.project.version !== expected.version) projectConfig.version = snapshot.project.version;
    if (snapshot.project.design.templateId !== expected.design.templateId) projectConfig.templateId = snapshot.project.design.templateId;
    if (snapshot.project.design.themeId !== expected.design.themeId) projectConfig.themeId = snapshot.project.design.themeId;
    return { productOverrides: nextOverrides, groups: state.groups.map((item) => item.id === id ? { ...item, projectConfig, editorSession: session, slidePlanCache: undefined, status: "ready" } : item) };
  }),
  exportAll: async (onlyGroupIds) => {
    const state = get();
    if (!state.baseProject || state.exportState.running) return;
    const allowed = onlyGroupIds ? new Set(onlyGroupIds) : undefined;
    const jobs = state.groups.filter((group) => group.enabled && (!allowed || allowed.has(group.id))).flatMap((group) => {
      const resolved = get().getResolvedGroup(group.id);
      return resolved ? [resolved] : [];
    });
    if (!jobs.length) return;
    set({ exportState: { ...EMPTY_EXPORT, running: true, total: jobs.length } });
    try {
      const zipName = `${sanitizeBatchFileName(`${state.baseProject.year}${state.baseProject.projectName}批量产品手册${state.config.version ? `-${state.config.version}` : ""}`)}.zip`;
      const output = await runBatchExportQueue(jobs, {
        zipName,
        onProgress: (logs, currentName) => set({ exportState: {
          running: true,
          current: logs.filter((log) => log.status === "completed" || log.status === "failed").length,
          total: logs.length,
          currentName,
          succeeded: logs.filter((log) => log.status === "completed").length,
          failed: logs.filter((log) => log.status === "failed").length,
          logs,
        } }),
      });
      downloadBatchZip(output);
      set({
        exportState: { running: false, current: output.logs.length, total: output.logs.length, succeeded: output.succeeded, failed: output.failed, zipName: output.zipName, logs: output.logs },
        failedGroupIds: output.failedGroupIds,
        lastExportOutput: output,
        groups: get().groups.map((group) => {
          const log = output.logs.find((item) => item.groupId === group.id);
          return log ? { ...group, status: log.status === "completed" ? "completed" : "error" } : group;
        }),
      });
    } catch (error) {
      console.error("[Batch Export] ZIP 生成失败", error);
      set((current) => ({ exportState: { ...current.exportState, running: false } }));
    }
  },
  retryFailed: async () => {
    const ids = get().failedGroupIds;
    if (ids.length) await get().exportAll(ids);
  },
  downloadLastExport: () => {
    const output = get().lastExportOutput;
    if (output) downloadBatchZip(output);
  },
  resetBatch: () => set({ analysis: EMPTY_ANALYSIS, baseProject: undefined, baseProducts: [], groups: [], productOverrides: [], activeGroupId: undefined, exportState: EMPTY_EXPORT, failedGroupIds: [], lastExportOutput: undefined }),
}));

export function snapshotForBatchEditor(project: CatalogMeta, products: Product[], session?: BatchEditorSession): EditorSnapshot {
  return {
    project,
    products,
    layoutOverrides: session?.layoutOverrides ?? {},
    editorState: session?.editorState ?? emptyEditorState(),
  };
}
