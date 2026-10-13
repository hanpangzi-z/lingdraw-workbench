"use client";

import {
  ImagePlus,
  Eye,
  EyeOff,
  Library,
  LockKeyhole,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  UnlockKeyhole,
} from "lucide-react";
import { getProductImages } from "@/src/lib/catalog/images";
import { createSlidePlan } from "@/src/lib/layout/createSlidePlan";
import { LAYOUT_LABELS } from "@/src/lib/layout/layoutRules";
import type { LayoutMode, ProductLayoutType } from "@/src/lib/layout/types";
import { useProjectStore } from "@/src/store/projectStore";
import { resolveCanvasTransform } from "@/src/lib/editor/canvas";
import {
  defaultCanvasImageOverride,
  readImageFile,
} from "@/src/lib/editor/image";
import type { CatalogSlide, ProductCategory } from "@/types/catalog";
import {
  isSectionHidden,
  type EditableSection,
  type EditorSelection,
  type ProductImageOverride,
} from "@/types/editor";
import { useCloudProject } from "@/components/cloud/CloudProjectContext";
import { pptFetch } from "@/src/lib/basePath";
import { useStudioDialog } from "@/components/host/StudioDialogProvider";

interface EditorInspectorProps {
  slide: CatalogSlide;
  selection?: EditorSelection;
  categories: ProductCategory[];
  layoutMode: LayoutMode;
  productSlideIds: string[];
  priceAreaColor: string;
}

const moduleOptions: Array<{ key: EditableSection; label: string }> = [
  { key: "marketPrice", label: "市场价" },
  { key: "salePrice", label: "套餐价" },
  { key: "details", label: "商品明细" },
  { key: "delivery", label: "配送区域" },
  { key: "category", label: "分类标签" },
];

export function EditorInspector({
  slide,
  selection,
  categories,
  layoutMode,
  productSlideIds,
  priceAreaColor,
}: EditorInspectorProps) {
  const cloud = useCloudProject();
  const dialog = useStudioDialog();
  const editorState = useProjectStore((state) => state.editorState);
  const editorUpdateProduct = useProjectStore(
    (state) => state.editorUpdateProduct,
  );
  const editorUpdateProductPrice = useProjectStore(
    (state) => state.editorUpdateProductPrice,
  );
  const editorMoveProduct = useProjectStore((state) => state.editorMoveProduct);
  const updateSlideEdit = useProjectStore((state) => state.updateSlideEdit);
  const setCanvasElementOverride = useProjectStore(
    (state) => state.setCanvasElementOverride,
  );
  const resetCanvasElementOverride = useProjectStore(
    (state) => state.resetCanvasElementOverride,
  );
  const updateManualSlide = useProjectStore((state) => state.updateManualSlide);
  const toggleSlideSection = useProjectStore(
    (state) => state.toggleSlideSection,
  );
  const setPriceZonesVisibility = useProjectStore(
    (state) => state.setPriceZonesVisibility,
  );
  const setPriceZoneBackground = useProjectStore(
    (state) => state.setPriceZoneBackground,
  );
  const setSlideImageOverride = useProjectStore(
    (state) => state.setSlideImageOverride,
  );
  const setPageLayoutOverride = useProjectStore(
    (state) => state.setPageLayoutOverride,
  );
  const toggleSlideLock = useProjectStore((state) => state.toggleSlideLock);
  const resetSlideEdit = useProjectStore((state) => state.resetSlideEdit);
  const edit = editorState.slides[slide.id];
  const locked = editorState.lockedSlideIds.includes(slide.id);
  const productId =
    selection && "productId" in selection ? selection.productId : undefined;
  const product =
    slide.kind === "products"
      ? slide.products.find((item) => item.id === productId)
      : undefined;
  const manual = editorState.manualSlides[slide.id];
  const allPriceZonesHidden =
    productSlideIds.length > 0 &&
    productSlideIds.every((slideId) => {
      const hidden = editorState.slides[slideId]?.hiddenSections ?? [];
      return hidden.includes("marketPrice") && hidden.includes("salePrice");
    });
  const bulkPriceZoneControl = (
    <button
      className="editor-secondary-button editor-bulk-toggle"
      type="button"
      aria-pressed={allPriceZonesHidden}
      onClick={() =>
        setPriceZonesVisibility(productSlideIds, allPriceZonesHidden)
      }
    >
      {allPriceZonesHidden ? (
        <Eye aria-hidden="true" />
      ) : (
        <EyeOff aria-hidden="true" />
      )}
      {allPriceZonesHidden
        ? "恢复全部页面价格区"
        : "移除全部页面价格区"}
    </button>
  );
  const saveToLibrary = async (strategy?: "update" | "copy") => {
    if (!cloud || !product) return;
    const response = await pptFetch(
      `/api/projects/${cloud.projectId}/save-product-to-library`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: product.id, strategy }),
      },
    );
    const payload = await response.json();
    if (response.status === 409) {
      if (
        await dialog.confirm(
          `${payload.error}\n\n确认：更新商品库现有商品\n取消：可继续另存新商品`,
        )
      )
        return saveToLibrary("update");
      if (await dialog.confirm("是否另存为不带 SKU 的新商品？"))
        return saveToLibrary("copy");
      return;
    }
    if (!response.ok) {
      dialog.notify(payload.error || "保存到商品库失败", "error");
      return;
    }
    editorUpdateProduct(product.id, {
      globalProductId: payload.id,
      globalProductVersion: payload.revision,
    });
    dialog.notify("已保存到商品库", "success");
  };

  if (selection?.type === "element") {
    const element = edit?.elementOverrides?.[selection.elementId];
    const priceZoneSelected = /^product\..+\.prices$/.test(selection.elementId);
    const canvasImage = { ...defaultCanvasImageOverride(), ...element?.image };
    const transform = resolveCanvasTransform(element);
    const patchTransform = (patch: Partial<typeof transform>) =>
      setCanvasElementOverride(slide.id, selection.elementId, {
        type: selection.elementType,
        label: selection.label,
        transform: { ...transform, ...patch },
      });
    const patchStyle = (patch: NonNullable<typeof element>["style"]) =>
      setCanvasElementOverride(slide.id, selection.elementId, {
        type: selection.elementType,
        label: selection.label,
        style: { ...element?.style, ...patch },
      });
    return (
      <div className="editor-inspector-body">
        <section className="editor-inspector-intro">
          <span>自由画布元素</span>
          <strong>{selection.label}</strong>
          <p>
            拖动与缩放使用相对坐标保存，不受浏览器缩放影响。双击文字可直接编辑。
          </p>
        </section>
        <section className="editor-field-group">
          {selection.elementType === "text" && (
            <>
              <label>
                文字内容
                <textarea
                  rows={4}
                  value={element?.text ?? ""}
                  placeholder="双击画布文字直接编辑"
                  onChange={(event) =>
                    setCanvasElementOverride(slide.id, selection.elementId, {
                      type: "text",
                      label: selection.label,
                      text: event.target.value,
                    })
                  }
                />
              </label>
              <div className="editor-field-row">
                <label>
                  字号
                  <input
                    type="number"
                    min="6"
                    max="96"
                    value={element?.style?.fontSize ?? 16}
                    onChange={(event) =>
                      patchStyle({ fontSize: Number(event.target.value) || 16 })
                    }
                  />
                </label>
                <label>
                  字重
                  <select
                    value={element?.style?.fontWeight ?? 400}
                    onChange={(event) =>
                      patchStyle({
                        fontWeight: Number(event.target.value) as
                          400 | 500 | 600 | 700,
                      })
                    }
                  >
                    <option value="400">常规</option>
                    <option value="500">中等</option>
                    <option value="600">半粗</option>
                    <option value="700">粗体</option>
                  </select>
                </label>
              </div>
              <div className="editor-field-row">
                <label>
                  文字颜色
                  <input
                    type="color"
                    value={element?.style?.color ?? "#24201e"}
                    onChange={(event) =>
                      patchStyle({ color: event.target.value })
                    }
                  />
                </label>
                <label>
                  对齐
                  <select
                    value={element?.style?.textAlign ?? "left"}
                    onChange={(event) =>
                      patchStyle({
                        textAlign: event.target.value as
                          "left" | "center" | "right",
                      })
                    }
                  >
                    <option value="left">左对齐</option>
                    <option value="center">居中</option>
                    <option value="right">右对齐</option>
                  </select>
                </label>
              </div>
            </>
          )}
          {(selection.elementType === "shape" || priceZoneSelected) && (
            <label>
              {priceZoneSelected ? "价格区背景颜色（全部页面）" : "填充颜色"}
              <input
                type="color"
                value={
                  priceZoneSelected
                    ? priceAreaColor
                    : element?.style?.fillColor ?? "#b01f32"
                }
                onChange={(event) => {
                  if (priceZoneSelected) {
                    setPriceZoneBackground(event.target.value);
                    return;
                  }
                  patchStyle({ fillColor: event.target.value });
                }}
              />
            </label>
          )}
          {selection.elementType === "image" && (
            <>
              <label className="editor-upload-button">
                <ImagePlus aria-hidden="true" />
                替换图片
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = "";
                    if (!file) return;
                    try {
                      const source = await readImageFile(file);
                      setCanvasElementOverride(slide.id, selection.elementId, {
                        type: "image",
                        label: selection.label,
                        image: { ...canvasImage, source },
                      });
                    } catch (error) {
                      console.error("替换图片失败", error);
                    }
                  }}
                />
              </label>
              <label>
                图片地址
                <input
                  value={canvasImage.source ?? ""}
                  placeholder="也可粘贴图片 URL"
                  onChange={(event) =>
                    setCanvasElementOverride(slide.id, selection.elementId, {
                      type: "image",
                      label: selection.label,
                      image: {
                        ...canvasImage,
                        source: event.target.value || undefined,
                      },
                    })
                  }
                />
              </label>
              <label>
                适配方式
                <select
                  value={canvasImage.fit}
                  onChange={(event) =>
                    setCanvasElementOverride(slide.id, selection.elementId, {
                      type: "image",
                      label: selection.label,
                      image: {
                        ...canvasImage,
                        fit: event.target.value as ProductImageOverride["fit"],
                      },
                    })
                  }
                >
                  <option value="contain">Contain · 完整显示</option>
                  <option value="cover">Cover · 填满区域</option>
                </select>
              </label>
              <label>
                图片缩放 <output>{Math.round(canvasImage.scale * 100)}%</output>
                <input
                  type="range"
                  min="0.5"
                  max="2.5"
                  step="0.05"
                  value={canvasImage.scale}
                  onChange={(event) =>
                    setCanvasElementOverride(slide.id, selection.elementId, {
                      type: "image",
                      label: selection.label,
                      image: {
                        ...canvasImage,
                        scale: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label>
                图片水平偏移 <output>{canvasImage.offsetX}%</output>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={canvasImage.offsetX}
                  onChange={(event) =>
                    setCanvasElementOverride(slide.id, selection.elementId, {
                      type: "image",
                      label: selection.label,
                      image: {
                        ...canvasImage,
                        offsetX: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label>
                图片垂直偏移 <output>{canvasImage.offsetY}%</output>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={canvasImage.offsetY}
                  onChange={(event) =>
                    setCanvasElementOverride(slide.id, selection.elementId, {
                      type: "image",
                      label: selection.label,
                      image: {
                        ...canvasImage,
                        offsetY: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <button
                className="editor-secondary-button"
                type="button"
                onClick={() =>
                  setCanvasElementOverride(slide.id, selection.elementId, {
                    type: "image",
                    label: selection.label,
                    image: undefined,
                  })
                }
              >
                <RotateCcw aria-hidden="true" />
                恢复原图
              </button>
            </>
          )}
          <div className="editor-field-row">
            <label>
              水平位置
              <input
                type="number"
                step="0.25"
                value={Number(transform.x.toFixed(2))}
                onChange={(event) =>
                  patchTransform({ x: Number(event.target.value) })
                }
              />
            </label>
            <label>
              垂直位置
              <input
                type="number"
                step="0.25"
                value={Number(transform.y.toFixed(2))}
                onChange={(event) =>
                  patchTransform({ y: Number(event.target.value) })
                }
              />
            </label>
          </div>
          <label className="editor-standalone-toggle">
            <input
              type="checkbox"
              checked={priceZoneSelected ? !allPriceZonesHidden : !element?.hidden}
              onChange={(event) => {
                if (priceZoneSelected) {
                  setPriceZonesVisibility(productSlideIds, event.target.checked);
                  return;
                }
                setCanvasElementOverride(slide.id, selection.elementId, {
                  hidden: !event.target.checked,
                });
              }}
            />
            <span>{priceZoneSelected ? "显示全部页面价格区" : "显示元素"}</span>
          </label>
          <label className="editor-standalone-toggle">
            <input
              type="checkbox"
              checked={Boolean(element?.locked)}
              onChange={(event) =>
                setCanvasElementOverride(slide.id, selection.elementId, {
                  locked: event.target.checked,
                })
              }
            />
            <span>锁定元素</span>
          </label>
          <button
            className="editor-secondary-button"
            type="button"
            onClick={() =>
              resetCanvasElementOverride(slide.id, selection.elementId)
            }
          >
            <RotateCcw aria-hidden="true" />
            恢复元素默认状态
          </button>
        </section>
      </div>
    );
  }

  if (product && selection?.type === "image") {
    const current =
      edit?.imageOverrides?.[product.id] ??
      ({
        fit: "contain",
        scale: 1,
        offsetX: 0,
        offsetY: 0,
      } satisfies ProductImageOverride);
    const patchImage = (patch: Partial<ProductImageOverride>) =>
      setSlideImageOverride(slide.id, product.id, { ...current, ...patch });
    const availableImages = getProductImages(product);
    return (
      <div className="editor-inspector-body">
        <section className="editor-inspector-intro">
          <span>商品图片</span>
          <strong data-ppt-no-translate translate="no">{product.name}</strong>
          <p>图片调整只作用于当前页面，导出 PPTX 时同步生效。</p>
        </section>
        <section className="editor-field-group">
          <label className="editor-upload-button">
            <ImagePlus aria-hidden="true" />
            更换图片
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file)
                  readImageFile(file)
                    .then((source) => patchImage({ source }))
                    .catch((error) => console.error("替换图片失败", error));
              }}
            />
          </label>
          {availableImages.length > 0 && (
            <div className="editor-image-library">
              <span>已上传 / 已匹配图片</span>
              <div>
                {availableImages.map((source, index) => (
                  <button
                    className={
                      (current.source ?? availableImages[0]) === source
                        ? "is-active"
                        : ""
                    }
                    type="button"
                    key={`${source}-${index}`}
                    onClick={() => patchImage({ source })}
                    title={`使用第 ${index + 1} 张图片`}
                  >
                    <img src={source} alt="" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <label>
            图片地址
            <input
              value={current.source ?? getProductImages(product)[0] ?? ""}
              onChange={(event) =>
                patchImage({ source: event.target.value || undefined })
              }
            />
          </label>
          <label>
            适配方式
            <select
              value={current.fit}
              onChange={(event) =>
                patchImage({
                  fit: event.target.value as ProductImageOverride["fit"],
                })
              }
            >
              <option value="contain">Contain · 完整显示</option>
              <option value="cover">Cover · 填满区域</option>
            </select>
          </label>
          <label>
            缩放 <output>{Math.round(current.scale * 100)}%</output>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.05"
              value={current.scale}
              onChange={(event) =>
                patchImage({ scale: Number(event.target.value) })
              }
            />
          </label>
          <label>
            水平偏移 <output>{current.offsetX}%</output>
            <input
              type="range"
              min="-30"
              max="30"
              value={current.offsetX}
              onChange={(event) =>
                patchImage({ offsetX: Number(event.target.value) })
              }
            />
          </label>
          <label>
            垂直偏移 <output>{current.offsetY}%</output>
            <input
              type="range"
              min="-30"
              max="30"
              value={current.offsetY}
              onChange={(event) =>
                patchImage({ offsetY: Number(event.target.value) })
              }
            />
          </label>
          <button
            className="editor-secondary-button"
            type="button"
            onClick={() =>
              setSlideImageOverride(slide.id, product.id, undefined)
            }
          >
            <RotateCcw aria-hidden="true" />
            恢复原图
          </button>
        </section>
      </div>
    );
  }

  if (product) {
    return (
      <div className="editor-inspector-body">
        <section className="editor-inspector-intro">
          <span>商品卡片</span>
          <strong data-ppt-no-translate translate="no">{product.name}</strong>
          <p>业务字段会更新 Product；除价格区外，显示开关只保存为当前页 Override。</p>
        </section>
        <section className="editor-field-group">
          <label>
            商品名称
            <input
              value={product.name}
              onChange={(event) =>
                editorUpdateProduct(product.id, { name: event.target.value })
              }
            />
          </label>
          <label>
            SKU
            <input
              value={product.sku}
              onChange={(event) =>
                editorUpdateProduct(product.id, { sku: event.target.value })
              }
            />
          </label>
          <label>
            商品明细
            <textarea
              rows={6}
              value={product.details.join("\n")}
              onChange={(event) =>
                editorUpdateProduct(product.id, {
                  details: event.target.value
                    .split(/\r?\n/)
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <div className="editor-field-row">
            <label>
              市场价
              <input
                type="number"
                value={product.price.market ?? ""}
                onChange={(event) =>
                  editorUpdateProductPrice(product.id, {
                    market:
                      event.target.value === ""
                        ? undefined
                        : Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              套餐价
              <input
                type="number"
                value={product.price.package ?? ""}
                onChange={(event) =>
                  editorUpdateProductPrice(product.id, {
                    package:
                      event.target.value === ""
                        ? undefined
                        : Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
          <label>
            商品分类
            <select
              value={product.categoryId}
              onChange={(event) =>
                editorUpdateProduct(product.id, {
                  categoryId: event.target.value as typeof product.categoryId,
                })
              }
            >
              {categories.map((category) => (
                <option value={category.id} key={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            配送区域
            <textarea
              rows={3}
              value={product.deliveryRegions.join("\n")}
              onChange={(event) =>
                editorUpdateProduct(product.id, {
                  deliveryRegions: event.target.value
                    .split(/\r?\n|[；;]/)
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          {cloud && (
            <button
              className="editor-secondary-button"
              type="button"
              onClick={() => void saveToLibrary()}
            >
              <Library aria-hidden="true" />
              {product.globalProductId ? "更新到商品库" : "保存到商品库"}
            </button>
          )}
        </section>
        <section className="editor-toggle-group">
          <strong>显示模块</strong>
          {moduleOptions.map((item) => (
            <label key={item.key}>
              <input
                type="checkbox"
                checked={!isSectionHidden(edit, product.id, item.key)}
                onChange={(event) =>
                  toggleSlideSection(
                    slide.id,
                    product.id,
                    item.key,
                    event.target.checked,
                  )
                }
              />
              <span>{item.label}</span>
            </label>
          ))}
          {bulkPriceZoneControl}
        </section>
        <section className="editor-inline-actions">
          <button
            type="button"
            onClick={() => editorMoveProduct(product.id, -1)}
          >
            上移商品
          </button>
          <button
            type="button"
            onClick={() => editorMoveProduct(product.id, 1)}
          >
            下移商品
          </button>
        </section>
      </div>
    );
  }

  const style = edit?.styleOverrides ?? {};
  const recommendation =
    slide.kind === "products"
      ? createSlidePlan(slide.products, { mode: "smart" })[0]
      : undefined;
  return (
    <div className="editor-inspector-body">
      <section className="editor-inspector-intro">
        <span>{slide.kind === "manual" ? "手动页面" : "页面设置"}</span>
        <strong>第 {slide.pageNumber} 页</strong>
        <p>页面样式覆盖会在切换主题后继续保留。</p>
      </section>
      <section className="editor-field-group">
        <label>
          页面标题
          <input
            value={edit?.customTitle ?? manual?.data.title ?? ""}
            placeholder="使用模板默认标题"
            onChange={(event) =>
              updateSlideEdit(slide.id, {
                customTitle: event.target.value || undefined,
              })
            }
          />
        </label>
        {manual && (
          <>
            <label>
              副标题
              <input
                value={manual.data.subtitle ?? ""}
                onChange={(event) =>
                  updateManualSlide(slide.id, { subtitle: event.target.value })
                }
              />
            </label>
            <label>
              正文
              <textarea
                rows={7}
                value={manual.data.body ?? ""}
                onChange={(event) =>
                  updateManualSlide(slide.id, { body: event.target.value })
                }
              />
            </label>
          </>
        )}
        {slide.kind === "products" && (
          <label>
            页面布局
            <select
              value={
                slide.plan.source === "manual" || layoutMode !== "smart"
                  ? slide.plan.type
                  : "auto"
              }
              onChange={(event) =>
                setPageLayoutOverride(
                  slide.plan.productIds[0],
                  event.target.value === "auto"
                    ? undefined
                    : (event.target.value as ProductLayoutType),
                )
              }
            >
              <option value="auto">自动</option>
              <option value="product-grid-3">3 商品</option>
              <option value="product-grid-2">2 商品</option>
              <option value="product-feature">单品重点</option>
              <option value="package-detail">套餐详情</option>
              <option value="product-image-focus">图片重点</option>
            </select>
          </label>
        )}
        <div className="editor-field-row">
          <label>
            标题字号
            <input
              type="number"
              min="12"
              max="64"
              value={style.titleFontSize ?? 34}
              onChange={(event) =>
                updateSlideEdit(slide.id, {
                  styleOverrides: {
                    ...style,
                    titleFontSize: Number(event.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            字重
            <select
              value={style.titleFontWeight ?? 700}
              onChange={(event) =>
                updateSlideEdit(slide.id, {
                  styleOverrides: {
                    ...style,
                    titleFontWeight: Number(event.target.value) as
                      400 | 500 | 600 | 700,
                  },
                })
              }
            >
              <option value="400">常规</option>
              <option value="500">中等</option>
              <option value="600">半粗</option>
              <option value="700">粗体</option>
            </select>
          </label>
        </div>
        <div className="editor-field-row">
          <label>
            标题颜色
            <input
              type="color"
              value={style.titleColor ?? "#24201e"}
              onChange={(event) =>
                updateSlideEdit(slide.id, {
                  styleOverrides: { ...style, titleColor: event.target.value },
                })
              }
            />
          </label>
          <label>
            页面背景
            <input
              type="color"
              value={style.backgroundColor ?? "#f4f1eb"}
              onChange={(event) =>
                updateSlideEdit(slide.id, {
                  styleOverrides: {
                    ...style,
                    backgroundColor: event.target.value,
                  },
                })
              }
            />
          </label>
        </div>
        <label>
          文字对齐
          <select
            value={style.textAlign ?? "left"}
            onChange={(event) =>
              updateSlideEdit(slide.id, {
                styleOverrides: {
                  ...style,
                  textAlign: event.target.value as "left" | "center" | "right",
                },
              })
            }
          >
            <option value="left">左对齐</option>
            <option value="center">居中</option>
            <option value="right">右对齐</option>
          </select>
        </label>
        <label className="editor-standalone-toggle">
          <input
            type="checkbox"
            checked={style.showPageNumber !== false}
            onChange={(event) =>
              updateSlideEdit(slide.id, {
                styleOverrides: {
                  ...style,
                  showPageNumber: event.target.checked,
                },
              })
            }
          />
          <span>显示页码</span>
        </label>
      </section>
      {slide.kind === "products" && slide.plan.overflow.overflow && (
        <section className="editor-overflow-alert">
          <TriangleAlert aria-hidden="true" />
          <div>
            <strong>当前内容可能溢出</strong>
            <p>{slide.plan.overflow.messages.join("；")}</p>
          </div>
        </section>
      )}
      {recommendation &&
        recommendation.type !==
          (slide.kind === "products" ? slide.plan.type : undefined) && (
          <section className="editor-recommendation">
            <Sparkles aria-hidden="true" />
            <div>
              <span>自动优化建议</span>
              <strong>{LAYOUT_LABELS[recommendation.type]}</strong>
              <p>{recommendation.reason}</p>
              <button
                type="button"
                onClick={() =>
                  slide.kind === "products" &&
                  setPageLayoutOverride(
                    slide.plan.productIds[0],
                    recommendation.type,
                  )
                }
              >
                应用建议
              </button>
            </div>
          </section>
        )}
      <section className="editor-page-actions">
        <button
          type="button"
          onClick={() => {
            if (!locked && slide.kind === "products")
              setPageLayoutOverride(slide.plan.productIds[0], slide.plan.type);
            toggleSlideLock(slide.id);
          }}
        >
          {locked ? (
            <UnlockKeyhole aria-hidden="true" />
          ) : (
            <LockKeyhole aria-hidden="true" />
          )}
          {locked ? "解除页面锁定" : "锁定当前页面"}
        </button>
        <button
          type="button"
          onClick={() =>
            updateSlideEdit(slide.id, { styleOverrides: undefined })
          }
        >
          清除局部样式
        </button>
        <button type="button" onClick={() => resetSlideEdit(slide.id)}>
          <RotateCcw aria-hidden="true" />
          恢复自动版本
        </button>
      </section>
    </div>
  );
}
