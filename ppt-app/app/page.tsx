import { redirect } from "next/navigation";
import { currentUser } from "@/src/server/auth/session";

export default async function Home() {
  redirect((await currentUser()) ? "/projects" : "/login");
}
