import { describe, expect, it } from "vitest";
import {
  MAX_GENERATED_PPT_BYTES,
  MAX_UPLOAD_BYTES,
  maxUploadBytesFor,
} from "@/src/server/assets/config";

describe("asset upload limits", () => {
  it("allows generated PowerPoint exports to be larger than regular uploads", () => {
    expect(maxUploadBytesFor("source_file")).toBe(MAX_UPLOAD_BYTES);
    expect(maxUploadBytesFor("generated_ppt")).toBe(MAX_GENERATED_PPT_BYTES);
    expect(MAX_GENERATED_PPT_BYTES).toBeGreaterThan(MAX_UPLOAD_BYTES);
  });
});
