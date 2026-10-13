"use client";

import {
  Bot,
  CheckCheck,
  CircleAlert,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useProjectStore } from "@/src/store/projectStore";

export function AIReviewPanel() {
  const products = useProjectStore((state) => state.products);
  const scan = useProjectStore((state) => state.aiScan);
  const processing = useProjectStore((state) => state.aiProcessing);
  const usage = useProjectStore((state) => state.aiUsage);
  const runAIReview = useProjectStore((state) => state.runAIReview);
  const retryFailedAI = useProjectStore((state) => state.retryFailedAI);
  const acceptHighConfidence = useProjectStore(
    (state) => state.acceptHighConfidenceSuggestions,
  );
  const suggestions = products.flatMap(
    (product) => product.aiMetadata?.suggestions ?? [],
  );
  const pending = suggestions.filter((item) => item.status === "pending");
  const highConfidence = pending.filter(
    (item) => item.canApply && item.confidence >= 0.85,
  );
  const reviewed = products.filter(
    (product) =>
      product.aiMetadata?.status === "processed" ||
      product.aiMetadata?.status === "needs-review",
  ).length;
  const isRunning =
    processing.status === "processing" || processing.status === "scanning";
  const progress = processing.total
    ? Math.round(
        ((processing.processed + processing.failed) / processing.total) * 100,
      )
    : 0;

  return (
    <section className={`ai-review-panel is-${processing.status}`}>
      <div className="ai-review-intro">
        <span className="ai-review-icon">
          <Bot aria-hidden="true" />
        </span>
        <div>
          <span>AI 数据审阅</span>
          <h2>智能检查与标准化建议</h2>
          <p>
            规则扫描先定位疑难数据，AI 只处理问题商品。原数据始终保留，SKU
            与价格绝不自动修改。
          </p>
        </div>
      </div>

      {isRunning ? (
        <div className="ai-progress-card" aria-live="polite">
          <div>
            <span>
              批次 {processing.currentBatch || 1} / {processing.batchCount || 1}
            </span>
            <strong>{processing.message}</strong>
            <b>{progress}%</b>
          </div>
          <div className="ai-progress-track">
            <i style={{ width: `${progress}%` }} />
          </div>
          <small>
            每批 12 个商品；单批失败会自动重试 2 次，已成功结果不会丢失。
          </small>
        </div>
      ) : (
        <div className="ai-review-actions">
          <button
            className="ai-primary-action"
            type="button"
            onClick={() => void runAIReview()}
          >
            <Sparkles aria-hidden="true" />
            {scan ? "重新运行 AI 检查" : "一键 AI 检查"}
          </button>
          {highConfidence.length > 0 && (
            <button
              className="ai-secondary-action"
              type="button"
              onClick={acceptHighConfidence}
            >
              <CheckCheck aria-hidden="true" />
              接受 {highConfidence.length} 条高置信建议
            </button>
          )}
          {processing.failedProductIds.length > 0 && (
            <button
              className="ai-secondary-action is-warning"
              type="button"
              onClick={() => void retryFailedAI()}
            >
              <RefreshCw aria-hidden="true" />
              重试 {processing.failedProductIds.length} 个失败商品
            </button>
          )}
        </div>
      )}

      <div className="ai-review-metrics">
        <div>
          <strong>{scan?.problemProductIds.length ?? "—"}</strong>
          <span>规则发现问题商品</span>
        </div>
        <div>
          <strong>{reviewed}</strong>
          <span>AI 已处理</span>
        </div>
        <div>
          <strong>{pending.length}</strong>
          <span>待人工确认建议</span>
        </div>
        <div>
          <strong>{highConfidence.length}</strong>
          <span>高置信可接受</span>
        </div>
        <div>
          <strong>{processing.failed}</strong>
          <span>处理失败</span>
        </div>
        <div>
          <strong>{usage.totalTokens || "—"}</strong>
          <span>{usage.estimated ? "估算 Token" : "累计 Token"}</span>
        </div>
      </div>

      {processing.status !== "idle" && !isRunning && (
        <div
          className={`ai-result-summary ${processing.failed ? "has-warning" : ""}`}
        >
          {processing.failed ? (
            <CircleAlert aria-hidden="true" />
          ) : (
            <ShieldCheck aria-hidden="true" />
          )}
          <span>{processing.message}</span>
          <small>
            所有 AI 输出均已通过运行时 Schema 校验；建议尚未自动写入商品。
          </small>
        </div>
      )}
    </section>
  );
}
