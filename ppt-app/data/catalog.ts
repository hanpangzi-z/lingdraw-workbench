import type { CatalogMeta, ProductCategory } from "@/types/catalog";

const image = (id: string) =>
  `https://images.unsplash.com/${id}?fit=crop&w=1200&q=84&fm=jpg`;

export const catalogMeta: CatalogMeta = {
  brand: "乐品福利",
  city: "上海",
  year: 2026,
  priceTier: 100,
  tierName: "100元档位",
  projectName: "上海职工乐品福利方案",
  title: "职工福利套餐产品手册",
  subtitle: "福利优选 · 一价任选",
  edition: "EMPLOYEE BENEFITS / 2026",
  serviceLine: "400 860 2026",
  design: {
    templateId: "business-standard",
    themeId: "business-red",
    themeOverrides: {},
    pageRatio: "16:9",
  },
};

export const productCategories: ProductCategory[] = [
  {
    id: "grain-seasoning",
    name: "粮油调味",
    englishName: "GRAIN & SEASONING",
    description: "主食、食用油与厨房调味组合。",
    coverImage: image("photo-1474979266404-7eaacbcd87c5"),
  },
  {
    id: "snacks-pastry",
    name: "休闲糕点",
    englishName: "SNACKS & PASTRY",
    description: "坚果、烘焙与日常休闲风味。",
    coverImage: image("photo-1558961363-fa8fdf82db35"),
  },
  {
    id: "braised-food",
    name: "卤味熟食",
    englishName: "BRAISED & READY-TO-EAT",
    description: "开袋即享的经典熟食组合。",
    coverImage: image("photo-1544025162-d76694265947"),
  },
  {
    id: "fresh-meat",
    name: "生鲜肉禽",
    englishName: "FRESH MEAT & POULTRY",
    description: "肉禽蛋与冷链生鲜精选。",
    coverImage: image("photo-1607623814075-e51df1bdc82f"),
  },
  {
    id: "kitchen-appliance",
    name: "厨具家电",
    englishName: "KITCHEN APPLIANCES",
    description: "高频实用的厨房电器与器具。",
    coverImage: image("photo-1556911220-bff31c812dba"),
  },
  {
    id: "home-appliance",
    name: "家居家电",
    englishName: "HOME APPLIANCES",
    description: "提升居家舒适度的生活电器。",
    coverImage: image("photo-1586023492125-27b2c045efd7"),
  },
  {
    id: "daily-care",
    name: "日化洗护",
    englishName: "DAILY CARE",
    description: "清洁、洗护与居家消耗用品。",
    coverImage: image("photo-1556228578-8c89e6adf883"),
  },
];

export const imageUrl = image;
