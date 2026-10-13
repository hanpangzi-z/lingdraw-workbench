import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { requireUser } from "@/src/server/auth/session";
import { executeImageGeneration } from "@/src/server/ai/imageGeneration";
import { beginImageJob, publicImageJob, runImageJob } from "@/src/server/ai/imageJobs";
import { errorResponse } from "@/src/server/errors";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const form = await request.formData();
    const jobId = String(form.get("jobId") || "");
    // Compatibility for already-open older frontends; new clients use short acknowledgements.
    if (!jobId) return executeImageGeneration(user, form, randomUUID());
    const { job, created } = await beginImageJob(user, form, jobId);
    if (created) after(() => runImageJob(job, user, form));
    return Response.json(publicImageJob(job), { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
