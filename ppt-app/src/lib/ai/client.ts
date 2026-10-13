import type { AICategoryCandidate, AIFieldDetectionResponse, AINormalizationResponse, AIProviderUsage } from "@/types/ai";
import { pptFetch } from "@/src/lib/basePath";

interface AIAPIResponse<T> {
  data?: T;
  provider?: "openai" | "mock";
  usage?: AIProviderUsage;
  error?: string;
}

async function postAI<T>(url: string, body: unknown): Promise<Required<Pick<AIAPIResponse<T>, "data" | "provider">> & { usage?: AIProviderUsage }> {
  const response = await pptFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json() as AIAPIResponse<T>;
  if (!response.ok || !payload.data || !payload.provider) throw new Error(payload.error || `AI 服务请求失败（HTTP ${response.status}）`);
  return { data: payload.data, provider: payload.provider, usage: payload.usage };
}

export function requestAIFieldDetection(input: {
  headers: string[];
  unmatchedTargets: Array<{ key: string; label: string; description: string }>;
  sampleRows: Record<string, unknown>[];
  requestId?: string;
}) {
  return postAI<AIFieldDetectionResponse>("/api/ai/detect-fields", input);
}

export function requestAIProductNormalization(input: { products: unknown[]; categoryCandidates: AICategoryCandidate[]; requestId?: string }) {
  return postAI<AINormalizationResponse>("/api/ai/normalize-products", input);
}
