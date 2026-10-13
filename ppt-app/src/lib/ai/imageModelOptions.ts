import { pptFetch } from "@/src/lib/basePath";

export interface ImageModelOption {
  key: string;
  providerId: string;
  providerName: string;
  model: string;
  label: string;
}

interface RuntimeImageProvider {
  id?: unknown;
  name?: unknown;
  enabled?: unknown;
  available?: unknown;
  image_models?: unknown;
  model_names?: unknown;
}

function optionKey(providerId: string, model: string) {
  return `${encodeURIComponent(providerId)}::${encodeURIComponent(model)}`;
}

export async function loadImageModelOptions(signal?: AbortSignal): Promise<ImageModelOption[]> {
  const response = await pptFetch("/api/ai/image-models", {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) throw new Error("图片模型加载失败，请重试。");

  const payload = await response.json() as { providers?: RuntimeImageProvider[] };
  return (Array.isArray(payload.providers) ? payload.providers : []).flatMap((provider) => {
    const providerId = typeof provider.id === "string" ? provider.id.trim() : "";
    const providerName = typeof provider.name === "string" ? provider.name.trim() : providerId;
    const models = Array.isArray(provider.image_models)
      ? provider.image_models.filter((model): model is string => typeof model === "string" && Boolean(model.trim()))
      : [];
    const modelNames = provider.model_names && typeof provider.model_names === "object"
      ? provider.model_names as Record<string, unknown>
      : {};
    if (!providerId || provider.enabled === false || provider.available !== true) return [];
    return models.map((model) => {
      const cleanModel = model.trim();
      const displayName = typeof modelNames[cleanModel] === "string" && String(modelNames[cleanModel]).trim()
        ? String(modelNames[cleanModel]).trim()
        : cleanModel;
      return {
        key: optionKey(providerId, cleanModel),
        providerId,
        providerName: providerName || providerId,
        model: cleanModel,
        label: `${providerName || providerId} · ${displayName}`,
      };
    });
  });
}
