import { mockProducts } from "@/data/mock-products";

/**
 * Stable sample data shared by every template preview. Keeping this separate
 * prevents a template from looking better simply because it received easier
 * source content than another template.
 */
export const templateDemoProducts = mockProducts.slice(0, 3);
