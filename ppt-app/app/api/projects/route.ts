import { requireUser } from "@/src/server/auth/session";
import { createProject, listProjects } from "@/src/server/projects/service";
import { errorResponse } from "@/src/server/errors";
import { getProjectByCreationKey } from "@/src/server/projects/service";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const creationKey = url.searchParams.get("creationKey");
    if (creationKey) return Response.json({ project: await getProjectByCreationKey(user.id, creationKey) });
    const result = await listProjects(user.id, {
      page: Number(url.searchParams.get("page") || 1), pageSize: Number(url.searchParams.get("pageSize") || 20),
      search: url.searchParams.get("search") || undefined, sort: url.searchParams.get("sort") || undefined, trash: url.searchParams.get("trash") === "true",
    });
    return Response.json(result);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    return Response.json(await createProject(user.id, body), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
