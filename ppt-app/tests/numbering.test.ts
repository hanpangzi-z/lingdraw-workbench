import { describe, expect, it } from "vitest";
import { formatPackageSequence, toChineseSequence } from "@/src/lib/catalog/numbering";

describe("package sequence labels", () => {
  it("formats imported product numbers as readable Chinese package labels", () => {
    expect(formatPackageSequence("01")).toBe("套餐一");
    expect(formatPackageSequence("10")).toBe("套餐十");
    expect(formatPackageSequence("17")).toBe("套餐十七");
    expect(formatPackageSequence("48")).toBe("套餐四十八");
    expect(toChineseSequence("NO.02")).toBe("二");
  });
});
