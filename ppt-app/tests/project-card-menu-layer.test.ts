import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("project card action menu", () => {
  it("raises the card with an open menu above later grid cards", () => {
    const component = fs.readFileSync(
      path.join(process.cwd(), "components/cloud/ProjectDashboard.tsx"),
      "utf8",
    );
    const styles = fs.readFileSync(
      path.join(process.cwd(), "app/cloud.css"),
      "utf8",
    );

    expect(component).toContain('menuId === project.id ? "is-menu-open" : ""');
    expect(styles).toContain(".project-card.is-menu-open { z-index: 10; }");
  });
});
