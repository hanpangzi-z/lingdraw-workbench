"use client";

import { useState } from "react";
import Link from "next/link";
import { ResourceNavigation } from "@/components/library/ResourceNavigation";
import { BusinessRedSlide } from "@/components/templates/business-red/BusinessRedSlide";
import { catalogMeta, productCategories } from "@/data/catalog";
import { templateDemoProducts } from "@/data/demo-products";
import { buildCatalogSlides } from "@/lib/pagination";
import { createSlidePlan } from "@/src/lib/layout/createSlidePlan";
import { createTemplatePreviewDesign, getAvailableTemplates } from "@/src/templates/registry";
import type { TemplateId } from "@/src/templates/types";

const slides = buildCatalogSlides(templateDemoProducts, createSlidePlan(templateDemoProducts, { mode: "force-single-image" }));
const productSlide = slides.find((slide) => slide.kind === "products") ?? slides[0];

/** View-only sample: no project store, provider, import, autosave or export. */
export function ReadOnlyDemo() {
  const [templateId, setTemplateId] = useState<TemplateId>("modern-catalog");
  const meta = { ...catalogMeta, projectName: "产品手册示例", title: "产品手册示例", design: createTemplatePreviewDesign(catalogMeta.design, templateId) };
  return <main className="projects-shell"><ResourceNavigation /><section className="projects-content demo-workspace">
    <header className="demo-heading"><div><h1>示例预览 · 只读</h1><p>以下为演示商品，仅用于了解版式效果。切换模板不会创建项目、保存草稿或修改你的商品资料。</p></div><Link href="/projects">返回项目首页</Link></header>
    <label className="demo-template-picker">预览模板<select value={templateId} onChange={(event) => setTemplateId(event.target.value as TemplateId)}>{getAvailableTemplates().map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</select></label>
    <div className="demo-slide-preview" role="img" aria-label="示例商品页面，只读"><span className="slide-frame" aria-hidden="true"><BusinessRedSlide slide={productSlide} meta={meta} products={templateDemoProducts} categories={productCategories} totalSlides={slides.length} /></span></div>
    <p className="demo-isolation-note">示例商品不会带入新项目。制作自己的手册，请返回项目首页后上传真实资料。</p>
  </section></main>;
}
