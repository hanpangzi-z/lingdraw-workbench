"use client";

import { createContext, useContext } from "react";
import type { CanvasElementOverride } from "@/types/editor";

const CanvasOverrideContext = createContext<Record<string, CanvasElementOverride>>({});

export const CanvasOverrideProvider = CanvasOverrideContext.Provider;

export function useCanvasOverrideResolver() {
  const overrides = useContext(CanvasOverrideContext);
  return (elementId: string) => overrides[elementId];
}

export function useCanvasTextResolver() {
  const overrides = useContext(CanvasOverrideContext);
  return (elementId: string, fallback: string) => overrides[elementId]?.text ?? fallback;
}
