import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/src/server/auth/session";
import { getProject } from "@/src/server/projects/service";
import { NotFoundError } from "@/src/server/errors";
import { CloudProjectWorkspace } from "@/components/cloud/CloudProjectWorkspace";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  try {
    const project = await getProject(user.id, (await params).projectId);
    return <CloudProjectWorkspace project={project} layoutDebug={process.env.SHOW_LAYOUT_DEBUG === "true"} />;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
