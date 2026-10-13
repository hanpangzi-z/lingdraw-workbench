"use client";

import { useEffect, useRef, useState } from "react";
import { BusinessRedSlide } from "@/components/templates/business-red/BusinessRedSlide";
import { FreeformCanvas } from "@/components/studio/FreeformCanvas";
import { pptFetch } from "@/src/lib/basePath";
import type { ProjectPagePreview } from "@/src/lib/cloud/projectPreview";

const noop = () => undefined;

export function ProjectPageThumbnail({ projectId, name, revision }: { projectId: string; name: string; revision: number }) {
  const root = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState<ProjectPagePreview>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: "150px" });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setError(false); setPreview(undefined);
    void pptFetch(`/api/projects/${projectId}/preview?revision=${revision}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("preview unavailable");
      const payload: ProjectPagePreview = await response.json();
      if (!controller.signal.aborted) setPreview(payload);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [projectId, revision, visible, attempt]);
  return <span ref={root} className="project-page-preview" role="group" aria-label={`${name}，首个可见页面预览`} onErrorCapture={() => setError(true)}>
    {!error && preview?.slide ? <span className="slide-frame" aria-hidden="true" inert>
      <FreeformCanvas slideId={preview.slide.id} editState={preview.slide.editor} editable={false} onSelect={noop} onPatch={noop} onReset={noop}>
        <BusinessRedSlide slide={preview.slide} meta={preview.meta} products={preview.products} categories={preview.categories} totalSlides={preview.totalSlides} />
      </FreeformCanvas>
    </span> : <span className="project-preview-placeholder">{error ? "页面预览暂不可用" : preview ? "暂无可见页面" : "正在加载真实页面…"}{error && <span role="button" tabIndex={0} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setAttempt((value) => value + 1); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); setAttempt((value) => value + 1); } }}>重试预览</span>}</span>}
  </span>;
}
