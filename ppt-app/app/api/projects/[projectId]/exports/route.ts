import { requireUser } from "@/src/server/auth/session";
import { saveGeneratedExport } from "@/src/server/exports/service";
import { errorResponse, ValidationError } from "@/src/server/errors";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("缺少 PPTX 文件");
    const snapshotRaw = form.get("snapshot");
    const expectedRevision = Number(form.get("expectedRevision"));
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1 || typeof snapshotRaw !== "string") throw new ValidationError("导出必须绑定已保存快照及修订号");
    return Response.json(await saveGeneratedExport({
      userId: user.id, projectId: (await context.params).projectId, file,
      pageCount: Number(form.get("pageCount") || 0),
      expectedRevision,
      snapshot: typeof snapshotRaw === "string" ? JSON.parse(snapshotRaw) : undefined,
    }), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
