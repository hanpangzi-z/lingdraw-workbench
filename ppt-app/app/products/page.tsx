import { redirect } from "next/navigation";
import { currentUser } from "@/src/server/auth/session";
import { ProductLibrary } from "@/components/library/ProductLibrary";

export default async function ProductsPage() {
  const user = await currentUser(); if (!user) redirect("/login");
  return <ProductLibrary />;
}
