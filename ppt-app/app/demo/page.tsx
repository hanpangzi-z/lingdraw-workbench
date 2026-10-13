import { redirect } from "next/navigation";
import { currentUser } from "@/src/server/auth/session";
import { ReadOnlyDemo } from "@/components/demo/ReadOnlyDemo";

export default async function DemoPage() {
  if (!(await currentUser())) redirect("/login");
  return <ReadOnlyDemo />;
}
