import type { EditorSelection, SlideEditState } from "@/types/editor";
import type { Product } from "@/types/catalog";

export interface EditorInteraction {
  enabled: boolean;
  selection?: EditorSelection;
  onSelect: (selection: EditorSelection) => void;
  onProductChange: (productId: string, patch: Partial<Product>) => void;
  onSlideEdit: (slideId: string, patch: Partial<SlideEditState>) => void;
}
