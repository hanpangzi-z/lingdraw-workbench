import type { CatalogMeta, Product } from "@/types/catalog";
import type { EditorState } from "@/types/editor";
import type { LayoutMode, ManualLayoutOverride } from "@/src/lib/layout/types";

export type ProjectStatusValue = "draft" | "ready" | "exported" | "archived";

export interface CloudProjectSnapshot {
  project: CatalogMeta;
  products: Product[];
  layoutMode: LayoutMode;
  layoutOverrides: Record<string, ManualLayoutOverride>;
  editorState: EditorState;
  batchConfig?: unknown;
}

export interface ProjectSummaryDto {
  id: string;
  name: string;
  templateName?: string;
  description?: string | null;
  status: ProjectStatusValue;
  year?: number | null;
  region?: string | null;
  priceTier?: string | null;
  thumbnailUrl?: string | null;
  thumbnailDirty: boolean;
  productCount: number;
  slideCount: number;
  categoryCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  deletedAt?: string | null;
}

export interface ProjectDetailDto extends ProjectSummaryDto {
  snapshot: CloudProjectSnapshot;
}

export interface ProjectListDto {
  items: ProjectSummaryDto[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}
