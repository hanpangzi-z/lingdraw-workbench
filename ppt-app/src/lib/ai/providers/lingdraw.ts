import { randomUUID } from "node:crypto";
import type { AIProviderUsage } from "@/types/ai";
import type { LingDrawUser } from "@/src/server/auth/session";
import { bridgeError, lingDrawInternalHeaders, lingDrawInternalUrl } from "@/src/server/ai/internalBridge";
import { AIServiceError } from "@/src/server/errors";
import type { AIProvider } from "../provider";
import type { StructuredSchema } from "../schemas";

interface BridgeChatResponse {
  data?: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

export class LingDrawAIProvider implements AIProvider {
  // Keep the existing persisted source value compatible while requests are served by LingDraw.
  readonly name = "openai" as const;
  private usage?: AIProviderUsage;

  constructor(
    private readonly user: LingDrawUser,
    private readonly operation: "field-detection" | "product-normalization",
    private readonly requestId: string = randomUUID(),
  ) {}

  async generateStructuredData<T>(systemPrompt: string, userPrompt: string, schema: StructuredSchema<T>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch(lingDrawInternalUrl("/api/ppt/internal/ai/chat"), {
        method: "POST",
        headers: { ...lingDrawInternalHeaders(this.user), "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: this.operation,
          system_prompt: systemPrompt,
          user_prompt: userPrompt,
          response_schema: schema.schema,
          schema_name: schema.name,
          request_id: this.requestId,
        }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new AIServiceError(await bridgeError(response), response.status === 429 ? 429 : 502);
      const payload = await response.json() as BridgeChatResponse;
      if (!schema.validate(payload.data)) throw new AIServiceError(`灵绘 AI 输出未通过 ${schema.name} 运行时校验`);
      const usage = payload.usage;
      this.usage = usage ? {
        inputTokens: usage.inputTokens ?? usage.input_tokens ?? 0,
        outputTokens: usage.outputTokens ?? usage.output_tokens ?? 0,
        totalTokens: usage.totalTokens ?? usage.total_tokens ?? 0,
        estimated: false,
      } : undefined;
      return payload.data;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new AIServiceError("灵绘 AI 请求超时（90 秒）", 504);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  getLastUsage() {
    return this.usage;
  }
}
