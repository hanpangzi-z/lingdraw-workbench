"use client";

import { FileSearch, ImageOff, X } from "lucide-react";
import type { Product } from "@/types/catalog";
import type { RawImportedDocument } from "@/src/lib/import/types";

export function SourcePreview({
  product,
  document,
  onClose,
}: {
  product: Product;
  document?: RawImportedDocument;
  onClose: () => void;
}) {
  const source = product.sources?.[0];
  const unitNumber = source?.slide ?? source?.page;
  const sourceDocument =
    [document, ...(document?.relatedDocuments ?? [])].find(
      (item) => item?.fileName === source?.fileName,
    ) ?? document;
  const page =
    sourceDocument?.pages?.find((item) => item.pageNumber === unitNumber) ??
    sourceDocument?.pages?.[0];
  return (
    <div
      className="source-preview-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside
        className="source-preview-panel"
        role="dialog"
        aria-modal="true"
        aria-label="原始资料预览"
      >
        <header>
          <div>
            <FileSearch aria-hidden="true" />
            <span>
              <strong>原始资料</strong>
              <small>
                {source?.fileName ?? sourceDocument?.fileName ? (
                  <span data-ppt-no-translate translate="no">
                    {source?.fileName ?? sourceDocument?.fileName}
                  </span>
                ) : (
                  "未记录来源"
                )}
              </small>
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭原始资料预览">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="source-preview-meta">
          <strong>
            {product.name ? <span data-ppt-no-translate translate="no">{product.name}</span> : "未命名商品"}
          </strong>
          <span>
            {source?.type.toUpperCase()}
            {source?.page ? ` · 第 ${source.page} 页` : ""}
            {source?.slide ? ` · Slide ${source.slide}` : ""}
            {source?.sheet ? ` · ${source.sheet}` : ""}
            {source?.row ? ` · 第 ${source.row} 行` : ""}
          </span>
        </div>
        <div className="source-preview-content">
          {page?.previewUrl ? (
            <img
              className="source-page-image"
              src={page.previewUrl}
              alt={`原始资料第 ${page.pageNumber} 页`}
            />
          ) : (
            <div className="source-text-preview">
              <strong>
                {sourceDocument?.sourceType === "ppt"
                  ? `Slide ${page?.pageNumber ?? "-"}`
                  : `第 ${page?.pageNumber ?? "-"} 页`}
              </strong>
              <pre>
                {page?.text ||
                  String(product.rawData?.sourceText ?? "未提取到可预览文字。")}
              </pre>
            </div>
          )}
          {page?.images?.length ? (
            <div className="source-image-strip">
              {page.images
                .filter(
                  (image) =>
                    !["possibleLogo", "decoration"].includes(
                      image.classification,
                    ),
                )
                .slice(0, 12)
                .map((image) => (
                  <img
                    src={image.url}
                    alt={image.fileName ?? "提取图片"}
                    key={image.id}
                  />
                ))}
            </div>
          ) : (
            <div className="source-no-images">
              <ImageOff aria-hidden="true" />
              该来源单元没有可用商品图
            </div>
          )}
        </div>
        <footer>
          <strong>全部来源</strong>
          {product.sources?.map((item, index) => (
            <span key={`${item.fileName}-${index}`}>
              {item.type.toUpperCase()} · <span data-ppt-no-translate translate="no">{item.fileName}</span>
              {item.page ? ` / 第 ${item.page} 页` : ""}
              {item.slide ? ` / Slide ${item.slide}` : ""}
              {item.row ? ` / 第 ${item.row} 行` : ""}
            </span>
          ))}
        </footer>
      </aside>
    </div>
  );
}
