import { redirect } from "next/navigation";
import { currentUser } from "@/src/server/auth/session";
import { AssetLibrary } from "@/components/library/AssetLibrary";

export default async function AssetsPage() {
  const user = await currentUser(); if (!user) redirect("/login");
  return <AssetLibrary />;
}
