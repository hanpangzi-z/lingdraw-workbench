import { redirect } from "next/navigation";
import { PendingProjectEntry } from "@/components/cloud/PendingProjectEntry";
import { currentUser } from "@/src/server/auth/session";

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string; draft?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { intent, draft } = await searchParams;
  return (
    <PendingProjectEntry
      userId={user.id}
      draftId={draft && /^[a-zA-Z0-9-]{1,128}$/.test(draft) ? draft : undefined}
      initialName={intent === "import" ? "新导入项目" : "未命名产品手册"}
      layoutDebug={process.env.SHOW_LAYOUT_DEBUG === "true"}
    />
  );
}
