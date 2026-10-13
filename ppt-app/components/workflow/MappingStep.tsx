"use client";

import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  LoaderCircle,
  Link2,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import {
  BATCH_IMPORT_FIELD_DEFINITIONS,
  IMPORT_FIELD_DEFINITIONS,
} from "@/src/lib/excel/fields";
import { getSheetHeaders } from "@/src/lib/excel/parser";
import { useProjectStore } from "@/src/store/projectStore";
import { useBatchStore } from "@/src/store/batchStore";
import { WorkflowNextAction } from "./WorkflowProgress";

export function MappingStep() {
  const generationMode = useBatchStore((state) => state.generationMode);
  const workbook = useProjectStore((state) => state.workbook);
  const config = useProjectStore((state) => state.importConfig);
  const setStep = useProjectStore((state) => state.setStep);
  const setFieldMapping = useProjectStore((state) => state.setFieldMapping);
  const setSplitItemsBySlash = useProjectStore(
    (state) => state.setSplitItemsBySlash,
  );
  const convertImport = useProjectStore((state) => state.convertImport);
  const aiFieldDetection = useProjectStore((state) => state.aiFieldDetection);
  const detectFieldMappingsWithAI = useProjectStore(
    (state) => state.detectFieldMappingsWithAI,
  );
  const sheet = workbook?.sheets.find(
    (item) => item.name === config?.sheetName,
  );

  if (!workbook || !sheet || !config) return null;

  const headers = getSheetHeaders(sheet, config.headerRow);
  const fields =
    generationMode === "batch"
      ? BATCH_IMPORT_FIELD_DEFINITIONS
      : IMPORT_FIELD_DEFINITIONS;
  const matchedCount = fields.filter((field) =>
    config.fieldMappings.some(
      (mapping) => mapping.targetField === field.key && mapping.sourceColumn,
    ),
  ).length;
  const unmatchedCount = fields.length - matchedCount;
  const nameMapped = config.fieldMappings.some(
    (mapping) => mapping.targetField === "name" && mapping.sourceColumn,
  );
  const sourceLabel = config.sourceType === "word" ? "Word 表格" : "Excel";
  const importableSheetCount = workbook.sheets.filter(
    (item) => item.nonEmptyRowCount > 0,
  ).length;

  return (
    <section className="workflow-page mapping-page">
      <div className="workflow-page-heading">
        <div>
          <span>第 2 步</span>
          <h1>核对字段匹配</h1>
          <p>
            系统只使用字段关键词进行规则匹配；未匹配或匹配不准确的字段可手动修改。
          </p>
        </div>
        <div className="mapping-score">
          <strong>{matchedCount}</strong>
          <span>
            / {fields.length}
            <small>已自动匹配</small>
          </span>
        </div>
      </div>

      <div className="mapping-context-bar">
        <div>
          <FileSummary label="文件" value={config.fileName} userData />
          <FileSummary
            label="导入范围"
            value={`${importableSheetCount} 个 Sheet`}
          />
          <FileSummary label="当前核对" value={config.sheetName} userData />
          <FileSummary label="表头" value={`第 ${config.headerRow} 行`} />
        </div>
        <div className="mapping-ai-actions">
          <span>
            <Sparkles aria-hidden="true" />
            规则优先，AI 只补充未匹配字段
          </span>
          <button
            type="button"
            disabled={
              !unmatchedCount || aiFieldDetection.status === "processing"
            }
            onClick={() => void detectFieldMappingsWithAI()}
          >
            {aiFieldDetection.status === "processing" ? (
              <LoaderCircle className="is-spinning" aria-hidden="true" />
            ) : (
              <Bot aria-hidden="true" />
            )}
            {aiFieldDetection.status === "processing"
              ? "AI 正在识别…"
              : `AI 推荐未匹配字段${unmatchedCount ? ` (${unmatchedCount})` : ""}`}
          </button>
        </div>
      </div>

      {aiFieldDetection.status === "failed" && (
        <div className="mapping-ai-error">
          <TriangleAlert aria-hidden="true" />
          {aiFieldDetection.error}
        </div>
      )}

      <div
        className="mapping-list"
        role="table"
        aria-label={`${sourceLabel}字段映射`}
      >
        <div className="mapping-list-head" role="row">
          <span>系统标准字段</span>
          <span>映射关系</span>
          <span>{sourceLabel}字段</span>
          <span>状态</span>
        </div>
        {fields.map((field) => {
          const mapping = config.fieldMappings.find(
            (item) => item.targetField === field.key,
          );
          const matched = Boolean(mapping?.sourceColumn);
          return (
            <div className="mapping-row" role="row" key={field.key}>
              <div>
                <strong>
                  {field.label}
                  {field.required && <i>*</i>}
                </strong>
                <small>{field.description}</small>
              </div>
              <Link2 aria-hidden="true" />
              <select
                value={mapping?.sourceColumn ?? ""}
                onChange={(event) =>
                  setFieldMapping(field.key, event.target.value || undefined)
                }
              >
                <option value="">未匹配</option>
                {headers.map((header) => (
                  <option data-ppt-no-translate translate="no" value={header} key={header}>
                    {header}
                  </option>
                ))}
              </select>
              <span
                className={`mapping-status ${matched ? "is-matched" : "is-unmatched"}`}
                title={mapping?.reason}
              >
                {matched ? (
                  <>
                    <CheckCircle2 aria-hidden="true" />
                    {mapping?.source === "ai"
                      ? `AI ${Math.round((mapping.confidence ?? 0) * 100)}%`
                      : mapping?.source === "manual"
                        ? "人工匹配"
                        : "规则匹配"}
                  </>
                ) : (
                  <>
                    <TriangleAlert aria-hidden="true" />
                    未匹配
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {importableSheetCount > 1 && (
        <div className="mapping-required-warning">
          <CheckCircle2 aria-hidden="true" />
          转换时会合并导入全部 {importableSheetCount} 个有效 Sheet；其他 Sheet
          将按各自表头自动匹配字段。
        </div>
      )}

      <label className="parser-option">
        <input
          type="checkbox"
          checked={config.splitItemsBySlash}
          onChange={(event) => setSplitItemsBySlash(event.target.checked)}
        />
        <span>
          <strong>允许使用斜杠拆分商品明细</strong>
          <small>
            默认按换行、中英文分号和竖线拆分；为避免误拆“500g×2 /
            300g×1”，建议仅在确认原数据确实使用斜杠分隔时开启。
          </small>
        </span>
      </label>

      {!nameMapped && (
        <div className="mapping-required-warning">
          <TriangleAlert aria-hidden="true" />
          必须为“套餐名称”选择一个{sourceLabel}字段后才能继续。
        </div>
      )}

      <div className="workflow-footer-actions">
        <button
          className="secondary-action"
          type="button"
          onClick={() => setStep("upload")}
        >
          <ArrowLeft aria-hidden="true" />
          返回上传资料
        </button>
        <WorkflowNextAction label="转换并检查数据" message="正在转换数据并匹配商品图片…" disabled={!nameMapped || aiFieldDetection.status === "processing"} action={convertImport} />
      </div>
    </section>
  );
}

function FileSummary({ label, value, userData = false }: { label: string; value: string; userData?: boolean }) {
  return (
    <span>
      <small>{label}</small>
      {userData ? <strong data-ppt-no-translate translate="no">{value}</strong> : <strong>{value}</strong>}
    </span>
  );
}
