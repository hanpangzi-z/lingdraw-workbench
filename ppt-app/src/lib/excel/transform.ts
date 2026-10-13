import { productCategories } from "@/data/catalog";
import { cleanText, parseDeliveryRules, parseImageSources, parsePrice, parseProductItems } from "./cleaners";
import { getMappedSource } from "./mapping";
import type { Product, ProductCategoryId } from "@/types/catalog";
import type { ExcelImportConfig, ExcelSheetData } from "@/types/import";
import { getDataRecords } from "./parser";

export const UNCATEGORIZED_ID: ProductCategoryId = "uncategorized";

export function resolveCategory(value: unknown): ProductCategoryId {
  const normalized = cleanText(value).replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
  if (!normalized) return UNCATEGORIZED_ID;
  return productCategories.find((category) =>
    [category.id, category.name, category.englishName].some((candidate) =>
      candidate.replace(/\s+/g, "").toLocaleLowerCase("zh-CN") === normalized,
    ),
  )?.id ?? UNCATEGORIZED_ID;
}

export function convertSheetToProducts(sheet: ExcelSheetData, config: ExcelImportConfig): Product[] {
  const records = getDataRecords(sheet, config.headerRow);
  const sourceFor = (target: Parameters<typeof getMappedSource>[1]) =>
    getMappedSource(config.fieldMappings, target);

  const valueFrom = (values: Record<string, unknown>, target: Parameters<typeof sourceFor>[0]) => {
    const source = sourceFor(target);
    return source ? values[source] : undefined;
  };

  if (sourceFor("productName")) {
    const groups: Array<typeof records> = [];
    for (const record of records) {
      const startsPackage = Boolean(cleanText(valueFrom(record.values, "no")) || cleanText(valueFrom(record.values, "name")));
      if (startsPackage || !groups.length) groups.push([record]);
      else groups.at(-1)!.push(record);
    }

    return groups.map((group, index) => {
      const firstText = (target: Parameters<typeof sourceFor>[0]) => group.map(({ values }) => cleanText(valueFrom(values, target))).find(Boolean) ?? "";
      const firstPrice = (target: "marketPrice" | "salePrice") => group.map(({ values }) => parsePrice(valueFrom(values, target))).find((value) => value !== undefined);
      const components = group.map(({ values }) => ({
        name: cleanText(valueFrom(values, "productName")),
        brand: cleanText(valueFrom(values, "brand")) || undefined,
        details: parseProductItems(valueFrom(values, "items"), config.splitItemsBySlash),
        marketPrice: parsePrice(valueFrom(values, "marketPrice")),
      })).filter((component) => component.name || component.details.length || component.marketPrice !== undefined);
      const componentMarketPrices = components
        .map((component) => component.marketPrice)
        .filter((value): value is number => value !== undefined);
      const marketTotal = componentMarketPrices.length
        ? Math.round(componentMarketPrices.reduce((total, value) => total + value, 0) * 100) / 100
        : undefined;
      const images = [...new Set(group.flatMap(({ values }) => parseImageSources(valueFrom(values, "image"))))];
      const rawNumber = firstText("no");
      const sku = firstText("sku");
      const packageName = firstText("name") || components.find((component) => component.name)?.name || "";
      const productNumber = rawNumber ? (/^\d+$/.test(rawNumber) ? rawNumber.padStart(2, "0") : rawNumber) : String(index + 1).padStart(2, "0");
      const firstRow = group[0]?.sourceRow ?? config.headerRow + index + 1;

      return {
        id: `import-package-${firstRow}-${index + 1}`,
        productNumber,
        sku,
        packageCode: sku || `AUTO-${String(index + 1).padStart(3, "0")}`,
        name: packageName,
        components,
        image: images[0],
        images,
        details: components.flatMap((component) => component.details.length ? component.details : component.name ? [component.name] : []),
        price: {
          currency: "CNY",
          market: marketTotal,
          package: firstPrice("salePrice"),
        },
        deliveryRegions: parseDeliveryRules(firstText("delivery")),
        categoryId: resolveCategory(firstText("category")),
        region: firstText("region") || undefined,
        priceTier: firstText("priceTier") || undefined,
        packageType: firstText("packageType") || undefined,
        customerGroup: firstText("customerGroup") || undefined,
        rawData: {
          packageName,
          components: group.map(({ sourceRow, values }) => ({ sourceRow, ...values })),
        },
        deliveryRaw: firstText("delivery"),
        sources: group.map(({ sourceRow, values }) => ({ type: config.sourceType ?? "excel", fileName: config.fileName, sheet: sheet.name, row: sourceRow, fields: Object.keys(values) })),
        importMetadata: {
          confidence: 1,
          fieldConfidence: { name: packageName ? 1 : 0, items: components.some((component) => component.details.length) ? 1 : 0, marketPrice: marketTotal !== undefined ? 1 : 0, salePrice: firstPrice("salePrice") !== undefined ? 1 : 0, image: images.length ? 1 : 0 },
        },
      } satisfies Product;
    });
  }

  return records.map(({ sourceRow, values }, index) => {
    const read = (target: Parameters<typeof sourceFor>[0]) => {
      return valueFrom(values, target);
    };
    const productNumber = cleanText(read("no")) || String(index + 1).padStart(2, "0");
    const sku = cleanText(read("sku"));
    const images = parseImageSources(read("image"));

    return {
      id: `import-${sourceRow}-${index + 1}`,
      productNumber,
      sku,
      packageCode: sku || `AUTO-${String(index + 1).padStart(3, "0")}`,
      name: cleanText(read("name")),
      image: images[0],
      images,
      details: parseProductItems(read("items"), config.splitItemsBySlash),
      price: {
        currency: "CNY",
        market: parsePrice(read("marketPrice")),
        package: parsePrice(read("salePrice")),
      },
      deliveryRegions: parseDeliveryRules(read("delivery")),
      categoryId: resolveCategory(read("category")),
      region: cleanText(read("region")) || undefined,
      priceTier: cleanText(read("priceTier")) || undefined,
      packageType: cleanText(read("packageType")) || undefined,
      customerGroup: cleanText(read("customerGroup")) || undefined,
      rawData: { ...values },
      deliveryRaw: cleanText(read("delivery")),
      sources: [{ type: config.sourceType ?? "excel", fileName: config.fileName, sheet: sheet.name, row: sourceRow, fields: Object.keys(values) }],
      importMetadata: {
        confidence: 1,
        fieldConfidence: { sku: sku ? 1 : 0, name: cleanText(read("name")) ? 1 : 0, items: read("items") ? 1 : 0, marketPrice: read("marketPrice") ? 1 : 0, salePrice: read("salePrice") ? 1 : 0, delivery: read("delivery") ? 1 : 0, category: read("category") ? 1 : 0, image: images.length ? 1 : 0 },
      },
    } satisfies Product;
  });
}

export function renumberProducts(products: Product[]) {
  return products.map((product, index) => ({
    ...product,
    productNumber: String(index + 1).padStart(2, "0"),
  }));
}
