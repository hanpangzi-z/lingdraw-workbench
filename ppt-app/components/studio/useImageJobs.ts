"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { generateProductImage, pollImageJob } from "@/src/lib/ai/generateProductImageClient";
import { ImageJobFailedError, type ImageJobResult } from "@/src/lib/ai/imageJobProtocol";
import type { AiImageGenerationRequest, AiImageGenerationState } from "./FreeformCanvas";
export type PendingImageJob = { jobId: string; projectId?: string; slideId: string; elementId: string; label: string; createdAt: number; originalSource?: string };
export type ImageJobView = PendingImageJob & AiImageGenerationState & { result?: ImageJobResult };
export const imageJobKey = (job: Pick<PendingImageJob, "slideId" | "elementId">) => `${job.slideId}::${job.elementId}`;
const storageKey = (projectId: string) => `ppt-image-jobs:${projectId}`;
function load(projectId?: string): PendingImageJob[] {
  if (!projectId) return [];
  const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(projectId)) || "[]");
  if (!Array.isArray(parsed)) throw new Error("绘图任务记录无法读取，已停止提交新任务");
  if (parsed.some(job => job?.projectId !== projectId || typeof job?.jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(job.jobId) || typeof job.slideId !== "string" || typeof job.elementId !== "string" || !Number.isFinite(job.createdAt))) throw new Error("绘图任务记录不完整，请联系管理员，暂不提交新任务");
  return parsed;
}
function remember(job: PendingImageJob) {
  if (!job.projectId) return;
  const jobs = load(job.projectId);
  // Image sources may be multi-megabyte data URLs. Recovery needs only small IDs.
  const { originalSource: _source, ...receipt } = job;
  localStorage.setItem(storageKey(job.projectId), JSON.stringify([...jobs.filter(item => item.jobId !== job.jobId), receipt]));
}
function forget(job: PendingImageJob) {
  if (job.projectId) localStorage.setItem(storageKey(job.projectId), JSON.stringify(load(job.projectId).filter(item => item.jobId !== job.jobId)));
}

export function useImageJobs(projectId: string | undefined, apply: (job: PendingImageJob, result: ImageJobResult, automatic: boolean) => Promise<boolean>) {
  const [jobs, setJobs] = useState<Record<string, ImageJobView>>({});
  const [storageError, setStorageError] = useState("");
  const active = useRef(new Map<string, AbortController>());
  const targets = useRef(new Set<string>());
  const applying = useRef(new Set<string>());
  const scope = useRef(projectId); scope.current = projectId;
  const applyRef = useRef(apply); applyRef.current = apply;
  const mounted = useRef(false);
  const remove = useCallback((job: PendingImageJob) => {
    try { forget(job); targets.current.delete(imageJobKey(job)); setJobs(current => { const next = { ...current }; delete next[imageJobKey(job)]; return next; }); }
    catch { setStorageError("无法更新本机任务记录，请勿重复生成"); }
  }, []);
  const run = useCallback((job: PendingImageJob, request?: AiImageGenerationRequest) => {
    if (active.current.has(job.jobId)) return;
    targets.current.add(imageJobKey(job));
    const controller = new AbortController(); active.current.set(job.jobId, controller);
    const valid = () => mounted.current && !controller.signal.aborted && scope.current === job.projectId;
    const update = (patch: Partial<ImageJobView>) => { if (valid()) setJobs(current => ({ ...current, [imageJobKey(job)]: { ...job, ...current[imageJobKey(job)], status: "generating", ...patch } })); };
    update({ status: "generating", message: request ? "准备提交任务" : "正在查询原任务", error: undefined });
    const options = { jobId: job.jobId, signal: controller.signal, onProgress: (progress: { message: string }) => update({ message: progress.message, elapsedSeconds: Math.max(0, Math.floor((Date.now() - job.createdAt) / 1000)) }) };
    void (request ? generateProductImage(request, options) : pollImageJob(job.jobId, options)).then(async result => {
      if (!valid()) return;
      update({ status: "ready", message: "图片已生成，可应用结果", result });
      // On refresh/query recovery the user chooses when to apply, preserving newer edits.
      if (request && await applyRef.current(job, result, true) && valid()) remove(job);
    }).catch(error => {
      if (!valid()) return;
      update({ status: error instanceof ImageJobFailedError ? "error" : "waiting", message: undefined, error: error instanceof Error ? error.message : "查询中断，请继续查询原任务" });
    }).finally(() => { if (active.current.get(job.jobId) === controller) active.current.delete(job.jobId); });
  }, [remove]);
  useEffect(() => {
    mounted.current = true; targets.current.clear(); setJobs({}); setStorageError("");
    try { for (const job of load(projectId)) run(job); }
    catch (error) { setStorageError(error instanceof Error ? error.message : "无法读取绘图任务记录"); }
    return () => { mounted.current = false; for (const controller of active.current.values()) controller.abort(); active.current.clear(); };
  }, [projectId, run]);
  useEffect(() => {
    const timer = setInterval(() => setJobs(current => {
      if (!Object.values(current).some(job => job.status === "generating")) return current;
      return Object.fromEntries(Object.entries(current).map(([key, job]) => [key, job.status === "generating" ? { ...job, elapsedSeconds: Math.max(0, Math.floor((Date.now() - job.createdAt) / 1000)) } : job]));
    }), 1000);
    return () => clearInterval(timer);
  }, []);
  const start = (request: AiImageGenerationRequest, originalSource?: string) => {
    if (storageError || targets.current.has(imageJobKey(request))) return;
    // The persistent ID is established before any paid request is submitted.
    const job: PendingImageJob = { jobId: crypto.randomUUID(), projectId, slideId: request.slideId, elementId: request.elementId, label: request.label, createdAt: Date.now(), originalSource };
    try {
      const existing = load(projectId).find(item => imageJobKey(item) === imageJobKey(request));
      if (existing) { run(existing); return; }
      remember(job); run(job, request);
    }
    catch { setStorageError("本机无法保留任务编号，已停止提交，避免重复生成"); }
  };
  const applyResult = async (job: ImageJobView) => {
    if (!job.result || job.projectId !== scope.current || applying.current.has(job.jobId)) return;
    applying.current.add(job.jobId);
    try { if (await applyRef.current(job, job.result, false) && scope.current === job.projectId) remove(job); }
    finally { applying.current.delete(job.jobId); }
  };
  return { jobs, start, resume: run, remove, applyResult, storageError };
}
