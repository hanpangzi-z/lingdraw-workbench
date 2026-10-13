"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  EyeOff,
  Image as ImageIcon,
  ImagePlus,
  Italic,
  Lock,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  Type,
  Unlock,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  canvasTransformCss,
  mergeCanvasElementOverride,
  moveCanvasTransform,
  resizeCanvasTransform,
  resolveCanvasTransform,
} from "@/src/lib/editor/canvas";
import { defaultCanvasImageOverride, readImageFile } from "@/src/lib/editor/image";
import type {
  CanvasElementOverride,
  CanvasElementStyle,
  CanvasElementType,
  EditorSelection,
  SlideEditState,
} from "@/types/editor";
import { CanvasOverrideProvider } from "@/src/lib/editor/CanvasOverrideContext";
import { AiImagePromptDialog } from "./AiImagePromptDialog";
import type { ProductImageGenerationInput } from "@/src/lib/ai/generateProductImageClient";

interface AiImageContext {
  productName: string;
  referenceImages: string[];
  projectId?: string;
}

interface FreeformCanvasProps {
  slideId: string;
  editState?: SlideEditState;
  selection?: EditorSelection;
  children: ReactNode;
  editable?: boolean;
  onSelect: (selection: EditorSelection) => void;
  onPatch: (elementId: string, patch: Partial<CanvasElementOverride>) => void;
  onReset: (elementId: string) => void;
  aiImageContext?: AiImageContext;
  aiImageGenerationStates?: Record<string, AiImageGenerationState>;
  onGenerateAiImage?: (request: AiImageGenerationRequest) => void;
}

export interface AiImageGenerationRequest extends ProductImageGenerationInput {
  slideId: string;
  elementId: string;
  label: string;
}

export interface AiImageGenerationState {
  status: "generating" | "error" | "waiting" | "ready";
  error?: string;
  message?: string;
  elapsedSeconds?: number;
}

const EMPTY_AI_IMAGE_GENERATION_STATES: Record<string, AiImageGenerationState> = {};

interface SelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PointerInteraction {
  pointerId: number;
  elementId: string;
  elementType: CanvasElementType;
  label: string;
  mode: "move" | "resize";
  direction?: string;
  startClientX: number;
  startClientY: number;
  canvasWidth: number;
  canvasHeight: number;
  elementWidthPercent: number;
  elementHeightPercent: number;
  base: CanvasElementOverride;
  moved: boolean;
}

interface InlineBaseline {
  transform: string;
  transformOrigin: string;
  opacity: string;
  pointerEvents: string;
  display: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  textDecoration: string;
  textAlign: string;
  color: string;
  backgroundColor: string;
}

interface CanvasTextEditorState {
  id: string;
  label: string;
  value: string;
  rect: SelectionRect;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  color: string;
  textAlign: "left" | "center" | "right";
}

const HANDLE_DIRECTIONS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

function findEditableElement(target: EventTarget | null, canvas: HTMLDivElement | null) {
  if (!(target instanceof Element) || !canvas) return undefined;
  const element = target.closest<HTMLElement>("[data-canvas-element]");
  return element && canvas.contains(element) ? element : undefined;
}

function findOverlappingElements(clientX: number, clientY: number, canvas: HTMLDivElement) {
  const seen = new Set<string>();
  return document.elementsFromPoint(clientX, clientY)
    .map((candidate) => candidate.closest<HTMLElement>("[data-canvas-element]"))
    .filter((candidate): candidate is HTMLElement => {
      const id = candidate?.dataset.canvasElement;
      if (!candidate || !id || !canvas.contains(candidate) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function getElementMetadata(element: HTMLElement) {
  return {
    elementId: element.dataset.canvasElement || "element",
    elementType: (element.dataset.canvasType || "group") as CanvasElementType,
    label: element.dataset.canvasLabel || "页面元素",
  };
}

function styleWithPatch(base: CanvasElementOverride | undefined, patch: Partial<CanvasElementStyle>) {
  return { ...base?.style, ...patch };
}

export function FreeformCanvas({ slideId, editState, selection, children, editable = true, onSelect, onPatch, onReset, aiImageContext, aiImageGenerationStates = EMPTY_AI_IMAGE_GENERATION_STATES, onGenerateAiImage }: FreeformCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const baselines = useRef(new WeakMap<HTMLElement, InlineBaseline>());
  const interaction = useRef<PointerInteraction | undefined>(undefined);
  const [draft, setDraft] = useState<CanvasElementOverride>();
  const [selectionRect, setSelectionRect] = useState<SelectionRect>();
  const [generationRects, setGenerationRects] = useState<Record<string, SelectionRect>>({});
  const [textEditor, setTextEditor] = useState<CanvasTextEditorState>();
  const [aiImageDialogOpen, setAiImageDialogOpen] = useState(false);
  const selectedElementId = selection?.type === "element" && selection.slideId === slideId ? selection.elementId : undefined;
  const savedOverrides = editState?.elementOverrides ?? {};
  const effectiveOverrides = useMemo(() => draft ? { ...savedOverrides, [draft.id]: draft } : savedOverrides, [savedOverrides, draft]);
  const selectedOverride = selectedElementId ? effectiveOverrides[selectedElementId] : undefined;
  const selectedGenerationState = selectedElementId ? aiImageGenerationStates[selectedElementId] : undefined;

  const updateSelectionRect = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedElementId) {
      setSelectionRect(undefined);
      return;
    }
    const element = [...canvas.querySelectorAll<HTMLElement>("[data-canvas-element]")]
      .find((candidate) => candidate.dataset.canvasElement === selectedElementId);
    if (!element || getComputedStyle(element).display === "none") {
      setSelectionRect(undefined);
      return;
    }
    const canvasBox = canvas.getBoundingClientRect();
    const elementBox = element.getBoundingClientRect();
    const scaleX = canvasBox.width / canvas.offsetWidth || 1;
    const scaleY = canvasBox.height / canvas.offsetHeight || 1;
    setSelectionRect({
      left: (elementBox.left - canvasBox.left) / scaleX,
      top: (elementBox.top - canvasBox.top) / scaleY,
      width: elementBox.width / scaleX,
      height: elementBox.height / scaleY,
    });
  }, [selectedElementId]);

  const updateGenerationRects = useCallback(() => {
    const canvas = canvasRef.current;
    const elementIds = Object.keys(aiImageGenerationStates);
    if (!canvas || !elementIds.length) {
      setGenerationRects({});
      return;
    }
    const canvasBox = canvas.getBoundingClientRect();
    const scaleX = canvasBox.width / canvas.offsetWidth || 1;
    const scaleY = canvasBox.height / canvas.offsetHeight || 1;
    const nextRects: Record<string, SelectionRect> = {};
    for (const element of canvas.querySelectorAll<HTMLElement>("[data-canvas-element]")) {
      const elementId = element.dataset.canvasElement;
      if (!elementId || !aiImageGenerationStates[elementId] || getComputedStyle(element).display === "none") continue;
      const elementBox = element.getBoundingClientRect();
      nextRects[elementId] = {
        left: (elementBox.left - canvasBox.left) / scaleX,
        top: (elementBox.top - canvasBox.top) / scaleY,
        width: elementBox.width / scaleX,
        height: elementBox.height / scaleY,
      };
    }
    setGenerationRects(nextRects);
  }, [aiImageGenerationStates]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const elements = [...canvas.querySelectorAll<HTMLElement>("[data-canvas-element]")];

    for (const element of elements) {
      if (!baselines.current.has(element)) {
        baselines.current.set(element, {
          transform: element.style.transform,
          transformOrigin: element.style.transformOrigin,
          opacity: element.style.opacity,
          pointerEvents: element.style.pointerEvents,
          display: element.style.display,
          fontFamily: element.style.fontFamily,
          fontSize: element.style.fontSize,
          fontWeight: element.style.fontWeight,
          fontStyle: element.style.fontStyle,
          textDecoration: element.style.textDecoration,
          textAlign: element.style.textAlign,
          color: element.style.color,
          backgroundColor: element.style.backgroundColor,
        });
      }

      const baseline = baselines.current.get(element)!;
      const override = effectiveOverrides[element.dataset.canvasElement || ""];
      element.style.transform = baseline.transform;
      element.style.transformOrigin = baseline.transformOrigin;
      element.style.opacity = baseline.opacity;
      element.style.pointerEvents = baseline.pointerEvents;
      element.style.display = baseline.display;
      element.style.fontFamily = baseline.fontFamily;
      element.style.fontSize = baseline.fontSize;
      element.style.fontWeight = baseline.fontWeight;
      element.style.fontStyle = baseline.fontStyle;
      element.style.textDecoration = baseline.textDecoration;
      element.style.textAlign = baseline.textAlign;
      element.style.color = baseline.color;
      element.style.backgroundColor = baseline.backgroundColor;

      if (!override) {
        continue;
      }
      const transform = resolveCanvasTransform(override);
      element.style.transformOrigin = "0 0";
      element.style.transform = canvasTransformCss(transform);
      element.style.display = override.hidden ? "none" : baseline.display;
      if (override.locked) element.style.cursor = "not-allowed";
      if (override.style?.fontFamily) element.style.fontFamily = override.style.fontFamily;
      if (override.style?.fontSize) element.style.fontSize = `${override.style.fontSize * 0.1041667}cqw`;
      if (override.style?.fontWeight) element.style.fontWeight = `${override.style.fontWeight}`;
      if (override.style?.italic !== undefined) element.style.fontStyle = override.style.italic ? "italic" : "normal";
      if (override.style?.underline !== undefined) element.style.textDecoration = override.style.underline ? "underline" : "none";
      if (override.style?.textAlign) element.style.textAlign = override.style.textAlign;
      if (override.style?.color) element.style.color = override.style.color;
      if (override.style?.fillColor) element.style.backgroundColor = override.style.fillColor;
    }

    const frame = requestAnimationFrame(() => {
      updateSelectionRect();
      updateGenerationRects();
    });
    return () => cancelAnimationFrame(frame);
  }, [effectiveOverrides, updateSelectionRect, updateGenerationRects, children]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const updateRects = () => {
      updateSelectionRect();
      updateGenerationRects();
    };
    const observer = new ResizeObserver(updateRects);
    observer.observe(canvas);
    window.addEventListener("resize", updateRects);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateRects);
    };
  }, [updateGenerationRects, updateSelectionRect]);

  useEffect(() => {
    if (!textEditor) return;
    const frame = requestAnimationFrame(() => {
      const editor = canvasRef.current?.querySelector<HTMLTextAreaElement>(".freeform-text-editor");
      editor?.focus({ preventScroll: true });
      editor?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [textEditor?.id]);

  useEffect(() => {
    setAiImageDialogOpen(false);
  }, [selectedElementId, slideId]);

  const beginInteraction = (event: ReactPointerEvent, element: HTMLElement, mode: PointerInteraction["mode"], direction?: string) => {
    if (!editable) return;
    if (event.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas || element.isContentEditable) return;
    const metadata = getElementMetadata(element);
    const existing = effectiveOverrides[metadata.elementId];
    const base = mergeCanvasElementOverride(existing, { type: metadata.elementType, label: metadata.label }, metadata.elementId);
    if (base.locked) return;
    const canvasBox = canvas.getBoundingClientRect();
    const elementBox = element.getBoundingClientRect();
    interaction.current = {
      pointerId: event.pointerId,
      ...metadata,
      mode,
      direction,
      startClientX: event.clientX,
      startClientY: event.clientY,
      canvasWidth: canvasBox.width,
      canvasHeight: canvasBox.height,
      elementWidthPercent: elementBox.width / canvasBox.width * 100,
      elementHeightPercent: elementBox.height / canvasBox.height * 100,
      base,
      moved: false,
    };
    canvas.setPointerCapture(event.pointerId);
    if (selectedElementId !== metadata.elementId) onSelect({ type: "element", slideId, ...metadata });
    event.stopPropagation();
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let element = findEditableElement(event.target, canvas);
    if (event.altKey) {
      const candidates = findOverlappingElements(event.clientX, event.clientY, canvas);
      const currentIndex = candidates.findIndex((candidate) => candidate.dataset.canvasElement === selectedElementId);
      element = candidates[(currentIndex + 1 + candidates.length) % candidates.length] ?? element;
    }
    if (!element) return;
    beginInteraction(event, element, "move");
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = interaction.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dxPercent = (event.clientX - current.startClientX) / current.canvasWidth * 100;
    const dyPercent = (event.clientY - current.startClientY) / current.canvasHeight * 100;
    const transform = current.mode === "move"
      ? moveCanvasTransform(resolveCanvasTransform(current.base), dxPercent, dyPercent)
      : resizeCanvasTransform(
          resolveCanvasTransform(current.base),
          current.direction || "se",
          dxPercent,
          dyPercent,
          current.elementWidthPercent,
          current.elementHeightPercent,
        );
    current.moved = current.moved || Math.abs(event.clientX - current.startClientX) + Math.abs(event.clientY - current.startClientY) > 2;
    setDraft(mergeCanvasElementOverride(current.base, { transform }, current.elementId));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = interaction.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.moved && draft) onPatch(current.elementId, { transform: draft.transform, type: current.elementType, label: current.label });
    interaction.current = undefined;
    setDraft(undefined);
    canvasRef.current?.releasePointerCapture(event.pointerId);
  };

  const beginTextEditing = useCallback((elementId: string) => {
    const canvas = canvasRef.current;
    const element = canvas && [...canvas.querySelectorAll<HTMLElement>("[data-canvas-element]")]
      .find((candidate) => candidate.dataset.canvasElement === elementId);
    if (!element || element.dataset.canvasType !== "text") return;
    const canvasBox = canvas.getBoundingClientRect();
    const elementBox = element.getBoundingClientRect();
    const scaleX = canvasBox.width / canvas.offsetWidth || 1;
    const scaleY = canvasBox.height / canvas.offsetHeight || 1;
    const computed = getComputedStyle(element);
    setTextEditor({
      id: elementId,
      label: element.dataset.canvasLabel || "文字",
      value: effectiveOverrides[elementId]?.text ?? element.innerText,
      rect: {
        left: (elementBox.left - canvasBox.left) / scaleX,
        top: (elementBox.top - canvasBox.top) / scaleY,
        width: Math.max(42, elementBox.width / scaleX),
        height: Math.max(22, elementBox.height / scaleY),
      },
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      color: computed.color,
      textAlign: (computed.textAlign === "center" || computed.textAlign === "right" ? computed.textAlign : "left"),
    });
  }, [effectiveOverrides]);

  const handleDoubleClick = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editable) return;
    const element = findEditableElement(event.target, canvasRef.current);
    if (!element || element.dataset.canvasType !== "text") return;
    const metadata = getElementMetadata(element);
    if (selectedElementId !== metadata.elementId) onSelect({ type: "element", slideId, ...metadata });
    beginTextEditing(metadata.elementId);
    event.stopPropagation();
  };

  const patchSelectedStyle = (patch: Partial<CanvasElementStyle>) => {
    if (!selectedElementId) return;
    onPatch(selectedElementId, { style: styleWithPatch(selectedOverride, patch) });
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, direction: string) => {
    if (!selectedElementId) return;
    const canvas = canvasRef.current;
    const element = canvas && [...canvas.querySelectorAll<HTMLElement>("[data-canvas-element]")]
      .find((candidate) => candidate.dataset.canvasElement === selectedElementId);
    if (element) beginInteraction(event, element, "resize", direction);
  };

  return (
    <div
      ref={canvasRef}
      className={`freeform-canvas ${editable ? "is-editable" : "is-readonly"}`}
      data-testid="freeform-canvas"
      data-canvas-override-count={Object.keys(savedOverrides).length}
      data-canvas-text-override-count={Object.values(savedOverrides).filter((item) => item.text !== undefined).length}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClickCapture={handleDoubleClick}
    >
      <CanvasOverrideProvider value={effectiveOverrides}>{children}</CanvasOverrideProvider>
      {Object.entries(aiImageGenerationStates).map(([elementId, state]) => {
        const rect = generationRects[elementId];
        if (!rect) return null;
        return <div
          className={`freeform-ai-generation-overlay is-${state.status}`}
          style={rect}
          key={elementId}
          role={editable ? "status" : undefined}
          aria-live={editable ? "polite" : undefined}
          aria-hidden={editable ? undefined : true}
          title={state.error}
        >
          <span>{state.status === "generating" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}<strong>{state.status === "generating" ? "AI 图片生成中" : state.status === "ready" ? "图片已生成，待应用" : state.status === "waiting" ? "任务已保留，待查询" : "生成失败"}</strong><small>{state.message || state.error || "请查看上方绘图任务状态"}{state.elapsedSeconds !== undefined ? ` · 已用时 ${state.elapsedSeconds} 秒` : ""}</small></span>
        </div>;
      })}
      {editable && textEditor && <textarea
        className="freeform-text-editor"
        aria-label={`编辑${textEditor.label}`}
        value={textEditor.value}
        style={{
          ...textEditor.rect,
          fontFamily: textEditor.fontFamily,
          fontSize: textEditor.fontSize,
          fontWeight: textEditor.fontWeight,
          color: textEditor.color,
          textAlign: textEditor.textAlign,
        }}
        onChange={(event) => setTextEditor((current) => current ? { ...current, value: event.target.value } : current)}
        onBlur={() => {
          onPatch(textEditor.id, { text: textEditor.value.trim(), type: "text", label: textEditor.label });
          setTextEditor(undefined);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" || ((event.metaKey || event.ctrlKey) && event.key === "Enter")) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />}
      {editable && selectedElementId && selectionRect && (
        <>
          <div
            className={`freeform-selection ${selectedOverride?.locked ? "is-locked" : ""}`}
            style={selectionRect}
            aria-hidden="true"
          >
            <span className="freeform-selection-label">{selection?.type === "element" ? selection.label : "页面元素"}</span>
            {!selectedOverride?.locked && HANDLE_DIRECTIONS.map((direction) => (
              <button
                key={direction}
                type="button"
                tabIndex={-1}
                className={`freeform-handle handle-${direction}`}
                onPointerDown={(event) => handleResizePointerDown(event, direction)}
                aria-label={`${direction} 缩放`}
              />
            ))}
          </div>
          <div
            className="freeform-floating-toolbar"
            style={{
              left: Math.max(8, selectionRect.left),
              top: Math.max(8, selectionRect.top + selectionRect.height + 9),
            }}
          >
            <span>{selection?.type === "element" && selection.elementType === "image" ? <ImageIcon aria-hidden="true" /> : <Type aria-hidden="true" />}{selection?.type === "element" ? selection.label : "元素"}</span>
            {selection?.type === "element" && selection.elementType === "image" && <label className="freeform-image-replace" title="替换图片">
              <ImagePlus aria-hidden="true" />
              <span className="sr-only">替换图片</span>
              <input type="file" accept="image/*" onChange={async (event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                try {
                  const source = await readImageFile(file);
                  onPatch(selectedElementId, { image: { ...defaultCanvasImageOverride(), ...selectedOverride?.image, source }, type: "image", label: selection.label });
                } catch (error) {
                  console.error("替换图片失败", error);
                }
              }} />
            </label>}
            {selection?.type === "element" && selection.elementType === "image" && aiImageContext && onGenerateAiImage && <button className={`freeform-ai-image-button ${selectedGenerationState ? `is-${selectedGenerationState.status}` : ""}`} type="button" disabled={!!selectedGenerationState} title={selectedGenerationState ? "已有绘图任务，请使用上方任务栏查询或应用结果" : "AI 绘图"} aria-label="AI 绘图" onClick={() => setAiImageDialogOpen(true)}>{selectedGenerationState?.status === "generating" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}</button>}
            {selection?.type === "element" && selection.elementType === "text" && <>
              <button type="button" title="编辑文字" aria-label="编辑文字" onClick={() => beginTextEditing(selectedElementId)}><Type aria-hidden="true" /></button>
              <button className={selectedOverride?.style?.fontWeight === 700 ? "is-active" : ""} type="button" title="粗体" aria-label="粗体" onClick={() => patchSelectedStyle({ fontWeight: selectedOverride?.style?.fontWeight === 700 ? 400 : 700 })}><Bold aria-hidden="true" /></button>
              <button className={selectedOverride?.style?.italic ? "is-active" : ""} type="button" title="斜体" aria-label="斜体" onClick={() => patchSelectedStyle({ italic: !selectedOverride?.style?.italic })}><Italic aria-hidden="true" /></button>
              <button type="button" title="左对齐" aria-label="左对齐" onClick={() => patchSelectedStyle({ textAlign: "left" })}><AlignLeft aria-hidden="true" /></button>
              <button type="button" title="居中" aria-label="居中" onClick={() => patchSelectedStyle({ textAlign: "center" })}><AlignCenter aria-hidden="true" /></button>
              <button type="button" title="右对齐" aria-label="右对齐" onClick={() => patchSelectedStyle({ textAlign: "right" })}><AlignRight aria-hidden="true" /></button>
            </>}
            <i />
            <button type="button" title={selectedOverride?.locked ? "解锁" : "锁定"} aria-label={selectedOverride?.locked ? "解锁元素" : "锁定元素"} onClick={() => onPatch(selectedElementId, { locked: !selectedOverride?.locked })}>{selectedOverride?.locked ? <Unlock aria-hidden="true" /> : <Lock aria-hidden="true" />}</button>
            <button type="button" title="隐藏" aria-label="隐藏元素" onClick={() => onPatch(selectedElementId, { hidden: true })}><EyeOff aria-hidden="true" /></button>
            <button type="button" title="复位" aria-label="恢复元素默认位置与样式" onClick={() => onReset(selectedElementId)}><RotateCcw aria-hidden="true" /></button>
          </div>
        </>
      )}
      {editable && aiImageContext && onGenerateAiImage && <AiImagePromptDialog
        open={aiImageDialogOpen}
        productName={aiImageContext.productName}
        referenceImages={aiImageContext.referenceImages}
        onClose={() => setAiImageDialogOpen(false)}
        onGenerate={(prompt, modelOption) => {
          if (!selectedElementId || selection?.type !== "element") return;
          onGenerateAiImage({
            slideId,
            elementId: selectedElementId,
            label: selection.label,
            prompt,
            productName: aiImageContext.productName,
            referenceImages: aiImageContext.referenceImages,
            aspectRatio: selectionRect && selectionRect.height > 0 ? selectionRect.width / selectionRect.height : 1,
            projectId: aiImageContext.projectId,
            providerId: modelOption.providerId,
            model: modelOption.model,
          });
          setAiImageDialogOpen(false);
        }}
      />}
    </div>
  );
}
