import type { ImportTargetField } from "@/types/import";

export interface ImportFieldDefinition {
  key: ImportTargetField;
  label: string;
  required?: boolean;
  description: string;
}

export const IMPORT_FIELD_DEFINITIONS: ImportFieldDefinition[] = [
  { key: "no", label: "序号", description: "套餐顺序；未提供时自动生成" },
  { key: "name", label: "套餐名称", required: true, description: "产品手册页面的主标题" },
  { key: "category", label: "品类", description: "商品所属品类" },
  { key: "brand", label: "品牌", description: "同一套餐内每个商品的品牌" },
  { key: "productName", label: "商品名称", description: "同一套餐内可包含多个商品" },
  { key: "items", label: "商品明细", description: "支持换行及中英文分号" },
  { key: "image", label: "商品图片（高清图）", description: "支持单元格内嵌图片、WPS DISPIMG 与图片链接" },
  { key: "marketPrice", label: "市场价", description: "支持 ¥168、168元等格式" },
  { key: "salePrice", label: "组合价", description: "福利套餐的成交价格" },
  { key: "delivery", label: "可配送区域", description: "可包含多条配送规则" },
];

const PRODUCT_RESOURCE_FIELD_DEFINITIONS: ImportFieldDefinition[] = [
  { key: "sku", label: "SKU / 套餐编号", description: "套餐或产品的唯一识别码" },
];

const BATCH_DIMENSION_FIELD_DEFINITIONS: ImportFieldDefinition[] = [
  { key: "region", label: "地区", description: "批量项目维度，如上海、江苏" },
  { key: "priceTier", label: "价格档位", description: "批量项目档位，如100元、200元" },
  { key: "packageType", label: "套餐类型", description: "批量项目类型，如职工福利" },
  { key: "customerGroup", label: "客户", description: "批量项目适用客户或客户群体" },
];

export const PRODUCT_LIBRARY_IMPORT_FIELD_DEFINITIONS: ImportFieldDefinition[] = [
  ...IMPORT_FIELD_DEFINITIONS,
  ...PRODUCT_RESOURCE_FIELD_DEFINITIONS,
];

export const BATCH_IMPORT_FIELD_DEFINITIONS: ImportFieldDefinition[] = [
  ...PRODUCT_LIBRARY_IMPORT_FIELD_DEFINITIONS,
  ...BATCH_DIMENSION_FIELD_DEFINITIONS,
];

export const FIELD_KEYWORDS: Record<ImportTargetField, string[]> = {
  no: ["no", "序号", "商品序号", "展示序号"],
  sku: ["sku", "套餐编号", "商品编号", "产品编号", "商品编码", "产品编码"],
  name: ["套餐名称", "套餐名", "组合名称", "方案名称", "商品名称", "产品名称", "名称", "品名"],
  productName: ["商品名称", "产品名称", "单品名称", "品名"],
  items: ["商品明细", "商品内容", "套餐内容", "产品内容", "配置", "明细", "规格明细"],
  marketPrice: ["市场价", "零售价", "原价", "建议零售价"],
  salePrice: ["组合价", "套餐价", "售价", "福利价"],
  delivery: ["配送区域", "配送范围", "可配送区域", "可配送范围"],
  category: ["分类", "品类", "商品分类", "产品分类"],
  brand: ["品牌", "商品品牌", "品牌名称"],
  image: ["图片", "商品图片", "产品图片", "图片地址", "图片链接", "image", "imageurl"],
  region: ["地区", "城市", "区域", "省份", "所属地区"],
  priceTier: ["价格档位", "档位", "套餐价格", "价格区间"],
  packageType: ["套餐类型", "方案类型", "福利类型", "项目类型"],
  customerGroup: ["客户", "客户群体", "客户类型", "适用客户", "客户名称"],
};
