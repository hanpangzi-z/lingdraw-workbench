import type { CatalogSlide, Product, ProductDetailSlide } from "@/types/catalog";
import { createSlidePlan } from "@/src/lib/layout/createSlidePlan";
import { resolveProductTier } from "@/src/lib/catalog/tiers";
import type { SlidePlan } from "@/src/lib/layout/types";

export const PRODUCTS_PER_SLIDE = 3;

function chunkProducts(products: Product[], size: number): Product[][] {
  if (size < 1) throw new Error("分页尺寸必须大于 0");

  return Array.from({ length: Math.ceil(products.length / size) }, (_, index) =>
    products.slice(index * size, index * size + size),
  );
}

export function buildCatalogSlides(products: Product[], plans: SlidePlan[] = createSlidePlan(products, { mode: "force-grid-3" })): CatalogSlide[] {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const sections: Array<{ tier: ReturnType<typeof resolveProductTier>; products: Product[]; plans: SlidePlan[] }> = [];

  for (const plan of plans) {
    const planProducts = plan.productIds.map((id) => productsById.get(id)).filter((product): product is Product => Boolean(product));
    if (!planProducts.length) continue;
    const tier = resolveProductTier(planProducts[0]);
    const current = sections.at(-1);
    if (current?.tier.key === tier.key) {
      current.products.push(...planProducts);
      current.plans.push(plan);
    } else {
      sections.push({ tier, products: [...planProducts], plans: [plan] });
    }
  }

  const slides: CatalogSlide[] = [];
  const sectionCount = sections.length || 1;
  sections.forEach((section, sectionIndex) => {
    slides.push({
      id: sectionIndex === 0 ? "cover" : `cover-tier-${section.tier.key}-${sectionIndex + 1}`,
      kind: "cover",
      pageNumber: 0,
      priceTier: section.tier.priceTier,
      tierName: section.tier.tierName,
      productIds: section.products.map((product) => product.id),
      sectionIndex: sectionIndex + 1,
      sectionCount,
    });
    section.plans.forEach((plan, pageIndex) => {
      const slideProducts = plan.productIds.map((id) => productsById.get(id)).filter((product): product is Product => Boolean(product));
      slides.push({
        id: plan.id,
        kind: "products",
        pageNumber: 0,
        products: slideProducts,
        sectionNumber: 2,
        sectionPage: pageIndex + 1,
        priceTier: section.tier.priceTier,
        tierName: section.tier.tierName,
        plan,
      } satisfies ProductDetailSlide);
    });
  });

  if (!slides.length) slides.push({ id: "cover", kind: "cover", pageNumber: 0 });
  slides.push({ id: "end", kind: "end", pageNumber: 0 });
  return slides.map((slide, index) => ({ ...slide, pageNumber: index + 1 }));
}
