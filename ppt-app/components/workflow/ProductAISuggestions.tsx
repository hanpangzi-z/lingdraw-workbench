"use client";

import { Bot, Check, Info, ShieldAlert, X } from "lucide-react";
import { productCategories } from "@/data/catalog";
import { useProjectStore } from "@/src/store/projectStore";
import type { Product } from "@/types/catalog";
import type { AISuggestion, AIValue } from "@/types/ai";

function displayValue(value: AIValue, suggestion: AISuggestion) {
  if (value === null || value === "" || (Array.isArray(value) && !value.length))
    return <em>空</em>;
  if (suggestion.field === "categoryId" && typeof value === "string") {
    if (value === "uncategorized") return "未分类";
    return <span data-ppt-no-translate translate="no">{productCategories.find((category) => category.id === value)?.name ?? value}</span>;
  }
  if (Array.isArray(value))
    return value.map((item, index) => (
      <span data-ppt-no-translate translate="no" key={`${item}-${index}`}>{item}</span>
    ));
  return <span data-ppt-no-translate translate="no">{String(value)}</span>;
}

export function ProductAISuggestions({ product }: { product: Product }) {
  const resolveSuggestion = useProjectStore(
    (state) => state.resolveAISuggestion,
  );
  const metadata = product.aiMetadata;
  if (!metadata)
    return (
      <section className="drawer-ai-panel is-empty">
        <div>
          <Bot aria-hidden="true" />
          <span>
            <strong>AI 尚未检查</strong>
            <small>
              在数据确认页运行“一键 AI 检查”后，这里会显示字段级建议。
            </small>
          </span>
        </div>
      </section>
    );
  if (metadata.status === "processing")
    return (
      <section className="drawer-ai-panel is-empty">
        <div>
          <Bot aria-hidden="true" />
          <span>
            <strong>AI 正在处理</strong>
            <small>当前商品所在批次完成后会显示建议。</small>
          </span>
        </div>
      </section>
    );
  if (metadata.status === "failed")
    return (
      <section className="drawer-ai-panel is-failed">
        <div>
          <ShieldAlert aria-hidden="true" />
          <span>
            <strong>本批处理失败</strong>
            <small>
              {metadata.error || "可在数据确认页单独重试失败商品。"}
            </small>
          </span>
        </div>
      </section>
    );

  return (
    <section className="drawer-ai-panel">
      <header>
        <div>
          <Bot aria-hidden="true" />
          <span>
            <strong>AI 审阅建议</strong>
            <small>
              {metadata.provider === "mock"
                ? "Mock 模式 · 本地确定性结果"
                : "灵绘 AI · 结构化输出"}
            </small>
          </span>
        </div>
        <b>
          {
            metadata.suggestions.filter((item) => item.status === "pending")
              .length
          }{" "}
          待确认
        </b>
      </header>
      {!metadata.suggestions.length && (
        <div className="ai-no-suggestion">
          <Check aria-hidden="true" />
          未发现需要调整的字段
        </div>
      )}
      <div className="ai-suggestion-list">
        {metadata.suggestions.map((suggestion) => (
          <article
            className={`ai-suggestion-card is-${suggestion.status} ${suggestion.canApply ? "" : "is-warning"}`}
            key={suggestion.id}
          >
            <div className="ai-suggestion-heading">
              <strong>{suggestion.label}</strong>
              <span
                className={
                  suggestion.confidence >= 0.85
                    ? "is-high"
                    : suggestion.confidence >= 0.7
                      ? "is-medium"
                      : "is-low"
                }
              >
                {Math.round(suggestion.confidence * 100)}%
              </span>
              {!suggestion.canApply && (
                <i>
                  <ShieldAlert aria-hidden="true" />
                  仅提示
                </i>
              )}
            </div>
            <div className="ai-value-compare">
              <div>
                <small>原始值</small>
                <p>{displayValue(suggestion.originalValue, suggestion)}</p>
              </div>
              <div>
                <small>{suggestion.canApply ? "建议值" : "异常说明"}</small>
                <p>
                  {suggestion.canApply
                    ? displayValue(suggestion.suggestedValue, suggestion)
                    : <span data-ppt-no-translate translate="no">{suggestion.reason}</span>}
                </p>
              </div>
            </div>
            {suggestion.canApply && (
              <p className="ai-suggestion-reason">
                <Info aria-hidden="true" />
                <span data-ppt-no-translate translate="no">{suggestion.reason}</span>
              </p>
            )}
            {suggestion.status === "pending" ? (
              <footer>
                {suggestion.canApply && (
                  <button
                    type="button"
                    className="accept"
                    onClick={() =>
                      resolveSuggestion(product.id, suggestion.id, true)
                    }
                  >
                    <Check aria-hidden="true" />
                    接受建议
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    resolveSuggestion(product.id, suggestion.id, false)
                  }
                >
                  <X aria-hidden="true" />
                  {suggestion.canApply ? "保留原值" : "已知悉"}
                </button>
              </footer>
            ) : (
              <footer className="is-resolved">
                <span>
                  {suggestion.status === "accepted" ? (
                    <>
                      <Check aria-hidden="true" />
                      已接受
                    </>
                  ) : (
                    <>
                      <X aria-hidden="true" />
                      已保留原值
                    </>
                  )}
                </span>
              </footer>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
