"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useProjectStore } from "@/src/store/projectStore";
import { useBatchStore } from "@/src/store/batchStore";
import type { ProjectDetailDto, CloudProjectSnapshot } from "@/src/server/projects/types";
import { uploadProjectAsset, type ClientAsset, type ClientAssetType } from "@/src/lib/cloud/upload";
import { ProjectUtilityDrawer } from "./ProjectUtilityDrawer";
import { pptFetch } from "@/src/lib/basePath";
import { useRouter } from "next/navigation";
import { useStudioDialog } from "@/components/host/StudioDialogProvider";
import { listenForPptActivation } from "@/src/lib/hostEvents";
import { recoveryAction, type SaveReceipt, type SaveResult } from "@/src/lib/cloud/saveResult";

export type CloudSaveState = "saved" | "dirty" | "saving" | "error" | "offline" | "conflict";

interface CloudProjectContextValue {
  projectId: string;
  revision: number;
  saveState: CloudSaveState;
  saveMessage: string;
  lastSavedAt?: number;
  uploadProgress?: number;
  saveNow: () => Promise<SaveResult>;
  uploadAsset: (file: File, type: ClientAssetType, onProgress?: (percent: number) => void) => Promise<ClientAsset>;
  saveExport: (file: File, pageCount: number, receipt: SaveReceipt) => Promise<void>;
  openFiles: () => void;
  openVersions: () => void;
  openProductSync: () => void;
  openReimport: () => Promise<void>;
}

const CloudProjectContext = createContext<CloudProjectContextValue | null>(null);
export const useCloudProject = () => useContext(CloudProjectContext);

const relevantChanged = (next: ReturnType<typeof useProjectStore.getState>, previous: ReturnType<typeof useProjectStore.getState>) =>
  next.project !== previous.project || next.products !== previous.products || next.editorState !== previous.editorState || next.layoutOverrides !== previous.layoutOverrides || next.layoutMode !== previous.layoutMode;

function currentSnapshot(): CloudProjectSnapshot {
  const project = useProjectStore.getState();
  const batch = useBatchStore.getState();
  return {
    project: project.project,
    products: project.products,
    layoutMode: project.layoutMode,
    layoutOverrides: project.layoutOverrides,
    editorState: project.editorState,
    batchConfig: batch.generationMode === "batch" ? { generationMode: batch.generationMode, config: batch.config, groups: batch.groups, productOverrides: batch.productOverrides } : undefined,
  };
}

async function sourceToFile(source: string, name: string) {
  const response = await pptFetch(source);
  if (!response.ok) throw new Error("无法读取待上传图片");
  const blob = await response.blob();
  const extension = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
  return new File([blob], `${name}.${extension}`, { type: blob.type || "image/jpeg" });
}

export function CloudProjectProvider({ initialProject, children }: { initialProject: ProjectDetailDto; children: React.ReactNode }) {
  const router = useRouter();
  const dialog = useStudioDialog();
  const projectId = initialProject.id;
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(initialProject.revision);
  const revisionRef = useRef(initialProject.revision);
  const [saveState, setSaveState] = useState<CloudSaveState>("saved");
  const [saveMessage, setSaveMessage] = useState("已保存");
  const [lastSavedAt, setLastSavedAt] = useState<number>();
  const [uploadProgress, setUploadProgress] = useState<number>();
  const [panel, setPanel] = useState<"files" | "versions" | "sync" | null>(null);
  const dirtyCounter = useRef(0);
  const savedCounter = useRef(0);
  const saving = useRef(false);
  const activeSave = useRef<Promise<boolean> | undefined>(undefined);
  const lastReceipt = useRef<SaveReceipt | undefined>(undefined);
  const initialized = useRef(false);
  const openingReimport = useRef(false);
  const [reimportLoading, setReimportLoading] = useState(false);
  const saveQueued = useRef(false);
  const trackingSuspended = useRef(true);
  const timer = useRef<number | undefined>(undefined);
  const sourceCache = useRef(new Map<string, string>());

  const hydrate = useCallback((snapshot: CloudProjectSnapshot) => {
    trackingSuspended.current = true;
    useProjectStore.getState().loadEditorSnapshot({ project: snapshot.project, products: snapshot.products, layoutOverrides: snapshot.layoutOverrides, editorState: snapshot.editorState }, snapshot.products.length ? "preview" : "upload");
    useProjectStore.getState().setLayoutMode(snapshot.layoutMode || "smart");
    useBatchStore.getState().resetBatch();
    const batch = snapshot.batchConfig as { generationMode?: "single" | "batch"; config?: object; groups?: unknown[]; productOverrides?: unknown[] } | undefined;
    if (batch?.generationMode) useBatchStore.setState({ generationMode: batch.generationMode, ...(batch.config ? { config: batch.config as ReturnType<typeof useBatchStore.getState>["config"] } : {}), ...(batch.groups ? { groups: batch.groups as ReturnType<typeof useBatchStore.getState>["groups"] } : {}), ...(batch.productOverrides ? { productOverrides: batch.productOverrides as ReturnType<typeof useBatchStore.getState>["productOverrides"] } : {}) });
    window.queueMicrotask(() => { trackingSuspended.current = false; });
  }, []);

  const receiveProject = useCallback((remote: ProjectDetailDto) => {
    if (openingReimport.current) return;
    const action = initialized.current ? recoveryAction(revisionRef.current, remote.revision, saving.current || dirtyCounter.current !== savedCounter.current) : "restore";
    if (action === "conflict") {
      setSaveState("conflict"); setSaveMessage("云端已有新版本，本地更改和撤销历史已保留；请先备份本地内容再处理冲突");
    } else if (action === "restore") {
      hydrate(remote.snapshot);
      revisionRef.current = remote.revision; setRevision(remote.revision);
      dirtyCounter.current = 0; savedCounter.current = 0;
      setSaveState("saved"); setSaveMessage("已同步云端版本");
    }
    initialized.current = true; setReady(true);
  }, [hydrate]);
  useEffect(() => { receiveProject(initialProject); }, [initialProject, receiveProject]);
  useEffect(() => {
    let disposed = false;
    const stop = listenForPptActivation(window, () => {
      void pptFetch(`/api/projects/${projectId}`, { cache: "no-store" }).then(async (response) => {
        if (!response.ok) return;
        const remote = await response.json();
        if (!disposed && remote.id === projectId) receiveProject(remote);
      }).catch(() => { /* Keep local state when the server cannot be reached. */ });
    });
    return () => { disposed = true; stop(); };
  }, [projectId, receiveProject]);

  const uploadAsset = useCallback(async (file: File, type: ClientAssetType, onProgress?: (percent: number) => void) => {
    setUploadProgress(0);
    try { return await uploadProjectAsset(projectId, file, type, (percent) => { setUploadProgress(percent); onProgress?.(percent); }); }
    finally { window.setTimeout(() => setUploadProgress(undefined), 800); }
  }, [projectId]);

  const materializeString = useCallback(async (value: string, type: ClientAssetType, label: string) => {
    if (!value.startsWith("data:") && !value.startsWith("blob:")) return value;
    const cached = sourceCache.current.get(value);
    if (cached) return cached;
    const asset = await uploadAsset(await sourceToFile(value, label), type);
    sourceCache.current.set(value, asset.url);
    return asset.url;
  }, [uploadAsset]);

  const materializeValue = useCallback(async (value: unknown): Promise<unknown> => {
    if (typeof value === "string") return materializeString(value, "product_image", `product-${Date.now()}`);
    if (Array.isArray(value)) return Promise.all(value.map(materializeValue));
    if (value && typeof value === "object") {
      const entries = await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await materializeValue(child)] as const));
      return Object.fromEntries(entries);
    }
    return value;
  }, [materializeString]);

  const prepareSnapshot = useCallback(async () => {
    const snapshot = structuredClone(currentSnapshot());
    const project = { ...snapshot.project };
    if (project.logo) project.logo = await materializeString(project.logo, "logo", `logo-${Date.now()}`);
    if (project.design.logo) project.design = { ...project.design, logo: await materializeString(project.design.logo, "logo", `logo-${Date.now()}`) };
    return { ...snapshot, project, products: await materializeValue(snapshot.products) as CloudProjectSnapshot["products"], editorState: await materializeValue(snapshot.editorState) as CloudProjectSnapshot["editorState"] };
  }, [materializeString, materializeValue]);

  const performSave = useCallback((): Promise<boolean> => {
    if (activeSave.current) return activeSave.current;
    const task = (async () => {
    if (trackingSuspended.current) return false;
    if (!navigator.onLine) { setSaveState("offline"); setSaveMessage("离线 · 更改尚未保存"); return false; }
    saving.current = true;
    const savingCounter = dirtyCounter.current;
    setSaveState("saving"); setSaveMessage("正在保存...");
    try {
      const snapshot = await prepareSnapshot();
      const response = await pptFetch(`/api/projects/${projectId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: revisionRef.current, snapshot }) });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status === 409) { setSaveState("conflict"); setSaveMessage("检测到云端新版本；本地更改已保留，请勿直接刷新覆盖"); return false; }
        throw new Error(payload.error || "保存失败");
      }
      revisionRef.current = payload.revision;
      setRevision(payload.revision);
      savedCounter.current = savingCounter;
      lastReceipt.current = { revision: payload.revision, snapshot };
      setLastSavedAt(Date.now());
      useProjectStore.setState({ saveStatus: "saved", lastSavedAt: Date.now() });
      if (dirtyCounter.current === savingCounter) { setSaveState("saved"); setSaveMessage("已保存"); }
      else { setSaveState("dirty"); setSaveMessage("有待保存更改"); saveQueued.current = true; }
      return true;
    } catch (cause) {
      console.error("[Cloud Autosave] 保存失败", cause);
      setSaveState("error"); setSaveMessage(cause instanceof Error ? cause.message : "保存失败，请重试");
      useProjectStore.setState({ saveStatus: "error" });
      return false;
    } finally {
      saving.current = false;
      if (saveQueued.current) { saveQueued.current = false; window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void performSave(), 80); }
    }
    })();
    activeSave.current = task;
    void task.then(() => { if (activeSave.current === task) activeSave.current = undefined; });
    return task;
  }, [prepareSnapshot, projectId]);

  const saveNow = useCallback(async (): Promise<SaveResult> => {
    do {
      window.clearTimeout(timer.current);
      if (!await performSave()) return { ok: false, message: "项目尚未保存成功（网络异常或版本冲突），已停止后续操作，本地更改保留。" };
    } while (dirtyCounter.current !== savedCounter.current);
    return { ok: true, ...lastReceipt.current! };
  }, [performSave]);

  const openReimport = useCallback(async () => {
    if (openingReimport.current) return;
    openingReimport.current = true;
    setReimportLoading(true);
    try {
      // Drain any in-flight autosave, then persist edits made during that save.
      // A failed/offline/conflicting save must never enter the staging workspace.
      do {
        window.clearTimeout(timer.current);
        if (!await performSave()) throw new Error("原项目尚未保存成功，请恢复网络或处理保存冲突后重试。未进入重新导入。");
      } while (dirtyCounter.current !== savedCounter.current);
      trackingSuspended.current = true;
      saveQueued.current = false;
      window.clearTimeout(timer.current);
      router.push(`/projects/${projectId}/reimport`);
    } catch (error) {
      openingReimport.current = false;
      trackingSuspended.current = false;
      setReimportLoading(false);
      dialog.notify(error instanceof Error ? error.message : "无法进入重新导入，原项目保持不变", "error");
    }
  }, [dialog, performSave, projectId, router]);

  useEffect(() => {
    if (!ready) return;
    const markDirty = () => {
      if (trackingSuspended.current) return;
      dirtyCounter.current += 1;
      setSaveState((current) => current === "conflict" ? current : navigator.onLine ? "dirty" : "offline");
      setSaveMessage(navigator.onLine ? "有待保存更改" : "离线 · 更改尚未保存");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void performSave(), 1000);
    };
    const unsubscribeProject = useProjectStore.subscribe((next, previous) => relevantChanged(next, previous) && markDirty());
    const unsubscribeBatch = useBatchStore.subscribe((next, previous) => {
      if (next.generationMode !== previous.generationMode || next.config !== previous.config || next.groups !== previous.groups || next.productOverrides !== previous.productOverrides) markDirty();
    });
    return () => { unsubscribeProject(); unsubscribeBatch(); window.clearTimeout(timer.current); };
  }, [performSave, ready]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyCounter.current !== savedCounter.current || saving.current) event.preventDefault(); };
    const online = () => { if (dirtyCounter.current !== savedCounter.current) void performSave(); };
    const offline = () => { setSaveState("offline"); setSaveMessage("离线 · 更改尚未保存"); };
    window.addEventListener("beforeunload", beforeUnload); window.addEventListener("online", online); window.addEventListener("offline", offline);
    return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, [performSave]);

  const saveExport = useCallback(async (file: File, pageCount: number, receipt: SaveReceipt) => {
    const form = new FormData(); form.append("file", file); form.append("pageCount", String(pageCount)); form.append("snapshot", JSON.stringify(receipt.snapshot)); form.append("expectedRevision", String(receipt.revision));
    const response = await pptFetch(`/api/projects/${projectId}/exports`, { method: "POST", body: form });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(payload.error || "导出文件保存失败");
  }, [projectId]);

  const applyRestoredSnapshot = useCallback((snapshot: CloudProjectSnapshot, nextRevision: number) => {
    revisionRef.current = nextRevision; setRevision(nextRevision); hydrate(snapshot); dirtyCounter.current = 0; savedCounter.current = 0; setSaveState("saved"); setSaveMessage("已恢复并保存");
  }, [hydrate]);

  const value = useMemo<CloudProjectContextValue>(() => ({
    projectId, revision, saveState, saveMessage, lastSavedAt, uploadProgress, saveNow, uploadAsset, saveExport, openReimport,
    openFiles: () => setPanel("files"), openVersions: () => setPanel("versions"), openProductSync: () => setPanel("sync"),
  }), [projectId, revision, saveState, saveMessage, lastSavedAt, uploadProgress, saveNow, uploadAsset, saveExport, openReimport]);

  if (!ready) return <div className="project-editor-loading"><div /><div /><span>正在恢复项目...</span></div>;
  return <CloudProjectContext.Provider value={value}>{children}<ProjectUtilityDrawer projectId={projectId} panel={panel} onClose={() => setPanel(null)} onSave={saveNow} onRestore={applyRestoredSnapshot} uploadAsset={uploadAsset} />{reimportLoading && <div className="reimport-saving-overlay" role="status">正在保存原项目，准备重新导入…</div>}</CloudProjectContext.Provider>;
}
