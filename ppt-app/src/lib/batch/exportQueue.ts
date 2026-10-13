import JSZip from "jszip";
import { getProjectCategories } from "@/src/lib/catalog/categories";
import { buildPpt } from "@/src/lib/ppt/generatePpt";
import type { BatchExportLog, ResolvedBatchProject } from "@/types/batch";

export interface BatchExportOutput {
  zip: Blob | Uint8Array;
  zipName: string;
  succeeded: number;
  failed: number;
  logs: BatchExportLog[];
  failedGroupIds: string[];
}

interface QueueOptions {
  zipName: string;
  onProgress?: (logs: BatchExportLog[], currentName?: string) => void;
  generateJob?: (job: ResolvedBatchProject) => Promise<Uint8Array>;
}

async function generatePptBytes(job: ResolvedBatchProject) {
  const result = await buildPpt({
    meta: job.project,
    products: job.products,
    categories: getProjectCategories(job.products),
    slidePlans: job.slidePlans,
    editorState: job.group.editorSession?.editorState,
  });
  return result.presentation.write({ outputType: "uint8array", compression: true }) as Promise<Uint8Array>;
}

export async function runBatchExportQueue(jobs: ResolvedBatchProject[], options: QueueOptions): Promise<BatchExportOutput> {
  const zip = new JSZip();
  const logs: BatchExportLog[] = jobs.map((job) => ({
    groupId: job.group.id,
    projectName: job.group.name,
    fileName: job.fileName,
    pageCount: job.pageCount,
    status: "queued",
  }));
  const generator = options.generateJob ?? generatePptBytes;

  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    logs[index] = { ...logs[index], status: "generating", startedAt: Date.now() };
    options.onProgress?.([...logs], job.group.name);
    try {
      const bytes = await generator(job);
      zip.file(job.fileName, bytes);
      logs[index] = { ...logs[index], status: "completed", completedAt: Date.now() };
    } catch (error) {
      const message = error instanceof Error ? error.message : "PPT 生成失败";
      console.error(`[Batch Export] ${job.group.name} 生成失败`, error);
      logs[index] = { ...logs[index], status: "failed", completedAt: Date.now(), error: message };
    }
    options.onProgress?.([...logs], jobs[index + 1]?.group.name);
  }

  const succeeded = logs.filter((log) => log.status === "completed").length;
  const failed = logs.filter((log) => log.status === "failed").length;
  const outputType = typeof Blob === "undefined" ? "uint8array" : "blob";
  const zipOutput = await zip.generateAsync({ type: outputType, compression: "DEFLATE", compressionOptions: { level: 6 } }) as Blob | Uint8Array;
  return {
    zip: zipOutput,
    zipName: options.zipName,
    succeeded,
    failed,
    logs,
    failedGroupIds: logs.filter((log) => log.status === "failed").map((log) => log.groupId),
  };
}

export function downloadBatchZip(output: BatchExportOutput) {
  if (typeof window === "undefined") return;
  const blob = output.zip instanceof Blob ? output.zip : new Blob([output.zip as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = output.zipName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}
