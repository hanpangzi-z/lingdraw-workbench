import { describe, expect, it } from "vitest";
import { catalogMeta } from "@/data/catalog";
import { mockProducts } from "@/data/mock-products";
import { emptyEditorState } from "@/types/editor";
import { createProjectPreview } from "@/src/lib/cloud/projectPreview";
import { isDefaultProjectName, suggestProjectName } from "@/src/lib/cloud/projectNaming";
import { applyTemplateToDesign } from "@/src/templates/registry";
import { resolveTheme } from "@/src/themes/registry";
import type { CloudProjectSnapshot } from "@/src/server/projects/types";

const fixture = (): CloudProjectSnapshot => ({ project: { ...catalogMeta, design: applyTemplateToDesign(catalogMeta.design, "modern-catalog") }, products: mockProducts.slice(0, 3), layoutMode: "smart", layoutOverrides: {}, editorState: emptyEditorState() });

describe("project homepage real-page previews", () => {
  it("uses the saved modern template rather than a default red cover", () => {
    const preview = createProjectPreview(fixture());
    expect(preview.meta.design.templateId).toBe("modern-catalog");
    expect(resolveTheme(preview.meta.design.themeId, preview.meta.design.themeOverrides, preview.meta.design.brandColor).colors.primary).not.toBe("#B51F32");
    expect(preview.slide?.pageNumber).toBe(1);
  });
  it("honors hidden pages, custom order, and saved canvas overrides", () => {
    const snapshot = fixture();
    const cover = createProjectPreview(snapshot).slide!;
    snapshot.editorState.hiddenSlideIds = [cover.id];
    const product = createProjectPreview(snapshot).slide!;
    snapshot.editorState.slides[product.id] = { slideId: product.id, elementOverrides: { "header.title": { id: "header.title", type: "text", text: "真实页面标题" } } };
    const preview = createProjectPreview(snapshot);
    expect(preview.slide?.id).toBe(product.id);
    expect(preview.slide?.editor?.elementOverrides?.["header.title"].text).toBe("真实页面标题");
    expect(preview.slide?.id).not.toBe(cover.id);
  });
  it("preserves explicit brand overrides", () => {
    const snapshot = fixture(); snapshot.project.design.brandColor = "#123456";
    expect(createProjectPreview(snapshot).meta.design.brandColor).toBe("#123456");
  });
  it("never considers a user-supplied name replaceable", () => {
    expect(isDefaultProjectName("招商银行秋季福利方案")).toBe(false);
    expect(isDefaultProjectName("未命名产品手册")).toBe(true);
  });
  it("uses source filename and a timestamp/discriminator for default names", () => {
    const name = suggestProjectName(catalogMeta, "招商银行秋季福利.xlsx", new Date("2026-09-07T07:00:00Z"), "abc123");
    expect(name).toContain("招商银行秋季福利");
    expect(name).not.toContain(".xlsx");
    expect(name).toContain("09071500-c123");
    expect(name.length).toBeLessThanOrEqual(120);
  });
});
