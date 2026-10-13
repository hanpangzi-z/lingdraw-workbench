const CHINESE_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;

export function toChineseSequence(value: string | number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value.replace(/\D/g, ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return String(value).trim() || "一";
  if (parsed < 10) return CHINESE_DIGITS[parsed];
  if (parsed < 20) return `十${parsed === 10 ? "" : CHINESE_DIGITS[parsed % 10]}`;
  if (parsed < 100) return `${CHINESE_DIGITS[Math.floor(parsed / 10)]}十${parsed % 10 === 0 ? "" : CHINESE_DIGITS[parsed % 10]}`;
  return String(parsed);
}

export function formatPackageSequence(value: string | number) {
  return `套餐${toChineseSequence(value)}`;
}
