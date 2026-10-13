import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { catalogMeta, productCategories } from "../data/catalog";
import { mockProducts } from "../data/mock-products";
import { buildPpt } from "../src/lib/ppt/generatePpt";
import { getTemplate } from "../src/templates/registry";
import type { TemplateId } from "../src/templates/types";
import type { ThemeId } from "../src/themes/types";

async function main() {
  const outputDirectory = resolve("output");
  await mkdir(outputDirectory, { recursive: true });
  const template = getTemplate((process.env.PPT_TEMPLATE_ID ?? catalogMeta.design.templateId) as TemplateId);
  const requestedTheme = process.env.PPT_THEME_ID as ThemeId | undefined;
  const themeId = requestedTheme && template.supportedThemes.includes(requestedTheme) ? requestedTheme : template.defaultThemeId;
  const meta = {
    ...catalogMeta,
    design: { ...catalogMeta.design, templateId: template.id, themeId },
  };

  const result = await buildPpt({
    meta,
    products: mockProducts,
    categories: productCategories,
  });

  const outputName = process.env.PPT_TEMPLATE_ID ? `${template.id}-${themeId}-${result.fileName}` : result.fileName;
  const outputPath = resolve(outputDirectory, outputName);
  await result.presentation.writeFile({ fileName: outputPath, compression: true });

  console.log(JSON.stringify({ outputPath, slideCount: result.slideCount, warnings: result.warnings }, null, 2));
}

main().catch((error) => {
  console.error("Failed to generate sample PPTX", error);
  process.exitCode = 1;
});
