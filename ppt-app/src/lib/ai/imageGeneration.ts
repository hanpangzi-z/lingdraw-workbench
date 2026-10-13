export interface ImageOutputSize {
  width: number;
  height: number;
  value: `${number}x${number}`;
  requestedAspectRatio: number;
}

export interface LingDrawImagePayload {
  image?: { base64?: string; mimeType?: string };
  model?: string;
  provider?: string;
  outputSize?: string;
  aspectRatio?: number;
  requestId?: string;
  billingStatus?: "reserved";
}

const MAX_GENERATED_IMAGE_BASE64_LENGTH = 70 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const DEFAULT_ASPECT_RATIO = 3 / 2;
const MAX_ASPECT_RATIO = 3;
const OUTPUT_LONG_EDGE = 1536;

function roundTo16(value: number) {
  return Math.max(16, Math.round(value / 16) * 16);
}

export function normalizeImageAspectRatio(value?: number) {
  if (!Number.isFinite(value) || !value || value <= 0) return DEFAULT_ASPECT_RATIO;
  return Math.min(MAX_ASPECT_RATIO, Math.max(1 / MAX_ASPECT_RATIO, value));
}

export function imageSizeForAspectRatio(value?: number, model = "gpt-image-2"): ImageOutputSize {
  const requestedAspectRatio = normalizeImageAspectRatio(value);

  if (!model.startsWith("gpt-image-2")) {
    const [width, height] = requestedAspectRatio > 1.15
      ? [1536, 1024]
      : requestedAspectRatio < 0.87
        ? [1024, 1536]
        : [1024, 1024];
    return { width, height, value: `${width}x${height}`, requestedAspectRatio };
  }

  const width = requestedAspectRatio >= 1 ? OUTPUT_LONG_EDGE : roundTo16(OUTPUT_LONG_EDGE * requestedAspectRatio);
  const height = requestedAspectRatio >= 1 ? roundTo16(OUTPUT_LONG_EDGE / requestedAspectRatio) : OUTPUT_LONG_EDGE;
  return { width, height, value: `${width}x${height}`, requestedAspectRatio };
}

export function createAspectMatchedImagePrompt(prompt: string, output: ImageOutputSize, referenceCount = 1) {
  const orientation = output.requestedAspectRatio > 1.08 ? "横向" : output.requestedAspectRatio < 0.92 ? "纵向" : "方形";
  const safeReferenceCount = Math.max(1, Math.floor(referenceCount));
  return `${prompt.trim()}\n\n商品一致性要求（最高优先级）：参考图 1 至 ${safeReferenceCount} 是唯一允许使用的商品来源。只呈现参考图中真实出现的商品和包装；保持瓶罐、礼盒、手提袋的外形、颜色、品牌标识、标签图案和组合关系。禁止虚构、增加、替换或重新设计任何商品，禁止混入参考图之外的品牌与包装。多张图若展示同一商品或同一套装，只用于补充细节，不要重复增加数量。场景道具不得做成商品包装；无法确认的商品宁可不添加。\n\n构图与画布要求：使用${orientation}画布，输出尺寸为 ${output.width}×${output.height}。场景和背景必须自然延展并铺满画布四边，不要白边、空白边距、画框或拼贴边框，不要把横版图片嵌入竖版画布，也不要把竖版图片嵌入横版画布。主体应在此宽高比下完整清晰，并为裁切保留少量安全空间。`;
}

export function extractLingDrawImage(payload: LingDrawImagePayload) {
  const base64 = payload.image?.base64;
  const mimeType = payload.image?.mimeType?.toLowerCase();
  if (!base64 || !mimeType || !SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)
    || base64.length > MAX_GENERATED_IMAGE_BASE64_LENGTH
    || base64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new Error("灵绘 AI 图片接口没有返回可用图片");
  }
  return { base64, mimeType };
}

export function assertLingDrawImageReservation(payload: LingDrawImagePayload, requestId: string) {
  if (payload.requestId !== requestId || payload.billingStatus !== "reserved") {
    throw new Error("灵绘 AI 图片预扣记录不匹配");
  }
}

export function imageExtension(mimeType: string) {
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  return "png";
}
