import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("editor action accessibility", () => {
  it("keeps emphasized save text visible on hover and keyboard focus", () => {
    const styles = read("app/lingdraw.css");

    expect(styles).toMatch(
      /\.save-now-button\.is-emphasized:hover\s*\{[\s\S]*?color:\s*#fff;/,
    );
    expect(styles).toMatch(
      /\.studio-header \.save-now-button\.is-emphasized:focus-visible\s*\{[\s\S]*?color:\s*#fff;/,
    );
  });

  it("provides stable names for icon-only editor actions", () => {
    const studio = read("components/studio/CatalogStudio.tsx");
    const toolbar = read("components/studio/CanvasTopToolbar.tsx");
    const canvas = read("components/studio/FreeformCanvas.tsx");

    for (const label of [
      "撤销",
      "重做",
      "商品库更新",
      "项目文件",
      "版本历史",
      "重新智能排版",
      "缩小页面",
      "放大页面",
    ]) {
      expect(studio).toContain(`aria-label="${label}"`);
    }
    expect(toolbar).toContain('aria-label="恢复元素默认位置与样式"');
    expect(canvas).toContain('aria-label="隐藏元素"');
  });

  it("uses 44px targets for the audited project menu and view controls", () => {
    const dashboard = read("components/cloud/ProjectDashboard.tsx");
    const styles = read("app/cloud.css");

    expect(dashboard).toContain('aria-label="网格视图"');
    expect(dashboard).toContain('aria-label="列表视图"');
    expect(dashboard).toContain("项目操作菜单`}");
    expect(styles).toContain(
      ".view-switch button { display: grid; width: 44px; height: 44px;",
    );
    expect(styles).toContain(
      ".project-card-body > button { display: grid; width: 44px; height: 44px;",
    );
    expect(styles).toContain(
      ".project-card-menu a { display: flex; height: 44px;",
    );
  });
});
