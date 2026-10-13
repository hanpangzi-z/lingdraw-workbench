import { describe, expect, it } from "vitest";
import { createImageScenePrompt, selectImageReferences } from "@/src/lib/ai/imageScenePrompts";

describe("AI image scene prompts", () => {
  it("inserts the selected product name into all three scene templates", () => {
    expect(createImageScenePrompt("office", "肉禽水果组合")).toContain("【肉禽水果组合】放在【笔记本电脑旁】");
    expect(createImageScenePrompt("camping", "肉禽水果组合")).toContain("【肉禽水果组合】放在【露营折叠桌】上");
    expect(createImageScenePrompt("home", "肉禽水果组合")).toContain("【肉禽水果组合】摆放在【客厅原木茶几】上");
  });

  it("deduplicates and limits image-to-image references to ten pictures", () => {
    const sources = Array.from({ length: 12 }, (_, index) => `${index}.png`);
    expect(selectImageReferences([sources[0], sources[1], sources[0], undefined, ...sources.slice(2)])).toEqual(sources.slice(0, 10));
  });
});
