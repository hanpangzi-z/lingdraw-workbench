import type { CSSProperties } from "react";
import { ProductCard } from "@/components/templates/business-red/ProductCard";
import { slideLayout, toCanvasWidthUnit } from "@/src/config/slideLayout";
import type { CatalogMeta, Product, ProductCategory } from "@/types/catalog";
import type { ProductAnalysis } from "../types";
import type { ProductLayoutConfig } from "./configTypes";
import type { EditorInteraction } from "@/src/lib/editor/interaction";
import type { SlideEditState } from "@/types/editor";

interface SharedPreviewProps {
  config: ProductLayoutConfig;
  products: Product[];
  analyses: ProductAnalysis[];
  meta: CatalogMeta;
  categories: ProductCategory[];
  debug?: boolean;
  slideId: string;
  editState?: SlideEditState;
  interaction?: EditorInteraction;
}

function boxStyle(box: ProductLayoutConfig["cards"][number]): CSSProperties {
  return {
    left: toCanvasWidthUnit(box.x),
    top: toCanvasWidthUnit(box.y),
    width: toCanvasWidthUnit(box.w),
    height: toCanvasWidthUnit(box.h),
  };
}

export function SharedProductLayoutPreview({ config, products, analyses, meta, categories, slideId, editState, interaction, debug = false }: SharedPreviewProps) {
  return (
    <div className={`br-adaptive-products br-layout-${config.type} ${debug ? "is-layout-debug" : ""}`} data-layout={config.type}>
      {config.cards.map((box, index) => {
        const product = products[index];
        return (
          <div className="br-layout-card-slot" style={boxStyle(box)} key={`${config.type}-${index}`}>
            {product ? <ProductCard product={product} meta={meta} categories={categories} slideId={slideId} editState={editState} interaction={interaction} variant={box.variant} analysis={analyses[index]} debug={debug} /> : <div className="br-empty-card" />}
          </div>
        );
      })}
      {debug && <div className="br-layout-debug-label">{config.label} · {config.capacity} 项 · {slideLayout.width}×{slideLayout.height}</div>}
    </div>
  );
}
