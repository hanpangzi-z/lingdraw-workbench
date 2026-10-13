import { cleanText, parsePrice, parseProductItems } from "@/src/lib/excel/cleaners";
import type { Product, ProductComponent } from "@/types/catalog";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function componentFromValue(value: unknown): ProductComponent | undefined {
  if (!isRecord(value)) return undefined;
  const name = cleanText(value.name ?? value["商品名称"] ?? value["产品名称"] ?? value["单品名称"]);
  const rawDetails = value.details ?? value["商品明细"] ?? value["产品明细"] ?? value["商品内容"] ?? value["套餐内容"];
  const details = Array.isArray(rawDetails)
    ? rawDetails.map(cleanText).filter(Boolean)
    : parseProductItems(rawDetails, false);
  const marketPrice = parsePrice(value.marketPrice ?? value["市场价"] ?? value["零售价"] ?? value["原价"]);
  if (!name && !details.length && marketPrice === undefined) return undefined;
  return { name, details, marketPrice };
}

export function extractProductComponents(rawData: unknown): ProductComponent[] {
  if (!isRecord(rawData)) return [];
  const values = Array.isArray(rawData.productComponents)
    ? rawData.productComponents
    : Array.isArray(rawData.components)
      ? rawData.components
      : [];
  return values.map(componentFromValue).filter((component): component is ProductComponent => Boolean(component));
}

export function withDerivedProductComponents(product: Product): Product {
  const components = product.components?.length ? product.components : extractProductComponents(product.rawData);
  if (!components.length) return product;
  const componentPrices = components.map((component) => component.marketPrice).filter((value): value is number => value !== undefined);
  const market = componentPrices.length
    ? Math.round(componentPrices.reduce((total, value) => total + value, 0) * 100) / 100
    : product.price.market;
  if (product.components === components && product.price.market === market) return product;
  return { ...product, components, price: { ...product.price, market } };
}

export function rawDataWithProductComponents(product: Product) {
  if (!product.components?.length) return product.rawData;
  if (isRecord(product.rawData)) return { ...product.rawData, productComponents: product.components };
  return { original: product.rawData, productComponents: product.components };
}
