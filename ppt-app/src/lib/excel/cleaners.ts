export function parseProductItems(value: unknown, splitBySlash = false): string[] {
  if (value === null || value === undefined) return [];
  const text = String(value).trim();
  if (!text) return [];

  const primary = text
    .split(/\r?\n|；|;|\|/g)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!splitBySlash) return primary;

  return primary.flatMap((item) => {
    // 只有两侧都像独立文字项目时才启用斜杠拆分，避免把“500g×2 / 300g×1”拆散。
    if (!item.includes("/") || /\d\s*(?:g|kg|ml|l)?\s*[×x*]\s*\d\s*\/\s*\d/i.test(item)) return [item];
    return item.split(/\s*\/\s*/g).map((part) => part.trim()).filter(Boolean);
  });
}

export function parsePrice(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;

  const text = String(value).trim();
  if (!text || /^(?:-|—|–|无|未标注|未填写|n\/?a)$/i.test(text)) return undefined;
  const match = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function parseImageSources(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values
    .flatMap((item) => item === null || item === undefined ? [] : String(item).split(/\r?\n/g))
    .flatMap((item) => item.trim().startsWith("data:") ? [item] : item.split(/；|;|\|/g))
    .map((item) => item.trim())
    .filter(Boolean))];
}

export function parseTextList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return String(value)
    .split(/\r?\n|；|;|\||、|，|,/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseDeliveryRules(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return String(value)
    .split(/\r?\n|；|;|\|/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function cleanText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}
