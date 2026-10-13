import { describe, expect, it } from "vitest";
import { catalogMeta } from "@/data/catalog";
import { mockProducts } from "@/data/mock-products";
import {
  getCatalogFileName,
  getImageSizingContain,
  getProductTextStyle,
  groupProductsByDeliveryRule,
} from "@/src/lib/ppt/helpers";

describe("PPT helpers", () => {
  it("derives the exact project filename from JSON metadata", () => {
    expect(getCatalogFileName(catalogMeta)).toBe("2026上海职工乐品套餐-100元档位产品手册.pptx");
  });

  it("adapts typography without discarding product details", () => {
    const normal = getProductTextStyle(mockProducts.find((product) => product.details.length === 2)!);
    const compact = getProductTextStyle(mockProducts.find((product) => product.details.length >= 7)!);

    expect(normal.compact).toBe(false);
    expect(compact.compact).toBe(true);
    expect(compact.itemFontSize).toBeGreaterThanOrEqual(8.5);
    expect(compact.itemFontSize).toBeLessThan(normal.itemFontSize);
  });

  it("calculates contain sizing without stretching the image", () => {
    const sizing = getImageSizingContain(
      { data: "data:image/png;base64,AA==", width: 1600, height: 900, source: "fixture" },
      { x: 1, y: 2, w: 3, h: 3 },
    );

    expect(sizing.w / sizing.h).toBeCloseTo(16 / 9, 4);
    expect(sizing.x).toBeCloseTo(1, 4);
    expect(sizing.y).toBeGreaterThan(2);
  });

  it("groups every supported delivery rule with matching product numbers", () => {
    const groups = groupProductsByDeliveryRule(mockProducts);

    expect(groups).toHaveLength(6);
    expect(groups.every((group) => group.productNumbers.length > 0)).toBe(true);
    expect(groups.every((group) => group.productNames.length > 0)).toBe(true);
    expect(groups.find((group) => group.rule === "按招标文件执行")?.productNumbers).toContain("33");
    expect(groups.find((group) => group.rule === "按招标文件执行")?.productNames).toContain("敏感肌温和清洁与保湿日常护理礼盒");
  });
});
