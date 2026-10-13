"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { usePptI18n } from "./PptDomLocalizer";
import { translatePptText } from "@/src/lib/pptI18n";

type DialogKind = "alert" | "confirm" | "prompt";
type ToastTone = "info" | "success" | "error";
type DialogResult = boolean | string | null;

interface DialogRequest {
  id: number;
  kind: DialogKind;
  message: string;
  title?: string;
  defaultValue?: string;
  resolve: (value: DialogResult) => void;
}

interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
}

interface StudioDialogApi {
  alert: (message: string, title?: string) => Promise<void>;
  confirm: (message: string, title?: string) => Promise<boolean>;
  prompt: (message: string, defaultValue?: string, title?: string) => Promise<string | null>;
  notify: (message: string, tone?: ToastTone) => void;
}

const StudioDialogContext = createContext<StudioDialogApi | null>(null);

export function useStudioDialog() {
  const value = useContext(StudioDialogContext);
  if (!value) throw new Error("useStudioDialog must be used within StudioDialogProvider");
  return value;
}

export function StudioDialogProvider({ children }: { children: React.ReactNode }) {
  const { language, t } = usePptI18n();
  const nextId = useRef(0);
  const activeRef = useRef<DialogRequest | null>(null);
  const queueRef = useRef<DialogRequest[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState<DialogRequest | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const enqueue = useCallback((kind: DialogKind, message: string, defaultValue?: string, title?: string) => new Promise<DialogResult>((resolve) => {
    const request = { id: ++nextId.current, kind, message, defaultValue, title, resolve };
    if (activeRef.current) queueRef.current.push(request);
    else {
      activeRef.current = request;
      setActive(request);
    }
  }), []);

  const finish = useCallback((value: DialogResult) => {
    const current = activeRef.current;
    if (!current) return;
    current.resolve(value);
    const next = queueRef.current.shift() ?? null;
    activeRef.current = next;
    setActive(next);
  }, []);

  useEffect(() => {
    if (!active) return;
    setInputValue(active.defaultValue ?? "");
    if (active.kind === "prompt") window.requestAnimationFrame(() => inputRef.current?.select());
  }, [active]);

  useEffect(() => () => {
    activeRef.current?.resolve(activeRef.current.kind === "alert" ? true : null);
    for (const request of queueRef.current) request.resolve(request.kind === "alert" ? true : null);
  }, []);

  const notify = useCallback((message: string, tone: ToastTone = "info") => {
    const id = ++nextId.current;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
  }, []);

  const api = useMemo<StudioDialogApi>(() => ({
    alert: async (message, title) => { await enqueue("alert", message, undefined, title); },
    confirm: async (message, title) => Boolean(await enqueue("confirm", message, undefined, title)),
    prompt: async (message, defaultValue, title) => {
      const result = await enqueue("prompt", message, defaultValue, title);
      return typeof result === "string" ? result : null;
    },
    notify,
  }), [enqueue, notify]);

  const localized = (value: string) => value.split("\n").map((line) => translatePptText(line, language)).join("\n");
  const cancel = () => finish(active?.kind === "alert" ? true : null);
  const accept = () => finish(active?.kind === "prompt" ? inputValue : true);

  return (
    <StudioDialogContext.Provider value={api}>
      {children}
      {active && <div className="studio-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && cancel()}>
        <section className="studio-dialog" role={active.kind === "alert" ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby="studio-dialog-title" onKeyDown={(event) => {
          if (event.key === "Escape") cancel();
        }}>
          <header><span className={`is-${active.kind}`}><Info aria-hidden="true" /></span><h2 id="studio-dialog-title">{localized(active.title ?? (active.kind === "prompt" ? "请输入" : active.kind === "confirm" ? "确认操作" : "提示"))}</h2><button type="button" aria-label={t("关闭", "Close")} onClick={cancel}><X aria-hidden="true" /></button></header>
          <form onSubmit={(event) => { event.preventDefault(); accept(); }}>
            <p>{localized(active.message)}</p>
            {active.kind === "prompt" && <input ref={inputRef} value={inputValue} onChange={(event) => setInputValue(event.target.value)} aria-label={localized(active.message)} />}
            <footer>
              {active.kind !== "alert" && <button type="button" onClick={cancel}>{t("取消", "Cancel")}</button>}
              <button type="submit" className="is-primary">{active.kind === "alert" ? t("确定", "OK") : t("确认", "Confirm")}</button>
            </footer>
          </form>
        </section>
      </div>}
      <div className="studio-toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => <div className={`studio-toast is-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"} key={toast.id}>
          {toast.tone === "success" ? <CheckCircle2 aria-hidden="true" /> : toast.tone === "error" ? <AlertCircle aria-hidden="true" /> : <Info aria-hidden="true" />}
          <span>{localized(toast.message)}</span>
          <button type="button" aria-label={t("关闭", "Close")} onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}><X aria-hidden="true" /></button>
        </div>)}
      </div>
    </StudioDialogContext.Provider>
  );
}
