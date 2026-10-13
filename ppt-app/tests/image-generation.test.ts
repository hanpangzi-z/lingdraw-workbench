import { describe, expect, it } from "vitest";
import {
  createAspectMatchedImagePrompt,
  extractLingDrawImage,
  imageExtension,
  imageSizeForAspectRatio,
} from "@/src/lib/ai/imageGeneration";

describe("AI image generation helpers", () => {
  it("reads a LingDraw bridge image response", () => {
    expect(extractLingDrawImage({ image: { base64: "YWJj", mimeType: "image/png" } })).toEqual({ base64: "YWJj", mimeType: "image/png" });
  });

  it("rejects an invalid LingDraw bridge image response", () => {
    expect(() => extractLingDrawImage({ image: { base64: "abc", mimeType: "text/plain" } })).toThrow("没有返回可用图片");
  });

  it("normalizes common image file extensions", () => {
    expect(imageExtension("image/webp")).toBe("webp");
    expect(imageExtension("image/jpeg")).toBe("jpg");
    expect(imageExtension("image/png")).toBe("png");
  });

  it("matches flexible GPT Image 2 output to the selected frame ratio", () => {
    const output = imageSizeForAspectRatio(0.7, "gpt-image-2");
    expect(output.height).toBe(1536);
    expect(output.width % 16).toBe(0);
    expect(output.height % 16).toBe(0);
    expect(output.width / output.height).toBeCloseTo(0.7, 2);
  });

  it("uses supported preset sizes for older image models", () => {
    expect(imageSizeForAspectRatio(0.7, "gpt-image-1").value).toBe("1024x1536");
    expect(imageSizeForAspectRatio(1.8, "gpt-image-1").value).toBe("1536x1024");
    expect(imageSizeForAspectRatio(1, "gpt-image-1").value).toBe("1024x1024");
  });

  it("adds full-bleed composition guidance", () => {
    const output = imageSizeForAspectRatio(0.7, "gpt-image-2");
    const prompt = createAspectMatchedImagePrompt("生成商品场景图", output, 10);
    expect(prompt).toContain("参考图 1 至 10");
    expect(prompt).toContain("唯一允许使用的商品来源");
    expect(prompt).toContain("禁止虚构、增加、替换或重新设计任何商品");
    expect(prompt).toContain(`${output.width}×${output.height}`);
    expect(prompt).toContain("铺满画布四边");
    expect(prompt).toContain("不要白边");
  });
});
