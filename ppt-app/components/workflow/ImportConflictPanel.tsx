"use client";

import { AlertTriangle, CheckCircle2, GitCompareArrows } from "lucide-react";
import { useProjectStore } from "@/src/store/projectStore";
import type { ProductDataConflict } from "@/src/lib/import/types";

const fieldLabels: Record<ProductDataConflict["field"], string> = {
  sku: "SKU",
  name: "商品名称",
  items: "商品明细",
  marketPrice: "市场价",
  salePrice: "套餐价",
  delivery: "配送区域",
  category: "分类",
  image: "图片",
};

const displayValue = (value: unknown) =>
  Array.isArray(value) ? value.join("；") : String(value ?? "空");
const sourceLabel = (conflict: ProductDataConflict, index: number) => {
  const source = conflict.alternatives[index].source;
  return `${source.type.toUpperCase()} · ${source.fileName}${source.page ? ` · 第 ${source.page} 页` : ""}${source.slide ? ` · Slide ${source.slide}` : ""}${source.row ? ` · 第 ${source.row} 行` : ""}`;
};

export function ImportConflictPanel() {
  const conflicts = useProjectStore((state) => state.importConflicts);
  const resolveConflict = useProjectStore(
    (state) => state.resolveImportConflict,
  );
  if (!conflicts.length) return null;
  const unresolved = conflicts.filter((conflict) => !conflict.resolved).length;
  return (
    <section
      className={`import-conflict-panel ${unresolved ? "has-unresolved" : "is-resolved"}`}
    >
      <header>
        {unresolved ? (
          <AlertTriangle aria-hidden="true" />
        ) : (
          <CheckCircle2 aria-hidden="true" />
        )}
        <div>
          <strong>
            {unresolved
              ? `检测到 ${unresolved} 个未解决数据冲突`
              : "数据冲突已全部确认"}
          </strong>
          <p>关键业务数值不会由 AI 自动决定，请明确选择来源。</p>
        </div>
      </header>
      {conflicts.map((conflict) => (
        <article
          className={conflict.resolved ? "is-resolved" : ""}
          key={conflict.id}
        >
          <div className="conflict-title">
            <GitCompareArrows aria-hidden="true" />
            <strong>
              {conflict.sku || "无 SKU"} · {fieldLabels[conflict.field]}
            </strong>
            {conflict.resolved && <span>已确认</span>}
          </div>
          <div className="conflict-alternatives">
            {conflict.alternatives.map((alternative, index) => (
              <button
                type="button"
                className={
                  conflict.selectedCandidateId === alternative.candidateId
                    ? "is-selected"
                    : ""
                }
                onClick={() =>
                  resolveConflict(conflict.id, alternative.candidateId)
                }
                key={`${alternative.candidateId}-${index}`}
              >
                <small>{sourceLabel(conflict, index)}</small>
                <strong data-ppt-no-translate translate="no">{displayValue(alternative.value)}</strong>
                <span>
                  {conflict.selectedCandidateId === alternative.candidateId
                    ? "当前选择"
                    : "使用此值"}
                </span>
              </button>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
