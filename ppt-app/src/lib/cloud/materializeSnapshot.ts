import type { CloudProjectSnapshot } from "@/src/server/projects/types";
import type { ClientAssetType } from "./upload";
import { pptFetch } from "@/src/lib/basePath";

type Upload = (file: File, type: ClientAssetType) => Promise<{ url: string }>;

/** Freeze the supplied snapshot; never read live editor state during uploads. */
export async function materializeSnapshot(snapshot: CloudProjectSnapshot, upload: Upload, cache = new Map<string, string>()): Promise<CloudProjectSnapshot> {
  const materialize = async (value: unknown, type: ClientAssetType = "product_image"): Promise<unknown> => {
    if (typeof value === "string" && (value.startsWith("data:") || value.startsWith("blob:"))) {
      const cached = cache.get(value);
      if (cached) return cached;
      const response = await pptFetch(value);
      if (!response.ok) throw new Error("无法读取待上传图片，原项目未被替换");
      const blob = await response.blob();
      const extension = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
      const asset = await upload(new File([blob], `${type}-${Date.now()}.${extension}`, { type: blob.type || "image/jpeg" }), type);
      cache.set(value, asset.url);
      return asset.url;
    }
    if (Array.isArray(value)) return Promise.all(value.map((item) => materialize(item, type)));
    if (value && typeof value === "object") {
      return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await materialize(child, type)])));
    }
    return value;
  };
  const project = { ...snapshot.project, design: { ...snapshot.project.design } };
  if (project.logo) project.logo = await materialize(project.logo, "logo") as string;
  if (project.design.logo) project.design.logo = await materialize(project.design.logo, "logo") as string;
  return {
    ...snapshot, project,
    products: await materialize(snapshot.products) as CloudProjectSnapshot["products"],
    editorState: await materialize(snapshot.editorState) as CloudProjectSnapshot["editorState"],
    batchConfig: await materialize(snapshot.batchConfig),
  };
}
