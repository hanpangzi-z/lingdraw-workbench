# 灵绘 PPT 迁移功能矩阵

本矩阵把“源码/行为保留”与“依赖真实基础设施的运行验收”分开记录。`PASS` 表示目标仓库已保留实现且有自动化或源码清单证据；`ENV` 表示实现已接通，但最终验收仍需要 PostgreSQL、灵绘 AI 供应商、S3 或桌面 PowerPoint 等外部环境。

| 功能面 | 原功能与迁移入口 | 验证证据 | 状态 |
| --- | --- | --- | --- |
| 手动创建与项目管理 | `/ppt/projects`，创建、复制、重命名、软删除、恢复 | Project Dashboard/Route Handlers 保留；原测试与生产构建通过 | PASS |
| Excel/PDF/Word/旧 PPT 导入 | `/ppt/projects` 新建流程；多 Sheet、内嵌图片、附件、ZIP 与 PDF OCR fallback | parser、workflow 与 OCR fallback 源码保留；解析器单测通过 | PASS |
| 字段识别与数据确认 | 规则匹配、AI 补充、原始预览、来源/SKU 合并、冲突选择、校验与建议接受 | 原 AI/schema/import 单测通过；AI 请求改由内部桥发送且返回再次按原 schema 校验 | PASS |
| 单项目设计设置 | 商品/图片/项目信息、分类分页、智能/强制布局、模板主题、品牌色与字体覆盖 | Store、engine、editor、renderer 全量保留；原单测通过 | PASS |
| PPT 编辑器 | 页面增删/排序/隐藏/恢复、手动页、元素移动缩放、文本样式、图片替换裁切、50 步撤销重做、页面重置 | editor state、history、canvas 与 inspector 源码保留；原单测通过 | PASS |
| PPTX 输出 | 16:9 预览、可编辑文字/形状/图片、全页型、单文件导出与记录 | PptxGenJS renderer/export Route Handlers 保留；原 PPT 单测与生产构建通过 | PASS |
| 批量项目 | 真实组合分组、项目覆盖、共享商品提示、检查/复制/删除/重试、顺序导出与 ZIP | batch store、UI 与 export 实现保留；原单测通过 | PASS |
| 商品库 | 分页搜索、批量导入、多图/版本、项目使用记录及同步 | `/ppt/products` 与全套 API/Prisma 模型保留 | PASS |
| 模板、主题与素材库 | 复制/收藏/应用、主题编辑、素材去重与引用删除保护 | `/ppt/templates`、`/ppt/assets`；5 套模板、6 套主题、6 种布局保留 | PASS |
| 自动保存与并发 | 1 秒防抖、revision 乐观锁、409、断网重试、版本快照/恢复 | CloudProjectContext、项目/版本 API 与原并发测试保留 | PASS |
| 本地/S3 存储 | `PPT_STORAGE_PATH` 本地持久化及 S3 provider；本地核心读取路由 `/ppt/api/storage/local` | 本地 write/read/delete 探针、S3 HeadBucket 短超时探针、引用保护与脱敏健康测试；生产构建包含核心路由 | PASS |
| 灵绘单点登录 | 代理删除外部身份头后注入 token 与用户字段；Next 验 token 并自动建立 shadow user；独立密码登录停用 | token 真伪、身份解码与 shadow email 新增单测；login/register/API 行为已改 | PASS |
| 同源 `/ppt` 接入 | Next `basePath=/ppt`、standalone；浏览器 API/public/worker/asset URL 显式前缀 | basePath 幂等与根路径扫描单测；standalone 对 login、worker、API 实机冒烟 | PASS |
| 灵绘宿主消息 | `studio-theme`、`studio-ui-scale`、`studio-lang`、`studio-activate`、`ppt:ready`、`ppt:auth-required` | 来源/同源校验及消息契约新增测试 | PASS |
| 灵绘 UI | 项目列表、导入/确认/批量、编辑器、商品/模板/素材库、弹窗抽屉均由末级 `lingdraw.css` 统一覆盖；原控件不删除 | 灵绘色值/字体/暗色覆盖与品牌文字静态扫描；生产构建通过 | PASS |
| AI 字段识别/标准化 | POST `/api/ppt/internal/ai/chat`，传原 system/user prompt、response schema 和独立 request ID | bridge URL/身份头/usage/错误 schema 新增单测 | PASS |
| AI 场景图片 | POST `/api/ppt/internal/ai/image` 预扣，素材事务落库后 POST `/api/ppt/internal/ai/image/settle` 成功结算，落库失败按相同 requestId 退款 | bridge wire、`billingStatus=reserved`、MIME/base64、两阶段同决策幂等结算新增单测 | PASS |
| 服务降级与健康 | Next `/ppt/api/health` 报告 service/database/storage；FastAPI 汇总 `/api/ppt/health` | standalone 在 DB 不可用时稳定返回结构化 503，不影响静态资源 | PASS |
| 独立数据库与部署 | `PPT_DATABASE_URL`、Prisma migration/seed；Docker `migrate`/`runner` targets | 生产构建与 Dockerfile 静态契约检查 | PASS |

## 外部环境终验

以下项目不能仅凭源码仓库伪造为完成，部署到联调环境后应记录实测结果：

| 验收项 | 所需环境 | 当前 |
| --- | --- | --- |
| 全格式导入端到端（含真实 OCR 文档） | PostgreSQL、OCR/转换运行时及样本文件 | ENV |
| 真实灵绘 AI 调用、积分预扣/结算/失败退款 | 已配置的灵绘模型与积分账户 | ENV |
| 本地与 S3 双存储全流程 | 可写持久卷及 S3/R2/MinIO 测试桶 | ENV |
| 导出 PPTX 在 Microsoft PowerPoint 中打开并逐元素确认可编辑 | Windows PowerPoint | ENV |
| 亮/暗主题与桌面/窄屏逐页视觉对照 | 完整灵绘宿主、种子数据库与浏览器 | ENV |

## 自动化基线

- 迁移前：15 个测试文件、119 个测试全部通过；TypeScript 检查与 Next 生产构建通过。
- 迁移后：19 个测试文件、156 个测试全部通过（包含原 119 个）；TypeScript 检查与 Next 16.3.3 standalone 生产构建通过。
- 源历史用户、项目、数据库记录及根目录 `storage/` 未复制；系统模板、主题、示例、迁移和功能源码保留。
