import { FIELD_KEYWORDS } from "@/src/lib/excel/fields";
import type {
  AICategoryCandidate,
  AIFieldDetectionResponse,
  AINormalizationResponse,
  AIProductProposal,
  AIProviderUsage,
} from "@/types/ai";
import type { AIProvider } from "../provider";
import { parsePromptInput } from "../prompts";
import type { StructuredSchema } from "../schemas";

const semanticFieldHints: Record<string, string[]> = {
  no: ["顺位", "排序", "行号"],
  sku: ["货号", "物料号", "礼盒码", "套餐码", "产品代码"],
  name: ["标题", "礼盒标题", "产品标题", "组合名称"],
  items: ["内含商品", "内含内容", "配置说明", "礼盒配置", "组成"],
  marketPrice: ["门店价", "吊牌价", "参考价", "建议价"],
  salePrice: ["员工价", "专享价", "成交价", "招标价"],
  delivery: ["送达", "覆盖区域", "服务范围", "发货说明"],
  category: ["组别", "产品组", "业务分类", "所属类别"],
  image: ["主图", "图链", "照片", "素材"],
};

function normalize(value: string) {
  return value.toLocaleLowerCase("zh-CN").replace(/[\s_\-—–/\\（）()【】\[\]：:·.]+/g, "");
}

function detectFields(userPrompt: string): AIFieldDetectionResponse {
  const input = parsePromptInput<{
    headers: string[];
    unmatchedTargets: Array<{ key: string; label: string }>;
  }>(userPrompt);
  const claimed = new Set<string>();
  return {
    mappings: input.unmatchedTargets.map((target) => {
      const candidates = input.headers.map((header) => {
        const normalizedHeader = normalize(header);
        const hints = [...(FIELD_KEYWORDS[target.key as keyof typeof FIELD_KEYWORDS] ?? []), ...(semanticFieldHints[target.key] ?? [])];
        const score = hints.reduce((best, hint) => {
          const normalizedHint = normalize(hint);
          if (normalizedHeader === normalizedHint) return Math.max(best, 0.97);
          if (normalizedHeader.includes(normalizedHint) || normalizedHint.includes(normalizedHeader)) return Math.max(best, 0.84);
          return best;
        }, 0);
        return { header, score };
      }).filter((candidate) => !claimed.has(candidate.header)).sort((a, b) => b.score - a.score);
      const best = candidates[0];
      if (!best || best.score < 0.7) return {
        targetField: target.key,
        sourceColumn: null,
        confidence: 0.25,
        reason: "没有足够明确的字段语义，建议人工选择",
      };
      claimed.add(best.header);
      return {
        targetField: target.key,
        sourceColumn: best.header,
        confidence: best.score,
        reason: `“${best.header}”与“${target.label}”语义接近`,
      };
    }),
  };
}

function cleanProductName(value: string) {
  return value
    .replace(/^[【\[]?(?:2026年?)?(?:上海)?(?:员工|职工)?福利(?:严选|专享|专供|推荐)?[】\]]?[：:\-—|｜]?\s*/g, "")
    .replace(/[（(]?(?:2026年?)?(?:上海)?(?:员工|职工)?福利(?:专享|专供|方案|推荐)?[）)]?/g, "")
    .replace(/[（(]?\d+\s*元档位[）)]?/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[：:\-—|｜\s]+|[：:\-—|｜\s]+$/g, "")
    .trim();
}

function normalizeItemText(value: string) {
  return value
    .replace(/(\d)\s*(KG|Kg|kG)\b/g, "$1kg")
    .replace(/(\d)\s*(ML|Ml|mL)\b/g, "$1ml")
    .replace(/([0-9a-zA-Z\u4e00-\u9fa5])\s*[xX*]\s*(\d)/g, "$1×$2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeItems(details: string[]) {
  return details.flatMap((detail) => {
    const primary = detail.split(/\r?\n|；|;|\|/g).map((item) => item.trim()).filter(Boolean);
    return primary.flatMap((item) => {
      if (!/[、/]/.test(item) || /\d\s*(?:g|kg|ml|l)?\s*[×x*]\s*\d\s*\/\s*\d/i.test(item)) return [normalizeItemText(item)];
      return item.split(/\s*[、/]\s*/g).map(normalizeItemText).filter(Boolean);
    });
  }).filter(Boolean);
}

function normalizeDelivery(value: string) {
  const compact = value.replace(/[\s，,、；;（）()]/g, "");
  if (!compact) return null;
  if (/招标文件|按招标/.test(compact)) return { value: "按招标文件执行", confidence: 0.97, reason: "原文明确要求按招标文件执行" };
  if (/沪浙苏皖闽|上海.*浙江.*江苏.*安徽.*福建/.test(compact)) return { value: "沪浙苏皖闽", confidence: 0.95, reason: "省市范围可归一为沪浙苏皖闽" };
  if (/江浙沪皖|上海.*浙江.*江苏.*安徽|沪浙苏皖/.test(compact)) return { value: "江浙沪皖", confidence: 0.93, reason: "省市范围可归一为江浙沪皖" };
  if (/江浙沪|上海.*浙江.*江苏|沪浙苏/.test(compact)) return { value: "江浙沪", confidence: 0.94, reason: "省市范围可归一为江浙沪" };
  if (/全国/.test(compact) && /不含|除|偏远|内蒙|新疆|西藏|青海|宁夏|甘肃|海南/.test(compact)) {
    return { value: "全国配送 A 类", confidence: 0.72, reason: "原文为全国但含排除区域，暂建议归入 A 类，请人工确认" };
  }
  if (/全国/.test(compact)) return { value: "全国配送 B 类", confidence: 0.7, reason: "原文描述全国配送，A/B 类仍需人工确认" };
  return null;
}

const categoryKeywords: Record<string, RegExp> = {
  "grain-seasoning": /米|面|粮|油|调味|酱油|醋|杂粮|菌菇|干货/,
  "snacks-pastry": /坚果|糕|饼|零食|糖|巧克力|曲奇|烘焙|蜜饯/,
  "braised-food": /卤|熟食|酱鸭|牛肉干|肉脯|即食/,
  "fresh-meat": /鲜|肉|禽|鸡|鸭|牛|羊|猪|蛋|海鲜|水产|虾|鱼/,
  "kitchen-appliance": /锅|刀|杯|壶|厨|电饭|空气炸|餐具/,
  "home-appliance": /床|被|枕|毯|家纺|风扇|取暖|吸尘|家居/,
  "daily-care": /洗|护|纸|清洁|牙膏|沐浴|洗发|日化|卫生/,
};

function classifyProduct(name: string, details: string[], candidates: AICategoryCandidate[]) {
  const text = `${name} ${details.join(" ")}`;
  for (const candidate of candidates) {
    const keyword = categoryKeywords[candidate.id];
    if (keyword?.test(text)) return { id: candidate.id, confidence: 0.86, reason: `名称或明细命中“${candidate.name}”特征词` };
  }
  return null;
}

function normalizeProduct(raw: Record<string, unknown>, candidates: AICategoryCandidate[]): AIProductProposal {
  const id = String(raw.id ?? "");
  const name = String(raw.name ?? "").trim();
  const details = Array.isArray(raw.details) ? raw.details.map(String) : [];
  const deliveryRegions = Array.isArray(raw.deliveryRegions) ? raw.deliveryRegions.map(String) : [];
  const categoryId = String(raw.categoryId ?? "uncategorized");
  const price = typeof raw.price === "object" && raw.price !== null ? raw.price as Record<string, unknown> : {};
  const changes: AIProductProposal["changes"] = [];
  const warnings: AIProductProposal["warnings"] = [];

  const normalizedName = cleanProductName(name);
  if (normalizedName && normalizedName !== name) changes.push({ field: "name", confidence: 0.93, reason: "移除年份、档位或福利营销后缀，保留商品主体名称" });
  else if (name.length > 28) warnings.push({ code: "long-name", field: "name", message: "商品名称较长但无法安全删减，请人工确认", confidence: 0.88 });

  const normalizedItems = normalizeItems(details);
  if (JSON.stringify(normalizedItems) !== JSON.stringify(details)) {
    changes.push({ field: "details", confidence: 0.91, reason: "拆分混排明细并统一乘号、单位与多余空格" });
  }
  if (!normalizedItems.length) warnings.push({ code: "missing-items", field: "details", message: "商品明细为空，AI 不补造内容", confidence: 1 });

  const rawDelivery = String(raw.deliveryRaw || deliveryRegions.join("；"));
  const delivery = normalizeDelivery(rawDelivery);
  if (delivery && JSON.stringify([delivery.value]) !== JSON.stringify(deliveryRegions)) {
    changes.push({ field: "deliveryRegions", confidence: delivery.confidence, reason: delivery.reason });
  } else if (!rawDelivery) warnings.push({ code: "missing-delivery", field: "deliveryRegions", message: "配送说明为空，AI 不补造范围", confidence: 1 });
  else if (!delivery) warnings.push({ code: "uncertain-delivery", field: "deliveryRegions", message: "配送原文无法可靠归一，请人工确认", confidence: 0.8 });

  const category = categoryId === "uncategorized" ? classifyProduct(normalizedName || name, normalizedItems, candidates) : null;
  if (category) changes.push({ field: "categoryId", confidence: category.confidence, reason: category.reason });
  else if (categoryId === "uncategorized") warnings.push({ code: "uncertain-category", field: "categoryId", message: "无法可靠判断分类，请人工选择", confidence: 0.8 });

  const market = typeof price.market === "number" ? price.market : undefined;
  const packagePrice = typeof price.package === "number" ? price.package : undefined;
  if (!String(raw.sku ?? "").trim()) warnings.push({ code: "missing-sku", field: "sku", message: "SKU 为空；关键字段未补造", confidence: 1 });
  if (market === undefined) warnings.push({ code: "missing-market-price", field: "marketPrice", message: "市场价为空；关键价格未补造", confidence: 1 });
  if (market !== undefined && packagePrice !== undefined && market < packagePrice) {
    warnings.push({ code: "price-inversion", field: "marketPrice", message: "市场价低于套餐价；关键价格未修改", confidence: 1 });
  }
  if (packagePrice === undefined) warnings.push({ code: "missing-sale-price", field: "salePrice", message: "套餐价为空；关键价格未修改", confidence: 1 });

  return {
    productId: id,
    normalizedName: normalizedName || null,
    normalizedItems,
    normalizedDelivery: delivery?.value ?? null,
    categoryId: category?.id ?? null,
    changes,
    warnings,
  };
}

function normalizeProducts(userPrompt: string): AINormalizationResponse {
  const input = parsePromptInput<{ products: Record<string, unknown>[]; categoryCandidates: AICategoryCandidate[] }>(userPrompt);
  return { products: input.products.map((product) => normalizeProduct(product, input.categoryCandidates)) };
}

export class MockAIProvider implements AIProvider {
  readonly name = "mock" as const;
  private usage?: AIProviderUsage;

  async generateStructuredData<T>(_systemPrompt: string, userPrompt: string, schema: StructuredSchema<T>): Promise<T> {
    const result = schema.name === "catalog_field_detection" ? detectFields(userPrompt) : normalizeProducts(userPrompt);
    const inputTokens = Math.ceil(userPrompt.length / 2.8);
    const outputTokens = Math.ceil(JSON.stringify(result).length / 2.8);
    this.usage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, estimated: true };
    if (!schema.validate(result)) throw new Error(`Mock AI 输出未通过 ${schema.name} 校验`);
    await Promise.resolve();
    return result as T;
  }

  getLastUsage() {
    return this.usage;
  }
}
