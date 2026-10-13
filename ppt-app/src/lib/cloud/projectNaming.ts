import type { CatalogMeta } from "@/types/catalog";

export function isDefaultProjectName(name?: string) {
  return !name?.trim() || /^(未命名产品手册|新导入项目|产品手册)$/.test(name.trim());
}

export function suggestProjectName(meta: CatalogMeta, sourceName?: string, now = new Date(), discriminator = "") {
  const source = sourceName?.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "-").trim();
  const base = source || `${meta.design.brandName || meta.brand || "商品"}产品手册`;
  const detail = [meta.city, meta.tierName || (meta.priceTier ? `${meta.priceTier}元档` : "")].filter((part) => part && !base.includes(part));
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const stamp = ["month", "day", "hour", "minute"].map((type) => parts.find((part) => part.type === type)?.value || "00").join("");
  return `${[base.slice(0, 65), ...detail].join(" · ").slice(0, 100)} · ${stamp}${discriminator ? `-${discriminator.slice(-4)}` : ""}`;
}
