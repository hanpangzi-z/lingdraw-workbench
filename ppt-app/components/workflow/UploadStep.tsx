"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  CheckCircle2,
  Download,
  FileText,
  FolderUp,
  ImagePlus,
  LoaderCircle,
  ScanText,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { getDataRecords, getSheetHeaders } from "@/src/lib/excel/parser";
import { detectFileType, validatePrimaryFile } from "@/src/lib/import/detectFileType";
import { useProjectStore } from "@/src/store/projectStore";
import { useBatchStore } from "@/src/store/batchStore";
import type { ExcelCellValue } from "@/types/import";
import { useCloudProject } from "@/components/cloud/CloudProjectContext";
import { withBasePath } from "@/src/lib/basePath";
import { CHUNK_UPLOAD_BYTES } from "@/src/lib/cloud/upload";
import { WorkflowNextAction, WorkflowProgress } from "./WorkflowProgress";

const columnLabel = (index: number) => {
  let label = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
  return label;
};

const formatPreviewCell = (value: ExcelCellValue | undefined) => {
  if (Array.isArray(value)) return value.length ? `${value.length} 张图片` : "";
  const text = String(value ?? "");
  return text.startsWith("data:image/") ? "已识别图片" : text;
};

export function UploadStep({ onStageSourceFiles, stagedFiles = [] }: { onStageSourceFiles?: (files: File[]) => void; stagedFiles?: File[] } = {}) {
  const cloud = useCloudProject();
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const generationMode = useBatchStore((state) => state.generationMode);
  const setGenerationMode = useBatchStore((state) => state.setGenerationMode);
  const workbook = useProjectStore((state) => state.workbook);
  const config = useProjectStore((state) => state.importConfig);
  const project = useProjectStore((state) => state.project);
  const importProgress = useProjectStore((state) => state.importProgress);
  const importSession = useProjectStore((state) => state.importSession);
  const rawDocument = useProjectStore((state) => state.rawImportedDocument);
  const conflicts = useProjectStore((state) => state.importConflicts);
  const setSheet = useProjectStore((state) => state.setSheet);
  const setHeaderRow = useProjectStore((state) => state.setHeaderRow);
  const updateProject = useProjectStore((state) => state.updateProject);
  const setStep = useProjectStore((state) => state.setStep);
  const startDocumentImport = useProjectStore(
    (state) => state.startDocumentImport,
  );
  const resetImport = useProjectStore((state) => state.resetImport);
  const primaryInputRef = useRef<HTMLInputElement>(null);
  const supportInputRef = useRef<HTMLInputElement>(null);
  const [primaryFile, setPrimaryFile] = useState<File | undefined>(() => stagedFiles.find((file) => ["excel", "pdf", "word", "ppt"].includes(detectFileType(file.name))));
  const [supportingFiles, setSupportingFiles] = useState<File[]>(() => stagedFiles.filter((file) => file !== primaryFile));
  const [requestedAccept, setRequestedAccept] = useState(
    ".xlsx,.xls,.pdf,.docx,.pptx",
  );
  const [dragging, setDragging] = useState(false);
  const [enableOcr, setEnableOcr] = useState(false);
  const [error, setError] = useState("");
  const [sourceUploadProgress, setSourceUploadProgress] = useState<number>();
  const loading = [
    "parsing",
    "detecting",
    "normalizing",
    "matching-images",
  ].includes(importProgress.phase);
  const selectedSheet = workbook?.sheets.find(
    (sheet) => sheet.name === config?.sheetName,
  );
  const maxColumns = Math.min(
    12,
    Math.max(
      0,
      ...(selectedSheet?.rows.slice(0, 18).map((row) => row.length) ?? [0]),
    ),
  );
  const previewRows = selectedSheet?.rows.slice(0, 18) ?? [];
  const headers =
    selectedSheet && config
      ? getSheetHeaders(selectedSheet, config.headerRow)
      : [];
  const excelRecordCount =
    selectedSheet && config
      ? getDataRecords(selectedSheet, config.headerRow).length
      : 0;
  const sheetSummary = useMemo(
    () =>
      workbook?.sheets.map((sheet) => ({
        name: sheet.name,
        count: Math.max(0, sheet.nonEmptyRowCount - 1),
      })) ?? [],
    [workbook],
  );

  useEffect(() => {
    if (generationMode !== "single") setGenerationMode("single");
  }, [generationMode, setGenerationMode]);

  const selectFiles = (files: File[]) => {
    let primary: File | undefined;
    primary = files.find((file) =>
      ["excel", "pdf", "word", "ppt"].includes(detectFileType(file.name)),
    );
    if (!primary)
      return setError("请选择 .xlsx、.xls、.pdf、.docx 或 .pptx 主资料文件。");
    try { validatePrimaryFile(primary); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "文件不符合上传限制");
      return;
    }
    resetImport();
    setPrimaryFile(primary);
    setSupportingFiles(files.filter((file) => file !== primary));
    onStageSourceFiles?.(files);
    setError("");
  };
  const beginImport = async () => {
    if (!primaryFile) return;
    setError("");
    const sourceFiles = [
      primaryFile,
      ...supportingFiles.filter((file) => !file.type.startsWith("image/")),
    ];
    if (onStageSourceFiles) {
      onStageSourceFiles([primaryFile, ...supportingFiles]);
    } else if (cloud) {
      try {
        const totalBytes = sourceFiles.reduce((sum, file) => sum + file.size, 0);
        let completedBytes = 0;
        setSourceUploadProgress(0);
        for (const file of sourceFiles) {
          await cloud.uploadAsset(file, "source_file", (percent) =>
            setSourceUploadProgress(Math.round(((completedBytes + file.size * percent / 100) / totalBytes) * 100)),
          );
          completedBytes += file.size;
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "原始资料上传失败");
        return;
      } finally {
        setSourceUploadProgress(undefined);
      }
    }
    await startDocumentImport(primaryFile, supportingFiles, enableOcr);
  };
  const updateLogo = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { if (mounted.current) updateProject({ logo: String(reader.result) }); };
    reader.readAsDataURL(file);
  };

  const failedMessage =
    importProgress.phase === "failed" ? importProgress.message : error;
  const parsedReady = importSession?.status === "review" && rawDocument;
  const primaryType = primaryFile
    ? detectFileType(primaryFile.name)
    : undefined;
  const uploading = sourceUploadProgress !== undefined;

  return (
    <section className="workflow-page upload-page unified-import-page">
      <div className="workflow-page-heading">
        <div>
          <span>第 1 步</span>
          <h1>从现有资料生成新产品手册</h1>
          <p>
            Excel、PDF、Word 和旧 PPT
            会先转换为统一文档结构，再进入同一套商品确认、排版与导出流程。
          </p>
        </div>
        <div className="workflow-heading-actions">
          <a
            className="secondary-action"
            href={withBasePath("/examples/product-import-template.xlsx")}
            download="商品导入模板.xlsx"
          >
            <Download aria-hidden="true" />
            下载 Excel 模板
          </a>
        </div>
      </div>

      <input
        id="primary-import-file"
        ref={primaryInputRef}
        type="file"
        accept={requestedAccept}
        hidden
        onChange={(event) =>
          selectFiles(event.target.files ? [...event.target.files] : [])
        }
      />
      <input
        id="supporting-import-files"
        ref={supportInputRef}
        type="file"
        accept="image/*,.zip,.xlsx,.xls,.pdf,.docx,.pptx"
        multiple
        hidden
        onChange={(event) => {
          resetImport();
          const attachments = event.target.files ? [...event.target.files] : [];
          setSupportingFiles(attachments);
          onStageSourceFiles?.([...(primaryFile ? [primaryFile] : []), ...attachments]);
        }}
      />

      <div className="upload-layout">
        <div className="upload-main">
          <div
            className={`excel-dropzone unified-dropzone ${dragging ? "is-dragging" : ""} ${primaryFile ? "has-file" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              selectFiles([...event.dataTransfer.files]);
            }}
          >
            {loading ? (
              <LoaderCircle className="is-spinning" aria-hidden="true" />
            ) : primaryFile ? (
              <CheckCircle2 aria-hidden="true" />
            ) : (
              <UploadCloud aria-hidden="true" />
            )}
            <div>
              <strong>
                {primaryFile?.name ?? "拖拽主资料与附加图片到这里"}
              </strong>
              <span>
                {primaryFile
                  ? `${primaryType?.toUpperCase()} 主资料 · ${(primaryFile.size / 1024 / 1024).toFixed(1)}MB${primaryFile.size > CHUNK_UPLOAD_BYTES ? " · 5MB 分片上传" : ""}`
                  : "第一个文档作为主资料，其余图片 / ZIP 作为附件 · 单文件上限 100MB"}
              </span>
            </div>
            <label
              className="dropzone-file-action"
              htmlFor="primary-import-file"
              onClick={() => setRequestedAccept(".xlsx,.xls,.pdf,.docx,.pptx")}
            >
              {primaryFile ? "更换主资料" : "选择文件"}
            </label>
          </div>

          <div className="supporting-files-bar">
            <div>
              <FolderUp aria-hidden="true" />
              <span>
                <strong>附加资料 / 图片 / ZIP</strong>
                <small>
                  {supportingFiles.length
                    ? `已选 ${supportingFiles.length} 个附件，将联合识别`
                    : "可选：附加文档按 SKU 合并，图片按 SKU 或商品名匹配"}
                </small>
              </span>
            </div>
            <label
              className="support-file-action"
              htmlFor="supporting-import-files"
            >
              <Archive aria-hidden="true" />
              {supportingFiles.length ? "重新选择" : "选择附件"}
            </label>
          </div>
          {primaryType === "pdf" && (
            <label className="ocr-fallback-option">
              <input
                type="checkbox"
                checked={enableOcr}
                onChange={(event) => setEnableOcr(event.target.checked)}
              />
              <ScanText aria-hidden="true" />
              <span>
                <strong>低文字密度时启用 OCR fallback</strong>
                <small>
                  普通 PDF 仍优先读取文字层；未配置 OCR Provider
                  时会保留原页预览并提示人工处理。
                </small>
              </span>
            </label>
          )}
          {primaryFile && !parsedReady && (
            <button
              className="import-start-button"
              type="button"
              disabled={loading || uploading}
              onClick={() => void beginImport()}
            >
              {loading || uploading ? (
                <LoaderCircle className="is-spinning" aria-hidden="true" />
              ) : (
                <Sparkles aria-hidden="true" />
              )}
              {uploading ? `分片上传中 ${sourceUploadProgress}%` : loading ? importProgress.message : "开始解析与识别"}
            </button>
          )}
          {(uploading || loading || importProgress.phase === "failed") && (
            <div className={`import-progress-card is-${uploading ? "uploading" : importProgress.phase}`}>
              <div>
                <strong>{uploading ? "正在分片上传主资料" : importProgress.message}</strong>
                <span>{uploading ? sourceUploadProgress : importProgress.percent}%</span>
              </div>
              <i>
                <b style={{ width: `${uploading ? sourceUploadProgress : importProgress.percent}%` }} />
              </i>
            </div>
          )}
          {failedMessage && (
            <div className="inline-error">
              <X aria-hidden="true" />
              {failedMessage}
            </div>
          )}

          {parsedReady && (
            <div className="import-result-summary">
              <header>
                <CheckCircle2 aria-hidden="true" />
                <div>
                  <strong>解析完成</strong>
                  <span data-ppt-no-translate translate="no">{rawDocument.fileName}</span>
                </div>
              </header>
              <div className="import-summary-stats">
                <div>
                  <strong>
                    {importSession.extractedProductCount ||
                      excelRecordCount ||
                      0}
                  </strong>
                  <span>套餐候选</span>
                </div>
                <div>
                  <strong>{importSession.extractedImageCount}</strong>
                  <span>提取图片</span>
                </div>
                <div>
                  <strong>{importSession.matchedImageCount}</strong>
                  <span>已匹配图片</span>
                </div>
                <div className={conflicts.length ? "has-warning" : ""}>
                  <strong>{conflicts.length}</strong>
                  <span>数据冲突</span>
                </div>
              </div>
              {importSession.warnings.length > 0 && (
                <ul>
                  {importSession.warnings.slice(0, 5).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
              {rawDocument.pages?.length ? (
                <div className="raw-page-snippets">
                  {rawDocument.pages.slice(0, 3).map((page) => (
                    <article key={page.pageNumber}>
                      {page.previewUrl ? (
                        <img
                          src={page.previewUrl}
                          alt={`原文档第 ${page.pageNumber} 页`}
                        />
                      ) : (
                        <FileText aria-hidden="true" />
                      )}
                      <div>
                        <strong>
                          {rawDocument.sourceType === "ppt"
                            ? `Slide ${page.pageNumber}`
                            : `第 ${page.pageNumber} 页`}
                        </strong>
                        <p>{page.text ? <span data-ppt-no-translate translate="no">{page.text.slice(0, 100)}</span> : "未提取到文字"}</p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {workbook && selectedSheet && config && (
            <div className="raw-preview-panel">
              <header>
                <div>
                  <strong>原始数据预览</strong>
                  <span>绿色行为当前表头</span>
                </div>
                <div className="preview-selectors">
                  <label>
                    Sheet
                    <select
                      value={config.sheetName}
                      onChange={(event) => setSheet(event.target.value)}
                    >
                      {sheetSummary.map((sheet) => (
                        <option value={sheet.name} key={sheet.name}>
                          {sheet.name} · 约 {sheet.count} 行
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    表头所在行
                    <select
                      value={config.headerRow}
                      onChange={(event) =>
                        setHeaderRow(Number(event.target.value))
                      }
                    >
                      {selectedSheet.rows
                        .slice(0, Math.min(20, selectedSheet.rows.length))
                        .map((_, index) => (
                          <option value={index + 1} key={index}>
                            第 {index + 1} 行
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              </header>
              <div className="raw-table-scroll">
                <table className="raw-excel-table">
                  <thead>
                    <tr>
                      <th />
                      {Array.from({ length: maxColumns }, (_, index) => (
                        <th key={index}>{columnLabel(index)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, rowIndex) => (
                      <tr
                        className={
                          rowIndex + 1 === config.headerRow
                            ? "is-header-row"
                            : ""
                        }
                        key={rowIndex}
                      >
                        <th>{rowIndex + 1}</th>
                        {Array.from(
                          { length: maxColumns },
                          (_, columnIndex) => {
                            const preview = formatPreviewCell(row[columnIndex]);
                            return (
                              <td data-ppt-no-translate translate="no" key={columnIndex} title={preview}>
                                {preview}
                              </td>
                            );
                          },
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <footer>
                当前 Sheet 识别到{" "}
                {
                  headers.filter((header) => !header.startsWith("未命名列"))
                    .length
                }{" "}
                个命名字段；转换时将合并全部 {sheetSummary.length} 个有效
                Sheet。
              </footer>
            </div>
          )}
        </div>

        <aside className="project-settings">
          <header>
            <span>项目</span>
            <h2>项目基础信息</h2>
            <p>这些内容会进入封面、结束页和 PPT 文件名。</p>
          </header>
          <div className="settings-grid">
            <label>
              项目名称
              <input
                value={project.projectName}
                onChange={(event) =>
                  updateProject({ projectName: event.target.value })
                }
              />
            </label>
            <label>
              地区
              <input
                value={project.city}
                onChange={(event) =>
                  updateProject({ city: event.target.value })
                }
              />
            </label>
            <label>
              年份
              <input
                type="number"
                value={project.year}
                onChange={(event) =>
                  updateProject({
                    year: Number(event.target.value) || project.year,
                  })
                }
              />
            </label>
            <label>
              档位名称
              <input
                value={project.tierName}
                onChange={(event) =>
                  updateProject({ tierName: event.target.value })
                }
              />
            </label>
            <label>
              套餐价格
              <input
                type="number"
                value={project.priceTier}
                onChange={(event) =>
                  updateProject({ priceTier: Number(event.target.value) || 0 })
                }
              />
            </label>
            <label>
              公司名称
              <input
                value={project.brand}
                onChange={(event) =>
                  updateProject({ brand: event.target.value })
                }
              />
            </label>
          </div>
          <label className="logo-upload">
            <ImagePlus aria-hidden="true" />
            <span>
              <strong>{project.logo ? "Logo 已上传" : "上传 Logo"}</strong>
              <small>PNG / JPG，可选</small>
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(event) => updateLogo(event.target.files?.[0])}
            />
          </label>
        </aside>
      </div>

      <div className="workflow-footer-actions">
        <span>
          {parsedReady ? (
            <>已准备：<span data-ppt-no-translate translate="no">{rawDocument.fileName}</span></>
          ) : primaryFile ? (
            <>主资料：<span data-ppt-no-translate translate="no">{primaryFile.name}</span></>
          ) : (
            "请上传 Excel、PDF、Word 或 PPT 主资料，解析后继续"
          )}
        </span>
        {uploading || loading ? <WorkflowProgress message={uploading ? "正在上传主资料…" : importProgress.message} percent={uploading ? sourceUploadProgress : importProgress.percent} /> : null}
        <WorkflowNextAction
          label={workbook && config ? "下一步：字段匹配" : "进入数据确认"}
          message={workbook && config ? "正在加载字段匹配…" : "正在加载数据确认…"}
          disabled={uploading || loading || !(workbook && config) && (!parsedReady || !importSession?.extractedProductCount)}
          action={() => setStep(workbook && config ? "mapping" : "confirm")}
        />
      </div>
    </section>
  );
}
