import type { Product } from "@/types/catalog";
import { analyzeProducts } from "./analyzeProduct";
import { chooseLayout } from "./chooseLayout";
import { createSlidePlan } from "./createSlidePlan";
import type { LayoutAdvisor, LayoutPlanningOptions, ProductAnalysis } from "./types";

export class RuleBasedLayoutAdvisor implements LayoutAdvisor {
  analyze(products: Product[]) { return analyzeProducts(products); }
  recommend(products: Product[], analyses?: ProductAnalysis[]) { return chooseLayout(products, analyses); }
  createPlan(products: Product[], options?: LayoutPlanningOptions) { return createSlidePlan(products, options); }
}

export const layoutAdvisor: LayoutAdvisor = new RuleBasedLayoutAdvisor();
