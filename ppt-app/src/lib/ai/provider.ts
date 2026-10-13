import type { AIProviderUsage } from "@/types/ai";
import type { StructuredSchema } from "./schemas";

export interface AIProvider {
  readonly name: "openai" | "mock";
  generateStructuredData<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: StructuredSchema<T>,
  ): Promise<T>;
  getLastUsage(): AIProviderUsage | undefined;
}
