"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { CatalogWorkflow } from "@/components/workflow/CatalogWorkflow";
import { useStudioDialog } from "@/components/host/StudioDialogProvider";
import { useProjectStore } from "@/src/store/projectStore";
import { useBatchStore } from "@/src/store/batchStore";
import { materializeSnapshot } from "@/src/lib/cloud/materializeSnapshot";
import { uploadProjectAsset } from "@/src/lib/cloud/upload";
import { pptFetch, withBasePath } from "@/src/lib/basePath";
import type { CloudProjectSnapshot, ProjectDetailDto } from "@/src/server/projects/types";

/** No CloudProjectProvider here: staged edits must never reach autosave. */
export function ReimportProjectWorkspace({ project }: { project: ProjectDetailDto }) {
  const original = useRef(project).current;
  const dialog = useStudioDialog();
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const sourceFiles = useRef<File[]>([]);
  const uploadedFiles = useRef(new Set<File>());
  const imageCache = useRef(new Map<string, string>());
  const pendingBody = useRef<string | undefined>(undefined);
  const submitting = useRef(false);
  const leaving = useRef(false);

  useEffect(() => {
    useBatchStore.getState().resetBatch();
    useProjectStore.getState().resetImport();
    // Preserve branding and project metadata, not old products or page overrides.
    useProjectStore.setState({ project: original.snapshot.project });
    setReady(true);
    const beforeUnload = (event: BeforeUnloadEvent) => { if (!leaving.current) event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      useProjectStore.getState().cancelDocumentImport();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [original]);

  const returnToProject = () => {
    leaving.current = true;
    useProjectStore.getState().cancelDocumentImport();
    // A fresh document also stops outstanding parsers and avoids a cached editor
    // snapshot when cancelling or returning after a committed replacement.
    window.location.replace(withBasePath(`/projects/${original.id}`));
  };

  const cancel = async () => {
    if (submitting.current) return;
    if (await dialog.confirm(uncertain
      ? "将返回项目查看实际保存结果。本次提交可能已完成，返回后请检查商品和版本历史。"
      : "放弃本次暂存资料并返回原项目？原商品和页面编辑保持不变。", "退出重新导入")) returnToProject();
  };

  const confirmReplacement = async (): Promise<boolean> => {
    if (submitting.current) return false;
    if (!pendingBody.current) {
      const count = useProjectStore.getState().products.length;
      if (!count) throw new Error("请先导入并确认有效商品");
      if (!await dialog.confirm(`将用 ${count} 个新商品替换原来的 ${original.productCount} 个商品，并重新生成页面。原商品与页面编辑会先备份到“版本历史”。确认替换？`, "确认替换原项目")) return false;
    }
    submitting.current = true;
    setWorking(true);
    try {
      if (!pendingBody.current) {
        const state = useProjectStore.getState();
        const batch = useBatchStore.getState();
        const staged: CloudProjectSnapshot = structuredClone({
          ...state.getEditorSnapshot(), layoutMode: state.layoutMode,
          batchConfig: batch.generationMode === "batch" ? { generationMode: batch.generationMode, config: batch.config, groups: batch.groups, productOverrides: batch.productOverrides } : undefined,
        });
        setMessage("正在上传新资料，原项目尚未替换…");
        const upload = (file: File, type: Parameters<typeof uploadProjectAsset>[2]) => uploadProjectAsset(original.id, file, type);
        for (const file of sourceFiles.current) {
          if (uploadedFiles.current.has(file)) continue;
          await upload(file, "source_file");
          uploadedFiles.current.add(file);
        }
        const snapshot = await materializeSnapshot(staged, upload, imageCache.current);
        pendingBody.current = JSON.stringify({ requestId: crypto.randomUUID(), expectedRevision: original.revision, snapshot });
      }
      setMessage("正在自动备份并替换项目…");
      const response = await pptFetch(`/api/projects/${original.id}/reimport`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: pendingBody.current,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        // A definitive rejection rolls back the transaction. A gateway/server
        // failure may hide a successful commit, so keep the same request to retry.
        if (response.status < 500) { pendingBody.current = undefined; setUncertain(false); }
        throw new Error(payload.error || "替换结果未确认，请重试或返回项目查看");
      }
      returnToProject();
      return false;
    } catch (error) {
      setUncertain(Boolean(pendingBody.current));
      setMessage(pendingBody.current
        ? "提交结果尚未确认。请重试同一次提交，或返回项目查看；不会重复替换或重复备份。"
        : "本次未替换原项目，请检查资料或网络后重试。");
      throw error;
    } finally {
      submitting.current = false;
      setWorking(false);
    }
  };

  if (!ready) return <div className="project-editor-loading">正在准备暂存区…</div>;
  return <section className="reimport-workspace">
    <div className="reimport-notice" role="status">
      <ShieldCheck aria-hidden="true" />
      <div><strong>重新导入 · 原项目已保留</strong><p>{message || `正在暂存新资料，原来的 ${original.productCount} 个商品和页面编辑不会自动覆盖。确认替换前会自动备份；离开此页将丢弃暂存资料。`}</p></div>
      <button type="button" onClick={() => void cancel()} disabled={working}><ArrowLeft aria-hidden="true" />{uncertain ? "返回项目查看" : "取消重新导入"}</button>
      {uncertain && <button type="button" disabled={working} onClick={() => void confirmReplacement().catch((error) => dialog.notify(error.message, "error"))}>重试本次提交</button>}
    </div>
    <div inert={working || uncertain}>
      <CatalogWorkflow cloudMode reimportMode onStageSourceFiles={(files) => { sourceFiles.current = files; }} onConfirmGeneration={confirmReplacement} />
    </div>
  </section>;
}
