"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CatalogWorkflow } from "@/components/workflow/CatalogWorkflow";
import { catalogMeta } from "@/data/catalog";
import { createPendingProject, savePendingProject } from "@/src/lib/cloud/pendingTransport";
import { uploadProjectAsset } from "@/src/lib/cloud/upload";
import { readDraft, writeDraft } from "@/src/lib/cloud/localDraft";
import type { CloudProjectSnapshot, ProjectDetailDto } from "@/src/server/projects/types";
import { useBatchStore } from "@/src/store/batchStore";
import { useProjectStore } from "@/src/store/projectStore";
import { emptyEditorState } from "@/types/editor";
import { isDefaultProjectName, suggestProjectName } from "@/src/lib/cloud/projectNaming";
import { uploadSnapshotImages, type ImageUploadReceipts } from "@/src/lib/cloud/snapshotImages";
import { CloudApiError, isProjectDeleted } from "@/src/lib/cloud/apiError";
import { prepareRecoveredDraft } from "@/src/lib/cloud/pendingRecovery";
import { forgetDraft, rememberDraft } from "@/src/lib/cloud/draftIdentity";

type Draft = {
  state: Partial<ReturnType<typeof useProjectStore.getState>>;
  batch: Partial<ReturnType<typeof useBatchStore.getState>>;
  files: File[];
  created?: ProjectDetailDto;
  imageUploads?: ImageUploadReceipts;
  sourceUploadedIndices?: number[];
  sourceFilesComplete?: boolean;
  projectDeleted?: boolean;
};
const dataOnly = <T extends object>(state: T): Partial<T> => Object.fromEntries(Object.entries(state).filter(([, value]) => typeof value !== "function")) as Partial<T>;
function pendingSnapshot(): CloudProjectSnapshot {
  const state = useProjectStore.getState();
  const batch = useBatchStore.getState();
  return { project: state.project, products: state.products, layoutMode: state.layoutMode, layoutOverrides: state.layoutOverrides, editorState: state.editorState,
    batchConfig: batch.generationMode === "batch" ? { generationMode: batch.generationMode, config: batch.config, groups: batch.groups, productOverrides: batch.productOverrides } : undefined };
}

export function PendingProjectWorkspace({ userId, initialName, draftId, layoutDebug = false }: { userId: string; initialName: string; draftId: string; layoutDebug?: boolean }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState("");
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error" | "dirty">("dirty");
  const [saveMessage, setSaveMessage] = useState("尚未创建云端项目");
  const [draftMessage, setDraftMessage] = useState("本地草稿准备中…");
  const [deletedProject, setDeletedProject] = useState(false);
  const [needsSourceFiles, setNeedsSourceFiles] = useState(false);
  const files = useRef<File[]>([]);
  const creation = useRef<Promise<void> | undefined>(undefined);
  const created = useRef<ProjectDetailDto | undefined>(undefined);
  const imageUploads = useRef<ImageUploadReceipts>({});
  const sourceUploadedIndices = useRef<number[]>([]);
  const sourceFilesComplete = useRef(true);
  const deleted = useRef(false);
  const recovering = useRef(false);
  const recoveryPanel = useRef<HTMLElement>(null);
  const mounted = useRef(false);
  const key = useRef("");
  const creationKey = useRef("");
  const writes = useRef(Promise.resolve());
  const completed = useRef(false);
  const slot = `ppt-pending:${userId}:${initialName}`;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (deletedProject) recoveryPanel.current?.focus(); }, [deletedProject]);

  const captureDraft = useCallback((): Draft => ({
    state: dataOnly(useProjectStore.getState()), batch: dataOnly(useBatchStore.getState()), files: [...files.current],
    created: created.current ? structuredClone(created.current) : undefined, imageUploads: { ...imageUploads.current },
    sourceUploadedIndices: [...sourceUploadedIndices.current], sourceFilesComplete: sourceFilesComplete.current, projectDeleted: deleted.current,
  }), []);
  const persistDraft = useCallback(() => {
    if (!key.current || completed.current || recovering.current) return writes.current;
    const targetKey = key.current;
    const draft = captureDraft();
    writes.current = writes.current.catch(() => undefined).then(async () => {
      await writeDraft(targetKey, draft);
      setDraftMessage("资料已暂存到本机，刷新可恢复；确认生成前不会创建云端项目");
    }).catch((error) => { setDraftMessage("本地草稿保存失败，请勿刷新或关闭页面"); throw error; });
    return writes.current;
  }, [captureDraft]);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        creationKey.current = draftId;
        key.current = `${slot}:${creationKey.current}`;
        const draft = await readDraft<Draft>(key.current, true);
        if (disposed) return;
        useBatchStore.getState().resetBatch();
        useProjectStore.getState().resetImport();
        created.current = undefined;
        imageUploads.current = {};
        files.current = [];
        sourceUploadedIndices.current = [];
        sourceFilesComplete.current = true;
        deleted.current = false;
        if (draft) {
          useProjectStore.setState({ ...draft.state, importProgress: { phase: "idle", percent: 0, message: "已恢复草稿；未完成解析请重新选择源文件" } });
          useBatchStore.setState(draft.batch);
          files.current = draft.files;
          created.current = draft.created;
          imageUploads.current = draft.created ? (draft.imageUploads || {}) : {};
          sourceUploadedIndices.current = draft.created ? (draft.sourceUploadedIndices || []) : [];
          // Old versions removed successful source files from the draft; their completeness is unknown.
          sourceFilesComplete.current = draft.sourceFilesComplete ?? !draft.created;
          deleted.current = !!draft.projectDeleted;
          if (deleted.current) {
            setSaveState("error");
            setSaveMessage("原项目已删除，当前导入资料已保留。");
          }
          setDraftMessage("已恢复本机草稿及源文件；未完成的解析任务需要重新导入");
        } else {
          useProjectStore.getState().loadEditorSnapshot({ project: { ...catalogMeta, projectName: initialName, title: initialName, design: { ...catalogMeta.design } }, products: [], layoutOverrides: {}, editorState: emptyEditorState() }, "upload");
          setDraftMessage("资料仅暂存本机，确认生成后才创建云端项目");
        }
        // Save a new empty draft before switching the last-draft recovery pointer.
        if (!draft) await writeDraft(key.current, captureDraft());
        if (disposed) return;
        rememberDraft(sessionStorage, slot, creationKey.current);
      } catch (error) {
        if (disposed) return;
        key.current = "";
        setRestoreFailed(error instanceof Error ? error.message : "本地草稿读取或保存失败");
        return;
      }
      if (!disposed) { setDeletedProject(deleted.current); setNeedsSourceFiles(!sourceFilesComplete.current); setReady(true); }
    })();
    return () => { disposed = true; };
  }, [slot, initialName, draftId, captureDraft, restoreAttempt]);

  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { void persistDraft().catch(() => undefined); }, 150); };
    const projectStop = useProjectStore.subscribe(schedule);
    const batchStop = useBatchStore.subscribe(schedule);
    const guard = (event: BeforeUnloadEvent) => { if (!completed.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard);
    return () => { projectStop(); batchStop(); clearTimeout(timer); window.removeEventListener("beforeunload", guard); void persistDraft().catch(() => undefined); useProjectStore.getState().cancelDocumentImport(); };
  }, [ready, persistDraft]);

  const stageSourceFiles = useCallback((next: File[]) => {
    files.current = next;
    sourceUploadedIndices.current = [];
    sourceFilesComplete.current = true;
    setNeedsSourceFiles(false);
    const meta = useProjectStore.getState().project;
    if (isDefaultProjectName(meta.projectName)) {
      const source = next.find((file) => /\.(xlsx?|pdf|docx|pptx)$/i.test(file.name));
      const name = suggestProjectName(meta, source?.name, new Date(), creationKey.current);
      useProjectStore.getState().updateProject({ projectName: name, ...(isDefaultProjectName(meta.title) ? { title: name } : {}) });
    }
    void persistDraft().catch(() => undefined);
  }, [persistDraft]);
  const persistProject = useCallback(async () => {
    if (creation.current) return creation.current;
    if (recovering.current) return;
    if (deleted.current) throw new Error("原项目已删除，请使用“用当前资料创建新项目”继续。");
    const task = (async () => {
      setSaveState("saving"); setSaveMessage("正在保存本地草稿…");
      let snapshot = structuredClone(pendingSnapshot());
      if (isDefaultProjectName(snapshot.project.projectName)) {
        snapshot.project.projectName = suggestProjectName(snapshot.project, files.current[0]?.name, new Date(), creationKey.current);
        if (isDefaultProjectName(snapshot.project.title)) snapshot.project.title = snapshot.project.projectName;
      }
      if (!snapshot.products.length) throw new Error("请先导入并确认有效商品数据");
      await persistDraft();
      if (!created.current) {
        setSaveMessage("正在创建项目记录…");
        created.current = await createPendingProject(creationKey.current, snapshot.project.projectName || initialName, setSaveMessage);
        await persistDraft();
      }
      const project = created.current;
      try {
        snapshot = await uploadSnapshotImages(project.id, snapshot, imageUploads.current, setSaveMessage);
      } finally {
        // Keep successful upload receipts even when another image fails.
        await persistDraft();
      }
      setSaveMessage("正在保存项目数据…");
      const saved = await savePendingProject(project, snapshot, setSaveMessage);
      project.revision = saved.revision;
      await persistDraft();
      const sourceCount = files.current.length;
      for (let index = 0; index < sourceCount; index++) {
        if (sourceUploadedIndices.current.includes(index)) continue;
        const file = files.current[index];
        const number = index + 1;
        try {
          await uploadProjectAsset(project.id, file, "source_file", (percent) =>
            setSaveMessage(`正在上传源文件 ${number}/${sourceCount}：${percent}%`), setSaveMessage);
        } catch (error) {
          if (error instanceof CloudApiError) throw error;
          throw new Error("源文件上传失败，资料已保留。点击重试，不会重复创建项目。");
        }
        sourceUploadedIndices.current.push(index);
        await persistDraft();
      }
      completed.current = true;
      await writes.current;
      if (key.current) await writeDraft(key.current, undefined);
      forgetDraft(sessionStorage, slot, creationKey.current);
      setSaveState("saved"); setSaveMessage("项目已创建");
      router.replace(`/projects/${project.id}`);
    })();
    creation.current = task;
    try { await task; }
    catch (cause) {
      completed.current = false;
      setSaveState("error");
      if (isProjectDeleted(cause)) {
        deleted.current = true; setDeletedProject(true); setNeedsSourceFiles(!sourceFilesComplete.current);
        setSaveMessage("原项目已删除，当前导入资料已保留。");
        await persistDraft().catch(() => undefined);
      } else setSaveMessage(cause instanceof Error ? cause.message : "项目创建失败");
      throw cause;
    }
    finally { creation.current = undefined; }
  }, [initialName, slot, router, persistDraft]);

  const recoverProject = useCallback(async () => {
    if (!deleted.current || recovering.current || creation.current) return;
    recovering.current = true;
    setSaveState("saving"); setSaveMessage("正在保留当前资料并准备新项目…");
    try {
      // Settle older writes, but let a new durable save retry a past quota/transient failure.
      await writes.current.catch(() => undefined);
      const next = await prepareRecoveredDraft(slot, captureDraft(), (name, value) => {
        if (!mounted.current) throw new Error("页面已离开，未创建新项目。");
        rememberDraft(sessionStorage, name, value);
        // Keep refresh on the newly saved recovery draft, not the deleted identity.
        const url = new URL(window.location.href);
        url.searchParams.set("draft", value);
        window.history.replaceState(window.history.state, "", url);
      });
      // No live identity changes before both durable storage and the recovery pointer succeed.
      key.current = next.key; creationKey.current = next.creationKey;
      created.current = undefined; imageUploads.current = {}; sourceUploadedIndices.current = [];
      deleted.current = false; setDeletedProject(false);
    } catch (error) {
      setSaveState("error");
      setSaveMessage(`未创建新项目，原草稿仍保留。${error instanceof Error ? error.message : "本地保存失败，请重试。"}`);
      return;
    } finally { recovering.current = false; }
    await persistProject().catch(() => undefined);
  }, [slot, captureDraft, persistProject]);

  if (restoreFailed) return <div className="pending-draft-entry" role="alert"><p>{restoreFailed}</p><p>为避免覆盖资料，已暂停进入编辑，未删除已有资料。</p><button type="button" onClick={() => { setRestoreFailed(""); setRestoreAttempt(value => value + 1); }}>重试读取草稿</button><button type="button" onClick={() => router.push("/projects")}>返回项目列表</button></div>;
  if (!ready) return <div className="project-editor-loading"><span>正在准备本地草稿…</span></div>;
  return <><div className="pending-draft-banner" role="status">{saveState === "saving" ? saveMessage : draftMessage}{saveState === "error" && <div role="alert">{saveMessage}{!deletedProject && <button type="button" onClick={() => void persistProject().catch(() => undefined)}>重试提交 / 上传</button>}</div>}
    {deletedProject && <section ref={recoveryPanel} tabIndex={-1} aria-label="恢复已删除项目的导入资料">
      <p>不会恢复或覆盖旧项目；确认后将使用当前资料另建项目。</p>
      {needsSourceFiles && <label>旧草稿可能缺少已上传的源文件，请补选全部原始资料（不会重新解析或清空编辑内容）。<input type="file" multiple disabled={saveState === "saving"} onChange={(event) => { const selected = Array.from(event.target.files || []); if (selected.length) stageSourceFiles(selected); }} /></label>}
      <button type="button" disabled={saveState === "saving" || needsSourceFiles} onClick={() => void recoverProject()}>用当前资料创建新项目</button>
    </section>}
    </div><div inert={saveState === "saving"}><CatalogWorkflow layoutDebug={layoutDebug} cloudMode onConfirmGeneration={persistProject} onSaveProject={persistProject} onStageSourceFiles={stageSourceFiles} stagedFiles={files.current} pendingSaveState={saveState} pendingSaveMessage={saveMessage} /></div></>;
}
