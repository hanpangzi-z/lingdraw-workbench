import { redirect } from "next/navigation";
import { currentUser } from "@/src/server/auth/session";
import { ProjectDashboard } from "@/components/cloud/ProjectDashboard";

export default async function ProjectsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <ProjectDashboard />;
}
