"use client";

import { ArrowUp, BriefcaseBusiness, House, Image as ImageIcon, Sparkles, TentTree, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createImageScenePrompt, IMAGE_SCENE_TEMPLATES, MAX_IMAGE_REFERENCES, type ImageScenePreset } from "@/src/lib/ai/imageScenePrompts";
import { loadImageModelOptions, type ImageModelOption } from "@/src/lib/ai/imageModelOptions";

interface AiImagePromptDialogProps {
  open: boolean;
  productName: string;
  referenceImages: string[];
  onClose: () => void;
  onGenerate: (prompt: string, option: ImageModelOption) => void;
}

const sceneIcons = {
  office: BriefcaseBusiness,
  camping: TentTree,
  home: House,
} satisfies Record<ImageScenePreset, typeof BriefcaseBusiness>;

export function AiImagePromptDialog({ open, productName, referenceImages, onClose, onGenerate }: AiImagePromptDialogProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("");
  const [activePreset, setActivePreset] = useState<ImageScenePreset>();
  const [message, setMessage] = useState("");
  const [modelOptions, setModelOptions] = useState<ImageModelOption[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPrompt("");
    setActivePreset(undefined);
    setMessage("");
    setSelectedModelKey("");
    const frame = requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    const controller = new AbortController();
    setModelsLoading(true);
    void loadImageModelOptions(controller.signal).then((options) => {
      setModelOptions(options);
      if (!options.length) setMessage("暂无可用图片模型，请先在 API 设置中配置。");
    }).catch((error) => {
      if (error instanceof Error && error.name === "AbortError") return;
      setModelOptions([]);
      setMessage("图片模型加载失败，请重试。");
    }).finally(() => {
      if (!controller.signal.aborted) setModelsLoading(false);
    });
    return () => {
      cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [open, productName]);

  if (!open) return null;

  const applyPreset = (preset: ImageScenePreset) => {
    setPrompt(createImageScenePrompt(preset, productName));
    setActivePreset(preset);
    setMessage("");
    requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
  };

  const generateImage = () => {
    if (!prompt.trim()) { setMessage("请先填写场景描述，或选择一个场景模板。"); return; }
    if (!referenceImages.length) { setMessage("当前图片框没有可用的参考图片。"); return; }
    const selected = modelOptions.find((option) => option.key === selectedModelKey);
    if (!selected) { setMessage("请选择图片模型后再生成。"); return; }
    onGenerate(prompt.trim(), selected);
  };

  return (
    <div
      className="ai-image-dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") onClose();
      }}
    >
      <section className="ai-image-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-image-dialog-title" data-testid="ai-image-dialog">
        <header>
          <div className="ai-image-dialog-heading">
            <span><Sparkles aria-hidden="true" /></span>
            <div>
              <h2 id="ai-image-dialog-title">AI 场景绘图</h2>
              <p>图生图模式 · 当前商品：{productName}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭 AI 绘图弹窗"><X aria-hidden="true" /></button>
        </header>

        <div className="ai-image-dialog-body">
          <div className="ai-image-prompt-panel">
            <div className="ai-image-model-field">
              <label htmlFor="ai-image-model">图片模型</label>
              <select
                id="ai-image-model"
                aria-label="图片模型"
                value={selectedModelKey}
                disabled={modelsLoading || !modelOptions.length}
                onChange={(event) => { setSelectedModelKey(event.target.value); setMessage(""); }}
              >
                <option value="">{modelsLoading ? "正在加载图片模型…" : modelOptions.length ? "请选择图片模型" : "暂无可用图片模型"}</option>
                {modelOptions.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}
              </select>
            </div>
            <label htmlFor="ai-image-prompt">场景描述</label>
            <div className="ai-image-prompt-box">
              <textarea
                ref={textareaRef}
                id="ai-image-prompt"
                value={prompt}
                placeholder="描述你想生成的图片场景，或选择下方场景模板"
                onChange={(event) => { setPrompt(event.target.value); setActivePreset(undefined); setMessage(""); }}
              />
              <div className="ai-image-prompt-meta">
                <span>{prompt.length} 字</span>
                <button type="button" aria-label="生成图片" onClick={generateImage}><ArrowUp aria-hidden="true" /></button>
              </div>
            </div>
            <div className="ai-image-scene-actions" aria-label="场景提示词模板">
              {IMAGE_SCENE_TEMPLATES.map((template) => {
                const Icon = sceneIcons[template.id];
                return <button className={activePreset === template.id ? "is-active" : ""} type="button" key={template.id} onClick={() => applyPreset(template.id)} title={template.description}><Icon aria-hidden="true" />{template.label}</button>;
              })}
            </div>
          </div>

          <aside className="ai-image-reference-panel">
            <div><span>参考图片</span><strong>{referenceImages.length} / {MAX_IMAGE_REFERENCES}</strong></div>
            <p>仅使用商品资料原图；生成结果不会回流为参考图。系统将按选框比例生成铺满画面的图片。</p>
            <div className="ai-image-reference-grid">
              {referenceImages.map((source, index) => <figure key={`${source}-${index}`}><img src={source} alt={`${productName}参考图 ${index + 1}`} /><figcaption>{String(index + 1).padStart(2, "0")}</figcaption></figure>)}
              {!referenceImages.length && <div className="ai-image-reference-empty"><ImageIcon aria-hidden="true" /><span>暂无参考图片</span></div>}
            </div>
          </aside>
        </div>

        <footer>
          <span className={message ? "is-error" : ""} role="status">{message || "提交后可继续编辑；生成完成会自动替换当前图片框。"}</span>
        </footer>
      </section>
    </div>
  );
}
