import { z } from "zod";
import { requireUser } from "@/src/server/auth/session";
import { saveProject } from "@/src/server/projects/service";
import { errorResponse, ValidationError } from "@/src/server/errors";
import type { CloudProjectSnapshot } from "@/src/server/projects/types";

const requestSchema = z.object({
  requestId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  snapshot: z.object({
    project: z.object({ design: z.object({}).passthrough() }).passthrough(),
    products: z.array(z.object({
      id: z.string().min(1), name: z.string().trim().min(1),
      price: z.object({}).passthrough(),
    }).passthrough()).min(1),
    editorState: z.object({}).passthrough(),
    layoutOverrides: z.record(z.string(), z.unknown()),
    layoutMode: z.string(),
  }).passthrough(),
});

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireUser();
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) throw new ValidationError("重新导入数据无效，请返回数据确认检查商品");
    const { requestId, expectedRevision, snapshot } = parsed.data;
    const result = await saveProject(user.id, (await context.params).projectId, expectedRevision, snapshot as unknown as CloudProjectSnapshot, { reimportRequestId: requestId });
    return Response.json(result);
  } catch (error) { return errorResponse(error); }
}
