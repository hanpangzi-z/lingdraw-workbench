import JSZip from "jszip";
import { importLimits } from "../config";
import { detectFileType } from "../detectFileType";
import { hashBytes, mimeFromFileName, readImageDimensions } from "./xml";
import type { ImportedImage } from "../types";

export async function readSupportingImages(files: File[]) {
  if (files.length > importLimits.supportingMaxFiles) throw new Error(`附加文件超过 ${importLimits.supportingMaxFiles} 个限制。`);
  const images: ImportedImage[] = [];
  for (const file of files) {
    const type = detectFileType(file.name);
    if (type === "image") {
      images.push({ id: `support-image-${images.length + 1}`, fileName: file.name, url: URL.createObjectURL(file), classification: "possibleProductImage" });
      if (images.length > importLimits.supportingMaxFiles) throw new Error(`附加图片超过 ${importLimits.supportingMaxFiles} 张限制。`);
      continue;
    }
    if (type !== "archive") continue;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    for (const path of Object.keys(zip.files).filter((name) => /\.(?:png|jpe?g|webp|gif)$/i.test(name) && !zip.files[name].dir)) {
      const entry = zip.file(path);
      if (!entry) continue;
      const bytes = await entry.async("uint8array");
      const base64 = await entry.async("base64");
      images.push({
        id: `support-image-${images.length + 1}`,
        fileName: path.split("/").pop(),
        url: `data:${mimeFromFileName(path)};base64,${base64}`,
        ...readImageDimensions(bytes, path),
        hash: hashBytes(bytes),
        classification: "possibleProductImage",
      });
      if (images.length > importLimits.supportingMaxFiles) throw new Error(`ZIP 内图片超过 ${importLimits.supportingMaxFiles} 张限制。`);
    }
  }
  return images;
}

function normalizeKey(value?: string) {
  return (value ?? "").toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9一-鿿]/g, "");
}

export function matchSupportingImages(candidates: import("../types").ProductCandidate[], images: ImportedImage[]) {
  let matched = 0;
  const result = candidates.map((candidate) => {
    if (candidate.images?.length) return candidate;
    const sku = normalizeKey(candidate.sku);
    const name = normalizeKey(candidate.name);
    const matches = images.filter((image) => {
      const fileName = normalizeKey(image.fileName);
      return Boolean(fileName && ((sku && fileName.includes(sku)) || (name && (fileName.includes(name) || name.includes(fileName)))));
    });
    if (!matches.length) return candidate;
    matched += 1;
    return { ...candidate, images: matches.map((image) => image.url), fieldConfidence: { ...candidate.fieldConfidence, image: 0.9 } };
  });
  return { candidates: result, matched };
}
