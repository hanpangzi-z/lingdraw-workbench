"use client";

import { ImagePlus, Star, X } from "lucide-react";
import { productCategories } from "@/data/catalog";
import { parseDeliveryRules, parseImageSources, parsePrice } from "@/src/lib/excel/cleaners";
import { getProductImages } from "@/src/lib/catalog/images";
import { UNCATEGORIZED_ID } from "@/src/lib/excel/transform";
import { validateProduct } from "@/src/lib/excel/validation";
import { useProjectStore } from "@/src/store/projectStore";
import { useBatchStore } from "@/src/store/batchStore";
import type { Product } from "@/types/catalog";
import { ProductAISuggestions } from "./ProductAISuggestions";

export function ProductDrawer({ product, onClose }: { product: Product; onClose: () => void }) {
  const basicMode = useBatchStore((state) => state.generationMode) === "single";
  const updateProduct = useProjectStore((state) => state.updateProduct);
  const updateProductPrice = useProjectStore((state) => state.updateProductPrice);
  const validation = validateProduct(product);
  const images = getProductImages(product);
  const remoteImageSources = images.filter((source) => !source.startsWith("data:") && !source.startsWith("blob:"));
  const embeddedImageSources = images.filter((source) => source.startsWith("data:") || source.startsWith("blob:"));

  const updateImages = async (files?: FileList | null) => {
    if (!files?.length) return;
    const sources = await Promise.all([...files].map((file) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    })));
    const nextImages = [...images, ...sources];
    const firstBitmap = !images.length && files[0] ? await createImageBitmap(files[0]).catch(() => undefined) : undefined;
    updateProduct(product.id, {
      image: nextImages[0],
      images: nextImages,
      imageMetadata: firstBitmap ? { width: firstBitmap.width, height: firstBitmap.height } : product.imageMetadata,
    });
    firstBitmap?.close();
  };

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="product-drawer" aria-label={`编辑 ${product.name || "未命名商品"}`}>
        <header>
          <div><span>{basicMode ? `套餐 ${product.productNumber}` : `NO.${product.productNumber}`}</span><h2>{basicMode ? "编辑套餐" : "编辑商品"}</h2><p>{basicMode ? `${product.components?.length ?? 0} 个商品 · ${images.length} 张图片` : product.sku || "SKU 待补充"}</p></div>
          <button type="button" onClick={onClose} aria-label="关闭编辑抽屉"><X aria-hidden="true" /></button>
        </header>

        <div className={`drawer-validation is-${validation.status}`}><strong>{validation.status === "valid" ? "数据完整" : validation.status === "error" ? "存在阻断问题" : "需要确认"}</strong><span>{validation.messages.join(" · ") || "所有关键字段均已填写"}</span></div>

        <ProductAISuggestions product={product} />

        <button className={`drawer-featured-toggle ${product.featured ? "is-active" : ""}`} type="button" onClick={() => updateProduct(product.id, { featured: !product.featured })}><Star aria-hidden="true" /><span><strong>{product.featured ? "已标记为精选商品" : "标记为精选商品"}</strong><small>智能排版会优先使用单品精选版式</small></span></button>

        <div className="drawer-form">
          {!basicMode && <div className="drawer-form-row"><label>SKU<input value={product.sku} onChange={(event) => updateProduct(product.id, { sku: event.target.value, packageCode: event.target.value })} /></label><label>NO.<input value={product.productNumber} disabled /></label></div>}
          <label>{basicMode ? "套餐名称" : "商品名称"}<input value={product.name} onChange={(event) => updateProduct(product.id, { name: event.target.value })} /></label>
          {basicMode && <label>商品名称<textarea rows={Math.max(3, Math.min(8, product.components?.length ?? 3))} value={product.components?.map((component) => component.name).join("\n") ?? ""} placeholder="一行一个商品" onChange={(event) => { const names = event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean); updateProduct(product.id, { components: names.map((name, index) => ({ name, details: product.components?.[index]?.details ?? [], marketPrice: product.components?.[index]?.marketPrice })) }); }} /><small>同一套餐内的多个商品名称分行保存。</small></label>}
          <label>商品明细<textarea rows={8} value={product.details.join("\n")} onChange={(event) => updateProduct(product.id, { details: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) })} /><small>一行代表一个商品组成。</small></label>
          <div className="drawer-form-row"><label>市场价<input inputMode="decimal" value={product.price.market ?? ""} onChange={(event) => updateProductPrice(product.id, { market: parsePrice(event.target.value) })} /></label><label>组合价<input inputMode="decimal" value={product.price.package ?? ""} onChange={(event) => updateProductPrice(product.id, { package: parsePrice(event.target.value) })} /></label></div>
          {!basicMode && <label>商品分类<select value={product.categoryId} onChange={(event) => updateProduct(product.id, { categoryId: event.target.value as Product["categoryId"] })}><option value={UNCATEGORIZED_ID}>未分类</option>{productCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>}
          {!basicMode && <label>配送区域<input value={product.deliveryRegions.join("；")} onChange={(event) => updateProduct(product.id, { deliveryRegions: parseDeliveryRules(event.target.value) })} /><small>多条规则使用分号分隔。</small></label>}
          <label>外部图片地址<textarea rows={3} value={remoteImageSources.join("\n")} placeholder="https://... 一行一张" onChange={(event) => { const nextImages = [...embeddedImageSources, ...parseImageSources(event.target.value)]; updateProduct(product.id, { image: nextImages[0], images: nextImages, imageMetadata: nextImages[0] === product.image ? product.imageMetadata : undefined }); }} /><small>{embeddedImageSources.length ? `Excel 内嵌图片 ${embeddedImageSources.length} 张已保留；此处只编辑外部链接。` : "支持多张图片，一行一张。"}</small></label>
          <label className="drawer-image-upload"><ImagePlus aria-hidden="true" /><span><strong>上传本地图片</strong><small>可一次选择多张，会追加到当前商品</small></span><input type="file" accept="image/png,image/jpeg" multiple onChange={(event) => void updateImages(event.target.files)} /></label>
          {images.length > 0 && <div className={`drawer-image-preview image-count-${Math.min(images.length, 4)}`}>{images.map((source, index) => <img src={source} alt={`${product.name} ${index + 1}`} key={index} />)}</div>}
        </div>

        <footer><button className="primary-action" type="button" onClick={onClose}>完成编辑</button></footer>
      </aside>
    </div>
  );
}
