import type { ProjectSummaryDto } from "@/src/server/projects/types";

export function findReusableEmptyDraft(
  projects: ProjectSummaryDto[],
  expectedName: string,
) {
  return projects
    .filter(
      (project) =>
        project.name === expectedName &&
        project.status === "draft" &&
        project.productCount === 0 &&
        project.categoryCount === 0 &&
        project.slideCount <= 2,
    )
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime(),
    )[0];
}
