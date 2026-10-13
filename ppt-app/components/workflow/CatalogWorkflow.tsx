"use client";

import { useEffect } from "react";
import Link from "next/link";
import { FileSpreadsheet, Presentation, RotateCcw } from "lucide-react";
import { CatalogStudio } from "@/components/studio/CatalogStudio";
import { getProjectCategories } from "@/src/lib/catalog/categories";
import { useProjectStore } from "@/src/store/projectStore";
import { ConfirmStep } from "./ConfirmStep";
import { BatchDashboard } from "./BatchDashboard";
import { MappingStep } from "./MappingStep";
import { UploadStep } from "./UploadStep";
import { WorkflowStepper } from "./WorkflowStepper";
import { snapshotForBatchEditor, useBatchStore } from "@/src/store/batchStore";
import { emptyEditorState } from "@/types/editor";
import { useCloudProject } from "@/components/cloud/CloudProjectContext";

export function CatalogWorkflow({
  layoutDebug = false,
  cloudMode = false,
  onConfirmGeneration,
  onSaveProject,
  onStageSourceFiles,
  stagedFiles,
  pendingSaveState,
  pendingSaveMessage,
  reimportMode = false,
}: {
  layoutDebug?: boolean;
  cloudMode?: boolean;
  onConfirmGeneration?: () => Promise<void | boolean>;
  onSaveProject?: () => Promise<void>;
  onStageSourceFiles?: (files: File[]) => void;
  stagedFiles?: File[];
  pendingSaveState?: "saved" | "saving" | "error" | "dirty";
  pendingSaveMessage?: string;
  reimportMode?: boolean;
}) {
  const cloud = useCloudProject();
  const step = useProjectStore((state) => state.step);
  const project = useProjectStore((state) => state.project);
  const products = useProjectStore((state) => state.products);
  const setStep = useProjectStore((state) => state.setStep);
  const resetImport = useProjectStore((state) => state.resetImport);
  const hydrateEditor = useProjectStore((state) => state.hydrateEditor);
  const categories = getProjectCategories(products);
  const generationMode = useBatchStore((state) => state.generationMode);
  const activeGroupId = useBatchStore((state) => state.activeGroupId);

  const openBatchGroup = (id: string) => {
    const batch = useBatchStore.getState();
    const resolved = batch.getResolvedGroup(id);
    if (!resolved) return;
    batch.setActiveGroup(id);
    useProjectStore.getState().loadEditorSnapshot(snapshotForBatchEditor(resolved.project, resolved.products, resolved.group.editorSession), "preview");
  };

  const returnToBatch = () => {
    const batch = useBatchStore.getState();
    if (activeGroupId) batch.saveEditorSession(activeGroupId, useProjectStore.getState().getEditorSnapshot());
    batch.setActiveGroup(undefined);
    if (batch.baseProject) useProjectStore.getState().loadEditorSnapshot({ project: batch.baseProject, products: batch.baseProducts, layoutOverrides: {}, editorState: emptyEditorState() }, "batch");
    else setStep("batch");
  };

  const returnBatchToConfirm = () => {
    const batch = useBatchStore.getState();
    if (batch.baseProject) useProjectStore.getState().loadEditorSnapshot({ project: batch.baseProject, products: batch.baseProducts, layoutOverrides: {}, editorState: emptyEditorState() }, "confirm");
    else setStep("confirm");
  };

  const resetAll = () => {
    if (cloud) { void cloud.openReimport(); return; }
    useBatchStore.getState().resetBatch();
    resetImport();
  };

  const previewBack = cloudMode
    ? undefined
    : generationMode === "batch" && activeGroupId
      ? returnToBatch
      : () => setStep("confirm");

  useEffect(() => {
    if (!cloudMode) hydrateEditor();
  }, [hydrateEditor, cloudMode]);

  return (
    <main className="catalog-workflow-shell">
      {step !== "preview" && <header className="workflow-topbar">
        {cloudMode ? <Link className="workflow-brand" href="/projects"><span><Presentation aria-hidden="true" /></span><div><strong>灵绘</strong><small>PPT 项目工作台</small></div></Link> : <div className="workflow-brand"><span><Presentation aria-hidden="true" /></span><div><strong>灵绘</strong><small>PPT 创作工作台</small></div></div>}
        <WorkflowStepper current={step} batchMode={generationMode === "batch"} />
        <div className="workflow-topbar-actions">
          <span><FileSpreadsheet aria-hidden="true" />{products.length ? `${products.length} 项商品` : "等待导入"}</span>
          {step !== "upload" && <button type="button" onClick={resetAll}><RotateCcw aria-hidden="true" />重新导入</button>}
        </div>
      </header>}

      {step === "upload" && <UploadStep onStageSourceFiles={onStageSourceFiles} stagedFiles={stagedFiles} />}
      {step === "mapping" && <MappingStep />}
      {step === "confirm" && <ConfirmStep onConfirmGeneration={onConfirmGeneration} reimportMode={reimportMode} pendingSaveMessage={pendingSaveMessage} />}
      {step === "batch" && <BatchDashboard onBack={returnBatchToConfirm} onOpenGroup={openBatchGroup} />}
      {step === "preview" && <CatalogStudio embedded meta={project} products={products} categories={categories} onBack={previewBack} onReimport={resetAll} backLabel={generationMode === "batch" && activeGroupId ? "返回批量项目" : "返回数据确认"} layoutDebug={layoutDebug} onSaveProject={onSaveProject} pendingSaveState={pendingSaveState} pendingSaveMessage={pendingSaveMessage} />}
    </main>
  );
}
