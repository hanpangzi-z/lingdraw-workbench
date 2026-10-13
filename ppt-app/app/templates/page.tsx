import { redirect } from "next/navigation";
import { currentUser } from "@/src/server/auth/session";
import { TemplateLibrary } from "@/components/library/TemplateLibrary";

export default async function TemplatesPage() {
  const user = await currentUser(); if (!user) redirect("/login");
  return <TemplateLibrary />;
}
