import { MockAIProvider } from "./providers/mock";
import { LingDrawAIProvider } from "./providers/lingdraw";
import { buildFieldDetectionUserPrompt, buildNormalizationUserPrompt, FIELD_DETECTION_SYSTEM_PROMPT, NORMALIZATION_SYSTEM_PROMPT } from "./prompts";
import { fieldDetectionSchema, normalizationSchema } from "./schemas";
import type { AICategoryCandidate, AIFieldDetectionResponse, AINormalizationResponse, AIProviderUsage } from "@/types/ai";
import type { LingDrawUser } from "@/src/server/auth/session";

function createProvider(user: LingDrawUser | undefined, operation: "field-detection" | "product-normalization", requestId?: string) {
  if (process.env.AI_MOCK_MODE?.toLocaleLowerCase() === "true") return new MockAIProvider();
  if (!user) throw new Error("灵绘身份不可用");
  return new LingDrawAIProvider(user, operation, requestId);
}

function logUsage(operation: string, provider: string, usage?: AIProviderUsage) {
  if (process.env.NODE_ENV !== "production") console.info(`[AI:${operation}]`, { provider, usage });
}

export async function detectFieldsWithAI(input: {
  headers: string[];
  unmatchedTargets: Array<{ key: string; label: string; description: string }>;
  sampleRows: Record<string, unknown>[];
  requestId?: string;
}, user?: LingDrawUser): Promise<{ data: AIFieldDetectionResponse; provider: "openai" | "mock"; usage?: AIProviderUsage }> {
  const provider = createProvider(user, "field-detection", input.requestId);
  const data = await provider.generateStructuredData(
    FIELD_DETECTION_SYSTEM_PROMPT,
    buildFieldDetectionUserPrompt(input),
    fieldDetectionSchema,
  );
  const usage = provider.getLastUsage();
  logUsage("field-detection", provider.name, usage);
  return { data, provider: provider.name, usage };
}

export async function normalizeProductsWithAI(input: {
  products: unknown[];
  categoryCandidates: AICategoryCandidate[];
  requestId?: string;
}, user?: LingDrawUser): Promise<{ data: AINormalizationResponse; provider: "openai" | "mock"; usage?: AIProviderUsage }> {
  const provider = createProvider(user, "product-normalization", input.requestId);
  const data = await provider.generateStructuredData(
    NORMALIZATION_SYSTEM_PROMPT,
    buildNormalizationUserPrompt(input),
    normalizationSchema,
  );
  const usage = provider.getLastUsage();
  logUsage("product-normalization", provider.name, usage);
  return { data, provider: provider.name, usage };
}
