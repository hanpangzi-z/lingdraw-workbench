import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/src/server/auth/session";
import { getProject } from "@/src/server/projects/service";
import { NotFoundError } from "@/src/server/errors";
import { ReimportProjectWorkspace } from "@/components/cloud/ReimportProjectWorkspace";

export default async function ReimportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  try {
    const project = await getProject(user.id, (await params).projectId);
    return <ReimportProjectWorkspace project={project} />;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
