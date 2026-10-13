"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";

export function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

// Mount only while work is active so every new attempt gets its own clock.
export function WorkflowProgress({ message, percent }: { message: string; percent?: number }) {
  const [started] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 1000);
    return () => window.clearInterval(timer);
  }, [started]);
  const value = percent !== undefined && Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : undefined;
  return <div className="workflow-operation-progress">
    <div className="workflow-operation-heading"><strong role="status">{message}</strong><span>已用时 {formatElapsed(elapsed)}</span></div>
    <div className={`workflow-operation-track${value === undefined ? " is-indeterminate" : ""}`} role="progressbar" aria-label={message} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <i style={value === undefined ? undefined : { width: `${value}%` }} />
    </div>
    <small>{value === undefined ? "正在处理，暂无法准确预计剩余时间" : `当前阶段 ${Math.round(value)}%（不是整体进度）`} · 请勿重复点击或关闭页面</small>
  </div>;
}

export function WorkflowNextAction({ label, message, disabled, action }: {
  label: string; message: string; disabled?: boolean; action: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = async () => {
    if (locked.current || disabled) return;
    locked.current = true;
    setError("");
    setBusy(true);
    try {
      // Give the busy state a paint before synchronous parsing/rendering begins.
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      if (!mounted.current) return;
      await action();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "处理失败，请重试");
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <div className="workflow-next-action">
    {busy && <WorkflowProgress message={message} />}
    {error && <div className="inline-error" role="alert">{error}</div>}
    <button className="primary-action" type="button" disabled={disabled || busy} aria-busy={busy} onClick={() => void run()}>
      {busy ? message : label}
      {busy ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
    </button>
  </div>;
}
