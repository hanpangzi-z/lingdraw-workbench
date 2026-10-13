import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("web product layout", () => {
  it("keeps slide arrival animation from overriding viewport zoom", () => {
    const shellRule = css.match(/\.main-slide-shell\s*\{[^}]*\}/)?.[0] ?? "";
    expect(shellRule).not.toContain("animation: slide-arrive");
    expect(css).toMatch(
      /\.main-slide-shell\s*>\s*\.slide-frame\s*\{[^}]*animation:\s*slide-arrive/,
    );
  });

  it("collapses hidden price rows for single-product cards", () => {
    expect(css).toMatch(
      /\.br-product-card\.without-product-identifiers:is\(\.variant-feature, \.variant-package, \.variant-image-focus\)\.is-price-hidden\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\);[^}]*grid-template-areas:\s*"image content";/,
    );
  });

  it("collapses hidden price columns for horizontal multi-product cards", () => {
    expect(css).toMatch(
      /\.br-product-card\.variant-grid-2-row\.is-price-hidden\s*\{[^}]*grid-template-columns:\s*30% minmax\(0, 1fr\);[^}]*"image content";/,
    );
    expect(css).toMatch(
      /\.br-product-card\.variant-mixed-secondary\.is-price-hidden\s*\{[^}]*grid-template-columns:\s*34% minmax\(0, 1fr\);[^}]*"image content";/,
    );
  });

  it("does not reserve an empty identifier row in mixed secondary cards", () => {
    expect(css).toMatch(
      /\.br-product-card\.without-product-identifiers\.variant-mixed-secondary\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\);[^}]*grid-template-areas:\s*"image content prices";/,
    );
  });
});
