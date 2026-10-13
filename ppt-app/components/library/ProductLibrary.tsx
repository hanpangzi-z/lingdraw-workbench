"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Grid2X2,
  ImageOff,
  List,
  LoaderCircle,
  PackagePlus,
  PencilLine,
  Plus,
  Search,
  Settings2,
  Star,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { ResourceNavigation } from "./ResourceNavigation";
import {
  readExcelFile,
  getFirstDataSheet,
  detectHeaderRow,
  getSheetHeaders,
} from "@/src/lib/excel/parser";
import { autoMapFields } from "@/src/lib/excel/mapping";
import { PRODUCT_LIBRARY_IMPORT_FIELD_DEFINITIONS } from "@/src/lib/excel/fields";
import { convertSheetToProducts } from "@/src/lib/excel/transform";
import type { Product } from "@/types/catalog";
import { pptFetch } from "@/src/lib/basePath";
import { useStudioDialog } from "@/components/host/StudioDialogProvider";
import { listenForPptActivation } from "@/src/lib/hostEvents";

interface Resource {
  id: string;
  name: string;
  code?: string | null;
  active: boolean;
  parentId?: string | null;
  displayText?: string;
  sortOrder?: number;
  _count?: { products: number };
}
interface Resources {
  categories: Resource[];
  brands: Resource[];
  deliveries: Resource[];
}
interface ProductRow {
  id: string;
  sku: string;
  name: string;
  shortName?: string | null;
  description?: string | null;
  items: string[];
  marketPrice?: number | null;
  defaultSalePrice?: number | null;
  deliveryOverrideText?: string | null;
  status: "active" | "inactive" | "archived";
  revision: number;
  primaryImageUrl?: string | null;
  primaryImageAssetId?: string | null;
  category?: { id: string; code?: string | null; name: string } | null;
  brand?: { id: string; name: string } | null;
  deliveryProfile?: { id: string; name: string; displayText: string } | null;
  images: {
    id: string;
    assetId: string;
    role: string;
    sortOrder: number;
    url: string;
    fileName: string;
  }[];
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  versions?: {
    id: string;
    versionNumber: number;
    changeSummary?: string;
    createdAt: string;
  }[];
  usage?: { id: string; name: string; updatedAt: string }[];
}
interface ProductList {
  items: ProductRow[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  stats: { active: number; missingImages: number; missingPrices: number };
}
interface ProductForm {
  sku: string;
  name: string;
  shortName: string;
  brandId: string;
  categoryId: string;
  description: string;
  items: string;
  marketPrice: string;
  defaultSalePrice: string;
  deliveryProfileId: string;
  deliveryOverrideText: string;
  status: ProductRow["status"];
}

const emptyForm: ProductForm = {
  sku: "",
  name: "",
  shortName: "",
  brandId: "",
  categoryId: "",
  description: "",
  items: "",
  marketPrice: "",
  defaultSalePrice: "",
  deliveryProfileId: "",
  deliveryOverrideText: "",
  status: "active",
};
const money = (value?: number | null) =>
  value == null ? "—" : `¥${value.toLocaleString("zh-CN")}`;
const date = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export function ProductLibrary() {
  const router = useRouter();
  const dialog = useStudioDialog();
  const [data, setData] = useState<ProductList>();
  const [resources, setResources] = useState<Resources>({
    categories: [],
    brands: [],
    deliveries: [],
  });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"table" | "grid">("table");
  const [filters, setFilters] = useState({
    categoryId: "",
    brandId: "",
    status: "",
    deliveryProfileId: "",
    missingImage: false,
    missingPrice: false,
    sort: "recent",
  });
  const [selected, setSelected] = useState(new Set<string>());
  const [detail, setDetail] = useState<ProductRow | null>();
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [drawerMode, setDrawerMode] = useState<"create" | "edit" | null>(null);
  const [resourcePanel, setResourcePanel] = useState<keyof Resources | null>(
    null,
  );
  const [projectPicker, setProjectPicker] = useState(false);
  const [projects, setProjects] = useState<
    { id: string; name: string; productCount: number }[]
  >([]);
  const [importBatch, setImportBatch] = useState<{
    fileName: string;
    products: Product[];
    strategy: "skip" | "update-empty" | "overwrite" | "prices";
  }>();
  const importInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const loadRequestId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [search]);
  const loadResources = useCallback(async (requestId?: number) => {
    const response = await pptFetch("/api/product-resources");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "资源加载失败");
    if (requestId === undefined || requestId === loadRequestId.current)
      setResources(payload);
  }, []);
  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "30",
        sort: filters.sort,
      });
      if (query) params.set("search", query);
      for (const key of [
        "categoryId",
        "brandId",
        "status",
        "deliveryProfileId",
      ] as const)
        if (filters[key]) params.set(key, filters[key]);
      if (filters.missingImage) params.set("missingImage", "true");
      if (filters.missingPrice) params.set("missingPrice", "true");
      const [response] = await Promise.all([
        pptFetch(`/api/products?${params}`),
        loadResources(requestId),
      ]);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "商品加载失败");
      if (requestId !== loadRequestId.current) return;
      setData(payload);
      setError("");
    } catch (cause) {
      if (requestId === loadRequestId.current)
        setError(cause instanceof Error ? cause.message : "加载失败");
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [filters, loadResources, page, query]);
  useEffect(() => {
    void load();
    return listenForPptActivation(window, () => void load());
  }, [load]);

  const openProduct = async (id: string) => {
    setWorking(true);
    setError("");
    try {
      const response = await pptFetch(`/api/products/${id}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setDetail(payload);
      setForm({
        sku: payload.sku,
        name: payload.name,
        shortName: payload.shortName || "",
        brandId: payload.brand?.id || "",
        categoryId: payload.category?.id || "",
        description: payload.description || "",
        items: payload.items.join("\n"),
        marketPrice: payload.marketPrice ?? "",
        defaultSalePrice: payload.defaultSalePrice ?? "",
        deliveryProfileId: payload.deliveryProfile?.id || "",
        deliveryOverrideText: payload.deliveryOverrideText || "",
        status: payload.status,
      });
      setDrawerMode("edit");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "商品加载失败");
    } finally {
      setWorking(false);
    }
  };
  const saveProduct = async () => {
    if (!form.name.trim()) {
      setError("商品名称不能为空");
      return;
    }
    setWorking(true);
    setError("");
    try {
      const body = {
        ...form,
        items: form.items
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean),
        marketPrice: form.marketPrice === "" ? null : Number(form.marketPrice),
        defaultSalePrice:
          form.defaultSalePrice === "" ? null : Number(form.defaultSalePrice),
        brandId: form.brandId || null,
        categoryId: form.categoryId || null,
        deliveryProfileId: form.deliveryProfileId || null,
      };
      const response = await pptFetch(
        drawerMode === "edit" && detail
          ? `/api/products/${detail.id}`
          : "/api/products",
        {
          method: drawerMode === "edit" ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存失败");
      setNotice(
        drawerMode === "edit" ? "商品已更新并记录新版本" : "商品已加入资源库",
      );
      if (drawerMode === "edit") await openProduct(payload.id);
      else {
        setDrawerMode(null);
        setForm(emptyForm);
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setWorking(false);
    }
  };
  const uploadImage = async (files?: FileList | null) => {
    if (!detail || !files?.length) return;
    setWorking(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await pptFetch(`/api/products/${detail.id}/images`, {
          method: "POST",
          body: formData,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
      }
      await openProduct(detail.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图片上传失败");
    } finally {
      setWorking(false);
      if (imageInput.current) imageInput.current.value = "";
    }
  };
  const imageAction = async (
    action: "primary" | "remove" | "reorder",
    assetId?: string,
    assetIds?: string[],
  ) => {
    if (!detail) return;
    setWorking(true);
    try {
      const response = await pptFetch(`/api/products/${detail.id}/images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, assetId, assetIds }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setDetail(payload);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图片操作失败");
    } finally {
      setWorking(false);
    }
  };
  const moveImage = (index: number, delta: number) => {
    if (!detail) return;
    const target = index + delta;
    if (target < 0 || target >= detail.images.length) return;
    const ids = detail.images.map((item) => item.assetId);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void imageAction("reorder", undefined, ids);
  };

  const batchUpdate = async (patch: Record<string, unknown>) => {
    setWorking(true);
    try {
      const response = await pptFetch("/api/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], ...patch }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setNotice(`已更新 ${payload.updated} 个商品`);
      setSelected(new Set());
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "批量更新失败");
    } finally {
      setWorking(false);
    }
  };
  const prepareImport = async (file?: File) => {
    if (!file) return;
    setWorking(true);
    try {
      const workbook = await readExcelFile(file);
      const sheetName = getFirstDataSheet(workbook);
      const sheet = workbook.sheets.find((item) => item.name === sheetName);
      if (!sheet) throw new Error("Excel 没有数据");
      const headerRow = detectHeaderRow(sheet);
      const fieldMappings = autoMapFields(
        getSheetHeaders(sheet, headerRow),
        PRODUCT_LIBRARY_IMPORT_FIELD_DEFINITIONS,
      );
      const products = convertSheetToProducts(sheet, {
        fileName: file.name,
        sourceType: "excel",
        sheetName: sheet.name,
        headerRow,
        fieldMappings,
        splitItemsBySlash: false,
      });
      setImportBatch({ fileName: file.name, products, strategy: "skip" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Excel 解析失败");
    } finally {
      setWorking(false);
      if (importInput.current) importInput.current.value = "";
    }
  };
  const runImport = async () => {
    if (!importBatch) return;
    setWorking(true);
    try {
      const response = await pptFetch("/api/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          products: importBatch.products,
          strategy: importBatch.strategy,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setNotice(
        `导入完成：新增 ${payload.added}，更新 ${payload.updated}，跳过 ${payload.skipped}`,
      );
      setImportBatch(undefined);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导入失败");
    } finally {
      setWorking(false);
    }
  };
  const exportExcel = async () => {
    const rows =
      data?.items.filter((item) => !selected.size || selected.has(item.id)) ||
      [];
    const XLSX = await import("xlsx");
    const sheet = XLSX.utils.json_to_sheet(
      rows.map((item) => ({
        SKU: item.sku,
        商品名称: item.name,
        品牌: item.brand?.name || "",
        分类: item.category?.name || "",
        商品组成: item.items.join("；"),
        市场价: item.marketPrice,
        默认套餐价: item.defaultSalePrice,
        配送:
          item.deliveryOverrideText || item.deliveryProfile?.displayText || "",
        状态: item.status,
      })),
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "商品库");
    XLSX.writeFile(workbook, "灵绘PPT商品资源库.xlsx");
  };
  const openProjectPicker = async () => {
    const response = await pptFetch("/api/projects?page=1&pageSize=50");
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error);
      return;
    }
    setProjects(payload.items);
    setProjectPicker(true);
  };
  const addToProject = async (projectId?: string) => {
    const name = projectId
      ? undefined
      : await dialog.prompt("新项目名称", "从商品库创建的产品手册");
    if (!projectId && !name) return;
    setWorking(true);
    try {
      const response = await pptFetch("/api/products/add-to-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: [...selected],
          projectId,
          projectName: name,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      router.push(`/projects/${payload.projectId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加入项目失败");
    } finally {
      setWorking(false);
    }
  };

  const resourceItems = resourcePanel ? resources[resourcePanel] : [];
  const resourceLabel =
    resourcePanel === "categories"
      ? "商品分类"
      : resourcePanel === "brands"
        ? "品牌"
        : "配送规则";
  const manageResource = async (
    action: "create" | "rename" | "toggle" | "up" | "down",
    resource?: Resource,
  ) => {
    if (!resourcePanel) return;
    const type =
      resourcePanel === "categories"
        ? "category"
        : resourcePanel === "brands"
          ? "brand"
          : "delivery";
    let body: Record<string, unknown> = { type };
    let method = "PATCH";
    if (action === "create") {
      const name = await dialog.prompt(`新增${resourceLabel}`);
      if (!name) return;
      method = "POST";
      body = {
        type,
        name,
        ...(type === "delivery" ? { displayText: name } : {}),
      };
    } else if (resource) {
      body.id = resource.id;
      if (action === "rename") {
        const name = await dialog.prompt("输入新名称", resource.name);
        if (!name) return;
        body.name = name;
      }
      if (action === "toggle") body.active = !resource.active;
      if (action === "up")
        body.sortOrder = Math.max(0, (resource.sortOrder || 0) - 1);
      if (action === "down") body.sortOrder = (resource.sortOrder || 0) + 1;
    }
    const response = await pptFetch("/api/product-resources", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error);
      return;
    }
    await loadResources();
  };
  const allSelected =
    Boolean(data?.items.length) &&
    data!.items.every((item) => selected.has(item.id));
  const filteredLabel = useMemo(
    () =>
      [
        filters.categoryId,
        filters.brandId,
        filters.status,
        filters.deliveryProfileId,
        filters.missingImage,
        filters.missingPrice,
      ].filter(Boolean).length,
    [filters],
  );

  return (
    <main className="resource-shell">
      <ResourceNavigation />
      <section className="resource-content">
        <header className="resource-heading">
          <div>
            <span>
              商品库 / {String(data?.total || 0).padStart(4, "0")}
            </span>
            <h1>商品库</h1>
            <p>维护可复用的商品、图片、价格、分类和配送规则。</p>
          </div>
          <div>
            <input
              ref={importInput}
              hidden
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => void prepareImport(event.target.files?.[0])}
            />
            <button
              className="secondary"
              onClick={() => importInput.current?.click()}
            >
              <UploadCloud />
              批量导入
            </button>
            <button
              className="primary"
              onClick={() => {
                setDetail(null);
                setForm(emptyForm);
                setDrawerMode("create");
              }}
            >
              <Plus />
              新增商品
            </button>
          </div>
        </header>
        <div className="resource-metrics">
          <div>
            <span>全部商品</span>
            <strong>{data?.total || 0}</strong>
          </div>
          <div>
            <span>正常上架</span>
            <strong>{data?.stats.active || 0}</strong>
          </div>
          <div>
            <span>缺少图片</span>
            <strong>{data?.stats.missingImages || 0}</strong>
          </div>
          <div>
            <span>缺少价格</span>
            <strong>{data?.stats.missingPrices || 0}</strong>
          </div>
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
        <section className="resource-workspace">
          <div className="resource-toolbar">
            <label className="resource-search">
              <Search />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索 SKU、商品名称、品牌或规格"
              />
            </label>
            <select
              value={filters.categoryId}
              onChange={(event) =>
                setFilters({ ...filters, categoryId: event.target.value })
              }
            >
              <option value="">全部分类</option>
              {resources.categories
                .filter((item) => item.parentId)
                .map((item) => (
                  <option
                    data-ppt-no-translate
                    translate="no"
                    key={item.id}
                    value={item.id}
                  >
                    {item.name}
                  </option>
                ))}
            </select>
            <select
              value={filters.brandId}
              onChange={(event) =>
                setFilters({ ...filters, brandId: event.target.value })
              }
            >
              <option value="">全部品牌</option>
              {resources.brands.map((item) => (
                <option
                  data-ppt-no-translate
                  translate="no"
                  key={item.id}
                  value={item.id}
                >
                  {item.name}
                </option>
              ))}
            </select>
            <select
              value={filters.status}
              onChange={(event) =>
                setFilters({ ...filters, status: event.target.value })
              }
            >
              <option value="">全部状态</option>
              <option value="active">正常</option>
              <option value="inactive">停用</option>
              <option value="archived">归档</option>
            </select>
            <button
              className={filters.missingImage ? "is-active" : ""}
              onClick={() =>
                setFilters({ ...filters, missingImage: !filters.missingImage })
              }
            >
              缺图
            </button>
            <button
              className={filters.missingPrice ? "is-active" : ""}
              onClick={() =>
                setFilters({ ...filters, missingPrice: !filters.missingPrice })
              }
            >
              缺价格
            </button>
            <select
              value={filters.sort}
              onChange={(event) =>
                setFilters({ ...filters, sort: event.target.value })
              }
            >
              <option value="recent">最近更新</option>
              <option value="created">创建时间</option>
              <option value="name">商品名称</option>
              <option value="sku">SKU</option>
              <option value="price">市场价</option>
            </select>
            <button
              title="资源设置"
              onClick={() => setResourcePanel("categories")}
            >
              <Settings2 />
              {filteredLabel ? (
                <i data-ppt-no-translate translate="no">
                  {filteredLabel}
                </i>
              ) : null}
            </button>
            <div className="resource-view">
              <button
                className={view === "table" ? "is-active" : ""}
                onClick={() => setView("table")}
              >
                <List />
              </button>
              <button
                className={view === "grid" ? "is-active" : ""}
                onClick={() => setView("grid")}
              >
                <Grid2X2 />
              </button>
            </div>
          </div>
          {loading ? (
            <div className="resource-loading">
              <LoaderCircle className="is-spinning" />
              正在读取商品库...
            </div>
          ) : view === "table" ? (
            <div className="resource-table-wrap">
              <table className="resource-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() =>
                          setSelected(
                            allSelected
                              ? new Set()
                              : new Set(data?.items.map((item) => item.id)),
                          )
                        }
                      />
                    </th>
                    <th>图片</th>
                    <th>SKU / 商品</th>
                    <th>品牌</th>
                    <th>分类</th>
                    <th>市场价</th>
                    <th>默认套餐价</th>
                    <th>配送</th>
                    <th>使用</th>
                    <th>更新时间</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((item) => (
                    <tr
                      key={item.id}
                      className={selected.has(item.id) ? "is-selected" : ""}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(item.id)}
                          onChange={() =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td>
                        <button
                          className="product-thumb"
                          onClick={() => void openProduct(item.id)}
                        >
                          {item.primaryImageUrl ? (
                            <img src={item.primaryImageUrl} alt="" />
                          ) : (
                            <ImageOff />
                          )}
                        </button>
                      </td>
                      <td>
                        <button
                          className="product-name"
                          data-ppt-no-translate
                          translate="no"
                          onClick={() => void openProduct(item.id)}
                        >
                          <small>{item.sku || "NO SKU"}</small>
                          <strong>{item.name}</strong>
                          <span>
                            {item.items.slice(0, 2).join(" · ") ||
                              "暂无商品组成"}
                          </span>
                        </button>
                      </td>
                      <td data-ppt-no-translate translate="no">
                        {item.brand?.name || "—"}
                      </td>
                      <td data-ppt-no-translate translate="no">
                        {item.category?.name || "未分类"}
                      </td>
                      <td>{money(item.marketPrice)}</td>
                      <td>
                        <strong className="price-accent">
                          {money(item.defaultSalePrice)}
                        </strong>
                      </td>
                      <td>
                        <span
                          className="truncate-cell"
                          data-ppt-no-translate
                          translate="no"
                        >
                          {item.deliveryOverrideText ||
                            item.deliveryProfile?.name ||
                            "—"}
                        </span>
                      </td>
                      <td>{item.usageCount} 项目</td>
                      <td>{date(item.updatedAt)}</td>
                      <td>
                        <span className={`resource-status is-${item.status}`}>
                          {item.status === "active"
                            ? "正常"
                            : item.status === "inactive"
                              ? "停用"
                              : "归档"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="product-resource-grid">
              {data?.items.map((item) => (
                <article
                  key={item.id}
                  onClick={() => void openProduct(item.id)}
                >
                  <div>
                    {item.primaryImageUrl ? (
                      <img src={item.primaryImageUrl} alt="" />
                    ) : (
                      <ImageOff />
                    )}
                    <span data-ppt-no-translate translate="no">
                      {item.category?.name || "未分类"}
                    </span>
                  </div>
                  <small data-ppt-no-translate translate="no">
                    {item.sku || "NO SKU"}
                  </small>
                  <strong data-ppt-no-translate translate="no">
                    {item.name}
                  </strong>
                  <footer>
                    <b>{money(item.defaultSalePrice)}</b>
                    <span>{item.usageCount} 个项目</span>
                  </footer>
                </article>
              ))}
            </div>
          )}
          {data && data.pageCount > 1 && (
            <footer className="resource-pagination">
              <span>共 {data.total} 个商品</span>
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
      {selected.size > 0 && (
        <div className="resource-bulkbar">
          <strong>{selected.size}</strong>
          <span>个商品已选择</span>
          <select
            defaultValue=""
            onChange={(event) =>
              event.target.value &&
              void batchUpdate({ categoryId: event.target.value })
            }
          >
            <option value="">设置分类</option>
            {resources.categories
              .filter((item) => item.parentId)
              .map((item) => (
                <option
                  data-ppt-no-translate
                  translate="no"
                  key={item.id}
                  value={item.id}
                >
                  {item.name}
                </option>
              ))}
          </select>
          <select
            defaultValue=""
            onChange={(event) =>
              event.target.value &&
              void batchUpdate({ brandId: event.target.value })
            }
          >
            <option value="">设置品牌</option>
            {resources.brands.map((item) => (
              <option
                data-ppt-no-translate
                translate="no"
                key={item.id}
                value={item.id}
              >
                {item.name}
              </option>
            ))}
          </select>
          <select
            defaultValue=""
            onChange={(event) =>
              event.target.value &&
              void batchUpdate({ deliveryProfileId: event.target.value })
            }
          >
            <option value="">设置配送</option>
            {resources.deliveries.map((item) => (
              <option
                data-ppt-no-translate
                translate="no"
                key={item.id}
                value={item.id}
              >
                {item.name}
              </option>
            ))}
          </select>
          <button onClick={() => void batchUpdate({ status: "inactive" })}>
            <Archive />
            停用
          </button>
          <button onClick={() => void exportExcel()}>
            <Download />
            导出 Excel
          </button>
          <button className="primary" onClick={() => void openProjectPicker()}>
            <PackagePlus />
            加入项目
          </button>
          <button onClick={() => setSelected(new Set())}>
            <X />
          </button>
        </div>
      )}
      {drawerMode && (
        <div
          className="library-drawer-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setDrawerMode(null)
          }
        >
          <aside className="product-library-drawer">
            <header>
              <div>
                <small>
                  {drawerMode === "create"
                    ? "新建商品"
                    : `商品 / V${detail?.revision}`}
                </small>
                <h2>
                  {drawerMode === "create" ? (
                    "新增商品"
                  ) : (
                    <span data-ppt-no-translate translate="no">
                      {detail?.name}
                    </span>
                  )}
                </h2>
              </div>
              <button onClick={() => setDrawerMode(null)}>
                <X />
              </button>
            </header>
            <div className="product-detail-scroll">
              {drawerMode === "edit" && detail && (
                <section className="product-image-manager">
                  <div className="product-primary-image">
                    {detail.primaryImageUrl ? (
                      <img src={detail.primaryImageUrl} alt="" />
                    ) : (
                      <ImageOff />
                    )}
                    <input
                      ref={imageInput}
                      hidden
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(event) => void uploadImage(event.target.files)}
                    />
                    <button onClick={() => imageInput.current?.click()}>
                      <UploadCloud />
                      上传图片
                    </button>
                  </div>
                  <div className="product-image-strip">
                    {detail.images.map((image, index) => (
                      <article
                        key={image.assetId}
                        className={image.role === "primary" ? "is-primary" : ""}
                      >
                        <img src={image.url} alt="" />
                        <div>
                          <button
                            disabled={index === 0}
                            onClick={() => moveImage(index, -1)}
                          >
                            <ArrowUp />
                          </button>
                          <button
                            disabled={index === detail.images.length - 1}
                            onClick={() => moveImage(index, 1)}
                          >
                            <ArrowDown />
                          </button>
                          <button
                            title="设为主图"
                            onClick={() =>
                              void imageAction("primary", image.assetId)
                            }
                          >
                            <Star />
                          </button>
                          <button
                            title="移除"
                            onClick={() =>
                              void imageAction("remove", image.assetId)
                            }
                          >
                            <Trash2 />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
              <section className="product-form-grid">
                <label>
                  <span>SKU</span>
                  <input
                    value={form.sku}
                    onChange={(event) =>
                      setForm({ ...form, sku: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>商品名称 *</span>
                  <input
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>短名称</span>
                  <input
                    value={form.shortName}
                    onChange={(event) =>
                      setForm({ ...form, shortName: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>状态</span>
                  <select
                    value={form.status}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        status: event.target.value as ProductRow["status"],
                      })
                    }
                  >
                    <option value="active">正常</option>
                    <option value="inactive">停用</option>
                    <option value="archived">归档</option>
                  </select>
                </label>
                <label>
                  <span>品牌</span>
                  <select
                    value={form.brandId}
                    onChange={(event) =>
                      setForm({ ...form, brandId: event.target.value })
                    }
                  >
                    <option value="">未设置</option>
                    {resources.brands
                      .filter((item) => item.active)
                      .map((item) => (
                        <option
                          data-ppt-no-translate
                          translate="no"
                          key={item.id}
                          value={item.id}
                        >
                          {item.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <span>分类</span>
                  <select
                    value={form.categoryId}
                    onChange={(event) =>
                      setForm({ ...form, categoryId: event.target.value })
                    }
                  >
                    <option value="">未分类</option>
                    {resources.categories
                      .filter((item) => item.parentId && item.active)
                      .map((item) => (
                        <option
                          data-ppt-no-translate
                          translate="no"
                          key={item.id}
                          value={item.id}
                        >
                          {item.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <span>市场价</span>
                  <input
                    type="number"
                    value={form.marketPrice}
                    onChange={(event) =>
                      setForm({ ...form, marketPrice: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>默认套餐价</span>
                  <input
                    type="number"
                    value={form.defaultSalePrice}
                    onChange={(event) =>
                      setForm({ ...form, defaultSalePrice: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>配送规则</span>
                  <select
                    value={form.deliveryProfileId}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        deliveryProfileId: event.target.value,
                      })
                    }
                  >
                    <option value="">未设置</option>
                    {resources.deliveries
                      .filter((item) => item.active)
                      .map((item) => (
                        <option
                          data-ppt-no-translate
                          translate="no"
                          key={item.id}
                          value={item.id}
                        >
                          {item.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <span>配送补充</span>
                  <input
                    value={form.deliveryOverrideText}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        deliveryOverrideText: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="wide">
                  <span>商品组成（一行一项）</span>
                  <textarea
                    rows={7}
                    value={form.items}
                    onChange={(event) =>
                      setForm({ ...form, items: event.target.value })
                    }
                  />
                </label>
                <label className="wide">
                  <span>商品说明</span>
                  <textarea
                    rows={3}
                    value={form.description}
                    onChange={(event) =>
                      setForm({ ...form, description: event.target.value })
                    }
                  />
                </label>
              </section>
              {drawerMode === "edit" && detail && (
                <section className="product-history">
                  <div>
                    <h3>使用记录</h3>
                    {detail.usage?.length ? (
                      detail.usage.map((project) => (
                        <button
                          key={project.id}
                          onClick={() => router.push(`/projects/${project.id}`)}
                        >
                          <span data-ppt-no-translate translate="no">{project.name}</span>
                          <small>{date(project.updatedAt)}</small>
                        </button>
                      ))
                    ) : (
                      <p>尚未用于项目。</p>
                    )}
                  </div>
                  <div>
                    <h3>版本历史</h3>
                    {detail.versions?.map((version) => (
                      <article key={version.id}>
                        <b>v{version.versionNumber}</b>
                        <span data-ppt-no-translate translate="no">{version.changeSummary || "更新商品"}</span>
                        <small>{date(version.createdAt)}</small>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </div>
            <footer>
              <button onClick={() => setDrawerMode(null)}>取消</button>
              <button
                className="primary"
                onClick={() => void saveProduct()}
                disabled={working}
              >
                {working ? <LoaderCircle className="is-spinning" /> : <Check />}
                保存商品
              </button>
            </footer>
          </aside>
        </div>
      )}
      {resourcePanel && (
        <div
          className="resource-modal-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setResourcePanel(null)
          }
        >
          <section className="resource-settings-modal">
            <header>
              <div>
                <small>资源库设置</small>
                <h2>{resourceLabel}</h2>
              </div>
              <button onClick={() => setResourcePanel(null)}>
                <X />
              </button>
            </header>
            <nav>
              <button
                className={resourcePanel === "categories" ? "is-active" : ""}
                onClick={() => setResourcePanel("categories")}
              >
                分类
              </button>
              <button
                className={resourcePanel === "brands" ? "is-active" : ""}
                onClick={() => setResourcePanel("brands")}
              >
                品牌
              </button>
              <button
                className={resourcePanel === "deliveries" ? "is-active" : ""}
                onClick={() => setResourcePanel("deliveries")}
              >
                配送
              </button>
            </nav>
            <div>
              {resourceItems.map((item) => (
                <article key={item.id}>
                  <span>
                    <strong data-ppt-no-translate translate="no">{item.name}</strong>
                    <small>
                      {item._count?.products || 0} 个商品 ·{" "}
                      {item.active ? "启用" : "停用"}
                    </small>
                  </span>
                  {resourcePanel === "categories" && (
                    <>
                      <button onClick={() => void manageResource("up", item)}>
                        <ArrowUp />
                      </button>
                      <button onClick={() => void manageResource("down", item)}>
                        <ArrowDown />
                      </button>
                    </>
                  )}
                  <button onClick={() => void manageResource("rename", item)}>
                    <PencilLine />
                  </button>
                  <button onClick={() => void manageResource("toggle", item)}>
                    {item.active ? <Archive /> : <Check />}
                  </button>
                </article>
              ))}
            </div>
            <footer>
              <button onClick={() => void manageResource("create")}>
                <Plus />
                新增{resourceLabel}
              </button>
            </footer>
          </section>
        </div>
      )}
      {importBatch && (
        <div className="resource-modal-backdrop">
          <section className="import-library-modal">
            <header>
              <div>
                <small>Excel 导入</small>
                <h2>确认导入商品库</h2>
              </div>
              <button onClick={() => setImportBatch(undefined)}>
                <X />
              </button>
            </header>
            <div>
              <FileSpreadsheet />
              <strong data-ppt-no-translate translate="no">{importBatch.fileName}</strong>
              <span>
                识别到 {importBatch.products.length} 个商品。已有 SKU
                默认不会被直接覆盖。
              </span>
              <label>
                已有 SKU 处理策略
                <select
                  value={importBatch.strategy}
                  onChange={(event) =>
                    setImportBatch({
                      ...importBatch,
                      strategy: event.target
                        .value as typeof importBatch.strategy,
                    })
                  }
                >
                  <option value="skip">跳过（推荐）</option>
                  <option value="update-empty">只补全空字段</option>
                  <option value="prices">只更新价格</option>
                  <option value="overwrite">覆盖所有字段</option>
                </select>
              </label>
            </div>
            <footer>
              <button onClick={() => setImportBatch(undefined)}>取消</button>
              <button
                className="primary"
                onClick={() => void runImport()}
                disabled={working}
              >
                开始导入
              </button>
            </footer>
          </section>
        </div>
      )}
      {projectPicker && (
        <div className="resource-modal-backdrop">
          <section className="project-picker-modal">
            <header>
              <div>
                <small>加入项目</small>
                <h2>加入项目</h2>
              </div>
              <button onClick={() => setProjectPicker(false)}>
                <X />
              </button>
            </header>
            <button
              className="create-project-choice"
              onClick={() => void addToProject()}
            >
              <Plus />
              <span>
                <strong>创建新项目</strong>
                <small>使用已选择的 {selected.size} 个商品立即生成</small>
              </span>
            </button>
            <div>
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => void addToProject(project.id)}
                >
                  <Boxes />
                  <span>
                    <strong data-ppt-no-translate translate="no">{project.name}</strong>
                    <small>当前 {project.productCount} 个商品</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
