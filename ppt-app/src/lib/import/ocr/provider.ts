import type { OCRProvider } from "../types";

export class UnconfiguredOCRProvider implements OCRProvider {
  id = "unconfigured";
  async recognizePage(): Promise<never> {
    throw new Error("OCR Provider 尚未配置。");
  }
}

export function hasUsableOCRProvider(provider?: OCRProvider) {
  return Boolean(provider && provider.id !== "unconfigured");
}
