"use client";

import { Check, Eye, X } from "lucide-react";
import { BusinessRedSlide } from "@/components/templates/business-red/BusinessRedSlide";
import { templateDemoProducts } from "@/data/demo-products";
import { buildCatalogSlides } from "@/lib/pagination";
import { createSlidePlan } from "@/src/lib/layout/createSlidePlan";
import {
  createTemplatePreviewDesign,
  getAvailableTemplates,
} from "@/src/templates/registry";
import type { CatalogMeta, ProductCategory } from "@/types/catalog";
import type { TemplateId } from "@/src/templates/types";
import { usePptI18n } from "@/components/host/PptDomLocalizer";

const demoPlans = createSlidePlan(templateDemoProducts, {
  mode: "force-single-image",
});
const demoSlides = buildCatalogSlides(templateDemoProducts, demoPlans);
const demoSlide =
  demoSlides.find((slide) => slide.kind === "products") ?? demoSlides[0];

interface TemplateGalleryProps {
  meta: CatalogMeta;
  categories: ProductCategory[];
  onApply: (templateId: TemplateId) => void;
  onClose: () => void;
}

export function TemplateGallery({
  meta,
  categories,
  onApply,
  onClose,
}: TemplateGalleryProps) {
  const { t } = usePptI18n();
  const templates = getAvailableTemplates();

  return (
    <div
      className="template-gallery-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="template-gallery"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-gallery-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>设计系统</span>
            <h2 id="template-gallery-title">选择产品手册模板</h2>
            <p>
              所有模板沿用商务红版式，区别仅在配色、字体与装饰。应用后不会改变商品数据。
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭模板图库">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="template-gallery-grid">
          {templates.map((template) => {
            const selected = meta.design.templateId === template.id;
            const previewMeta: CatalogMeta = {
              ...meta,
              design: createTemplatePreviewDesign(meta.design, template.id),
            };
            return (
              <article
                className={selected ? "is-selected" : ""}
                key={template.id}
              >
                <div className="template-live-preview">
                  <div className="slide-frame">
                    <BusinessRedSlide
                      slide={demoSlide}
                      meta={previewMeta}
                      products={templateDemoProducts}
                      categories={categories}
                      totalSlides={demoSlides.length}
                    />
                  </div>
                  <span>
                    <Eye aria-hidden="true" />
                    实时样张
                  </span>
                </div>
                <div className="template-card-copy">
                  <div>
                    <span>{template.nameEn}</span>
                    <h3>{template.name}</h3>
                  </div>
                  {selected && (
                    <small>
                      <Check aria-hidden="true" />
                      当前模板
                    </small>
                  )}
                  <p>{template.description}</p>
                  <div className="template-tag-list">
                    {template.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                  <button
                    type="button"
                    aria-label={
                      selected
                        ? t(
                            `保持当前模板：${template.name}`,
                            `Keep current template: ${template.nameEn}`,
                          )
                        : t(
                            `应用模板：${template.name}`,
                            `Apply template: ${template.nameEn}`,
                          )
                    }
                    onClick={() => {
                      if (!selected) onApply(template.id);
                      onClose();
                    }}
                  >
                    {selected ? "保持当前模板" : "应用此模板"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
