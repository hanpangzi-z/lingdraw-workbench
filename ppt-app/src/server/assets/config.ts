function megabytesFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback);
  return (Number.isFinite(value) && value > 0 ? value : fallback) * 1024 * 1024;
}

export const MAX_UPLOAD_BYTES = megabytesFromEnv("MAX_UPLOAD_MB", 100);
export const MAX_GENERATED_PPT_BYTES = megabytesFromEnv("MAX_GENERATED_PPT_MB", 300);
export const CHUNK_UPLOAD_BYTES = 5 * 1024 * 1024;

export const ASSET_TYPE_TO_ROLE = {
  source_file: "source",
  product_image: "product_image",
  logo: "logo",
  generated_ppt: "export",
  thumbnail: "thumbnail",
} as const;

export function maxUploadBytesFor(type: keyof typeof ASSET_TYPE_TO_ROLE) {
  return type === "generated_ppt" ? MAX_GENERATED_PPT_BYTES : MAX_UPLOAD_BYTES;
}
