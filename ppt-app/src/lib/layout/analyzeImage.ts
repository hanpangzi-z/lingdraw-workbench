import { getProductImages } from "@/src/lib/catalog/images";
import type { Product } from "@/types/catalog";
import { LAYOUT_RULES } from "./layoutRules";
import type { ImageAnalysis, ProductImageType } from "./types";

function bytesFromDataUrl(source: string) {
  const match = source.match(/^data:[^;,]+;base64,(.+)$/);
  if (!match) return undefined;
  try {
    if (typeof atob === "function") return Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0));
    return Uint8Array.from(Buffer.from(match[1], "base64"));
  } catch {
    return undefined;
  }
}

function readImageDimensions(source?: string) {
  if (!source?.startsWith("data:")) return undefined;
  const bytes = bytesFromDataUrl(source);
  if (!bytes || bytes.length < 24) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) === 0x89504e47) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: (bytes[offset + 5] << 8) + bytes[offset + 6], width: (bytes[offset + 7] << 8) + bytes[offset + 8] };
    }
    if (length < 2) break;
    offset += length + 2;
  }
  return undefined;
}

export function classifyImageType(aspectRatio?: number): ProductImageType {
  if (!aspectRatio || !Number.isFinite(aspectRatio)) return "unknown";
  if (aspectRatio < LAYOUT_RULES.imageRatio.tall) return "tall";
  if (aspectRatio < LAYOUT_RULES.imageRatio.squareMin) return "portrait";
  if (aspectRatio <= LAYOUT_RULES.imageRatio.squareMax) return "square";
  if (aspectRatio > LAYOUT_RULES.imageRatio.wide) return "wide";
  return "landscape";
}

export function analyzeImage(product: Product): ImageAnalysis {
  const source = getProductImages(product)[0];
  const dimensions = product.imageMetadata ?? readImageDimensions(source);
  const aspectRatio = dimensions?.width && dimensions?.height ? dimensions.width / dimensions.height : undefined;
  const shortestEdge = dimensions ? Math.min(dimensions.width, dimensions.height) : 0;
  const quality = !dimensions ? "unknown" : shortestEdge >= 1200 ? "excellent" : shortestEdge >= 700 ? "good" : "low";
  return {
    hasImage: Boolean(source),
    width: dimensions?.width,
    height: dimensions?.height,
    aspectRatio,
    imageType: classifyImageType(aspectRatio),
    quality,
  };
}
