"use client";

import { ImagePlus, Palette, RotateCcw, Type } from "lucide-react";
import { getTemplate } from "@/src/templates/registry";
import { getAvailableThemes } from "@/src/themes/registry";
import type { CatalogMeta } from "@/types/catalog";
import type { ThemeId } from "@/src/themes/types";

interface DesignPanelProps {
  project: CatalogMeta;
  onOpenGallery: () => void;
  onThemeChange: (themeId: ThemeId) => void;
  onDesignChange: (patch: Partial<CatalogMeta["design"]>) => void;
  onThemeOverride: (patch: Partial<CatalogMeta["design"]["themeOverrides"]>) => void;
  onReset: () => void;
}

const fontOptions = ["Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Arial"];

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Logo 读取失败"));
    reader.readAsDataURL(file);
  });
}

export function DesignPanel({ project, onOpenGallery, onThemeChange, onDesignChange, onThemeOverride, onReset }: DesignPanelProps) {
  const template = getTemplate(project.design.templateId);
  const themes = getAvailableThemes().filter((theme) => template.supportedThemes.includes(theme.id));

  return (
    <div className="design-panel">
      <section className="design-template-summary">
        <span>当前模板</span>
        <strong>{template.name}</strong>
        <p>{template.description}</p>
        <button type="button" onClick={onOpenGallery}>浏览模板图库</button>
      </section>

      <section className="design-field-group">
        <label><Palette aria-hidden="true" />主题
          <select value={project.design.themeId} onChange={(event) => onThemeChange(event.target.value as ThemeId)}>
            {themes.map((theme) => <option value={theme.id} key={theme.id}>{theme.name} · {theme.nameEn}</option>)}
          </select>
        </label>
        <label>品牌主色
          <div className="design-color-control">
            <input type="color" value={project.design.brandColor ?? project.design.themeOverrides.primary ?? themes[0]?.colors.primary ?? "#A51F2D"} onChange={(event) => onDesignChange({ brandColor: event.target.value })} />
            <input value={project.design.brandColor ?? ""} placeholder="跟随主题" onChange={(event) => onDesignChange({ brandColor: event.target.value || undefined })} />
          </div>
        </label>
      </section>

      <section className="design-field-group">
        <label><Type aria-hidden="true" />标题字体
          <select value={project.design.themeOverrides.titleFont ?? ""} onChange={(event) => onThemeOverride({ titleFont: event.target.value || undefined })}>
            <option value="">跟随主题</option>
            {fontOptions.map((font) => <option value={font} key={font}>{font}</option>)}
          </select>
        </label>
        <label>正文字体
          <select value={project.design.themeOverrides.bodyFont ?? ""} onChange={(event) => onThemeOverride({ bodyFont: event.target.value || undefined })}>
            <option value="">跟随主题</option>
            {fontOptions.map((font) => <option value={font} key={font}>{font}</option>)}
          </select>
        </label>
      </section>

      <section className="design-field-group">
        <label>品牌名称
          <input value={project.design.brandName ?? ""} placeholder={project.brand} onChange={(event) => onDesignChange({ brandName: event.target.value || undefined })} />
        </label>
        <label className="design-logo-control"><ImagePlus aria-hidden="true" />公司 Logo
          <input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try { onDesignChange({ logo: await readFileAsDataUrl(file) }); } catch (error) { console.error("Logo 读取失败", error); }
          }} />
          <span>{project.design.logo ? "已上传，可在封面与页眉中预览" : "PNG / JPG / SVG"}</span>
        </label>
        {project.design.logo && <button className="design-remove-logo" type="button" onClick={() => onDesignChange({ logo: undefined })}>移除 Logo</button>}
      </section>

      <button className="design-reset-button" type="button" onClick={onReset}><RotateCcw aria-hidden="true" />重置模板默认样式</button>
    </div>
  );
}
