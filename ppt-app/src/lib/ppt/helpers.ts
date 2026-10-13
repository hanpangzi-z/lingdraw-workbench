import type PptxGenJS from "pptxgenjs";
import type { CatalogMeta, DeliveryRule, Product } from "@/types/catalog";
import type {
  DeliveryGroup,
  ImageBox,
  PreparedImageAsset,
  ProductTextStyle,
} from "./types";
import { slideLayout } from "@/src/config/slideLayout";
import { getProjectFileLabel } from "@/src/lib/catalog/project";
import type { LayoutContext } from "./types";
import { getEffectiveBrand } from "@/src/render/context";
import type { ProductImageOverride } from "@/types/editor";
import { resolveCanvasTransform } from "@/src/lib/editor/canvas";
import { pptFetch } from "@/src/lib/basePath";

export interface CanvasParentBox {
  id: string;
  box: ImageBox;
}

const imageCache = new Map<string, Promise<PreparedImageAsset | undefined>>();

export const DELIVERY_RULE_ORDER: DeliveryRule[] = [
  "全国配送 A 类",
  "全国配送 B 类",
  "沪浙苏皖闽",
  "江浙沪皖",
  "江浙沪",
  "按招标文件执行",
];

export const formatMoney = (value?: number) =>
  value === undefined ? "价格待确认" : `¥${new Intl.NumberFormat("zh-CN").format(value)}`;

function getCanvasOverride(context: LayoutContext, elementId: string) {
  return context.currentSlide.editor?.elementOverrides?.[elementId];
}

export function resolveCanvasBox(
  context: LayoutContext,
  elementId: string,
  box: ImageBox,
  parents: CanvasParentBox[] = [],
) {
  let next = { ...box, rotate: 0, objectName: `folio:${elementId}` };
  for (const parent of parents) {
    const override = getCanvasOverride(context, parent.id);
    if (override?.hidden) return undefined;
    if (!override?.transform) continue;
    const transform = resolveCanvasTransform(override);
    next.x = parent.box.x + slideLayout.width * transform.x / 100 + (next.x - parent.box.x) * transform.scaleX;
    next.y = parent.box.y + slideLayout.height * transform.y / 100 + (next.y - parent.box.y) * transform.scaleY;
    next.w *= transform.scaleX;
    next.h *= transform.scaleY;
    next.rotate += transform.rotation;
  }
  const override = getCanvasOverride(context, elementId);
  if (override?.hidden) return undefined;
  if (override?.transform) {
    const transform = resolveCanvasTransform(override);
    next.x += slideLayout.width * transform.x / 100;
    next.y += slideLayout.height * transform.y / 100;
    next.w *= transform.scaleX;
    next.h *= transform.scaleY;
    next.rotate += transform.rotation;
  }
  return next;
}

export function addCanvasText(
  context: LayoutContext,
  elementId: string,
  text: string,
  options: PptxGenJS.TextPropsOptions,
  parents: CanvasParentBox[] = [],
) {
  const box = resolveCanvasBox(context, elementId, {
    x: Number(options.x ?? 0),
    y: Number(options.y ?? 0),
    w: Number(options.w ?? 0),
    h: Number(options.h ?? 0),
  }, parents);
  if (!box) return;
  const override = getCanvasOverride(context, elementId);
  const style = override?.style;
  context.slide.addText(override?.text ?? text, {
    ...options,
    ...box,
    fontFace: style?.fontFamily ?? options.fontFace,
    fontSize: style?.fontSize ?? options.fontSize,
    bold: style?.fontWeight ? style.fontWeight >= 600 : options.bold,
    italic: style?.italic ?? options.italic,
    underline: style?.underline ? { style: "sng" } : options.underline,
    color: style?.color?.replace(/^#/, "") ?? options.color,
    align: style?.textAlign ?? options.align,
  });
}

export function addCanvasShape(
  context: LayoutContext,
  elementId: string,
  shape: PptxGenJS.ShapeType,
  options: PptxGenJS.ShapeProps,
  parents: CanvasParentBox[] = [],
) {
  const box = resolveCanvasBox(context, elementId, {
    x: Number(options.x ?? 0),
    y: Number(options.y ?? 0),
    w: Number(options.w ?? 0),
    h: Number(options.h ?? 0),
  }, parents);
  if (!box) return;
  const override = getCanvasOverride(context, elementId);
  context.slide.addShape(shape, {
    ...options,
    ...box,
    fill: override?.style?.fillColor
      ? { ...(typeof options.fill === "object" ? options.fill : {}), color: override.style.fillColor.replace(/^#/, "") }
      : options.fill,
  });
}

export function getCatalogFileName(meta: CatalogMeta) {
  const tierLabel = (meta.tierName || `${meta.priceTier}元档位`).replace(/\s+/g, "");
  const version = meta.version?.trim() ? `-${meta.version.trim().replace(/\s+/g, "")}` : "";
  return `${meta.year}${getProjectFileLabel(meta)}-${tierLabel}产品手册${version}.pptx`;
}

export function getProductTextStyle(product: Product): ProductTextStyle {
  const detailCount = product.details.length;
  const detailCharacters = product.details.reduce((total, detail) => total + detail.length, 0);
  const longTitle = product.name.length > 20;

  if (detailCount >= 16 || detailCharacters >= 420) {
    return {
      titleFontSize: longTitle ? 11 : 12,
      itemFontSize: 10,
      lineSpacing: 10.8,
      compact: true,
    };
  }

  if (detailCount >= 11 || detailCharacters >= 300) {
    return {
      titleFontSize: longTitle ? 11.5 : 13.5,
      itemFontSize: 10,
      lineSpacing: 11,
      compact: true,
    };
  }

  if (detailCount >= 7 || detailCharacters >= 200) {
    return {
      titleFontSize: longTitle ? 13.5 : 15,
      itemFontSize: 10,
      lineSpacing: 11.4,
      compact: true,
    };
  }

  if (detailCount >= 5 || detailCharacters >= 140) {
    return {
      titleFontSize: longTitle ? 14.5 : 16,
      itemFontSize: 10,
      lineSpacing: 12,
      compact: true,
    };
  }

  return {
    titleFontSize: longTitle ? 15.5 : 17.5,
    itemFontSize: 11,
    lineSpacing: 13.5,
    compact: false,
  };
}

export function groupProductsByDeliveryRule(products: Product[]): DeliveryGroup[] {
  const grouped = new Map<string, { productNumbers: string[]; productNames: string[] }>();

  for (const rule of DELIVERY_RULE_ORDER) grouped.set(rule, { productNumbers: [], productNames: [] });

  for (const product of products) {
    for (const rule of product.deliveryRegions) {
      if (!grouped.has(rule)) grouped.set(rule, { productNumbers: [], productNames: [] });
      grouped.get(rule)?.productNumbers.push(product.productNumber);
      grouped.get(rule)?.productNames.push(product.name);
    }
  }

  const known = DELIVERY_RULE_ORDER.map((rule) => ({
    rule,
    productNumbers: grouped.get(rule)?.productNumbers ?? [],
    productNames: grouped.get(rule)?.productNames ?? [],
  })).filter((group) => group.productNumbers.length > 0);
  const extras = [...grouped.entries()]
    .filter(([rule]) => !DELIVERY_RULE_ORDER.includes(rule as DeliveryRule))
    .map(([rule, productsForRule]) => ({ rule, ...productsForRule }));
  return [...known, ...extras];
}

function readPngDimensions(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 24 || view.getUint32(0) !== 0x89504e47) return undefined;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readJpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: (bytes[offset + 5] << 8) + bytes[offset + 6],
        width: (bytes[offset + 7] << 8) + bytes[offset + 8],
      };
    }
    if (length < 2) break;
    offset += length + 2;
  }

  return undefined;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function fetchImageAsset(source: string): Promise<PreparedImageAsset | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await pptFetch(source, {
      headers: { Accept: "image/jpeg,image/png" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const bytes = new Uint8Array(await response.arrayBuffer());
    const dimensions = readPngDimensions(bytes) ?? readJpegDimensions(bytes);
    if (!dimensions) throw new Error("无法识别图片尺寸");

    const mime = response.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    return {
      data: `data:${mime};base64,${bytesToBase64(bytes)}`,
      width: dimensions.width,
      height: dimensions.height,
      source,
    };
  } catch (error) {
    console.warn(`[PPT] 图片加载失败，将使用占位符: ${source}`, error);
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export function loadImageAsset(source?: string) {
  if (!source) return Promise.resolve(undefined);
  if (!imageCache.has(source)) imageCache.set(source, fetchImageAsset(source).then((asset) => {
    // Transient failures must be retried on the next export.
    if (!asset) imageCache.delete(source);
    return asset;
  }));
  return imageCache.get(source) as Promise<PreparedImageAsset | undefined>;
}

export async function preloadImages(sources: Array<string | undefined>) {
  const uniqueSources = [...new Set(sources.filter((source): source is string => Boolean(source)))];
  const assets = new Map<string, PreparedImageAsset>();
  const warnings: string[] = [];
  const concurrency = 6;

  for (let index = 0; index < uniqueSources.length; index += concurrency) {
    const batch = uniqueSources.slice(index, index + concurrency);
    const loaded = await Promise.all(batch.map((source) => loadImageAsset(source)));
    loaded.forEach((asset, assetIndex) => {
      if (asset) assets.set(batch[assetIndex], asset);
      else warnings.push(`图片不可用：${batch[assetIndex]}`);
    });
  }

  return { assets, warnings };
}

export function getImageSizingContain(asset: PreparedImageAsset, box: ImageBox, padding = 0, allowUpscale = true) {
  const availableWidth = Math.max(0.01, box.w - padding * 2);
  const availableHeight = Math.max(0.01, box.h - padding * 2);
  // 120 PPI is a conservative PowerPoint display target. Small source images stay sharp instead of filling the box.
  const maximumScale = allowUpscale ? Number.POSITIVE_INFINITY : 1 / 120;
  const scale = Math.min(availableWidth / asset.width, availableHeight / asset.height, maximumScale);
  const width = asset.width * scale;
  const height = asset.height * scale;

  return {
    data: asset.data,
    x: box.x + (box.w - width) / 2,
    y: box.y + (box.h - height) / 2,
    w: width,
    h: height,
  } satisfies PptxGenJS.ImageProps;
}

export function getImageSizingCrop(asset: PreparedImageAsset, box: ImageBox) {
  const coverScale = Math.max(box.w / asset.width, box.h / asset.height);
  const renderedWidth = asset.width * coverScale;
  const renderedHeight = asset.height * coverScale;
  return {
    data: asset.data,
    x: box.x,
    y: box.y,
    // PptxGenJS calculates its native crop from the picture object's initial
    // aspect ratio, then replaces the object bounds with sizing.w / sizing.h.
    // Keeping the virtual picture at its rendered aspect ratio avoids the
    // stretched output produced by passing the frame dimensions here.
    w: renderedWidth,
    h: renderedHeight,
    sizing: {
      type: "crop",
      x: Math.max(0, (renderedWidth - box.w) / 2),
      y: Math.max(0, (renderedHeight - box.h) / 2),
      w: box.w,
      h: box.h,
    },
  } satisfies PptxGenJS.ImageProps;
}

/**
 * Maps the preview's `object-fit + translate + scale` behavior to a native
 * PowerPoint crop whenever the transformed picture covers the full frame.
 * PowerPoint does not inherit the browser container's overflow clipping, so
 * enlarging the picture object itself would otherwise cover adjacent content.
 */
export function getTransformedImageSizing(
  asset: PreparedImageAsset,
  box: ImageBox,
  fit: ProductImageOverride["fit"],
  allowUpscale: boolean,
  transform: ProductImageOverride,
): PptxGenJS.ImageProps | undefined {
  const zoom = Math.max(0.5, Math.min(2.5, transform.scale));
  const baseSizing = fit === "cover"
    ? (() => {
        const scale = Math.max(box.w / asset.width, box.h / asset.height);
        return { w: asset.width * scale, h: asset.height * scale };
      })()
    : getImageSizingContain(asset, box, 0.08, allowUpscale);
  const baseWidth = Number(baseSizing.w);
  const baseHeight = Number(baseSizing.h);
  const requestedWidth = baseWidth * zoom;
  const requestedHeight = baseHeight * zoom;

  // A native crop reproduces the browser's clipped zoom without allowing the
  // picture object itself to extend into the content or price columns.
  if (requestedWidth >= box.w - 0.001 && requestedHeight >= box.h - 0.001) {
    const maximumCropX = Math.max(0, requestedWidth - box.w);
    const maximumCropY = Math.max(0, requestedHeight - box.h);
    const cropX = Math.min(
      maximumCropX,
      Math.max(0, maximumCropX / 2 - box.w * transform.offsetX / 100),
    );
    const cropY = Math.min(
      maximumCropY,
      Math.max(0, maximumCropY / 2 - box.h * transform.offsetY / 100),
    );
    return {
      data: asset.data,
      x: box.x,
      y: box.y,
      w: requestedWidth,
      h: requestedHeight,
      sizing: {
        type: "crop",
        x: cropX,
        y: cropY,
        w: box.w,
        h: box.h,
      },
    } satisfies PptxGenJS.ImageProps;
  }

  // If only one axis would overflow, keep the largest proportional picture
  // that still stays inside the frame. Offsets are clamped for the same reason.
  const safeZoom = Math.min(zoom, box.w / baseWidth, box.h / baseHeight);
  const width = baseWidth * safeZoom;
  const height = baseHeight * safeZoom;
  const desiredX = box.x + (box.w - width) / 2 + box.w * transform.offsetX / 100;
  const desiredY = box.y + (box.h - height) / 2 + box.h * transform.offsetY / 100;
  const x = Math.min(box.x + box.w - width, Math.max(box.x, desiredX));
  const y = Math.min(box.y + box.h - height, Math.max(box.y, desiredY));
  return { data: asset.data, x, y, w: width, h: height } satisfies PptxGenJS.ImageProps;
}

export function addBusinessHeader(context: LayoutContext, title: string, sectionLabel: string) {
  const { pptx, slide, theme, currentSlide, totalSlides, meta } = context;
  const solid = theme.decoration.headerStyle === "solid" || theme.decoration.headerStyle === "ornamental";
  const foreground = solid ? theme.colors.onPrimary : theme.colors.textPrimary;
  const muted = solid ? theme.colors.onPrimaryMuted : theme.colors.textSecondary;
  const localStyle = currentSlide.editor?.styleOverrides;
  const headerTokens = slideLayout.header;
  const headerColumns = [headerTokens.columns.brand, headerTokens.columns.label, headerTokens.columns.title, headerTokens.columns.page];
  const headerContentWidth = slideLayout.width - slideLayout.slidePadding * 2;
  const headerColumnUnit = headerContentWidth / headerColumns.reduce((sum, value) => sum + value, 0);
  const headerBoxes = headerColumns.map((column, index) => ({
    x: slideLayout.slidePadding + headerColumns.slice(0, index).reduce((sum, value) => sum + value, 0) * headerColumnUnit,
    w: column * headerColumnUnit,
  }));
  const headerBox = { x: 0, y: 0, w: slideLayout.width, h: slideLayout.headerHeight };
  const headerParent = [{ id: "header.group", box: headerBox }];
  addCanvasShape(context, "header.group", pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: slideLayout.width,
    h: slideLayout.headerHeight,
    line: { color: solid ? theme.colors.primary : theme.colors.border, transparency: solid ? 100 : 0, pt: solid ? 0 : 0.6 },
    fill: { color: solid ? theme.colors.primary : theme.colors.background, transparency: solid ? 0 : 100 },
  });
  if (!solid) {
    slide.addShape(pptx.ShapeType.line, { x: slideLayout.slidePadding, y: slideLayout.headerHeight - 0.02, w: slideLayout.width - slideLayout.slidePadding * 2, h: 0, line: { color: theme.colors.border, pt: 0.7 } });
  }
  addCanvasText(context, "header.brand", getEffectiveBrand(meta), {
    x: headerBoxes[0].x,
    y: 0,
    w: headerBoxes[0].w,
    h: slideLayout.headerHeight,
    fontFace: theme.fonts.title,
    fontSize: headerTokens.brandFontSize,
    bold: true,
    charSpacing: headerTokens.brandFontSize * 0.08,
    color: foreground,
    margin: 0,
    valign: "middle",
  }, headerParent);
  addCanvasText(context, "header.label", sectionLabel, {
    x: headerBoxes[1].x,
    y: 0,
    w: headerBoxes[1].w,
    h: slideLayout.headerHeight,
    fontFace: theme.fonts.number,
    fontSize: headerTokens.labelFontSize,
    charSpacing: headerTokens.labelFontSize * 0.16,
    color: muted,
    margin: 0,
    valign: "middle",
  }, headerParent);
  addCanvasText(context, "header.title", currentSlide.editor?.customTitle || title, {
    x: headerBoxes[2].x,
    y: 0,
    w: headerBoxes[2].w,
    h: slideLayout.headerHeight,
    fontFace: theme.fonts.title,
    fontSize: headerTokens.titleFontSize,
    bold: (localStyle?.titleFontWeight ?? 700) >= 600,
    align: "center",
    color: solid ? foreground : localStyle?.titleColor?.replace(/^#/, "") || foreground,
    margin: 0,
    fit: "shrink",
    valign: "middle",
  }, headerParent);
  if (localStyle?.showPageNumber !== false) addCanvasText(context, "header.page", `${String(currentSlide.pageNumber).padStart(2, "0")} / ${String(totalSlides).padStart(2, "0")}`, {
    x: headerBoxes[3].x,
    y: 0,
    w: headerBoxes[3].w,
    h: slideLayout.headerHeight,
    fontFace: theme.fonts.number,
    fontSize: headerTokens.pageFontSize,
    bold: true,
    align: "right",
    color: foreground,
    margin: 0,
    valign: "middle",
  }, headerParent);
}

export function addSlideFooter(context: LayoutContext) {
  const { slide, theme, meta, currentSlide, totalSlides } = context;
  if (theme.decoration.showFooterLine) slide.addShape(context.pptx.ShapeType.line, {
      x: slideLayout.slidePadding,
      y: 7.18,
      w: slideLayout.width - slideLayout.slidePadding * 2,
      h: 0,
      line: { color: theme.colors.border, pt: 0.6 },
    });
  addCanvasText(context, "footer.text", `${meta.year} ${meta.projectName} · ${meta.tierName}`, {
    x: slideLayout.slidePadding,
    y: 7.23,
    w: 5,
    h: 0.13,
    fontFace: theme.fonts.body,
    fontSize: 6.5,
    color: theme.colors.secondaryText,
    charSpacing: 0.5,
    margin: 0,
  });
  if (theme.decoration.showPageNumber && currentSlide.editor?.styleOverrides?.showPageNumber !== false) slide.addText(`${String(currentSlide.pageNumber).padStart(2, "0")} / ${String(totalSlides).padStart(2, "0")}`, {
    x: slideLayout.width - 1.55,
    y: 7.22,
    w: 1.05,
    h: 0.14,
    fontFace: theme.fonts.number,
    fontSize: 6.5,
    color: theme.colors.secondaryText,
    align: "right",
    margin: 0,
  });
}

export function addImageOrPlaceholder(
  context: LayoutContext,
  source: string | undefined,
  box: ImageBox,
  mode: "contain" | "crop" = "contain",
  allowUpscale = true,
  transform?: ProductImageOverride,
  elementId?: string,
) {
  const { pptx, slide, theme, assets } = context;
  const asset = source ? assets.get(source) : undefined;
  if (source && !asset) context.imageFailures?.add(source);

  slide.addShape(pptx.ShapeType.rect, {
    ...box,
    objectName: elementId ? `folio:${elementId}.background` : undefined,
    line: { color: theme.colors.border, pt: 0.5 },
    fill: { color: theme.colors.imageArea },
  });

  if (asset) {
    const sizing = transform
      ? getTransformedImageSizing(asset, box, transform.fit, allowUpscale, transform)
      : mode === "crop" ? getImageSizingCrop(asset, box) : getImageSizingContain(asset, box, 0.08, allowUpscale);
    if (!sizing) return;
    slide.addImage(elementId ? { ...sizing, objectName: `folio:${elementId}` } : sizing);
    return;
  }

  slide.addText("×", {
    x: box.x,
    y: box.y + box.h * 0.29,
    w: box.w,
    h: box.h * 0.34,
    fontFace: theme.fonts.number,
    fontSize: 31,
    color: theme.colors.border,
    align: "center",
    margin: 0,
  });
  slide.addText("暂无商品图片", {
    x: box.x,
    y: box.y + box.h * 0.73,
    w: box.w,
    h: 0.2,
    fontFace: theme.fonts.body,
    fontSize: 8,
    color: theme.colors.secondaryText,
    align: "center",
    margin: 0,
  });
}

export function addSourceNotes(slide: PptxGenJS.Slide, sources: Array<string | undefined>) {
  const uniqueSources = [...new Set(sources.filter((source): source is string => Boolean(source)))];
  if (!uniqueSources.length) return;
  slide.addNotes(`[Sources]\n${uniqueSources.map((source) => `- ${source}`).join("\n")}`);
}
