"use client";

import { useEffect, useSyncExternalStore } from "react";
import { isEnglishPptLanguage, resolvePptLocalizedValue, type PptLocalizedValueState } from "@/src/lib/pptI18n";

const SKIP_SELECTOR = ".template-live-preview, [data-canvas-element], .freeform-text-editor, [contenteditable='true'], [data-ppt-no-translate], [translate='no'], .notranslate, .asset-resource-grid article > strong, .utility-list article > div > strong, .source-text-preview pre, script, style";
const ATTRIBUTES = ["placeholder", "title", "aria-label"] as const;

const localizedText = new WeakMap<Node, PptLocalizedValueState>();
const localizedAttributes = new WeakMap<Element, Map<string, PptLocalizedValueState>>();

function subscribe(callback: () => void) {
  window.addEventListener("ppt:lang-change", callback);
  return () => window.removeEventListener("ppt:lang-change", callback);
}

function languageSnapshot() {
  return document.documentElement.lang || "zh-CN";
}

export function usePptI18n() {
  const language = useSyncExternalStore(subscribe, languageSnapshot, () => "zh-CN");
  return { language, isEnglish: isEnglishPptLanguage(language), t: (zh: string, en: string) => isEnglishPptLanguage(language) ? en : zh };
}

function skipped(element: Element | null) {
  return Boolean(element?.closest(SKIP_SELECTOR));
}

function localizeTextNode(node: Node, language: string) {
  const current = node.nodeValue || "";
  const resolved = resolvePptLocalizedValue(current, language, localizedText.get(node));
  localizedText.set(node, resolved.state);
  if (resolved.value !== current) node.nodeValue = resolved.value;
}

function localizeAttributes(element: Element, language: string) {
  if (skipped(element)) return;
  let states = localizedAttributes.get(element);
  if (!states) {
    states = new Map();
    localizedAttributes.set(element, states);
  }
  for (const attribute of ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (value) {
      const resolved = resolvePptLocalizedValue(value, language, states.get(attribute));
      states.set(attribute, resolved.state);
      if (resolved.value !== value) element.setAttribute(attribute, resolved.value);
    } else {
      states.delete(attribute);
    }
  }
}

function localizeElement(element: Element, language: string) {
  if (skipped(element)) return;
  localizeAttributes(element, language);
  element.querySelectorAll("*").forEach((descendant) => localizeAttributes(descendant, language));
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (!skipped(node.parentElement)) localizeTextNode(node, language);
    node = walker.nextNode();
  }
}

export function PptDomLocalizer() {
  const { language } = usePptI18n();
  useEffect(() => {
    localizeElement(document.body, language);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.target instanceof Element) {
          localizeElement(mutation.target, language);
        }
        if (mutation.type === "characterData" && mutation.target.parentElement && !skipped(mutation.target.parentElement)) {
          localizeTextNode(mutation.target, language);
        }
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) localizeElement(node, language);
          else if (node.nodeType === Node.TEXT_NODE && node.parentElement && !skipped(node.parentElement)) {
            localizeTextNode(node, language);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES], subtree: true });
    return () => observer.disconnect();
  }, [language]);
  return null;
}
