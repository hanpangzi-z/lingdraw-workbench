"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  Eye,
  FolderOpen,
  History,
  Layers3,
  LayoutGrid,
  LockKeyhole,
  LoaderCircle,
  MonitorUp,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  Pencil,
  Presentation,
  Plus,
  Redo2,
  Sparkles,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { catalogMeta, productCategories } from "@/data/catalog";
import type { CatalogMeta, CatalogSlide, Product, ProductCategory } from "@/types/catalog";
import { BusinessRedSlide } from "@/components/templates/business-red/BusinessRedSlide";
import { createSlidePlan } from "@/src/lib/layout/createSlidePlan";
import { DENSITY_LABELS, LAYOUT_LABELS } from "@/src/lib/layout/layoutRules";
import type { LayoutMode, ProductLayoutType } from "@/src/lib/layout/types";
import { useProjectStore } from "@/src/store/projectStore";
import { getTemplate, resolveTemplateLayoutMode } from "@/src/templates/registry";
import { DesignPanel } from "./DesignPanel";
import { TemplateGallery } from "./TemplateGallery";
import { EditorInspector } from "./EditorInspector";
import { FreeformCanvas, type AiImageGenerationRequest, type AiImageGenerationState } from "./FreeformCanvas";
import { CanvasTopToolbar } from "./CanvasTopToolbar";
import { createFinalPresentationModel, hasSlideCustomizations } from "@/src/lib/editor/createFinalPresentationModel";
import {
  CANVAS_VIEWPORT_ZOOM_LEVELS,
  resolveCanvasTransform,
  stepCanvasViewportZoom,
  type CanvasViewportZoom,
} from "@/src/lib/editor/canvas";
import type { CanvasElementOverride, EditorSelection, ManualSlideType } from "@/types/editor";
import { useCloudProject } from "@/components/cloud/CloudProjectContext";
import { withInferredPriceTier } from "@/src/lib/catalog/project";
import { getProductImages } from "@/src/lib/catalog/images";
import { selectImageReferences } from "@/src/lib/ai/imageScenePrompts";
import { clampSlideIndex } from "@/src/lib/editor/slideSelection";
import { defaultCanvasImageOverride } from "@/src/lib/editor/image";
import { useImageJobs, type PendingImageJob } from "./useImageJobs";
import { useStudioDialog } from "@/components/host/StudioDialogProvider";
import { shouldRenderThumbnailImmediately } from "@/src/lib/editor/thumbnailWindow";
import { resolveTheme } from "@/src/themes/registry";
import { requireSaved } from "@/src/lib/cloud/saveResult";
import { getProjectCategories } from "@/src/lib/catalog/categories";

type ExportStatus = "idle" | "generating" | "success" | "warning" | "error";
const EMPTY_AI_IMAGE_GENERATION_STATES: Record<string, AiImageGenerationState> = {};

interface CatalogStudioProps {
  meta?: CatalogMeta;
  products?: Product[];
  categories?: ProductCategory[];
  embedded?: boolean;
  onBack?: () => void;
  onReimport?: () => void;
  backLabel?: string;
  layoutDebug?: boolean;
  onSaveProject?: () => Promise<void>;
  pendingSaveState?: "saved" | "saving" | "error" | "dirty";
  pendingSaveMessage?: string;
}

const slideTitle: Record<CatalogSlide["kind"], string> = {
  cover: "档位分隔页",
  "category-overview": "产品分类总览",
  products: "商品明细",
  delivery: "配送区域说明",
  end: "结束页",
  manual: "手动页面",
};

function getSlideTitle(slide: CatalogSlide) {
  if (slide.kind === "cover" && slide.tierName) return `${slide.tierName}分隔页`;
  if (slide.kind === "products") return `${slideTitle[slide.kind]} ${slide.sectionPage}`;
  return slideTitle[slide.kind];
}

function DeferredThumbnailPreview({ eager, children }: { eager: boolean; children: React.ReactNode }) {
  const shellRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(eager);

  useEffect(() => {
    if (eager) {
      setVisible(true);
      return;
    }
    const shell = shellRef.current;
    if (!shell || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const scrollRoot = shell.closest(".thumbnail-list");
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      {
        root: scrollRoot instanceof HTMLElement ? scrollRoot : null,
        rootMargin: "480px 0px",
      },
    );
    observer.observe(shell);
    return () => observer.disconnect();
  }, [eager]);

  return (
    <span ref={shellRef} className="thumbnail-shell">
      {visible ? children : <span className="thumbnail-placeholder" aria-hidden="true" />}
    </span>
  );
}

export function CatalogStudio({
  meta = catalogMeta,
  products = [],
  categories = productCategories,
  embedded = false,
  onBack,
  onReimport,
  backLabel = "返回数据确认",
  layoutDebug = false,
  onSaveProject,
  pendingSaveState,
  pendingSaveMessage,
}: CatalogStudioProps) {
  const cloud = useCloudProject();
  const dialog = useStudioDialog();
  const layoutMode = useProjectStore((state) => state.layoutMode);
  const layoutOverrides = useProjectStore((state) => state.layoutOverrides);
  const layoutRevision = useProjectStore((state) => state.layoutRevision);
  const setLayoutMode = useProjectStore((state) => state.setLayoutMode);
  const setPageLayoutOverride = useProjectStore((state) => state.setPageLayoutOverride);
  const regenerateSmartLayout = useProjectStore((state) => state.regenerateSmartLayout);
  const editorState = useProjectStore((state) => state.editorState);
  const editorPast = useProjectStore((state) => state.editorPast);
  const editorFuture = useProjectStore((state) => state.editorFuture);
  const saveStatus = useProjectStore((state) => state.saveStatus);
  const initializeEditor = useProjectStore((state) => state.initializeEditor);
  const persistEditor = useProjectStore((state) => state.persistEditor);
  const undoEditor = useProjectStore((state) => state.undoEditor);
  const redoEditor = useProjectStore((state) => state.redoEditor);
  const editorUpdateProduct = useProjectStore((state) => state.editorUpdateProduct);
  const updateSlideEdit = useProjectStore((state) => state.updateSlideEdit);
  const setCanvasElementOverride = useProjectStore((state) => state.setCanvasElementOverride);
  const resetCanvasElementOverride = useProjectStore((state) => state.resetCanvasElementOverride);
  const setPriceZonesVisibility = useProjectStore((state) => state.setPriceZonesVisibility);
  const addManualSlide = useProjectStore((state) => state.addManualSlide);
  const hideSlide = useProjectStore((state) => state.hideSlide);
  const restoreAutoSlides = useProjectStore((state) => state.restoreAutoSlides);
  const moveSlide = useProjectStore((state) => state.moveSlide);
  const setSlideOrder = useProjectStore((state) => state.setSlideOrder);
  const restoreInitialSnapshot = useProjectStore((state) => state.restoreInitialSnapshot);
  const editorSetTemplate = useProjectStore((state) => state.editorSetTemplate);
  const editorSetTheme = useProjectStore((state) => state.editorSetTheme);
  const editorUpdateDesign = useProjectStore((state) => state.editorUpdateDesign);
  const editorUpdateThemeOverrides = useProjectStore((state) => state.editorUpdateThemeOverrides);
  const editorResetDesign = useProjectStore((state) => state.editorResetDesign);
  const resolvedMeta = useMemo(() => withInferredPriceTier(meta, products), [meta, products]);
  const template = getTemplate(resolvedMeta.design.templateId);
  const resolvedTheme = resolveTheme(
    resolvedMeta.design.themeId,
    resolvedMeta.design.themeOverrides,
    resolvedMeta.design.brandColor,
  );
  const effectiveLayoutMode = resolveTemplateLayoutMode(resolvedMeta.design.templateId, layoutMode);
  const slidePlans = useMemo(
    () => createSlidePlan(products, { mode: effectiveLayoutMode, overrides: layoutOverrides }),
    [products, effectiveLayoutMode, layoutOverrides, layoutRevision],
  );
  const presentationModel = useMemo(() => createFinalPresentationModel({ project: resolvedMeta, products, categories, slidePlans, editorState }), [resolvedMeta, products, categories, slidePlans, editorState]);
  const slides = presentationModel.slides;
  const productSlideIds = useMemo(
    () => slides.filter((slide) => slide.kind === "products").map((slide) => slide.id),
    [slides],
  );
  const allPriceZonesHidden =
    productSlideIds.length > 0 &&
    productSlideIds.every((slideId) => {
      const hidden = editorState.slides[slideId]?.hiddenSections ?? [];
      return hidden.includes("marketPrice") && hidden.includes("salePrice");
    });
  const [requestedSelectedIndex, setSelectedIndex] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [exportMessages, setExportMessages] = useState<string[]>([]);
  const exportRunning = useRef(false);
  const [inspectorTab, setInspectorTab] = useState<"edit" | "layout" | "design">("edit");
  const [templateGalleryOpen, setTemplateGalleryOpen] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [zoom, setZoom] = useState<CanvasViewportZoom>("fit");
  const [selection, setSelection] = useState<EditorSelection>();
  const [dragSlideId, setDragSlideId] = useState<string>();
  const [newSlideType, setNewSlideType] = useState<ManualSlideType>("text");
  const thumbnailRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const previewStageRef = useRef<HTMLDivElement>(null);
  const lastWheelZoomAtRef = useRef(0);
  const selectedIndex = clampSlideIndex(requestedSelectedIndex, slides.length);
  const selectedSlide = slides[selectedIndex];
  const storedSelectedCanvasOverride = selection?.type === "element"
    ? editorState.slides[selection.slideId]?.elementOverrides?.[selection.elementId]
    : undefined;
  const selectedCanvasOverride =
    selection?.type === "element" && /^product\..+\.prices$/.test(selection.elementId)
      ? {
          id: selection.elementId,
          type: selection.elementType,
          label: selection.label,
          ...storedSelectedCanvasOverride,
          hidden: allPriceZonesHidden,
        }
      : storedSelectedCanvasOverride;
  const aiImageContext = useMemo(() => {
    if (selection?.type !== "element" || selection.elementType !== "image" || selectedSlide?.kind !== "products") return undefined;
    const match = selection.elementId.match(/^product\.(.+)\.image$/);
    const product = match ? selectedSlide.products.find((item) => item.id === match[1]) : undefined;
    if (!product) return undefined;
    return {
      productName: product.name,
      referenceImages: selectImageReferences([product.image, ...getProductImages(product)]),
      projectId: cloud?.projectId,
    };
  }, [selection, selectedSlide, cloud?.projectId]);
  const layoutStats = useMemo(() => slidePlans.reduce<Record<string, number>>((counts, plan) => {
    counts[plan.type] = (counts[plan.type] ?? 0) + 1;
    return counts;
  }, {}), [slidePlans]);

  const patchCanvasElement = useCallback(
    (slideId: string, elementId: string, patch: Partial<CanvasElementOverride>) => {
      if (/^product\..+\.prices$/.test(elementId) && patch.hidden !== undefined) {
        setPriceZonesVisibility(productSlideIds, !patch.hidden);
        return;
      }
      setCanvasElementOverride(slideId, elementId, patch);
    },
    [productSlideIds, setCanvasElementOverride, setPriceZonesVisibility],
  );

  const saveNow = useCallback(async () => {
    if (cloud) {
      const result = await cloud.saveNow();
      if (!result.ok) dialog.notify(result.message, "error");
    }
    else if (onSaveProject) await onSaveProject();
    else persistEditor();
  }, [cloud, onSaveProject, persistEditor, dialog]);

  const handleExport = async () => {
    if (exportRunning.current) return;
    exportRunning.current = true;
    setExportStatus("generating");
    setExportMessages([]);

    try {
      if (onSaveProject) await onSaveProject();
      const receipt = cloud ? requireSaved(await cloud.saveNow()) : undefined;
      const ppt = await import("@/src/lib/ppt/generatePpt");
      const frozen = receipt?.snapshot;
      const input = frozen ? {
        meta: frozen.project, products: frozen.products, categories: getProjectCategories(frozen.products),
        slidePlans: createSlidePlan(frozen.products, { mode: resolveTemplateLayoutMode(frozen.project.design.templateId, frozen.layoutMode), overrides: frozen.layoutOverrides }),
        editorState: frozen.editorState,
      } : structuredClone({ meta: resolvedMeta, products, categories, slidePlans, editorState, presentationModel });
      const result = cloud ? await ppt.generatePptBlob(input) : await ppt.generatePpt(input);
      const messages = [...result.warnings];
      if (cloud) {
        const blobResult = result as Awaited<ReturnType<typeof ppt.generatePptBlob>>;
        ppt.downloadPptBlob(blobResult.blob, blobResult.fileName);
        try {
          await cloud.saveExport(new File([blobResult.blob], blobResult.fileName, { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), blobResult.slideCount, receipt!);
        } catch (error) {
          messages.push(`已下载，但云端归档失败：${error instanceof Error ? error.message : "请重试"}`);
        }
      }
      setExportMessages(messages);
      setExportStatus(messages.length ? "warning" : "success");
    } catch (error) {
      console.error("[PPT] 导出失败", error);
      setExportStatus("error");
      setExportMessages([error instanceof Error ? error.message : "导出失败，请重试"]);
    } finally { exportRunning.current = false; }
  };

  const imageJobs = useImageJobs(cloud?.projectId, async (job: PendingImageJob, result, automatic) => {
    if (job.projectId !== cloud?.projectId) return false;
    const targetSlide = slides.find(slide => slide.id === job.slideId);
    const targetProduct = targetSlide?.kind === "products" ? targetSlide.products.find(product => `product.${product.id}.image` === job.elementId) : undefined;
    if (!targetProduct) { if (!automatic) dialog.notify("原图片位置已删除，生成结果仍保留。", "error"); return false; }
    const latestOverride = useProjectStore.getState().editorState.slides[job.slideId]?.elementOverrides?.[job.elementId];
    if (automatic && (latestOverride?.image?.source || targetProduct.image) !== job.originalSource) return false;
    setCanvasElementOverride(job.slideId, job.elementId, {
      image: { ...defaultCanvasImageOverride(), ...latestOverride?.image, source: result.imageUrl },
      type: "image", label: job.label,
    });
    if (cloud) { const saved = await cloud.saveNow(); if (!saved.ok) { dialog.notify("图片已应用，但保存未完成；任务结果仍保留，请保存后再取回。", "error"); return false; } }
    return true;
  });
  const aiImageGenerationStatesBySlide = useMemo(() => {
    const grouped: Record<string, Record<string, AiImageGenerationState>> = {};
    for (const [key, state] of Object.entries(imageJobs.jobs)) {
      const separator = key.indexOf("::");
      if (separator < 0) continue;
      const slideId = key.slice(0, separator);
      const elementId = key.slice(separator + 2);
      grouped[slideId] = { ...grouped[slideId], [elementId]: state };
    }
    return grouped;
  }, [imageJobs.jobs]);
  const imageGenerationStatesForSlide = (slideId: string) => aiImageGenerationStatesBySlide[slideId] ?? EMPTY_AI_IMAGE_GENERATION_STATES;

  const handleGenerateAiImage = (request: AiImageGenerationRequest) => {
    const targetSlide = slides.find(slide => slide.id === request.slideId);
    const product = targetSlide?.kind === "products" ? targetSlide.products.find(item => `product.${item.id}.image` === request.elementId) : undefined;
    const originalSource = useProjectStore.getState().editorState.slides[request.slideId]?.elementOverrides?.[request.elementId]?.image?.source || product?.image;
    imageJobs.start(request, originalSource);
  };

  const selectSlide = (index: number) => {
    const nextIndex = clampSlideIndex(index, slides.length);
    setSelectedIndex(nextIndex);
    const nextSlide = slides[nextIndex];
    if (nextSlide) setSelection({ type: "page", slideId: nextSlide.id });
    if (window.innerWidth <= 760) setSidebarOpen(false);
  };

  useEffect(() => {
    if (window.innerWidth <= 760) setSidebarOpen(false);
    initializeEditor();
  }, []);

  useEffect(() => {
    if (cloud || onSaveProject || saveStatus !== "saving") return;
    const timer = window.setTimeout(persistEditor, 650);
    return () => window.clearTimeout(timer);
  }, [saveStatus, persistEditor, resolvedMeta, products, editorState, cloud, onSaveProject]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoEditor();
        else undoEditor();
        return;
      }
      if (command && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveNow();
        return;
      }
      if (event.key === "Escape") {
        setSelection(selectedSlide ? { type: "page", slideId: selectedSlide.id } : undefined);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selection?.type === "element") {
        event.preventDefault();
        patchCanvasElement(selection.slideId, selection.elementId, { hidden: true });
        return;
      }
      if (event.key === "Delete" && selection?.type === "page" && selectedSlide) {
        event.preventDefault();
        const slideId = selectedSlide.id;
        void dialog.confirm("隐藏当前页面？商品数据不会被删除。").then((confirmed) => confirmed && hideSlide(slideId));
        return;
      }
      if (mode === "edit" && selection?.type === "element" && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const current = useProjectStore.getState().editorState.slides[selection.slideId]?.elementOverrides?.[selection.elementId];
        const transform = resolveCanvasTransform(current);
        const step = event.shiftKey ? 1 : 0.25;
        if (event.key === "ArrowLeft") transform.x -= step;
        if (event.key === "ArrowRight") transform.x += step;
        if (event.key === "ArrowUp") transform.y -= step;
        if (event.key === "ArrowDown") transform.y += step;
        setCanvasElementOverride(selection.slideId, selection.elementId, { transform });
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((current) => clampSlideIndex(current - 1, slides.length));
      }
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((current) => clampSlideIndex(current + 1, slides.length));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [slides.length, selectedSlide, selection, mode, undoEditor, redoEditor, hideSlide, setCanvasElementOverride, patchCanvasElement, dialog, saveNow]);

  useEffect(() => {
    thumbnailRefs.current[selectedIndex]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedIndex]);

  useEffect(() => {
    setSelectedIndex((current) => clampSlideIndex(current, slides.length));
  }, [slides.length]);

  useEffect(() => {
    if (selectedSlide && selection?.slideId !== selectedSlide.id) setSelection({ type: "page", slideId: selectedSlide.id });
  }, [selectedSlide?.id]);

  useEffect(() => {
    const stage = previewStageRef.current;
    if (!stage) return;

    const handleWheelZoom = (event: WheelEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".main-slide-shell")) return;
      if (target.closest("input, textarea, select, [contenteditable='true'], .ai-image-dialog-backdrop")) return;
      if (!event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

      event.preventDefault();
      const now = performance.now();
      if (lastWheelZoomAtRef.current && now - lastWheelZoomAtRef.current < 160) return;
      lastWheelZoomAtRef.current = now;
      const direction = event.deltaY < 0 ? "in" : "out";
      setZoom((current) => stepCanvasViewportZoom(current, direction));
    };

    stage.addEventListener("wheel", handleWheelZoom, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheelZoom);
  }, []);

  const addPage = () => {
    if (!selectedSlide) return;
    const id = addManualSlide(newSlideType, { title: newSlideType === "title" ? "新标题页" : undefined }, selectedSlide.id, slides.map((slide) => slide.id));
    window.setTimeout(() => {
      const index = useProjectStore.getState().editorState.slideOrder.indexOf(id);
      if (index >= 0) selectSlide(index);
    }, 0);
  };

  const duplicateCurrentSlide = () => {
    if (!selectedSlide) return;
    const manual = editorState.manualSlides[selectedSlide.id];
    const type: ManualSlideType = manual?.type ?? (selectedSlide.kind === "products" ? "product" : selectedSlide.kind === "end" ? "ending" : "text");
    const data = manual?.data ?? {
      title: selectedSlide.editor?.customTitle || slideTitle[selectedSlide.kind],
      productIds: selectedSlide.kind === "products" ? selectedSlide.products.map((product) => product.id) : undefined,
    };
    addManualSlide(type, data, selectedSlide.id, slides.map((slide) => slide.id));
  };

  const reorderByDrop = (targetId: string) => {
    if (!dragSlideId || dragSlideId === targetId) return;
    const order = slides.map((slide) => slide.id);
    const from = order.indexOf(dragSlideId);
    const to = order.indexOf(targetId);
    if (from < 0 || to < 0) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    setSlideOrder(order);
    setDragSlideId(undefined);
  };

  if (!selectedSlide) {
    return (
      <main className={`studio-shell ${embedded ? "is-embedded" : ""}`}>
        <section className="preview-workspace" aria-label="PPT 页面预览">
          <div className="layout-inspector-empty" role="status">
            <TriangleAlert aria-hidden="true" />
            <strong>暂无可预览页面</strong>
            <p>请返回数据确认后重新生成页面。</p>
            {onBack && <button type="button" onClick={onBack}><ArrowLeft aria-hidden="true" />{backLabel}</button>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`studio-shell ${embedded ? "is-embedded" : ""}`}>
      <header className="studio-header">
        <a className="studio-brand" href="/ppt/projects" aria-label="返回PPT工作台首页">
          <div className="studio-logo"><Presentation aria-hidden="true" /></div>
          <div>
            <strong>灵绘</strong>
            <span>PPT 智能编辑器</span>
          </div>
        </a>

        <div className="document-title">
          <span className={`save-dot is-${cloud?.saveState ?? pendingSaveState ?? saveStatus}`} />
          <strong>{resolvedMeta.year} {resolvedMeta.projectName}产品手册</strong>
          <span>{cloud?.saveMessage ?? pendingSaveMessage ?? (saveStatus === "saving" ? "保存中..." : saveStatus === "error" ? "保存失败" : "已保存")}</span>
        </div>

        <div className="studio-actions">
          {onBack && <button className="preview-back-button" type="button" onClick={onBack}><ArrowLeft aria-hidden="true" />{backLabel}</button>}
          <div className="history-actions" aria-label="编辑历史">
            <button type="button" disabled={!editorPast.length} onClick={undoEditor} title="撤销 Cmd/Ctrl+Z" aria-label="撤销"><Undo2 aria-hidden="true" /></button>
            <button type="button" disabled={!editorFuture.length} onClick={redoEditor} title="重做 Cmd/Ctrl+Shift+Z" aria-label="重做"><Redo2 aria-hidden="true" /></button>
          </div>
          {cloud && <div className="cloud-project-actions" aria-label="云端项目操作"><button type="button" onClick={cloud.openProductSync} title="商品库更新" aria-label="商品库更新"><RefreshCw aria-hidden="true" /></button><button type="button" onClick={cloud.openFiles} title="项目文件" aria-label="项目文件"><FolderOpen aria-hidden="true" /></button><button type="button" onClick={cloud.openVersions} title="版本历史" aria-label="版本历史"><History aria-hidden="true" /></button></div>}
          <button className={`mode-toggle ${mode === "edit" ? "is-preview" : ""}`} type="button" onClick={() => setMode((current) => current === "edit" ? "preview" : "edit")}>
            {mode === "edit" ? <Eye aria-hidden="true" /> : <Pencil aria-hidden="true" />}{mode === "edit" ? "退出编辑" : "编辑"}
          </button>
          {mode === "edit" && <button className="save-now-button is-emphasized" type="button" onClick={() => void saveNow()} title="保存 Cmd/Ctrl+S"><Save aria-hidden="true" /><span>保存</span></button>}
          <button className="template-selector" type="button" onClick={() => setTemplateGalleryOpen(true)} title="打开模板图库">
            <Layers3 aria-hidden="true" />
            <span>{template.name}</span>
            <ChevronDown aria-hidden="true" />
          </button>
          {onReimport && <button className="studio-reimport-button" type="button" onClick={onReimport}><RotateCcw aria-hidden="true" /><span>重新导入</span></button>}
          <div className="export-action-wrap">
            <button
              className={`export-button export-${exportStatus}`}
              type="button"
              disabled={exportStatus === "generating"}
              onClick={handleExport}
              title="下载可继续编辑的 PowerPoint 文件"
            >
              {exportStatus === "generating" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Download aria-hidden="true" />}
              {exportStatus === "generating" ? "正在生成" : "导出 PPT"}
            </button>
            {exportStatus !== "idle" && (
              <div className={`export-status export-status-${exportStatus}`} role="status" aria-live="polite">
                {exportStatus === "generating" && <><LoaderCircle className="is-spinning" aria-hidden="true" />正在生成 PPT...</>}
                {exportStatus === "success" && <><CheckCircle2 aria-hidden="true" />生成完成</>}
                {exportStatus === "warning" && <><TriangleAlert aria-hidden="true" />导出有警告，请检查图片和归档结果</>}
                {exportStatus === "error" && <><TriangleAlert aria-hidden="true" />导出失败，请重试</>}
                {exportMessages.length > 0 && <details open><summary>查看问题（{exportMessages.length}）</summary><ul>{exportMessages.map((message, index) => <li key={index}>{message}</li>)}</ul><button type="button" onClick={() => void handleExport()}>重试导出</button></details>}
              </div>
            )}
          </div>
        </div>
      </header>
      {(imageJobs.storageError || Object.keys(imageJobs.jobs).length > 0) && <section className="ppt-image-jobs" aria-label="绘图任务">
        {imageJobs.storageError && <p role="alert">{imageJobs.storageError}</p>}
        {Object.values(imageJobs.jobs).map(job => <div key={job.jobId}>
          <span><strong>{job.label}</strong> · {job.message || job.error || "任务已保留"}{job.elapsedSeconds !== undefined && ` · 已用时 ${job.elapsedSeconds} 秒`}</span>
          {job.status === "waiting" && <button type="button" onClick={() => imageJobs.resume(job)}>继续查询（不重新生成）</button>}
          {job.status === "ready" && <button type="button" onClick={() => void imageJobs.applyResult(job).catch(() => dialog.notify("结果应用失败，任务已保留", "error"))}>应用生成结果</button>}
          {job.status === "error" && <button type="button" onClick={() => imageJobs.remove(job)}>确认失败，允许重新生成</button>}
        </div>)}
      </section>}

      <div className={`studio-body has-layout-inspector editor-mode-${mode} ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
        <aside className="thumbnail-sidebar" aria-label="页面缩略图导航">
          <div className="sidebar-heading">
            <div>
              <span>页面</span>
              <strong>{slides.length}</strong>
            </div>
            <button type="button" onClick={() => setSidebarOpen(false)} aria-label="收起缩略图导航">
              <PanelLeftClose aria-hidden="true" />
            </button>
          </div>

          <div className="thumbnail-page-actions">
            <select value={newSlideType} onChange={(event) => setNewSlideType(event.target.value as ManualSlideType)} aria-label="新增页面类型"><option value="title">标题页</option><option value="text">文字说明页</option><option value="product">商品页</option><option value="category">分类页</option><option value="ending">结束页</option></select>
            <button type="button" onClick={addPage}><Plus aria-hidden="true" />新增页面</button>
          </div>

          <nav className="thumbnail-list">
            {slides.map((slide, index) => (
              <button
                ref={(element) => { thumbnailRefs.current[index] = element; }}
                type="button"
                className={`thumbnail-item ${selectedIndex === index ? "is-active" : ""}`}
                key={slide.id}
                draggable={mode === "edit"}
                onDragStart={() => setDragSlideId(slide.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => reorderByDrop(slide.id)}
                onClick={() => selectSlide(index)}
                aria-current={selectedIndex === index ? "page" : undefined}
                aria-label={`第 ${slide.pageNumber} 页，${getSlideTitle(slide)}`}
              >
                <span className="thumbnail-number">{String(slide.pageNumber).padStart(2, "0")}</span>
                {hasSlideCustomizations(editorState, slide.id) && <span className="thumbnail-custom-dot" title="本页已自定义">●</span>}
                <DeferredThumbnailPreview eager={shouldRenderThumbnailImmediately(index, selectedIndex)}>
                  <span className="slide-frame">
                    <FreeformCanvas slideId={slide.id} editState={slide.editor} editable={false} onSelect={() => undefined} onPatch={() => undefined} onReset={() => undefined} aiImageGenerationStates={imageGenerationStatesForSlide(slide.id)}>
                      <BusinessRedSlide slide={slide} meta={resolvedMeta} products={products} categories={categories} totalSlides={slides.length} debug={layoutDebug} />
                    </FreeformCanvas>
                  </span>
                </DeferredThumbnailPreview>
                <span className="thumbnail-name">{getSlideTitle(slide)}</span>
              </button>
            ))}
          </nav>
          <div className="thumbnail-footer-actions">
            <button type="button" onClick={duplicateCurrentSlide} disabled={!selectedSlide}><Copy aria-hidden="true" />复制</button>
            <button type="button" onClick={() => selectedSlide && moveSlide(selectedSlide.id, -1, slides.map((slide) => slide.id))} disabled={selectedIndex === 0}>上移</button>
            <button type="button" onClick={() => selectedSlide && moveSlide(selectedSlide.id, 1, slides.map((slide) => slide.id))} disabled={selectedIndex >= slides.length - 1}>下移</button>
            <button type="button" onClick={() => { if (!selectedSlide) return; const slideId = selectedSlide.id; void dialog.confirm("隐藏当前页面？商品数据不会被删除。").then((confirmed) => confirmed && hideSlide(slideId)); }} disabled={!selectedSlide}><Trash2 aria-hidden="true" />删除</button>
            <button type="button" onClick={restoreAutoSlides}><RotateCcw aria-hidden="true" />恢复页面</button>
          </div>
        </aside>

        {!sidebarOpen && (
          <button className="sidebar-open-button" type="button" onClick={() => setSidebarOpen(true)} aria-label="展开缩略图导航">
            <PanelLeftOpen aria-hidden="true" />
          </button>
        )}

        <section className="preview-workspace" aria-label="PPT 页面预览">
          <div className="preview-meta">
            <div>
              <MonitorUp aria-hidden="true" />
              <span>{mode === "edit" ? "编辑模式" : "最终预览"}</span>
              <i />
              <span>16:9 · {zoom === "fit" ? "适应窗口" : `${zoom}%`}</span>
            </div>
            <div className="preview-page-count">
              <strong>{String(selectedIndex + 1).padStart(2, "0")}</strong>
              <span>/ {String(slides.length).padStart(2, "0")}</span>
            </div>
          </div>

          {mode === "edit" && <CanvasTopToolbar
            selection={selection}
            override={selectedCanvasOverride}
            onPatch={(patch: Partial<CanvasElementOverride>) => selection?.type === "element" && patchCanvasElement(selection.slideId, selection.elementId, patch)}
            onReset={() => selection?.type === "element" && resetCanvasElementOverride(selection.slideId, selection.elementId)}
            trailing={<div className="canvas-toolbar-layout">
              <SlidersHorizontal aria-hidden="true" />
              <select value={layoutMode} onChange={(event) => setLayoutMode(event.target.value as LayoutMode)} aria-label="排版模式">
                <option value="smart">智能排版</option>
                <option value="force-grid-3">全部 3 个 / 页</option>
                <option value="force-grid-2">全部 2 个 / 页</option>
                <option value="force-single-image">单品图片版</option>
              </select>
              <button type="button" onClick={regenerateSmartLayout} title="重新智能排版" aria-label="重新智能排版"><RefreshCw aria-hidden="true" /></button>
              <div className="canvas-zoom-control"><button type="button" aria-label="缩小页面" onClick={() => setZoom((value) => stepCanvasViewportZoom(value, "out"))}>−</button><select aria-label="页面缩放" value={zoom} onChange={(event) => setZoom(event.target.value === "fit" ? "fit" : Number(event.target.value))}><option value="fit">适应</option>{CANVAS_VIEWPORT_ZOOM_LEVELS.map((level) => <option value={level} key={level}>{level}%</option>)}</select><button type="button" aria-label="放大页面" onClick={() => setZoom((value) => stepCanvasViewportZoom(value, "in"))}>+</button></div>
            </div>}
          />}

          <div className="preview-stage" ref={previewStageRef}>
            <div className="main-slide-shell" key={selectedSlide.id} style={{ transform: `scale(${zoom === "fit" ? 1 : zoom / 100})` }} title="滚动鼠标滚轮可缩放页面">
              <div className={`slide-frame ${mode === "edit" ? "is-editor-canvas" : ""}`}>
                <FreeformCanvas
                  slideId={selectedSlide.id}
                  editState={selectedSlide.editor}
                  editable={mode === "edit"}
                  selection={mode === "edit" ? selection : undefined}
                  onSelect={setSelection}
                  onPatch={(elementId, patch) => patchCanvasElement(selectedSlide.id, elementId, patch)}
                  onReset={(elementId) => resetCanvasElementOverride(selectedSlide.id, elementId)}
                  aiImageContext={aiImageContext}
                  aiImageGenerationStates={imageGenerationStatesForSlide(selectedSlide.id)}
                  onGenerateAiImage={handleGenerateAiImage}
                >
                  <BusinessRedSlide slide={selectedSlide} meta={resolvedMeta} products={products} categories={categories} totalSlides={slides.length} debug={layoutDebug} />
                </FreeformCanvas>
              </div>
            </div>
          </div>

          <div className="preview-controls">
            <button type="button" onClick={() => selectSlide(selectedIndex - 1)} disabled={selectedIndex === 0} aria-label="上一页">
              <ArrowLeft aria-hidden="true" />
            </button>
            <div>
              <span>{slideTitle[selectedSlide.kind]}</span>
              {selectedSlide.kind === "products" && <small>系列页 {selectedSlide.sectionPage}</small>}
              {hasSlideCustomizations(editorState, selectedSlide.id) && <small>● Custom</small>}
            </div>
            <button type="button" onClick={() => selectSlide(selectedIndex + 1)} disabled={selectedIndex === slides.length - 1} aria-label="下一页">
              <ArrowRight aria-hidden="true" />
            </button>
          </div>
        </section>

        <aside className="layout-inspector" aria-label="布局与设计设置">
          <header className="inspector-heading"><div><strong>{inspectorTab === "edit" ? "属性面板" : inspectorTab === "layout" ? "智能布局" : "设计系统"}</strong><span>{inspectorTab === "edit" ? (selection?.type === "element" ? selection.label : selection?.type === "image" ? "商品图片" : selection && "productId" in selection ? "商品内容" : "当前页面") : inspectorTab === "layout" ? "规则引擎 · 页面结构" : `${template.name} · ${resolvedMeta.design.themeId}`}</span></div></header>
          <nav className="inspector-tabs" aria-label="检查器标签">
            <button className={inspectorTab === "edit" ? "is-active" : ""} type="button" onClick={() => setInspectorTab("edit")}><Pencil aria-hidden="true" />属性</button>
            <button className={inspectorTab === "layout" ? "is-active" : ""} type="button" onClick={() => setInspectorTab("layout")}><LayoutGrid aria-hidden="true" />布局</button>
            <button className={inspectorTab === "design" ? "is-active" : ""} type="button" onClick={() => setInspectorTab("design")}><Palette aria-hidden="true" />设计</button>
          </nav>
          {inspectorTab === "edit" ? <>
            <EditorInspector
              slide={selectedSlide}
              selection={selection}
              categories={categories}
              layoutMode={effectiveLayoutMode}
              productSlideIds={productSlideIds}
              priceAreaColor={resolvedTheme.colors.priceBackground}
            />
            <footer className="editor-snapshot-action"><button type="button" onClick={() => void dialog.confirm("恢复初始生成版本？当前编辑内容将被替换。").then((confirmed) => confirmed && restoreInitialSnapshot())}><RotateCcw aria-hidden="true" />恢复初始生成版本</button></footer>
          </> : inspectorTab === "design" ? (
            <DesignPanel
              project={resolvedMeta}
              onOpenGallery={() => setTemplateGalleryOpen(true)}
              onThemeChange={editorSetTheme}
              onDesignChange={editorUpdateDesign}
              onThemeOverride={editorUpdateThemeOverrides}
              onReset={editorResetDesign}
            />
          ) : <>
            <section className="layout-stat-list">
              {Object.entries(layoutStats).map(([type, count]) => <div key={type}><span>{LAYOUT_LABELS[type as ProductLayoutType]}</span><strong>{count}</strong></div>)}
            </section>
            {selectedSlide?.kind === "products" ? (
            <>
              <section className="layout-page-control">
                <label>当前页版式
                  <select
                    value={selectedSlide.plan.source === "manual" || effectiveLayoutMode !== "smart" ? selectedSlide.plan.type : "auto"}
                    onChange={(event) => setPageLayoutOverride(
                      selectedSlide.plan.productIds[0],
                      event.target.value === "auto" ? undefined : event.target.value as ProductLayoutType,
                    )}
                  >
                    <option value="auto">自动</option>
                    <option value="product-grid-3">三栏商品</option>
                    <option value="product-grid-2">双栏商品</option>
                    <option value="product-feature">单品精选</option>
                    <option value="package-detail">套餐详情</option>
                    <option value="product-image-focus">图片优先</option>
                    <option value="mixed-product">混合编排</option>
                  </select>
                </label>
                <div className={`layout-source is-${selectedSlide.plan.source}`}>
                  {selectedSlide.plan.source === "manual" ? <LockKeyhole aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                  {selectedSlide.plan.source === "manual" ? "手动锁定" : "自动推荐"}
                </div>
              </section>
              <section className="layout-explanation">
                <span>为什么使用这个布局？</span>
                <strong>{LAYOUT_LABELS[selectedSlide.plan.type]}</strong>
                <p>{selectedSlide.plan.reason}</p>
                <div className="layout-score"><span>适配度</span><i><b style={{ width: `${selectedSlide.plan.score}%` }} /></i><strong>{selectedSlide.plan.score}</strong></div>
              </section>
              <section className="layout-density-list">
                {selectedSlide.plan.analyses.map((analysis, index) => (
                  <div key={analysis.productId}><span>{selectedSlide.products[index]?.name}</span><strong>{DENSITY_LABELS[analysis.density]}</strong><small>{analysis.itemCount} 项 · {analysis.itemTextLength} 字</small></div>
                ))}
              </section>
              {selectedSlide.plan.overflow.overflow && <div className="layout-overflow-warning"><TriangleAlert aria-hidden="true" />{selectedSlide.plan.overflow.messages.join("；")}</div>}
            </>
            ) : (
            <div className="layout-inspector-empty"><Sparkles aria-hidden="true" /><strong>选择商品明细页</strong><p>这里会说明自动选版依据，并允许锁定当前页版式。</p></div>
            )}
            {layoutDebug && <footer className="layout-debug-status">SHOW_LAYOUT_DEBUG 已开启</footer>}
          </>}
        </aside>
      </div>
      {templateGalleryOpen && (
        <TemplateGallery
          meta={resolvedMeta}
          categories={categories}
          onApply={editorSetTemplate}
          onClose={() => setTemplateGalleryOpen(false)}
        />
      )}
    </main>
  );
}
