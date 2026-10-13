# 灵绘 PPT 项目管理与云端持久化

## 架构

- Next.js Route Handlers 只负责解析请求、读取当前用户并返回 HTTP 状态。
- `src/server/projects` 负责 Project Summary、Project Detail、Product/Design/Editor State 的分表读写和 revision 并发保护。
- `src/server/assets` 负责 Asset 权限、数据库元数据与 Storage Provider 的一致性。
- `src/server/versions` 只在手动保存、导出或恢复前建立快照，自动保存不生成版本。
- `src/lib/storage` 提供 Local / S3 两种适配器，业务层不依赖具体云厂商。
- `CloudProjectProvider` 将服务器项目还原到现有 Zustand Store，再复用原有 Slide Engine、HTML Preview 和 PptxGenJS Export。

## 本地启动

1. `cp .env.example .env`，设置 `PPT_INTERNAL_TOKEN`、`PPT_DATABASE_URL` 与 `PPT_STORAGE_PATH`。
2. 启动独立的 `ppt-postgres` 数据库。
3. `npm run db:migrate`
4. `npm run db:seed`
5. `npm run dev`
6. 通过灵绘主站的 `/ppt/projects` 访问；身份由灵绘反向代理注入，PPT 不提供独立账号或密码。

`STORAGE_PROVIDER=local` 时文件保存在 `PPT_STORAGE_PATH`；正式环境可切换为 `s3` 并配置 S3/R2/MinIO 参数。

## 数据库

- 新建开发迁移：`npm run db:migrate -- --name <name>`
- 生产应用已提交迁移：`npm run db:deploy`
- 重新生成 Prisma Client：`npm run db:generate`
- 检查数据：`npm run db:studio`
- 云端集成测试：`npm run test:cloud`

## 保存规则

- 普通编辑停止 1000ms 后自动保存。
- 每次写入携带 `expectedRevision`；过期请求返回 `409 REVISION_CONFLICT`。
- 同一浏览器内保存串行执行，保存中的新更改会进入下一轮，不会被旧请求覆盖。
- 断网后保留 dirty state，网络恢复会重试。
- data/blob 图片在保存前先上传为 Asset，数据库和版本快照只保存 Asset ID 引用。
