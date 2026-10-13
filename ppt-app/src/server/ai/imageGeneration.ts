import type { LingDrawUser } from "@/src/server/auth/session";
import { assertProjectOwner, createAsset } from "@/src/server/assets/service";
import {
  createAspectMatchedImagePrompt,
  assertLingDrawImageReservation,
  extractLingDrawImage,
  imageExtension,
  imageSizeForAspectRatio,
  type LingDrawImagePayload,
} from "@/src/lib/ai/imageGeneration";
import { MAX_IMAGE_REFERENCES } from "@/src/lib/ai/imageScenePrompts";
import { bridgeError, lingDrawInternalHeaders, lingDrawInternalUrl, settleLingDrawImageWithRetry } from "@/src/server/ai/internalBridge";
import { AIServiceError, AppError, ValidationError, errorResponse } from "@/src/server/errors";

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

function safeFilePart(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9一-龥_-]+/g, "-").slice(0, 50) || "product";
}

export async function validateImageGenerationForm(form: FormData, user: LingDrawUser) {
    const prompt = String(form.get("prompt") || "").trim();
    const productName = String(form.get("productName") || "商品").trim();
    const projectId = String(form.get("projectId") || "").trim() || undefined;
    const providerId = String(form.get("provider") || "").trim();
    const model = String(form.get("model") || "").trim();
    const requestedAspectRatio = Number(form.get("aspectRatio"));
    const images = form.getAll("images").filter((value): value is File => value instanceof File);
    if (!prompt) throw new ValidationError("请先填写场景描述");
    if (!providerId || !model) throw new ValidationError("请选择图片模型");
    if (prompt.length > 4_000) throw new ValidationError("场景描述不能超过 4000 字");
    if (!images.length) throw new ValidationError("至少需要 1 张参考图片");
    if (images.length > MAX_IMAGE_REFERENCES) throw new ValidationError(`最多支持 ${MAX_IMAGE_REFERENCES} 张参考图片`);
    if (images.some((image) => !image.type.startsWith("image/") || image.size > MAX_REFERENCE_BYTES)) {
      throw new ValidationError("参考图片格式不正确或单张超过 20MB");
    }
    if (projectId) await assertProjectOwner(projectId, user.id);

    return { prompt, productName, projectId, providerId, model, requestedAspectRatio, images };
}

export async function executeImageGeneration(user: LingDrawUser, form: FormData, requestId: string, checkpoint: (result: Record<string, unknown>) => Promise<void> = async () => {}) {
  let reservation: { requestId: string; user: LingDrawUser } | undefined;
  let settled = false;
  let assetPersisted = false;
  try {
    const { prompt, productName, projectId, providerId, model, requestedAspectRatio, images } = await validateImageGenerationForm(form, user);

    const outputSize = imageSizeForAspectRatio(requestedAspectRatio);
    reservation = { requestId, user };
    const upstream = new FormData();
    upstream.append("prompt", createAspectMatchedImagePrompt(prompt, outputSize, images.length));
    upstream.append("aspectRatio", String(outputSize.requestedAspectRatio));
    upstream.append("quality", "high");
    upstream.append("request_id", requestId);
    upstream.append("provider", providerId);
    upstream.append("model", model);
    images.forEach((image, index) => upstream.append("images", image, image.name || `reference-${index + 1}.png`));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 240_000);
    let response: Response;
    try {
      response = await fetch(lingDrawInternalUrl("/api/ppt/internal/ai/image"), {
        method: "POST",
        headers: lingDrawInternalHeaders(user),
        body: upstream,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new AIServiceError("AI 图片生成超时，请重试", 504);
      throw new AIServiceError("暂时无法连接灵绘 AI 图片服务", 502);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new AIServiceError(await bridgeError(response), response.status === 429 ? 429 : 502);
    let payload: LingDrawImagePayload;
    try {
      payload = await response.json() as LingDrawImagePayload;
    } catch {
      throw new AIServiceError("灵绘 AI 图片接口返回格式不正确");
    }
    try { assertLingDrawImageReservation(payload, requestId); }
    catch { throw new AIServiceError("灵绘 AI 图片预扣记录不匹配"); }
    let generated: ReturnType<typeof extractLingDrawImage>;
    try { generated = extractLingDrawImage(payload); }
    catch { throw new AIServiceError("灵绘 AI 图片接口没有返回可用图片"); }
    const bytes = Uint8Array.from(Buffer.from(generated.base64, "base64"));
    const mimeType = generated.mimeType;
    if (!bytes.length) throw new Error("AI 图片接口返回了空图片");

    const extension = imageExtension(mimeType);
    const fileBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const file = new File([fileBytes], `ai-${safeFilePart(productName)}-${Date.now()}.${extension}`, { type: mimeType });
    const asset = await createAsset({
      userId: user.id,
      projectId,
      file,
      type: "product_image",
      metadata: {
        source: "ai-image",
        provider: payload.provider,
        model: payload.model,
        outputSize: payload.outputSize || outputSize.value,
        requestedAspectRatio: outputSize.requestedAspectRatio,
        requestId: payload.requestId,
      },
    });
    assetPersisted = true;
    await checkpoint({ imageUrl: asset.url, model: payload.model, provider: payload.provider, outputSize: payload.outputSize || outputSize.value, billingStatus: "settlement-pending" });
    try {
      await settleLingDrawImageWithRetry(user, { requestId, success: true });
      settled = true;
    } catch {
      console.error("[AI Image] persisted asset settlement remains pending", { requestId });
    }
    return Response.json({
      imageUrl: asset.url,
      model: payload.model,
      provider: payload.provider,
      outputSize: payload.outputSize || outputSize.value,
      aspectRatio: payload.aspectRatio || outputSize.width / outputSize.height,
      billingStatus: settled ? "succeeded" : "settlement-pending",
    });
  } catch (error) {
    if (reservation && !settled) {
      const reason = !assetPersisted && error instanceof AppError ? error.message : "PPT 素材持久化失败";
      await settleLingDrawImageWithRetry(reservation.user, {
        requestId: reservation.requestId,
        success: assetPersisted,
        ...(!assetPersisted ? { error: reason } : {}),
      }).catch((settlementError) => {
        console.error(`[AI Image] ${assetPersisted ? "success" : "refund"} settlement failed`, settlementError);
      });
    }
    return errorResponse(error);
  }
}
