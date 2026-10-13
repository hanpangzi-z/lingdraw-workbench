import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("project dashboard deduplication", () => {
  it("does not render a recent-projects copy above the complete project list", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "components/cloud/ProjectDashboard.tsx"),
      "utf8",
    );
    const styles = ["app/cloud.css", "app/lingdraw.css"]
      .map((file) => fs.readFileSync(path.join(process.cwd(), file), "utf8"))
      .join("\n");

    expect(source).not.toContain('className="recent-projects"');
    expect(styles).not.toContain(".recent-projects");
    expect(source).toContain('useState<Sort>("recent")');
  });

  it("opens a pending workspace without posting an empty cloud project", () => {
    const dashboard = fs.readFileSync(
      path.join(process.cwd(), "components/cloud/ProjectDashboard.tsx"),
      "utf8",
    );
    const pendingWorkspace = fs.readFileSync(
      path.join(process.cwd(), "components/cloud/PendingProjectWorkspace.tsx"),
      "utf8",
    );

    expect(dashboard).toContain('router.push("/projects/new")');
    expect(dashboard).toContain('router.push("/projects/new?intent=import")');
    expect(dashboard).not.toContain('void create("新导入项目")');
    expect(pendingWorkspace).toContain('if (!snapshot.products.length)');
    expect(pendingWorkspace).toContain('createPendingProject(creationKey.current, snapshot.project.projectName || initialName, setSaveMessage)');
    // Initial creation sends only metadata. Image references are saved after
    // project-scoped uploads; no giant inline snapshot is sent twice.
    const transport = fs.readFileSync(path.join(process.cwd(), "src/lib/cloud/pendingTransport.ts"), "utf8");
    expect(transport).toContain('JSON.stringify({ name, creationKey })');
    expect(pendingWorkspace).not.toContain('initialName, snapshot, creationKey:');
    expect(pendingWorkspace).toContain('uploadSnapshotImages(project.id, snapshot, imageUploads.current, setSaveMessage)');
  });
});
