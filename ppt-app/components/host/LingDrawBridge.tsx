"use client";

import { useEffect } from "react";
import { observeHostAuthFailure } from "@/src/lib/basePath";

function messageValue(data: Record<string, unknown>, key: string) {
  const payload = typeof data.payload === "object" && data.payload ? data.payload as Record<string, unknown> : undefined;
  return data[key] ?? data.value ?? payload?.[key] ?? payload?.value;
}

export function LingDrawBridge() {

  useEffect(() => {
    const originalFetch = window.fetch;
    const observedFetch: typeof window.fetch = async (...args) => {
      const response = await originalFetch.apply(window, args);
      await observeHostAuthFailure(response);
      return response;
    };
    window.fetch = observedFetch;

    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return;
      const data = event.data as Record<string, unknown>;
      const type = String(data.type || "");
      if (type === "studio-theme") {
        const theme = String(messageValue(data, "theme") || "light").toLowerCase();
        const dark = theme === "dark";
        document.documentElement.classList.toggle("studio-theme-dark", dark);
        document.documentElement.classList.toggle("theme-dark", dark);
        document.body.classList.toggle("studio-theme-dark", dark);
        document.body.classList.toggle("theme-dark", dark);
        document.documentElement.dataset.theme = dark ? "dark" : "light";
      } else if (type === "studio-ui-scale") {
        const raw = Number(messageValue(data, "scale"));
        const scale = Number.isFinite(raw) ? Math.min(1.5, Math.max(0.75, raw)) : 1;
        document.documentElement.style.setProperty("--studio-ui-scale", String(scale));
      } else if (type === "studio-lang") {
        const lang = String(messageValue(data, "lang") || "zh-CN");
        document.documentElement.lang = lang;
        document.documentElement.dataset.lang = lang;
        window.dispatchEvent(new CustomEvent("ppt:lang-change", { detail: { lang } }));
      } else if (type === "studio-activate") {
        window.dispatchEvent(new CustomEvent("ppt:activate"));
      }
    };

    window.addEventListener("message", receive);
    if (window.parent !== window) window.parent.postMessage({ type: "ppt:ready" }, window.location.origin);
    return () => {
      window.removeEventListener("message", receive);
      if (window.fetch === observedFetch) window.fetch = originalFetch;
    };
  }, []);

  return null;
}
