import { FIELD_KEYWORDS, IMPORT_FIELD_DEFINITIONS, type ImportFieldDefinition } from "./fields";
import type { FieldMapping, ImportTargetField } from "@/types/import";

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s_\-—–/\\（）()【】\[\]：:·.]+/g, "");
}

function scoreHeader(target: ImportTargetField, header: string) {
  const normalized = normalizeHeader(header);
  if (!normalized) return 0;

  let score = 0;
  for (const [index, keyword] of FIELD_KEYWORDS[target].entries()) {
    const normalizedKeyword = normalizeHeader(keyword);
    if (normalized === normalizedKeyword) score = Math.max(score, 120 - index + normalizedKeyword.length);
    else if (normalized.includes(normalizedKeyword) || normalizedKeyword.includes(normalized)) {
      score = Math.max(score, 40 + Math.min(normalized.length, normalizedKeyword.length));
    }
  }
  return score;
}

export function autoMapFields(headers: string[], definitions: ImportFieldDefinition[] = IMPORT_FIELD_DEFINITIONS): FieldMapping[] {
  const claimed = new Set<string>();

  return definitions.map(({ key }) => {
    const candidates = headers
      .map((header) => ({ header, score: scoreHeader(key, header) }))
      .filter((candidate) => candidate.score > 0 && !claimed.has(candidate.header))
      .sort((a, b) => b.score - a.score);
    const sourceColumn = candidates[0]?.header;
    if (sourceColumn) claimed.add(sourceColumn);
    return {
      targetField: key,
      sourceColumn,
      source: sourceColumn ? "rule" : undefined,
      confidence: sourceColumn ? 1 : undefined,
      reason: sourceColumn ? "字段名称命中本地关键词规则" : undefined,
    };
  });
}

export function getMappedSource(mapping: FieldMapping[], target: ImportTargetField) {
  return mapping.find((item) => item.targetField === target)?.sourceColumn;
}
