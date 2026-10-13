# 灵绘 PPT 商品、模板与素材资源库

## 1. 数据模型

- `GlobalProduct`：用户长期维护的商品主数据；SKU、名称、规格、价格、分类、品牌、配送规则和主图均保存在此。
- `GlobalProductVersion`：每次重要保存写入一份轻量 JSON 版本，并记录版本号与变更摘要。
- `ProjectProductSnapshot`：继续映射原数据库 `Product` 表，保存项目创建时复制的数据和来源商品版本。
- `ProductAsset`：商品与 Asset 的多图关系，支持 `primary / secondary / detail / package / manual`、排序和主图切换。
- `ProductCategory`、`Brand`、`DeliveryProfile`：分类、品牌和配送规则资源。
- `TemplateDefinition`、`ThemeDefinition`：数据库中的模板配置与主题 token。React 与 PPT Renderer 仍使用经过审核的代码实现。
- `TemplateFavorite`、`BrandKit`：模板收藏和企业品牌方案预留。
- `Asset`：新增系统资源标记，并继续作为项目、商品、模板、品牌和导出文件共用的文件元数据。

## 2. GlobalProduct 与项目商品

项目不会直接读取 `GlobalProduct` 的实时字段。从商品库加入项目时，系统复制关键字段到 `ProjectProductSnapshot`，同时记录 `globalProductId`、`globalProductVersion` 和 `snapshotTakenAt`。因此商品库后续改价、换图或修改规格不会改变已生成项目。

## 3. 商品同步

项目同步接口先比较项目快照版本和商品库当前版本，再生成字段级 Diff。用户可以选择：

- 全部更新；
- 只更新图片；
- 只更新规格；
- 更新除价格外的字段；
- 忽略当前版本。

同步后只覆盖用户选择的字段，并把本次商品库版本标记为已处理。项目中的其他定制字段保持不变。

## 4. 商品库

`/products` 默认使用分页表格，也可切换卡片模式。页面包含统计、全文搜索、分类/品牌/状态/缺图/缺价格筛选、排序、批量导入、批量修改和加入项目。商品抽屉提供多图管理、主图设置、图片排序、商品编辑、项目使用记录和版本历史。

Excel 导入继续复用已有 Excel Parser、表头识别、字段映射与标准 `Product[]` 转换。导入到商品库前再匹配 SKU，并按“跳过、只填空字段、只更新价格、覆盖”策略写入 `GlobalProduct`。

项目导入 Excel、PDF、Word 或 PPT 时，会先按 SKU 查询商品库主图；命中后把商品库主图放在候选图片首位，并保留本次上传匹配到的图片作为备选。未命中才完全沿用本次导入的图片匹配结果，商品库接口异常也不会阻断导入。

## 5. 模板与 Theme

`/templates` 同时展示系统模板和用户模板。数据库只保存模板名称、分类、标签、状态、默认 Theme、稳定 Renderer Key 和布局配置 JSON；不会存储或执行 React/PPT 代码。系统模板只读，用户可复制为个人模板后编辑。

Theme 以 token JSON 资源化，代码中的 `business-red`、`corporate-blue`、`fresh-green`、`minimal-light`、`premium-dark`、`festival-red` 继续作为稳定 fallback。模板应用到项目时，项目同时保存 Template/Theme 的 ID、版本和 JSON 快照，历史项目不会被资源库后续修改破坏。

模板预览由统一 Demo 数据生成 16:9 SVG，包含封面、三商品、双商品和重点商品版式的缩略组合，并以 Asset 缓存。

## 6. Asset 复用、去重与删除保护

所有上传统一进入 `src/server/assets/service.ts`。服务读取文件内容并计算 SHA-256，在同一用户范围内复用内容相同的 Asset；商品、模板和项目不再各自实现存储。

删除前统计项目、项目源文件、项目商品、商品库图片、品牌、模板、品牌方案和导出记录的引用。存在引用时返回冲突和引用数量，不删除数据库记录或存储对象。System Asset 所有人可读，但普通用户不可修改。

## 7. 数据迁移

迁移文件位于 `prisma/migrations/20260831170000_resource_libraries/migration.sql`。原 `Product` 表保留，Prisma 模型升级为 `ProjectProductSnapshot` 并使用 `@@map("Product")`，因此旧项目数据无需复制且不会丢失。新增来源商品和模板快照字段均允许为空，原有项目可继续打开；用户可在编辑器中把旧项目商品“保存到商品库”。

## 8. 搜索、索引与规模

- 商品列表和素材列表使用服务器分页，不一次加载全部记录。
- 商品建立 owner、SKU、分类、品牌、状态、更新时间等 B-tree 索引。
- PostgreSQL 启用 `pg_trgm`，为商品名称、SKU、搜索文本和模板搜索文本建立 GIN trigram 索引。
- 模板建立 scope、owner、分类、状态、系统标记和更新时间索引。
- 集成测试会生成 5,000 个商品、100 套模板和 10,000 个素材并验证分页搜索；当前本地 PostgreSQL 本轮分别为 38ms、10ms、19ms。

## 9. 本地测试

```bash
docker compose up -d ppt-postgres
npm run db:deploy
npm run db:seed
npm run typecheck
npm test
npm run test:cloud
npm run test:library
npm run build
npm run build
```

使用灵绘账号登录后，通过同源 `/ppt` 前缀访问：

- `/ppt/products`
- `/ppt/templates`
- `/ppt/assets`
- `/ppt/projects`

## 10. 当前限制

- 自定义模板配置目前是结构化 JSON 编辑，还不是完整的可视化模板设计器。
- 模板预览是统一 Demo 数据生成的组合缩略图，不是逐页高分辨率截图。
- Asset 去重使用“查询 Hash 后复用”，尚未增加数据库级并发唯一约束；极端并发的相同上传仍可能产生重复记录。
- 旧的重复 Asset 不会在迁移时自动合并，避免错误改写历史引用。
- `BrandKit` 已建模，完整管理界面留待企业组织能力阶段。
- 生产数据库账号需要有创建 `pg_trgm` 扩展的权限，或由 DBA 预先启用。
