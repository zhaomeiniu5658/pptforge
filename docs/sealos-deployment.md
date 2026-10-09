# PPT 智造：腾讯云 TCR → Sealos

## 本次准备结果

- 目标 Sealos：杭州 `https://hzh.sealos.run`，工作区 `ns-udky0j90`。
- TCR：`ccr.ccs.tencentyun.com/tenvoice`，三个独立私有仓库。
- 版本：`20260930-e907b7f`，平台 `linux/amd64`。
- 镜像名：`ppt-creation-web`、`ppt-creation-api`、`ppt-creation-tools`；Worker 复用 API 镜像。
- Sealos 应用尚未创建：等待 kompose 安装确认及首次部署的数据处理选择。

## 构建与推送

凭据使用 Docker credential helper；不要写入脚本、Dockerfile、构建参数或 Git。

```bash
docker login ccr.ccs.tencentyun.com
TCR_NAMESPACE=tenvoice IMAGE_VERSION=20260930-e907b7f bash scripts/build-tcr.sh
```

Docker Hub 不可达时可以显式选择可用的基础镜像镜像站：

```bash
TCR_NAMESPACE=tenvoice \
NODE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim \
NGINX_IMAGE=docker.m.daocloud.io/library/nginx:1.27-alpine \
PYTHON_IMAGE=docker.m.daocloud.io/library/python:3.12-slim \
bash scripts/build-tcr.sh
```

脚本默认推送，`BUILD_ACTION=load` 可仅构建到本地。每次更新使用新版本号。

## 运行契约

| 组件 | 命令/端口 | 存储和依赖 |
| --- | --- | --- |
| web | Nginx，80 | `/api/` 转发 API；唯一公网入口 |
| api | Alembic 迁移后启动 Uvicorn，8011 | PostgreSQL、队列、渲染服务、`/data/assets` |
| worker | `celery -A quark.tasks:celery worker --loglevel=info --concurrency=2` | 等待迁移完成；与 API 共享 `/data/assets` |
| tools | `node services/render-tools/src/server.js`，8012 | Chromium、中文字体；仅集群内部访问 |
| PostgreSQL | 5432 | 独立 KubeBlocks 数据库、持久卷 |
| Redis | 6379 | 独立 KubeBlocks 队列、持久卷 |

Sealos 服务名需按实例名生成；通过 Nginx ConfigMap 将 `api:8011` 改为实际 API Service。API 和 Worker 的共享卷必须在同一节点可访问，不能各自创建空卷而丢失共享文件语义。

运行时 Secret：`PGPASSWORD`、`TOOL_SECRET`、`MODEL_ENCRYPTION_KEY`、`BOOTSTRAP_ADMIN_PASSWORD`，以及实际使用的模型凭据。通过私有仓库拉取 Secret 注入 TCR 登录凭据。

运行时配置：`PGHOST/PGPORT/PGDATABASE/PGUSER/PGSSLMODE`、`DATABASE_SCHEMA`、`BROKER_URL`、`TOOL_URL`、`STORAGE_ROOT=/data/assets`、`SOFFICE_PATH=/usr/bin/soffice`、`WEB_ORIGIN`、`COOKIE_SECURE`。Redis 启用认证时必须注入对应密码。

HTTPS 公网地址写入 `WEB_ORIGIN` 并设置 `COOKIE_SECURE=true`。优先使用 Sealos 分配的公网地址，无需自备域名或 DNS。不能将集群内部 ClusterIP 当作公网访问 IP。

渲染服务 `/health` 也需要 `x-tool-secret` 请求头；使用读取环境变量的 exec 探针，不将实际密钥写进探针配置。Worker 不使用 API 的 HTTP 探针。

## 已完成的本地验证

三个 amd64 镜像均成功构建。隔离容器验证：数据库迁移达到 `0006`；API 健康、管理员登录、个人信息、项目、模板、PPT 方案库均返回 200；Chromium 成功渲染中文测试页。13 项 HTML 引擎测试通过。本地验证不代表 Sealos 公网部署验收通过。

## 首次数据与后续更新

首次部署需明确选择迁移现有数据或全新初始化。迁移时先备份本地数据库和资产，并保留原 `MODEL_ENCRYPTION_KEY`（未显式设置时保留其回退用的 `TOOL_SECRET`），否则已有模型配置无法解密。不得将本地数据库地址直接带到云端。

后续更新：构建新版本 → 推送 TCR → 备份数据库、资产及加密根密钥 → 更新同一 Sealos 应用镜像 → 检查迁移、登录、上传、渲染、导出、日志和事件。保留原 Service、Ingress、公网域名和 PVC；更新前记录旧镜像 digest，并评估数据库迁移能否回滚。
