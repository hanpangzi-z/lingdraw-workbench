"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Download,
  Edit3,
  FileArchive,
  ImagePlus,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { productCategories } from "@/data/catalog";
import { BATCH_DIMENSION_LABELS } from "@/src/lib/batch/constants";
import { getTheoreticalCombinationCount } from "@/src/lib/batch/grouping";
import { summarizeBatchReports } from "@/src/lib/batch/validation";
import { useBatchStore } from "@/src/store/batchStore";
import { getAvailableTemplates } from "@/src/templates/registry";
import { getAvailableThemes } from "@/src/themes/registry";
import type { BatchGroup, BatchProductPatch } from "@/types/batch";
import { useStudioDialog } from "@/components/host/StudioDialogProvider";

export function BatchDashboard({
  onBack,
  onOpenGroup,
}: {
  onBack: () => void;
  onOpenGroup: (id: string) => void;
}) {
  const dialog = useStudioDialog();
  const config = useBatchStore((state) => state.config);
  const analysis = useBatchStore((state) => state.analysis);
  const groups = useBatchStore((state) => state.groups);
  const baseProducts = useBatchStore((state) => state.baseProducts);
  const exportState = useBatchStore((state) => state.exportState);
  const failedGroupIds = useBatchStore((state) => state.failedGroupIds);
  const lastExportOutput = useBatchStore((state) => state.lastExportOutput);
  const setConfig = useBatchStore((state) => state.setConfig);
  const setDimensionEnabled = useBatchStore(
    (state) => state.setDimensionEnabled,
  );
  const rebuildGroups = useBatchStore((state) => state.rebuildGroups);
  const toggleGroup = useBatchStore((state) => state.toggleGroup);
  const setAllGroupsEnabled = useBatchStore(
    (state) => state.setAllGroupsEnabled,
  );
  const updateGroupConfig = useBatchStore((state) => state.updateGroupConfig);
  const applyTemplateToAll = useBatchStore((state) => state.applyTemplateToAll);
  const applyThemeToAll = useBatchStore((state) => state.applyThemeToAll);
  const applyLogoToAll = useBatchStore((state) => state.applyLogoToAll);
  const deleteGroup = useBatchStore((state) => state.deleteGroup);
  const duplicateGroup = useBatchStore((state) => state.duplicateGroup);
  const addManualGroup = useBatchStore((state) => state.addManualGroup);
  const setGroupProducts = useBatchStore((state) => state.setGroupProducts);
  const setProductOverride = useBatchStore((state) => state.setProductOverride);
  const updateSharedProduct = useBatchStore(
    (state) => state.updateSharedProduct,
  );
  const getProductImpactCount = useBatchStore(
    (state) => state.getProductImpactCount,
  );
  const checkAll = useBatchStore((state) => state.checkAll);
  const exportAll = useBatchStore((state) => state.exportAll);
  const retryFailed = useBatchStore((state) => state.retryFailed);
  const downloadLastExport = useBatchStore((state) => state.downloadLastExport);
  const [editingGroupId, setEditingGroupId] = useState<string>();
  const [showSharedProducts, setShowSharedProducts] = useState(false);
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const editingGroup = groups.find((group) => group.id === editingGroupId);
  const report = summarizeBatchReports(groups);
  const enabledCount = groups.filter((group) => group.enabled).length;
  const selectedTheoreticalCombinations = getTheoreticalCombinationCount(
    analysis,
    config.dimensions,
  );
  const templates = getAvailableTemplates();
  const themes = getAvailableThemes();

  const updateGlobalLogo = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => applyLogoToAll(String(reader.result));
    reader.readAsDataURL(file);
  };

  const createManual = () => {
    const id = addManualGroup({}, []);
    setEditingGroupId(id);
  };

  const confirmDeleteGroup = async (group: BatchGroup) => {
    if (await dialog.confirm(`删除项目“${group.name}”？共享商品不会被删除。`))
      deleteGroup(group.id);
  };

  const confirmSharedUpdate = async (
    productId: string,
    patch: BatchProductPatch,
  ) => {
    const impact = getProductImpactCount(productId);
    if (
      await dialog.confirm(
        `该商品被 ${impact} 个项目使用。此次修改将同步影响 ${impact} 个项目，确认修改？`,
      )
    )
      updateSharedProduct(productId, patch);
  };

  return (
    <section className="workflow-page batch-dashboard-page">
      <div className="workflow-page-heading batch-heading">
        <div>
          <span>第 4 步</span>
          <h1>批量项目预览</h1>
          <p>
            从共享 Product[]
            生成真实数据组合；每个项目独立排版、检查、编辑与导出。
          </p>
        </div>
        <div className="batch-heading-actions">
          <button className="secondary-action" type="button" onClick={checkAll}>
            <ClipboardCheck aria-hidden="true" />
            检查全部项目
          </button>
          <button
            className="primary-action"
            type="button"
            disabled={!enabledCount || exportState.running}
            onClick={() => void exportAll()}
          >
            {exportState.running ? (
              <LoaderCircle className="is-spinning" aria-hidden="true" />
            ) : (
              <FileArchive aria-hidden="true" />
            )}
            {exportState.running
              ? `正在生成 ${exportState.current} / ${exportState.total}`
              : `批量导出 PPT（${enabledCount}）`}
          </button>
        </div>
      </div>

      <div className="batch-overview-grid">
        <article>
          <span>真实项目组合</span>
          <strong>{groups.length}</strong>
          <small>当前维度理论组合 {selectedTheoreticalCombinations}</small>
        </article>
        <article>
          <span>已启用</span>
          <strong>{enabledCount}</strong>
          <small>未启用 {groups.length - enabledCount}</small>
        </article>
        <article className="is-ready">
          <span>可直接生成</span>
          <strong>{report.ready}</strong>
          <small>检查后实时更新</small>
        </article>
        <article className="is-warning">
          <span>存在警告</span>
          <strong>{report.warning}</strong>
          <small>仍可导出</small>
        </article>
        <article className="is-error">
          <span>存在错误</span>
          <strong>{report.error}</strong>
          <small>建议先修正</small>
        </article>
      </div>

      <section className="batch-config-panel">
        <header>
          <div>
            <Settings2 aria-hidden="true" />
            <div>
              <strong>全局批量设置</strong>
              <span>子项目未设置 Override 时继承这里</span>
            </div>
          </div>
          <button type="button" onClick={rebuildGroups}>
            <RefreshCw aria-hidden="true" />
            按维度重新分组
          </button>
        </header>
        <div className="batch-config-grid">
          <label className="batch-wide-field">
            拆分维度
            <div className="inline-checkboxes">
              {config.dimensions.map((dimension) => (
                <span key={dimension.field}>
                  <input
                    type="checkbox"
                    checked={dimension.enabled}
                    onChange={(event) =>
                      setDimensionEnabled(dimension.field, event.target.checked)
                    }
                  />
                  {BATCH_DIMENSION_LABELS[dimension.field]}{" "}
                  <small>{analysis.values[dimension.field].length}</small>
                </span>
              ))}
            </div>
          </label>
          <label>
            文件名规则
            <input
              value={config.filenameRule}
              onChange={(event) =>
                setConfig({ filenameRule: event.target.value })
              }
            />
          </label>
          <label>
            版本号
            <input
              value={config.version}
              placeholder="v1"
              onChange={(event) => setConfig({ version: event.target.value })}
            />
          </label>
          <label>
            封面主标题规则
            <input
              value={config.titleRule}
              onChange={(event) => setConfig({ titleRule: event.target.value })}
            />
          </label>
          <label>
            封面副标题规则
            <input
              value={config.subtitleRule}
              onChange={(event) =>
                setConfig({ subtitleRule: event.target.value })
              }
            />
          </label>
          <label>
            全部模板
            <select
              value={config.templateId}
              onChange={(event) =>
                applyTemplateToAll(
                  event.target.value as typeof config.templateId,
                )
              }
            >
              {templates.map((template) => (
                <option value={template.id} key={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            全部主题
            <select
              value={config.themeId}
              onChange={(event) =>
                applyThemeToAll(event.target.value as typeof config.themeId)
              }
            >
              {themes.map((theme) => (
                <option value={theme.id} key={theme.id}>
                  {theme.name}
                </option>
              ))}
            </select>
          </label>
          <label className="batch-logo-control">
            <ImagePlus aria-hidden="true" />
            <span>{config.logo ? "已设置全局 Logo" : "全部设置 Logo"}</span>
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(event) => updateGlobalLogo(event.target.files?.[0])}
            />
          </label>
        </div>
        <footer>
          变量：{"{year}"} · {"{region}"} · {"{priceTier}"} · {"{projectName}"}{" "}
          · {"{packageType}"} · {"{customerGroup}"} · {"{version}"}
        </footer>
      </section>

      <div className="batch-list-toolbar">
        <div>
          <button type="button" onClick={() => setAllGroupsEnabled(true)}>
            <Check aria-hidden="true" />
            全部开启
          </button>
          <button type="button" onClick={() => setAllGroupsEnabled(false)}>
            <X aria-hidden="true" />
            全部关闭
          </button>
          <button type="button" onClick={createManual}>
            <Plus aria-hidden="true" />
            新增项目
          </button>
          <button type="button" onClick={() => setShowSharedProducts(true)}>
            <Boxes aria-hidden="true" />
            管理共享商品
          </button>
        </div>
        <span>仪表盘只加载摘要；打开项目时才生成完整预览。</span>
      </div>

      <div className="batch-project-table-wrap">
        <table className="batch-project-table">
          <thead>
            <tr>
              <th>生成</th>
              <th>项目</th>
              <th>商品</th>
              <th>分类</th>
              <th>页数</th>
              <th>模板 / 主题</th>
              <th>状态</th>
              <th>检查结果</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <BatchProjectRow
                group={group}
                products={baseProducts.filter((product) =>
                  group.productIds.includes(product.id),
                )}
                onToggle={() => toggleGroup(group.id)}
                onOpen={() => onOpenGroup(group.id)}
                onEdit={() => setEditingGroupId(group.id)}
                onCopy={() => duplicateGroup(group.id)}
                onDelete={() => void confirmDeleteGroup(group)}
                key={group.id}
              />
            ))}
          </tbody>
        </table>
        {!groups.length && (
          <div className="batch-empty">
            <Boxes aria-hidden="true" />
            <strong>没有可生成的真实组合</strong>
            <span>请启用至少一个存在数据的批量维度，或手动新增项目。</span>
          </div>
        )}
      </div>

      {exportState.total > 0 && (
        <section
          className={`batch-export-report ${exportState.running ? "is-running" : ""}`}
        >
          <header>
            <div>
              {exportState.running ? (
                <LoaderCircle className="is-spinning" aria-hidden="true" />
              ) : exportState.failed ? (
                <AlertTriangle aria-hidden="true" />
              ) : (
                <CheckCircle2 aria-hidden="true" />
              )}
              <div>
                <strong>
                  {exportState.running
                    ? `正在生成：${exportState.currentName ?? "准备中"}`
                    : `生成完成：成功 ${exportState.succeeded}，失败 ${exportState.failed}`}
                </strong>
                <span>
                  {exportState.zipName ?? "PPTX 将在全部任务结束后统一打包 ZIP"}
                </span>
              </div>
            </div>
            <div className="batch-export-report-actions">
              {lastExportOutput && !exportState.running && (
                <button type="button" onClick={downloadLastExport}>
                  <Download aria-hidden="true" />
                  重新下载 ZIP
                </button>
              )}
              {failedGroupIds.length > 0 && !exportState.running && (
                <button type="button" onClick={() => void retryFailed()}>
                  <RefreshCw aria-hidden="true" />
                  重试失败项目
                </button>
              )}
            </div>
          </header>
          <div className="batch-export-progress">
            <i
              style={{
                width: `${exportState.total ? (exportState.current / exportState.total) * 100 : 0}%`,
              }}
            />
          </div>
          <ul>
            {exportState.logs.map((log) => (
              <li key={log.groupId}>
                <span>
                  {log.status === "completed" ? (
                    <CheckCircle2 />
                  ) : log.status === "failed" ? (
                    <XCircle />
                  ) : log.status === "generating" ? (
                    <LoaderCircle className="is-spinning" />
                  ) : (
                    <span className="queue-dot" />
                  )}
                  {log.projectName}
                </span>
                <small>
                  {log.pageCount ? `${log.pageCount} 页` : ""}
                  {log.error ? ` · ${log.error}` : ""}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="workflow-footer-actions">
        <button className="secondary-action" type="button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          返回数据确认
        </button>
        <span>{enabledCount} 个项目将顺序生成，单个失败不会中断其余项目。</span>
      </div>

      {editingGroup && (
        <BatchGroupDrawer
          group={editingGroup}
          filter={filter}
          categoryFilter={categoryFilter}
          onFilter={setFilter}
          onCategoryFilter={setCategoryFilter}
          onClose={() => setEditingGroupId(undefined)}
          onUpdateConfig={(patch) => updateGroupConfig(editingGroup.id, patch)}
          onSetProducts={(ids) => setGroupProducts(editingGroup.id, ids)}
          onSetPrice={(productId, price) =>
            setProductOverride(editingGroup.id, productId, {
              price: { package: price },
            })
          }
        />
      )}
      {showSharedProducts && (
        <SharedProductDrawer
          filter={filter}
          onFilter={setFilter}
          onClose={() => setShowSharedProducts(false)}
          onUpdate={(productId, patch) =>
            void confirmSharedUpdate(productId, patch)
          }
        />
      )}
    </section>
  );
}

function BatchProjectRow({
  group,
  products,
  onToggle,
  onOpen,
  onEdit,
  onCopy,
  onDelete,
}: {
  group: BatchGroup;
  products: ReturnType<typeof useBatchStore.getState>["baseProducts"];
  onToggle: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const categoryCount = new Set(products.map((product) => product.categoryId))
    .size;
  const pageCount =
    (group.slidePlanCache?.plans.length ?? Math.ceil(group.productCount / 3)) +
    4 +
    Object.keys(group.editorSession?.editorState.manualSlides ?? {}).length;
  const statusLabel = {
    ready: "已就绪",
    warning: "需要确认",
    error: "存在错误",
    generating: "生成中",
    completed: "已完成",
  }[group.status];
  return (
    <tr className={!group.enabled ? "is-disabled" : ""}>
      <td>
        <input
          type="checkbox"
          checked={group.enabled}
          onChange={onToggle}
          aria-label={`${group.name}是否生成`}
        />
      </td>
      <td>
        <strong data-ppt-no-translate translate="no">{group.name}</strong>
        <small>
          {Object.entries(group.dimensions)
            .map(
              ([key, value]) =>
                `${BATCH_DIMENSION_LABELS[key as keyof typeof BATCH_DIMENSION_LABELS]}：${value}`,
            )
            .join(" · ") || "手动项目"}
        </small>
      </td>
      <td>
        <strong>{group.productCount}</strong>
        <small>商品</small>
      </td>
      <td>{categoryCount}</td>
      <td>{pageCount}</td>
      <td>
        <span>{group.projectConfig?.templateId ?? "继承全局"}</span>
        <small>{group.projectConfig?.themeId ?? "继承全局"}</small>
      </td>
      <td>
        <span className={`batch-status is-${group.status}`}>
          {group.status === "ready" || group.status === "completed" ? (
            <CheckCircle2 />
          ) : (
            <AlertTriangle />
          )}
          {statusLabel}
        </span>
      </td>
      <td>
        <small>
          {group.checkReport?.issues.map((issue) => issue.message).join("；") ||
            "尚未检查"}
        </small>
      </td>
      <td>
        <div className="batch-row-actions">
          <button type="button" onClick={onOpen} title="打开现有编辑器">
            <Edit3 />
          </button>
          <button type="button" onClick={onEdit} title="项目设置">
            <Settings2 />
          </button>
          <button type="button" onClick={onCopy} title="复制项目">
            <Copy />
          </button>
          <button type="button" onClick={onDelete} title="删除项目">
            <Trash2 />
          </button>
        </div>
      </td>
    </tr>
  );
}

function BatchGroupDrawer({
  group,
  filter,
  categoryFilter,
  onFilter,
  onCategoryFilter,
  onClose,
  onUpdateConfig,
  onSetProducts,
  onSetPrice,
}: {
  group: BatchGroup;
  filter: string;
  categoryFilter: string;
  onFilter: (value: string) => void;
  onCategoryFilter: (value: string) => void;
  onClose: () => void;
  onUpdateConfig: (patch: NonNullable<BatchGroup["projectConfig"]>) => void;
  onSetProducts: (ids: string[]) => void;
  onSetPrice: (id: string, price?: number) => void;
}) {
  const products = useBatchStore((state) => state.baseProducts);
  const overrides = useBatchStore((state) => state.productOverrides);
  const templates = getAvailableTemplates();
  const themes = getAvailableThemes();
  const visible = products.filter(
    (product) =>
      (!filter ||
        `${product.sku}${product.name}${product.region}${product.priceTier}`
          .toLocaleLowerCase()
          .includes(filter.toLocaleLowerCase())) &&
      (!categoryFilter || product.categoryId === categoryFilter),
  );
  const selected = new Set(group.productIds);
  const toggle = (id: string) =>
    onSetProducts(
      selected.has(id)
        ? group.productIds.filter((item) => item !== id)
        : [...group.productIds, id],
    );
  return (
    <div className="batch-drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="batch-drawer"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>批量项目组</span>
            <h2 data-ppt-no-translate translate="no">{group.name}</h2>
            <p>{group.productCount} 商品 · 项目配置未填写时继承全局</p>
          </div>
          <button type="button" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="batch-drawer-content">
          <section>
            <h3>项目级配置</h3>
            <div className="batch-drawer-grid">
              <label>
                项目名称
                <input
                  value={group.projectConfig?.projectName ?? ""}
                  placeholder="继承全局"
                  onChange={(event) =>
                    onUpdateConfig({
                      projectName: event.target.value || undefined,
                    })
                  }
                />
              </label>
              <label>
                公司名称
                <input
                  value={group.projectConfig?.brand ?? ""}
                  placeholder="继承全局"
                  onChange={(event) =>
                    onUpdateConfig({ brand: event.target.value || undefined })
                  }
                />
              </label>
              <label>
                主标题
                <input
                  value={group.projectConfig?.title ?? ""}
                  placeholder="使用标题规则"
                  onChange={(event) =>
                    onUpdateConfig({ title: event.target.value || undefined })
                  }
                />
              </label>
              <label>
                副标题
                <input
                  value={group.projectConfig?.subtitle ?? ""}
                  placeholder="使用副标题规则"
                  onChange={(event) =>
                    onUpdateConfig({
                      subtitle: event.target.value || undefined,
                    })
                  }
                />
              </label>
              <label>
                模板
                <select
                  value={group.projectConfig?.templateId ?? ""}
                  onChange={(event) =>
                    onUpdateConfig({
                      templateId: (event.target.value ||
                        undefined) as NonNullable<
                        BatchGroup["projectConfig"]
                      >["templateId"],
                    })
                  }
                >
                  <option value="">继承全局</option>
                  {templates.map((template) => (
                    <option value={template.id} key={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                主题
                <select
                  value={group.projectConfig?.themeId ?? ""}
                  onChange={(event) =>
                    onUpdateConfig({
                      themeId: (event.target.value || undefined) as NonNullable<
                        BatchGroup["projectConfig"]
                      >["themeId"],
                    })
                  }
                >
                  <option value="">继承全局</option>
                  {themes.map((theme) => (
                    <option value={theme.id} key={theme.id}>
                      {theme.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
          <section>
            <h3>商品集合与项目售价</h3>
            <div className="batch-product-filters">
              <label>
                <Search />
                <input
                  value={filter}
                  placeholder="SKU / 名称 / 地区 / 档位"
                  onChange={(event) => onFilter(event.target.value)}
                />
              </label>
              <select
                value={categoryFilter}
                onChange={(event) => onCategoryFilter(event.target.value)}
              >
                <option value="">全部分类</option>
                {productCategories.map((category) => (
                  <option value={category.id} key={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="batch-product-picker">
              {visible.map((product) => {
                const override = overrides.find(
                  (item) =>
                    item.batchGroupId === group.id &&
                    item.productId === product.id,
                );
                return (
                  <article
                    className={selected.has(product.id) ? "is-selected" : ""}
                    key={product.id}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(product.id)}
                      onChange={() => toggle(product.id)}
                    />
                    <div data-ppt-no-translate translate="no">
                      <strong>{product.name || "未命名商品"}</strong>
                      <small>
                        {product.sku || "无 SKU"} ·{" "}
                        {product.region ?? "未设地区"} ·{" "}
                        {product.priceTier ?? "未设档位"}
                      </small>
                    </div>
                    {selected.has(product.id) && (
                      <label>
                        项目价
                        <input
                          type="number"
                          value={
                            override?.overrides.price?.package ??
                            product.price.package ??
                            ""
                          }
                          onChange={(event) =>
                            onSetPrice(
                              product.id,
                              event.target.value
                                ? Number(event.target.value)
                                : undefined,
                            )
                          }
                        />
                      </label>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

function SharedProductDrawer({
  filter,
  onFilter,
  onClose,
  onUpdate,
}: {
  filter: string;
  onFilter: (value: string) => void;
  onClose: () => void;
  onUpdate: (id: string, patch: BatchProductPatch) => void;
}) {
  const products = useBatchStore((state) => state.baseProducts);
  const getImpact = useBatchStore((state) => state.getProductImpactCount);
  const visible = products.filter(
    (product) =>
      !filter ||
      `${product.sku}${product.name}`
        .toLocaleLowerCase()
        .includes(filter.toLocaleLowerCase()),
  );
  return (
    <div className="batch-drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="batch-drawer shared-product-drawer"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>共享商品</span>
            <h2>共享商品管理</h2>
            <p>修改前会明确提示受影响的项目数量。</p>
          </div>
          <button type="button" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="batch-drawer-content">
          <div className="batch-product-filters">
            <label>
              <Search />
              <input
                value={filter}
                placeholder="搜索 SKU / 商品名称"
                onChange={(event) => onFilter(event.target.value)}
              />
            </label>
          </div>
          <div className="shared-product-list">
            {visible.map((product) => (
              <article key={product.id}>
                <div data-ppt-no-translate translate="no">
                  <strong>{product.name || "未命名商品"}</strong>
                  <small>
                    {product.sku || "无 SKU"} · 被 {getImpact(product.id)}{" "}
                    个项目使用
                  </small>
                </div>
                <label>
                  市场价
                  <input
                    type="number"
                    defaultValue={product.price.market ?? ""}
                    onBlur={(event) => {
                      const next = event.target.value
                        ? Number(event.target.value)
                        : undefined;
                      if (next !== product.price.market)
                        onUpdate(product.id, {
                          price: { ...product.price, market: next },
                        });
                    }}
                  />
                </label>
                <label>
                  套餐价
                  <input
                    type="number"
                    defaultValue={product.price.package ?? ""}
                    onBlur={(event) => {
                      const next = event.target.value
                        ? Number(event.target.value)
                        : undefined;
                      if (next !== product.price.package)
                        onUpdate(product.id, {
                          price: { ...product.price, package: next },
                        });
                    }}
                  />
                </label>
              </article>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
