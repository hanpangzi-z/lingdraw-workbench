import type { ProductImageOverride } from "@/types/editor";

export const defaultCanvasImageOverride = (): ProductImageOverride => ({
  fit: "contain",
  scale: 1,
  offsetX: 0,
  offsetY: 0,
});

export function readImageFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("请选择图片文件"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("无法读取图片"));
    reader.onerror = () => reject(reader.error ?? new Error("无法读取图片"));
    reader.readAsDataURL(file);
  });
}
