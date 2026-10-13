import { CloudProjectProvider } from "./CloudProjectContext";
import { CatalogWorkflow } from "@/components/workflow/CatalogWorkflow";
import type { ProjectDetailDto } from "@/src/server/projects/types";

export function CloudProjectWorkspace({ project, layoutDebug = false }: { project: ProjectDetailDto; layoutDebug?: boolean }) {
  return <CloudProjectProvider key={project.id} initialProject={project}><CatalogWorkflow layoutDebug={layoutDebug} cloudMode /></CloudProjectProvider>;
}
