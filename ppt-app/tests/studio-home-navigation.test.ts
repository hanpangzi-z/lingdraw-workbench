import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("studio home navigation", () => {
  it("links the top-left brand directly to the PPT workspace homepage", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "components/studio/CatalogStudio.tsx"),
      "utf8",
    );

    expect(source).toContain(
      '<a className="studio-brand" href="/ppt/projects" aria-label="返回PPT工作台首页">',
    );
    expect(source).not.toContain('<div className="studio-brand">');
  });
});
