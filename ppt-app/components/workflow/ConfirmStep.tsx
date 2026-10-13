"use client";

import { memo, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  Boxes,
  CheckCircle2,
  Edit3,
  FileSearch,
  ImageOff,
  Layers3,
  Star,
  TriangleAlert,
} from "lucide-react";
import { productCategories } from "@/data/catalog";
import {
  parseDeliveryRules,
  parseImageSources,
  parsePrice,
} from "@/src/lib/excel/cleaners";
import { getProductImages } from "@/src/lib/catalog/images";
import { UNCATEGORIZED_ID } from "@/src/lib/excel/transform";
import { validateProduct } from "@/src/lib/excel/validation";
import { useProjectStore } from "@/src/store/projectStore";
import { useBatchStore } from "@/src/store/batchStore";
import { BATCH_DIMENSION_LABELS } from "@/src/lib/batch/constants";
import {
  analyzeBatchDimensions,
  getTheoreticalCombinationCount,
} from "@/src/lib/batch/grouping";
import { createSlidePlan } from "@/src/lib/layout/createSlidePlan";
import type { Product, ProductCategoryId } from "@/types/catalog";
import type { ProductFilter } from "@/types/import";
import { ProductDrawer } from "./ProductDrawer";
import { AIReviewPanel } from "./AIReviewPanel";
import { ImportConflictPanel } from "./ImportConflictPanel";
import { SourcePreview } from "./SourcePreview";
import { WorkflowProgress } from "./WorkflowProgress";

const basicFilters: Array<{ key: ProductFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "valid", label: "正常" },
  { key: "needs-review", label: "需要确认" },
  { key: "missing-image", label: "缺少图片" },
  { key: "missing-price", label: "缺少价格" },
];

const batchFilters: Array<{ key: ProductFilter; label: string }> = [
  ...basicFilters,
  { key: "missing-category", label: "缺少分类" },
  { key: "ai-needs-review", label: "AI 待确认" },
];

function matchesFilter(product: Product, filter: ProductFilter) {
  const validation = validateProduct(product);
  if (filter === "valid") return validation.status === "valid";
  if (filter === "needs-review") return validation.status !== "valid";
  if (filter === "missing-image") return !getProductImages(product).length;
  if (filter === "missing-price")
    return (
      product.price.market === undefined || product.price.package === undefined
    );
  if (filter === "missing-category")
    return product.categoryId === UNCATEGORIZED_ID;
  if (filter === "ai-needs-review")
    return (
      product.aiMetadata?.status === "needs-review" ||
      product.aiMetadata?.status === "failed"
    );
  return true;
}

export function ConfirmStep({ onConfirmGeneration, reimportMode = false, pendingSaveMessage }: { onConfirmGeneration?: () => Promise<void | boolean>; reimportMode?: boolean; pendingSaveMessage?: string } = {}) {
  const project = useProjectStore((state) => state.project);
  const products = useProjectStore((state) => state.products);
  const selectedIds = useProjectStore((state) => state.selectedProductIds);
  const setStep = useProjectStore((state) => state.setStep);
  const selectProducts = useProjectStore((state) => state.selectProducts);
  const clearSelection = useProjectStore((state) => state.clearSelection);
  const bulkUpdate = useProjectStore((state) => state.bulkUpdate);
  const [filter, setFilter] = useState<ProductFilter>("all");
  const [editingId, setEditingId] = useState<string>();
  const [batchCategory, setBatchCategory] = useState<ProductCategoryId | "">(
    "",
  );
  const [batchPrice, setBatchPrice] = useState("");
  const [batchDelivery, setBatchDelivery] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const phasePercent = pendingSaveMessage?.match(/(\d+(?:\.\d+)?)%/);
  const [creationError, setCreationError] = useState("");
  const [sourceProductId, setSourceProductId] = useState<string>();
  const rawDocument = useProjectStore((state) => state.rawImportedDocument);
  const importSession = useProjectStore((state) => state.importSession);
  const importConflicts = useProjectStore((state) => state.importConflicts);
  const generationMode = useBatchStore((state) => state.generationMode);
  const batchConfig = useBatchStore((state) => state.config);
  const setDimensionEnabled = useBatchStore(
    (state) => state.setDimensionEnabled,
  );
  const initializeBatch = useBatchStore((state) => state.initializeBatch);

  const validations = useMemo(
    () =>
      products.map((product) => ({
        product,
        validation: validateProduct(product),
      })),
    [products],
  );
  const filteredProducts = useMemo(
    () => products.filter((product) => matchesFilter(product, filter)),
    [products, filter],
  );
  const validCount = validations.filter(
    ({ validation }) => validation.status === "valid",
  ).length;
  const warningCount = validations.filter(
    ({ validation }) => validation.status === "warning",
  ).length;
  const errorCount = validations.filter(
    ({ validation }) => validation.status === "error",
  ).length;
  const editingProduct = products.find((product) => product.id === editingId);
  const sourceProduct = products.find(
    (product) => product.id === sourceProductId,
  );
  const filters = generationMode === "batch" ? batchFilters : basicFilters;
  const allFilteredSelected =
    filteredProducts.length > 0 &&
    filteredProducts.every((product) => selectedIds.includes(product.id));
  const estimatedProductSlides = useMemo(
    () => createSlidePlan(products).length,
    [products],
  );
  const batchAnalysis = useMemo(
    () => analyzeBatchDimensions(products),
    [products],
  );
  const selectedTheoreticalCombinations = useMemo(
    () => getTheoreticalCombinationCount(batchAnalysis, batchConfig.dimensions),
    [batchAnalysis, batchConfig.dimensions],
  );
  const beginGeneration = async () => {
    setCreationError("");
    if (generationMode === "batch") initializeBatch(project, products);
    if (onConfirmGeneration) {
      setCreatingProject(true);
      try {
        const proceed = await onConfirmGeneration();
        if (proceed === false) { setCreatingProject(false); return; }
      } catch (cause) {
        setCreationError(cause instanceof Error ? cause.message : "项目创建失败，请重试");
        setCreatingProject(false);
        return;
      }
    }
    setStep(generationMode === "batch" ? "batch" : "preview");
  };

  return (
    <section className="workflow-page confirm-page">
      <div className="workflow-page-heading confirm-heading">
        <div>
          <span>第 3 步</span>
          <h1>
            {generationMode === "single" ? "套餐数据确认" : "商品数据确认"}
          </h1>
          <p>
            {rawDocument
              ? `${rawDocument.sourceType.toUpperCase()} 资料已转换为标准 Product[]；套餐名称、套餐内商品和图片均保留在同一条记录中。`
              : "直接编辑标准 Product[]；顺序将决定 PPT 商品分页。"}
          </p>
        </div>
        <div className="confirmation-stats">
          <div>
            <strong>{products.length}</strong>
            <span>{generationMode === "single" ? "识别套餐" : "识别商品"}</span>
          </div>
          <div className="is-valid">
            <strong>{validCount}</strong>
            <span>正常</span>
          </div>
          <div className="is-warning">
            <strong>{warningCount}</strong>
            <span>需确认</span>
          </div>
          <div className="is-error">
            <strong>{errorCount}</strong>
            <span>错误</span>
          </div>
        </div>
      </div>

      {importSession && (
        <div className="import-session-strip">
          <FileSearch aria-hidden="true" />
          <div>
            <strong>
              {importSession.sourceFiles.find((file) => file.primary)?.name ??
                rawDocument?.fileName ??
                "手动创建"}
            </strong>
            <span>
              {importSession.extractedProductCount} 个
              {generationMode === "single" ? "套餐" : "商品"} ·{" "}
              {importSession.extractedImageCount} 张图片 ·{" "}
              {importSession.matchedImageCount} 个已匹配
            </span>
          </div>
          {importSession.warnings.length > 0 && (
            <span className="has-warning">
              {importSession.warnings.length} 条解析提示
            </span>
          )}
        </div>
      )}

      <ImportConflictPanel />

      <AIReviewPanel />

      {generationMode === "batch" && (
        <section className="batch-dimension-card">
          <div>
            <Boxes aria-hidden="true" />
            <div>
              <strong>检测到可批量生成维度</strong>
              <p>
                {batchAnalysis.detectedDimensions.length
                  ? batchAnalysis.detectedDimensions
                      .map(
                        (field) =>
                          `${BATCH_DIMENSION_LABELS[field]} ${batchAnalysis.values[field].length} 个`,
                      )
                      .join(" · ")
                  : "当前数据没有多个维度值，可手动选择拆分字段。"}
              </p>
            </div>
            <span>当前选择理论组合 {selectedTheoreticalCombinations} 个</span>
          </div>
          <div className="batch-dimension-options">
            {batchConfig.dimensions.map((dimension) => (
              <label key={dimension.field}>
                <input
                  type="checkbox"
                  checked={dimension.enabled}
                  onChange={(event) =>
                    setDimensionEnabled(dimension.field, event.target.checked)
                  }
                />
                <span>
                  <strong>{BATCH_DIMENSION_LABELS[dimension.field]}</strong>
                  <small>
                    {batchAnalysis.values[dimension.field].length} 个值
                  </small>
                </span>
              </label>
            ))}
          </div>
          <small>
            仅按数据中真实存在的组合创建项目，不生成空的笛卡尔积组合。
          </small>
        </section>
      )}

      <div className="confirm-toolbar">
        <div className="filter-tabs">
          {filters.map((item) => {
            const count = products.filter((product) =>
              matchesFilter(product, item.key),
            ).length;
            return (
              <button
                className={filter === item.key ? "is-active" : ""}
                type="button"
                onClick={() => setFilter(item.key)}
                key={item.key}
              >
                {item.label}
                <span>{count}</span>
              </button>
            );
          })}
        </div>
        <span>
          {selectedIds.length
            ? `已选择 ${selectedIds.length} 项`
            : "可勾选商品进行批量修改"}
        </span>
      </div>

      {selectedIds.length > 0 && (
        <div className="batch-toolbar">
          <div>
            <Layers3 aria-hidden="true" />
            <strong>批量修改 {selectedIds.length} 个商品</strong>
          </div>
          {generationMode === "batch" && (
            <label>
              分类
              <select
                value={batchCategory}
                onChange={(event) =>
                  setBatchCategory(event.target.value as ProductCategoryId | "")
                }
              >
                <option value="">选择分类</option>
                {productCategories.map((category) => (
                  <option value={category.id} key={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!batchCategory}
                onClick={() =>
                  bulkUpdate({ categoryId: batchCategory || undefined })
                }
              >
                应用
              </button>
            </label>
          )}
          <label>
            套餐价
            <input
              inputMode="decimal"
              placeholder="100"
              value={batchPrice}
              onChange={(event) => setBatchPrice(event.target.value)}
            />
            <button
              type="button"
              disabled={parsePrice(batchPrice) === undefined}
              onClick={() =>
                bulkUpdate({ packagePrice: parsePrice(batchPrice) })
              }
            >
              应用
            </button>
          </label>
          {generationMode === "batch" && (
            <label>
              配送区域
              <input
                placeholder="全国配送 A 类"
                value={batchDelivery}
                onChange={(event) => setBatchDelivery(event.target.value)}
              />
              <button
                type="button"
                disabled={!batchDelivery.trim()}
                onClick={() =>
                  bulkUpdate({ delivery: parseDeliveryRules(batchDelivery) })
                }
              >
                应用
              </button>
            </label>
          )}
          <button
            className="batch-clear"
            type="button"
            onClick={clearSelection}
          >
            取消选择
          </button>
        </div>
      )}

      <div className="product-table-wrap">
        <table
          className={`product-confirm-table ${generationMode === "single" ? "is-basic-import" : ""}`}
        >
          <thead>
            {generationMode === "single" ? (
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="选择当前筛选中的全部套餐"
                    checked={allFilteredSelected}
                    onChange={() =>
                      allFilteredSelected
                        ? clearSelection()
                        : selectProducts(
                            filteredProducts.map((product) => product.id),
                          )
                    }
                  />
                </th>
                <th>序号</th>
                <th>套餐名称</th>
                <th>商品名称</th>
                <th>商品明细</th>
                <th>市场价</th>
                <th>组合价</th>
                <th>商品图片</th>
                <th>数据状态</th>
                <th>操作</th>
              </tr>
            ) : (
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="选择当前筛选中的全部商品"
                    checked={allFilteredSelected}
                    onChange={() =>
                      allFilteredSelected
                        ? clearSelection()
                        : selectProducts(
                            filteredProducts.map((product) => product.id),
                          )
                    }
                  />
                </th>
                <th>序号</th>
                <th>SKU</th>
                <th>商品名称</th>
                <th>商品明细</th>
                <th>市场价</th>
                <th>组合价</th>
                <th>分类</th>
                <th>配送区域</th>
                <th>图片</th>
                <th>精选</th>
                <th>AI 状态</th>
                <th>数据状态</th>
                <th>操作</th>
              </tr>
            )}
          </thead>
          <tbody>
            {filteredProducts.map((product) => (
              <ProductRow
                basicMode={generationMode === "single"}
                key={product.id}
                product={product}
                selected={selectedIds.includes(product.id)}
                onEdit={() => setEditingId(product.id)}
                onViewSource={() => setSourceProductId(product.id)}
              />
            ))}
          </tbody>
        </table>
        {!filteredProducts.length && (
          <div className="empty-filter-state">当前筛选条件下没有商品。</div>
        )}
      </div>

      <div className="workflow-footer-actions confirm-footer">
        {creatingProject && <WorkflowProgress message={pendingSaveMessage || (reimportMode ? "正在备份并替换…" : "正在创建项目…")} percent={phasePercent ? Number(phasePercent[1]) : undefined} />}
        <button
          className="secondary-action"
          type="button"
          onClick={() => setStep("mapping")}
        >
          <ArrowLeft aria-hidden="true" />
          返回字段匹配
        </button>
        <span>
          {creationError
            ? <span className="inline-error" role="alert">{creationError}</span>
            : errorCount
            ? `还有 ${errorCount} 个套餐缺少套餐名称，修正后才能生成`
            : `${products.length} 个${generationMode === "single" ? "套餐" : "商品"}预计生成 ${estimatedProductSlides} 个智能商品页`}
        </span>
        <button
          className="primary-action"
          type="button"
          disabled={
            !products.length ||
            creatingProject ||
            errorCount > 0 ||
            importConflicts.some((conflict) => !conflict.resolved)
          }
          onClick={() => void beginGeneration()}
        >
          {creatingProject ? (pendingSaveMessage || (reimportMode ? "正在备份并替换…" : "正在创建项目…")) : reimportMode ? "确认替换原项目" : generationMode === "batch" ? "生成批量项目" : "生成产品手册"}
          <ArrowRight aria-hidden="true" />
        </button>
      </div>

      {editingProduct && (
        <ProductDrawer
          product={editingProduct}
          onClose={() => setEditingId(undefined)}
        />
      )}
      {sourceProduct && (
        <SourcePreview
          product={sourceProduct}
          document={rawDocument}
          onClose={() => setSourceProductId(undefined)}
        />
      )}
    </section>
  );
}

const ProductRow = memo(function ProductRow({
  product,
  selected,
  basicMode,
  onEdit,
  onViewSource,
}: {
  product: Product;
  selected: boolean;
  basicMode: boolean;
  onEdit: () => void;
  onViewSource: () => void;
}) {
  const updateProduct = useProjectStore((state) => state.updateProduct);
  const updateProductPrice = useProjectStore(
    (state) => state.updateProductPrice,
  );
  const toggleProduct = useProjectStore((state) => state.toggleProduct);
  const moveProduct = useProjectStore((state) => state.moveProduct);
  const validation = validateProduct(product);
  const images = getProductImages(product);
  const aiStatus = product.aiMetadata?.status ?? "unprocessed";
  const aiPending =
    product.aiMetadata?.suggestions.filter((item) => item.status === "pending")
      .length ?? 0;
  const lowConfidence = (
    field: keyof NonNullable<Product["importMetadata"]>["fieldConfidence"],
  ) => (product.importMetadata?.fieldConfidence[field] ?? 1) < 0.75;

  if (basicMode) {
    const componentNames =
      product.components
        ?.map((component) => component.name)
        .filter(Boolean)
        .join("\n") ?? "";
    return (
      <tr
        className={`product-row is-${validation.status} ${selected ? "is-selected" : ""}`}
      >
        <td>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => toggleProduct(product.id)}
            aria-label={`选择第 ${product.productNumber} 个套餐`}
          />
        </td>
        <td>
          <strong>{product.productNumber}</strong>
        </td>
        <td>
          <input
            className={`cell-input name-input ${lowConfidence("name") ? "is-low-confidence" : ""}`}
            value={product.name}
            placeholder="套餐名称"
            onChange={(event) =>
              updateProduct(product.id, { name: event.target.value })
            }
          />
        </td>
        <td>
          <textarea
            className="cell-input component-names-input"
            rows={2}
            value={componentNames}
            placeholder="一行一个商品"
            onChange={(event) => {
              const names = event.target.value
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean);
              updateProduct(product.id, {
                components: names.map((name, index) => ({
                  name,
                  details: product.components?.[index]?.details ?? [],
                  marketPrice: product.components?.[index]?.marketPrice,
                })),
              });
            }}
          />
        </td>
        <td>
          <textarea
            className={`cell-input items-input ${lowConfidence("items") ? "is-low-confidence" : ""}`}
            rows={2}
            value={product.details.join("\n")}
            placeholder="一行一项"
            onChange={(event) =>
              updateProduct(product.id, {
                details: event.target.value
                  .split(/\r?\n/)
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
          />
        </td>
        <td>
          <input
            className="cell-input price-input"
            inputMode="decimal"
            value={product.price.market ?? ""}
            placeholder="—"
            onChange={(event) =>
              updateProductPrice(product.id, {
                market: parsePrice(event.target.value),
              })
            }
          />
        </td>
        <td>
          <input
            className="cell-input price-input is-sale"
            inputMode="decimal"
            value={product.price.package ?? ""}
            placeholder="—"
            onChange={(event) =>
              updateProductPrice(product.id, {
                package: parsePrice(event.target.value),
              })
            }
          />
        </td>
        <td>
          {images.length ? (
            <button
              className="basic-image-status"
              type="button"
              onClick={onEdit}
              title="查看和编辑图片"
            >
              <img src={images[0]} alt="" />
              <span>{images.length} 张</span>
            </button>
          ) : (
            <button
              className="basic-image-status is-empty"
              type="button"
              onClick={onEdit}
            >
              <ImageOff aria-hidden="true" />
              <span>未识别</span>
            </button>
          )}
        </td>
        <td>
          <span
            className={`validation-chip is-${validation.status}`}
            title={validation.messages.join("\n")}
          >
            {validation.status === "valid" ? (
              <CheckCircle2 aria-hidden="true" />
            ) : (
              <TriangleAlert aria-hidden="true" />
            )}
            {validation.status === "valid"
              ? "正常"
              : validation.status === "error"
                ? "错误"
                : `${validation.messages.length} 项`}
          </span>
        </td>
        <td>
          <div className="row-actions">
            <button
              type="button"
              onClick={() => moveProduct(product.id, -1)}
              aria-label="上移"
            >
              <ArrowUp aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => moveProduct(product.id, 1)}
              aria-label="下移"
            >
              <ArrowDown aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onViewSource}
              aria-label="查看原始页"
            >
              <FileSearch aria-hidden="true" />
            </button>
            <button type="button" onClick={onEdit} aria-label="打开编辑抽屉">
              <Edit3 aria-hidden="true" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr
      className={`product-row is-${validation.status} ${selected ? "is-selected" : ""}`}
    >
      <td>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => toggleProduct(product.id)}
          aria-label={`选择 NO.${product.productNumber}`}
        />
      </td>
      <td>
        <strong>NO.{product.productNumber}</strong>
      </td>
      <td>
        <input
          className={`cell-input sku-input ${lowConfidence("sku") ? "is-low-confidence" : ""}`}
          value={product.sku}
          placeholder="未填写"
          onChange={(event) =>
            updateProduct(product.id, {
              sku: event.target.value,
              packageCode: event.target.value,
            })
          }
        />
      </td>
      <td>
        <input
          className={`cell-input name-input ${lowConfidence("name") ? "is-low-confidence" : ""}`}
          value={product.name}
          placeholder="商品名称"
          onChange={(event) =>
            updateProduct(product.id, { name: event.target.value })
          }
        />
      </td>
      <td>
        <textarea
          className={`cell-input items-input ${lowConfidence("items") ? "is-low-confidence" : ""}`}
          rows={2}
          value={product.details.join("\n")}
          placeholder="一行一项"
          onChange={(event) =>
            updateProduct(product.id, {
              details: event.target.value
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean),
            })
          }
        />
      </td>
      <td>
        <input
          className="cell-input price-input"
          inputMode="decimal"
          value={product.price.market ?? ""}
          placeholder="—"
          onChange={(event) =>
            updateProductPrice(product.id, {
              market: parsePrice(event.target.value),
            })
          }
        />
      </td>
      <td>
        <input
          className="cell-input price-input is-sale"
          inputMode="decimal"
          value={product.price.package ?? ""}
          placeholder="—"
          onChange={(event) =>
            updateProductPrice(product.id, {
              package: parsePrice(event.target.value),
            })
          }
        />
      </td>
      <td>
        <select
          className="cell-input category-input"
          value={product.categoryId}
          onChange={(event) =>
            updateProduct(product.id, {
              categoryId: event.target.value as ProductCategoryId,
            })
          }
        >
          <option value={UNCATEGORIZED_ID}>未分类</option>
          {productCategories.map((category) => (
            <option value={category.id} key={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          className="cell-input delivery-input"
          value={product.deliveryRegions.join("；")}
          placeholder="未填写"
          onChange={(event) =>
            updateProduct(product.id, {
              deliveryRegions: parseDeliveryRules(event.target.value),
            })
          }
        />
      </td>
      <td>
        <textarea
          className="cell-input image-input"
          rows={2}
          value={images.join("\n")}
          placeholder="图片 URL，一行一张"
          onChange={(event) => {
            const nextImages = parseImageSources(event.target.value);
            updateProduct(product.id, {
              image: nextImages[0],
              images: nextImages,
              imageMetadata:
                nextImages[0] === product.image
                  ? product.imageMetadata
                  : undefined,
            });
          }}
        />
        {images.length ? (
          <small className="image-count-label">{images.length} 张</small>
        ) : (
          <ImageOff aria-label="缺少图片" />
        )}
      </td>
      <td>
        <button
          className={`featured-toggle ${product.featured ? "is-active" : ""}`}
          type="button"
          onClick={() =>
            updateProduct(product.id, { featured: !product.featured })
          }
          title={product.featured ? "取消精选" : "标记为精选商品"}
        >
          <Star aria-hidden="true" />
          <span>{product.featured ? "已精选" : "精选"}</span>
        </button>
      </td>
      <td>
        <button
          type="button"
          className={`ai-status-chip is-${aiStatus}`}
          onClick={onEdit}
          title="打开抽屉查看 AI 详情"
        >
          <Bot aria-hidden="true" />
          {aiStatus === "unprocessed"
            ? "未处理"
            : aiStatus === "processing"
              ? "处理中"
              : aiStatus === "failed"
                ? "失败"
                : aiPending
                  ? `${aiPending} 建议`
                  : "已处理"}
        </button>
      </td>
      <td>
        <span
          className={`validation-chip is-${validation.status}`}
          title={validation.messages.join("\n")}
        >
          {validation.status === "valid" ? (
            <CheckCircle2 aria-hidden="true" />
          ) : (
            <TriangleAlert aria-hidden="true" />
          )}
          {validation.status === "valid"
            ? "正常"
            : validation.status === "error"
              ? "错误"
              : `${validation.messages.length} 项`}
        </span>
      </td>
      <td>
        <div className="row-actions">
          <button
            type="button"
            onClick={() => moveProduct(product.id, -1)}
            aria-label="上移"
          >
            <ArrowUp aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => moveProduct(product.id, 1)}
            aria-label="下移"
          >
            <ArrowDown aria-hidden="true" />
          </button>
          <button type="button" onClick={onViewSource} aria-label="查看原始页">
            <FileSearch aria-hidden="true" />
          </button>
          <button type="button" onClick={onEdit} aria-label="打开编辑抽屉">
            <Edit3 aria-hidden="true" />
          </button>
        </div>
      </td>
    </tr>
  );
});
