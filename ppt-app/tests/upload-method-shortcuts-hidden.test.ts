import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("upload page shortcuts", () => {
  it("does not render the redundant import-method shortcut row", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "components/workflow/UploadStep.tsx"),
      "utf8",
    );

    expect(source).not.toContain('className="import-method-grid"');
    expect(source).not.toContain('aria-label="创建方式"');
  });

  it("directs users to real source files instead of a hidden creation method or sample import", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "components/workflow/UploadStep.tsx"), "utf8");
    expect(source).toContain("请上传 Excel、PDF、Word 或 PPT 主资料，解析后继续");
    expect(source).not.toContain("请选择一种创建方式");
    expect(source).not.toContain("模拟数据预览");
    expect(source).not.toContain("useMockProducts");
    expect(source).not.toContain("allowDemoPreview");
  });

  it("isolates sample preview from project creation, import, save and export", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "components/demo/ReadOnlyDemo.tsx"), "utf8");
    const route = fs.readFileSync(path.join(process.cwd(), "app/demo/page.tsx"), "utf8");
    expect(source).toContain("示例预览 · 只读");
    expect(source).toContain("createTemplatePreviewDesign");
    expect(source).toContain('href="/projects"');
    for (const forbidden of ["useProjectStore", "useBatchStore", "CloudProjectProvider", "CatalogWorkflow", "fetch(", "generatePpt", "saveProject"]) {
      expect(source).not.toContain(forbidden);
      expect(route).not.toContain(forbidden);
    }
    expect(route).toContain("currentUser()");
    expect(route).toContain('<ReadOnlyDemo />');
  });
});
