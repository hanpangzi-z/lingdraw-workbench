import { requireUser } from "@/src/server/auth/session";
import { getImageJob } from "@/src/server/ai/imageJobs";
import { errorResponse } from "@/src/server/errors";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try { const user = await requireUser(); const { jobId } = await params; return Response.json(await getImageJob(user, jobId), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
