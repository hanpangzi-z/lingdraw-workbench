import { imageUrl } from "@/data/catalog";
import type { DeliveryRule, Product, ProductCategoryId } from "@/types/catalog";

interface ProductSeed {
  name: string;
  categoryId: ProductCategoryId;
  imageId?: string;
  details: string[];
  market?: number;
  regions: DeliveryRule[];
}

const productSeeds: ProductSeed[] = [
  { name: "五常稻花香大米组合", categoryId: "grain-seasoning", imageId: "photo-1536304993881-ff6e9eefa2a6", details: ["五常核心产区", "当季新米", "5kg 真空装"], market: 168, regions: ["全国配送 A 类"] },
  { name: "赣南冷榨山茶油双瓶礼", categoryId: "grain-seasoning", imageId: "photo-1474979266404-7eaacbcd87c5", details: ["低温物理压榨", "一级食用油", "750ml×2 瓶"], market: 198, regions: ["全国配送 B 类"] },
  { name: "五色杂粮轻食组合", categoryId: "grain-seasoning", imageId: "photo-1574323347407-f5e1ad6d020b", details: ["五种谷物搭配", "独立真空包装", "净含量 2.4kg"], market: 139, regions: ["全国配送 A 类"] },
  { name: "厨房基础调味七件套", categoryId: "grain-seasoning", imageId: "photo-1532336414038-cf19250c5757", details: ["生抽 500ml", "老抽 500ml", "香醋 500ml", "蚝油 510g", "芝麻油 220ml", "海盐 300g", "白砂糖 400g", "礼盒包装"], market: 156, regions: ["全国配送 B 类", "按招标文件执行"] },
  { name: "河套雪花粉与手工面组合", categoryId: "grain-seasoning", imageId: "photo-1556761223-4c4282c73f77", details: ["高筋雪花粉 2.5kg", "山西手工面 1.5kg"], market: 128, regions: ["全国配送 A 类"] },

  { name: "每日坚果 30 日轻享礼盒", categoryId: "snacks-pastry", imageId: "photo-1599599810769-bcde5a160d32", details: ["六种坚果果干", "每日独立装", "750g 礼盒"], market: 169, regions: ["全国配送 A 类"] },
  { name: "江南传统糕点八味礼", categoryId: "snacks-pastry", imageId: "photo-1558961363-fa8fdf82db35", details: ["八种经典风味", "独立小包装", "净含量 1.2kg"], market: 148, regions: ["全国配送 A 类"] },
  { name: "精品挂耳咖啡风味集", categoryId: "snacks-pastry", imageId: "photo-1495474472287-4d71bcdd2085", details: ["四大产区拼配", "新鲜烘焙研磨", "24 杯礼盒"], market: 138, regions: ["全国配送 A 类"] },
  { name: "丹麦曲奇与华夫饼组合", categoryId: "snacks-pastry", imageId: "photo-1558961363-fa8fdf82db35", details: ["黄油曲奇 600g", "原味华夫饼 480g", "双层礼盒"], market: 149, regions: ["全国配送 B 类"] },
  { name: "高原纯牛奶营养组合", categoryId: "snacks-pastry", imageId: "photo-1550583724-b2692b85b150", details: ["3.6g 乳蛋白", "250ml×16 盒", "常温保存"], market: 128, regions: ["沪浙苏皖闽"] },

  { name: "岭南广式腊味礼盒", categoryId: "braised-food", imageId: "photo-1544025162-d76694265947", details: ["传统日晒工艺", "腊肠腊肉双拼", "净含量 1.5kg"], market: 168, regions: ["全国配送 B 类"] },
  { name: "古法酱香鸭双只装", categoryId: "braised-food", imageId: "photo-1562967914-608f82629710", details: ["整鸭卤制", "咸甜酱香", "两只礼盒装"], market: 158, regions: ["江浙沪皖"] },
  { name: "金陵盐水鸭与桂花鸭组合", categoryId: "braised-food", imageId: "photo-1518492104633-130d0cc84637", details: ["低温慢卤", "两种风味", "净含量 1.4kg"], market: 168, regions: ["江浙沪"] },
  { name: "五香牛肉熟食礼盒", categoryId: "braised-food", imageId: "photo-1546833999-b9f581a1996d", details: ["精选牛腱", "独立真空装", "净含量 800g"], market: 179, regions: ["沪浙苏皖闽"] },
  { name: "潮汕卤味合家欢", categoryId: "braised-food", imageId: "photo-1601050690597-df0568f70950", details: ["卤鹅与卤蛋组合", "加热即食", "净含量 1.3kg"], market: 158, regions: ["按招标文件执行"] },

  { name: "M3 谷饲原切牛排组合", categoryId: "fresh-meat", imageId: "photo-1603048297172-c92544798d5a", details: ["西冷与眼肉组合", "独立真空分装", "净含量 1kg"], market: 198, regions: ["沪浙苏皖闽"] },
  { name: "生态黑猪肉家宴组合", categoryId: "fresh-meat", imageId: "photo-1602470520998-f4a52199a3d6", details: ["黑猪慢养", "五花与梅花组合", "净含量 1.5kg"], market: 168, regions: ["江浙沪皖"] },
  { name: "清远走地鸡双拼", categoryId: "fresh-meat", imageId: "photo-1587593810167-a84920ea0781", details: ["山林散养", "冰鲜锁味", "两只约 2.2kg"], market: 158, regions: ["江浙沪"] },
  { name: "东海海捕大虾家庭装", categoryId: "fresh-meat", imageId: "photo-1565680018434-b513d5e5fd47", details: ["海捕鲜冻", "约 20–24 只/kg", "净含量 1.2kg"], market: 188, regions: ["沪浙苏皖闽"] },
  { name: "可生食鲜鸡蛋礼盒", categoryId: "fresh-meat", imageId: "photo-1506976785307-8732e854ad03", details: ["无抗养殖", "可生食标准", "30 枚礼盒装"], market: 138, regions: ["江浙沪皖"] },

  { name: "IH 多功能智能电饭煲 3L", categoryId: "kitchen-appliance", imageId: "photo-1585515320310-259814833e62", details: ["3L 黄金容量", "8 大菜单", "预约烹饪"], market: 269, regions: ["全国配送 B 类"] },
  { name: "316L 不锈钢保温电热水壶", categoryId: "kitchen-appliance", imageId: "photo-1585515320310-259814833e62", details: ["1.5L 容量", "双层防烫", "自动断电"], market: 159, regions: ["全国配送 A 类"] },
  { name: "麦饭石不粘炒锅 32cm", categoryId: "kitchen-appliance", imageId: "photo-1593618998160-e34014e67546", details: ["32cm 大口径", "少油不易粘", "燃气电磁炉通用"], market: 199, regions: ["全国配送 B 类"] },
  { name: "破壁料理机 ProMix X7", categoryId: "kitchen-appliance", imageId: "photo-1570222094114-d054a817e56b", details: ["800W 高速电机", "冷热双杯", "六叶精钢刀组", "豆浆模式", "果蔬模式", "研磨模式", "一键自清洁", "中英双语面板"], market: 299, regions: ["全国配送 B 类"] },
  { name: "家用精钢刀具砧板六件套", categoryId: "kitchen-appliance", imageId: "photo-1593618998160-e34014e67546", details: ["三把精钢刀具", "分类砧板", "厨房剪与收纳座"], market: 169, regions: ["全国配送 A 类"] },

  { name: "桌面静音加湿器 3.8L", categoryId: "home-appliance", imageId: "photo-1585771724684-38269d6639fd", details: ["3.8L 大水箱", "静音运行", "缺水自动保护"], market: 169, regions: ["全国配送 A 类"] },
  { name: "循环空气轻音风扇", categoryId: "home-appliance", imageId: "photo-1585771724684-38269d6639fd", details: ["三档风量", "上下左右摇头", "低噪节能"], market: 189, regions: ["全国配送 B 类"] },
  { name: "折叠阅读护眼台灯", categoryId: "home-appliance", imageId: "photo-1507473885765-e6ed057f782c", details: ["无频闪光源", "三档色温", "USB-C 供电"], market: 149, regions: ["全国配送 A 类"] },
  { name: "AI 智能蓝牙音箱 Voice Mini 2 代家庭娱乐版", categoryId: "home-appliance", imageId: "photo-1608043152269-423dbba4e7e1", details: ["蓝牙 5.3", "双单元立体声", "12 小时续航", "语音助手", "Type-C 快充"], market: 199, regions: ["全国配送 B 类", "按招标文件执行"] },

  { name: "酵素浓缩洗衣液家庭装", categoryId: "daily-care", imageId: "photo-1583947215259-38e31be8751f", details: ["深层去渍", "低泡易漂", "2kg×2 瓶"], market: 139, regions: ["全国配送 A 类"] },
  { name: "天然植萃洗发护发沐浴三件套", categoryId: "daily-care", imageId: "photo-1556228578-8c89e6adf883", details: ["洗发水 500ml", "护发素 500ml", "沐浴露 500ml"], regions: ["全国配送 A 类"] },
  { name: "原生竹浆抽纸与卷纸家庭组合", categoryId: "daily-care", details: ["抽纸 24 包", "卷纸 12 卷", "原生竹浆"], market: 129, regions: ["全国配送 B 类"] },
  { name: "敏感肌温和清洁与保湿日常护理礼盒", categoryId: "daily-care", imageId: "photo-1556228720-195a672e8a03", details: ["氨基酸洁面", "舒缓保湿水", "修护乳液", "旅行分装瓶", "洁面巾", "适用敏感肌", "成分说明卡"], market: 199, regions: ["全国配送 A 类", "沪浙苏皖闽", "江浙沪皖", "按招标文件执行"] },
];

export const mockProducts: Product[] = productSeeds.map((seed, index) => ({
  id: `product-${String(index + 1).padStart(2, "0")}`,
  productNumber: String(index + 1).padStart(2, "0"),
  sku: `LP-${String(index + 1).padStart(3, "0")}`,
  packageCode: `SH-100-${String(index + 1).padStart(2, "0")}`,
  name: seed.name,
  image: seed.imageId ? imageUrl(seed.imageId) : undefined,
  details: seed.details,
  price: { currency: "CNY", market: seed.market, package: 100 },
  deliveryRegions: seed.regions,
  categoryId: seed.categoryId,
}));
