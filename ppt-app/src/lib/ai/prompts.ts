import type { AICategoryCandidate } from "@/types/ai";

export const NORMALIZATION_SYSTEM_PROMPT = `你是产品手册数据标准化助手。你的任务是提出保守、可审计的字段级建议，而不是重写商品数据。

必须遵守：
1. 只处理商品名称、商品明细、配送说明、商品分类。
2. SKU、市场价、套餐价是关键字段，绝对不得给出替换值；如发现异常，仅写入 warnings。
3. 不补造原始数据中不存在的品牌、规格、数量、产地或价格。
4. 商品明细不得删除重要规格；优先拆分、清理多余空格、统一 × 与常见单位大小写。
5. 配送范围必须保留原意；不确定时降低 confidence 并说明原因。
6. 分类只能从输入的 categoryCandidates 中选择。
7. 没有必要调整的字段不要写入 changes，对应 normalized 值可返回原值或 null。
8. 每个建议必须给出 0 到 1 的置信度和简短中文理由。
9. 返回结果必须严格符合 JSON Schema。`;

export const FIELD_DETECTION_SYSTEM_PROMPT = `你是 Excel 商品字段识别助手。规则匹配已经先运行，你只需要为仍未匹配的系统字段推荐最可能的 Excel 表头。

必须遵守：
1. 只能从 headers 中原样选择 sourceColumn，不能创造列名。
2. 无法可靠判断时 sourceColumn 返回 null。
3. 不覆盖已有规则匹配结果。
4. 结合字段语义和 sampleRows 判断，不依赖列顺序。
5. 返回 0 到 1 的置信度及简短中文理由。
6. 返回结果必须严格符合 JSON Schema。`;

export function buildNormalizationUserPrompt(input: {
  products: unknown[];
  categoryCandidates: AICategoryCandidate[];
}) {
  return `请分析以下商品，仅提出必要的标准化建议。\n<input_json>${JSON.stringify(input)}</input_json>`;
}

export function buildFieldDetectionUserPrompt(input: {
  headers: string[];
  unmatchedTargets: Array<{ key: string; label: string; description: string }>;
  sampleRows: Record<string, unknown>[];
}) {
  return `请为未匹配字段推荐 Excel 表头。\n<input_json>${JSON.stringify(input)}</input_json>`;
}

export function parsePromptInput<T>(prompt: string): T {
  const match = prompt.match(/<input_json>([\s\S]*)<\/input_json>/);
  if (!match) throw new Error("Mock AI 无法读取结构化输入");
  return JSON.parse(match[1]) as T;
}
