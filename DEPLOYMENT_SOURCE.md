# 部署说明

## 统一启动入口

复制 `design-agent.env.example` 为 `design-agent.env`，设置数据库密码、内部服务令牌和存储目录。

Windows 使用根目录脚本：

```powershell
.\setup-agent-env.bat
.\start-windows.bat
.\stop-windows.bat
```

也可直接使用根目录 Docker 编排：

```powershell
docker compose --env-file design-agent.env -f docker-compose.agent.yml up -d --build
```

编排包含 MySQL、Temporal、主应用及 PPT 服务。数据库初始化脚本位于 `ops/mysql/`，保留相应挂载。

## 账号与模型服务

首次访问 `/admin/setup` 创建管理员。普通账号注册后由管理员审核，在 API 设置中填写自己的模型服务地址和密钥，或配置 ComfyUI。

## 数据存储

应用数据使用 MySQL，媒体文件保存到配置的文件目录或对象存储。部署时配置持久化目录并定期备份；程序更新时保留数据库和媒体数据。

环境文件、密钥与运行数据保存在部署环境，不提交到 Git。

## 反向代理

Nginx 示例位于 `ops/nginx/lingdraw.example.conf`，按环境设置域名和 HTTPS。浏览器通过主应用同域 `/ppt/` 访问 PPT，独立 PPT 服务保持在内部网络。
