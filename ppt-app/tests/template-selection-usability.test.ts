import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { catalogMeta } from "@/data/catalog";
import { createTemplatePreviewDesign } from "@/src/templates/registry";
import { getTheme, resolveTheme } from "@/src/themes/registry";

describe("template selection usability", () => {
  it("uses each template default color in previews instead of the project brand color", () => {
    const preview = createTemplatePreviewDesign(
      { ...catalogMeta.design, brandColor: "#FF00FF" },
      "corporate-blue",
    );
    const theme = resolveTheme(
      preview.themeId,
      preview.themeOverrides,
      preview.brandColor,
    );

    expect(preview.brandColor).toBeUndefined();
    expect(preview.themeOverrides).toEqual({});
    expect(theme.colors.primary).toBe(getTheme("corporate-blue").colors.primary);
    expect(theme.colors.primary).not.toBe("#FF00FF");
  });

  it("gives every apply button a template-specific accessible name", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "components/studio/TemplateGallery.tsx"),
      "utf8",
    );

    expect(source).toContain("aria-label={");
    expect(source).toContain("`应用模板：${template.name}`");
    expect(source).toContain("`Apply template: ${template.nameEn}`");
  });

  it("keeps the complete primary navigation available below 760px", () => {
    const navigation = fs.readFileSync(
      path.join(process.cwd(), "components/library/ResourceNavigation.tsx"),
      "utf8",
    );
    const styles = fs.readFileSync(
      path.join(process.cwd(), "app/library.css"),
      "utf8",
    );

    expect(navigation).toContain("PPT 工作台主导航");
    expect(navigation).toContain('aria-current={active ? "page" : undefined}');
    expect(styles).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.resource-topbar nav \{ display: flex;/,
    );
  });
});
