"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Eye,
  EyeOff,
  ImagePlus,
  Italic,
  Lock,
  RotateCcw,
  Underline,
  Unlock,
} from "lucide-react";
import type { ReactNode } from "react";
import { defaultCanvasImageOverride, readImageFile } from "@/src/lib/editor/image";
import type { CanvasElementOverride, CanvasElementStyle, EditorSelection } from "@/types/editor";

interface CanvasTopToolbarProps {
  selection?: EditorSelection;
  override?: CanvasElementOverride;
  onPatch: (patch: Partial<CanvasElementOverride>) => void;
  onReset: () => void;
  trailing?: ReactNode;
}

function mergeStyle(override: CanvasElementOverride | undefined, patch: Partial<CanvasElementStyle>) {
  return { ...override?.style, ...patch };
}

export function CanvasTopToolbar({ selection, override, onPatch, onReset, trailing }: CanvasTopToolbarProps) {
  const isElement = selection?.type === "element";
  const isText = isElement && selection.elementType === "text";
  const isImage = isElement && selection.elementType === "image";
  const style = override?.style ?? {};
  const fontSize = style.fontSize ?? 16;

  return (
    <div className="canvas-top-toolbar" aria-label="画布元素工具栏">
      <div className="canvas-toolbar-selection">
        <span>已选择</span>
        <strong>{isElement ? selection.label : "点击画布中的元素"}</strong>
      </div>
      <i />
      {isImage && <label className="canvas-image-replace-button" title="替换图片">
        <ImagePlus aria-hidden="true" />
        <span>替换图片</span>
        <input type="file" accept="image/*" onChange={async (event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          try {
            const source = await readImageFile(file);
            onPatch({ image: { ...defaultCanvasImageOverride(), ...override?.image, source } });
          } catch (error) {
            console.error("替换图片失败", error);
          }
        }} />
      </label>}
      <label className="canvas-font-select">
        <span className="sr-only">字体</span>
        <select
          value={style.fontFamily ?? "Microsoft YaHei"}
          disabled={!isText}
          onChange={(event) => onPatch({ style: mergeStyle(override, { fontFamily: event.target.value }) })}
        >
          <option value="Microsoft YaHei">微软雅黑</option>
          <option value="PingFang SC">苹方</option>
          <option value="SimSun">宋体</option>
          <option value="Arial">Arial</option>
        </select>
      </label>
      <label className="canvas-font-size">
        <span className="sr-only">字号</span>
        <input
          type="number"
          min="6"
          max="96"
          value={fontSize}
          disabled={!isText}
          onChange={(event) => onPatch({ style: mergeStyle(override, { fontSize: Number(event.target.value) || 16 }) })}
        />
      </label>
      <div className="canvas-toolbar-buttons">
        <button className={style.fontWeight === 700 ? "is-active" : ""} type="button" title="粗体" aria-label="粗体" disabled={!isText} onClick={() => onPatch({ style: mergeStyle(override, { fontWeight: style.fontWeight === 700 ? 400 : 700 }) })}><Bold aria-hidden="true" /></button>
        <button className={style.italic ? "is-active" : ""} type="button" title="斜体" aria-label="斜体" disabled={!isText} onClick={() => onPatch({ style: mergeStyle(override, { italic: !style.italic }) })}><Italic aria-hidden="true" /></button>
        <button className={style.underline ? "is-active" : ""} type="button" title="下划线" aria-label="下划线" disabled={!isText} onClick={() => onPatch({ style: mergeStyle(override, { underline: !style.underline }) })}><Underline aria-hidden="true" /></button>
      </div>
      <label className="canvas-color-control" title="文字颜色">
        <span>A</span>
        <input type="color" value={style.color ?? "#24201e"} disabled={!isText} onChange={(event) => onPatch({ style: mergeStyle(override, { color: event.target.value }) })} />
      </label>
      <div className="canvas-toolbar-buttons">
        <button className={style.textAlign === "left" ? "is-active" : ""} type="button" title="左对齐" aria-label="左对齐" disabled={!isText} onClick={() => onPatch({ style: mergeStyle(override, { textAlign: "left" }) })}><AlignLeft aria-hidden="true" /></button>
        <button className={style.textAlign === "center" ? "is-active" : ""} type="button" title="居中" aria-label="居中" disabled={!isText} onClick={() => onPatch({ style: mergeStyle(override, { textAlign: "center" }) })}><AlignCenter aria-hidden="true" /></button>
        <button className={style.textAlign === "right" ? "is-active" : ""} type="button" title="右对齐" aria-label="右对齐" disabled={!isText} onClick={() => onPatch({ style: mergeStyle(override, { textAlign: "right" }) })}><AlignRight aria-hidden="true" /></button>
      </div>
      <i />
      <div className="canvas-toolbar-buttons canvas-toolbar-element-actions">
        <button type="button" title={override?.locked ? "解锁元素" : "锁定元素"} aria-label={override?.locked ? "解锁元素" : "锁定元素"} disabled={!isElement} onClick={() => onPatch({ locked: !override?.locked })}>{override?.locked ? <Unlock aria-hidden="true" /> : <Lock aria-hidden="true" />}</button>
        <button type="button" title={override?.hidden ? "显示元素" : "隐藏元素"} aria-label={override?.hidden ? "显示元素" : "隐藏元素"} disabled={!isElement} onClick={() => onPatch({ hidden: !override?.hidden })}>{override?.hidden ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}</button>
        <button type="button" title="恢复元素默认位置与样式" aria-label="恢复元素默认位置与样式" disabled={!isElement} onClick={onReset}><RotateCcw aria-hidden="true" /></button>
      </div>
      {trailing}
      <p>拖动移动 · 控点缩放 · 双击改字 · Alt 单击切换重叠元素</p>
    </div>
  );
}
