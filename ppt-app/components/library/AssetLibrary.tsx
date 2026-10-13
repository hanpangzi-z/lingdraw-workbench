"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  LoaderCircle,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { ResourceNavigation } from "./ResourceNavigation";
import { pptFetch } from "@/src/lib/basePath";
import { useStudioDialog } from "@/components/host/StudioDialogProvider";
import { listenForPptActivation } from "@/src/lib/hostEvents";

interface AssetRow {
  id: string;
  type: string;
  fileName: string;
  mimeType: string;
  size: number;
  width?: number | null;
  height?: number | null;
  createdAt: string;
  url: string;
}
interface AssetList {
  items: AssetRow[];
  page: number;
  total: number;
  pageCount: number;
}
const labels: Record<string, string> = {
  source_file: "源文件",
  product_image: "商品图",
  logo: "Logo",
  generated_ppt: "导出文件",
  thumbnail: "预览图",
};
const icon = (item: AssetRow) =>
  item.type === "product_image" ||
  item.type === "thumbnail" ||
  item.type === "logo"
    ? FileImage
    : item.type === "generated_ppt"
      ? FileArchive
      : item.mimeType.includes("sheet")
        ? FileSpreadsheet
        : File;
const size = (value: number) =>
  value > 1024 * 1024
    ? `${(value / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(value / 1024))} KB`;

export function AssetLibrary() {
  const dialog = useStudioDialog();
  const [data, setData] = useState<AssetList>();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadRequestId = useRef(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "30",
      });
      if (query) params.set("search", query);
      if (type) params.set("type", type);
      const response = await pptFetch(`/api/assets?${params}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      if (requestId !== loadRequestId.current) return;
      setData(payload);
      setError("");
    } catch (cause) {
      if (requestId === loadRequestId.current)
        setError(cause instanceof Error ? cause.message : "素材加载失败");
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [page, query, type]);
  useEffect(() => {
    void load();
    return listenForPptActivation(window, () => void load());
  }, [load]);
  const remove = async (asset: AssetRow) => {
    setError("");
    const usageResponse = await pptFetch(`/api/assets/${asset.id}`);
    const usage = await usageResponse.json();
    if (!usageResponse.ok) {
      setError(usage.error);
      return;
    }
    if (usage.total) {
      setError(
        `“${asset.fileName}”正在被 ${usage.total} 个资源引用，不能删除。`,
      );
      return;
    }
    if (!(await dialog.confirm(`删除“${asset.fileName}”？`))) return;
    const response = await pptFetch(`/api/assets/${asset.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error);
      return;
    }
    setNotice("素材已删除");
    await load();
  };
  return (
    <main className="resource-shell">
      <ResourceNavigation />
      <section className="resource-content">
        <header className="resource-heading">
          <div>
            <span>
              素材库 / {String(data?.total || 0).padStart(4, "0")}
            </span>
            <h1>素材库</h1>
            <p>商品、模板和项目共用同一套私有 Asset 与内容哈希去重。</p>
          </div>
        </header>
        <div className="resource-metrics">
          <div>
            <span>当前结果</span>
            <strong>{data?.total || 0}</strong>
          </div>
          {Object.entries(labels)
            .slice(0, 3)
            .map(([key, label]) => (
              <button
                key={key}
                onClick={() => setType(type === key ? "" : key)}
                className={type === key ? "is-active" : ""}
              >
                <span>{label}</span>
                <strong>{type === key ? "已筛选" : "查看"}</strong>
              </button>
            ))}
        </div>
        {(error || notice) && (
          <div
            className={
              error
                ? "resource-message is-error"
                : "resource-message is-success"
            }
          >
            {error || notice}
            <button
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              <X />
            </button>
          </div>
        )}
        <section className="asset-workspace">
          <div className="resource-toolbar">
            <label className="resource-search">
              <Search />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索文件名"
              />
            </label>
            <select
              value={type}
              onChange={(event) => {
                setType(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部类型</option>
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {loading ? (
            <div className="resource-loading">
              <LoaderCircle className="is-spinning" />
              正在读取素材库...
            </div>
          ) : (
            <div className="asset-resource-grid">
              {data?.items.map((asset) => {
                const Icon = icon(asset);
                return (
                  <article key={asset.id}>
                    <div className="asset-preview">
                      {asset.mimeType.startsWith("image/") ? (
                        <img src={asset.url} alt="" />
                      ) : (
                        <Icon />
                      )}
                    </div>
                    <span>{labels[asset.type] || asset.type}</span>
                    <strong data-ppt-no-translate translate="no" title={asset.fileName}>{asset.fileName}</strong>
                    <small>
                      {size(asset.size)} ·{" "}
                      {new Date(asset.createdAt).toLocaleDateString("zh-CN")}
                    </small>
                    <footer>
                      <a href={`${asset.url}?download=1`}>
                        <Download />
                        下载
                      </a>
                      <button onClick={() => void remove(asset)}>
                        <Trash2 />
                        删除
                      </button>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
          {data && data.pageCount > 1 && (
            <footer className="resource-pagination">
              <span>共 {data.total} 个素材</span>
              <div>
                <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft />
                </button>
                <strong>
                  {page} / {data.pageCount}
                </strong>
                <button
                  disabled={page >= data.pageCount}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight />
                </button>
              </div>
            </footer>
          )}
        </section>
      </section>
    </main>
  );
}
