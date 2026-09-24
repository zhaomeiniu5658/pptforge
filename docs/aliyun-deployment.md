# 阿里云部署

当前项目最适合部署在一台阿里云 ECS 上，使用阿里云 RDS PostgreSQL 保存业务数据：

```text
浏览器 → ECS web (Nginx:80) → ECS api (仅 Compose 内网)
                                      ├─ RDS PostgreSQL（私网）
                                      ├─ ECS Valkey（仅 Compose 内网）
                                      └─ ECS Chromium 工具（仅 Compose 内网）
```

ECS 上不需要安装 Node 或 Python，只需要 Docker Engine 和 Compose plugin。上传文件保存到 Docker volume；数据库和文件需要分别备份。

## 1. 准备阿里云资源

建议先准备：

1. ECS：Ubuntu 24.04 LTS 或 Alibaba Cloud Linux 3，至少 4 vCPU / 8 GiB；生成 PPTX、截图和 AI 任务较多时使用 8 vCPU / 16 GiB。
2. RDS PostgreSQL：版本 16，创建数据库 `quarkmed` 和应用账号；把 ECS 的安全组私网地址加入 RDS 白名单。RDS 默认 PostgreSQL 端口通常为 `1921`，以控制台实际端口为准。
3. 一个域名（推荐）和 HTTPS 证书。证书可以绑定到阿里云 ALB/证书服务；也可以先用 ECS 公网 IP 验证 HTTP，再切 HTTPS。

ECS 安全组只放行 `22`（建议限制为办公出口 IP）、`80` 和 `443`。不要放行 `8011`、`8012`、`6379` 或 PostgreSQL 端口到公网。

## 2. 安装 Docker 并取得代码

以 ECS 的普通部署用户执行：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
# 重新登录一次，使 docker 用户组生效
git clone <你的代码仓库地址> /opt/quarkmed
cd /opt/quarkmed
```

如果代码仓库尚未推送，可以在本地打包后通过 SCP 上传；不要上传本地 `.env`、`data/` 或 `artifacts/`。

## 3. 配置 RDS 和应用密钥

```bash
cp deploy/aliyun.env.example .env
chmod 600 .env
nano .env
```

至少替换 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`、`TOOL_SECRET`、`WEB_ORIGIN` 和 `BOOTSTRAP_ADMIN_PASSWORD`。`PGHOST` 应填写 RDS 私网地址；`WEB_ORIGIN` 填用户最终访问的完整地址，例如 `https://ppt.example.com`。

`DOCKER_PGHOST=${PGHOST}` 和 `DOCKER_PGPORT=${PGPORT}` 是给 Compose 传入 API/Worker 的数据库地址。若密码包含 `#`、`$` 或空格，按 Compose `.env` 语法正确引用，或使用只含字母、数字和符号的随机密码。

全新部署保留示例中的 `DATABASE_SCHEMA=quarkmed`。如果要迁移当前本地环境，当前数据在 `public` schema 中，先把 `DATABASE_SCHEMA` 改成 `public`，这样数据库 dump 和应用会使用同一 schema；不要让 API 在导入旧数据前运行迁移。

## 4. 迁移本地数据

本地已生成迁移包，目录名类似 `backups/aliyun-migration-20260923-173711/`，其中包含 `database-public.dump` 和 `assets.tar.gz`。将整个目录上传到 ECS，再在目标 RDS 上执行：

```bash
sha256sum -c SHA256SUMS
pg_restore --list database-public.dump | head
```

先在 RDS 控制台创建空数据库和应用账号，并确认账号拥有 `public` schema 的创建、使用和 DDL/DML 权限。停掉 ECS 上的 API/Worker 后，由 DBA 在目标数据库执行：

```bash
pg_restore --no-owner --no-privileges --dbname="$DATABASE_URL" database-public.dump
```

恢复文件到 ECS 的 assets volume：

```bash
docker run --rm -v quarkmed_assets:/data -v "$PWD":/backup alpine \
  sh -c 'rm -rf /data/assets && tar -xzf /backup/assets.tar.gz -C /data'
```

确认 `.env` 中 `STORAGE_ROOT=/data/assets`、`DATABASE_SCHEMA=public`，再启动 API/Worker；登录、项目数量、页面和附件抽查无误后，再启动 web。迁移完成后把备份目录复制到 OSS，并保留 SHA256 校验文件。

## 5. 首次启动

```bash
./scripts/deploy-aliyun.sh
```

首次构建会下载 Chromium、LibreOffice 和字体，可能需要数分钟。API 容器会自动执行 Alembic 迁移、创建 `quarkmed` schema，并在用户表为空时创建 `BOOTSTRAP_ADMIN_PASSWORD` 指定的管理员。

检查状态和日志：

```bash
docker compose -f compose.yaml -f compose.aliyun.yaml --profile full ps
docker compose -f compose.yaml -f compose.aliyun.yaml --profile full logs -f api worker tools web
curl -fsS http://127.0.0.1/api/health
```

确认可以登录后，立即从 `.env` 删除 `BOOTSTRAP_ADMIN_PASSWORD`，再执行：

```bash
docker compose -f compose.yaml -f compose.aliyun.yaml --profile full up -d api worker
```

## 6. 域名和 HTTPS

把域名 A 记录指向 ECS 公网 IP。生产环境建议把 ECS 的 `80/443` 接入阿里云 ALB，在 ALB 上绑定证书并把 HTTP 重定向到 HTTPS；ALB 后端指向 ECS 的 80 端口。若直接在 ECS 上终止 TLS，可把 `deploy/nginx.conf` 扩展为证书配置，并把证书目录只读挂载到 `web`，同时保留 `.env` 中的 `COOKIE_SECURE=true`。

HTTPS 生效后，访问 `https://你的域名/`；健康接口为 `https://你的域名/api/health`。前端通过同源 `/api` 访问 API，不需要额外的跨域代理。

## 7. 更新、备份和恢复

更新代码后：

```bash
git pull
./scripts/deploy-aliyun.sh
```

备份会同时保存 RDS schema 和 ECS 文件卷：

```bash
./scripts/backup.sh backups/$(date +%Y%m%d-%H%M%S)
```

备份目录应复制到 OSS 或其它独立存储，不能只留在 ECS。RDS 也应开启自动备份和按需快照。恢复前停掉 API/Worker，按 `docs/implementation/operations.md` 的说明恢复数据库 schema 和 `assets.tar.gz`，再启动服务。

## 8. 常见检查

- RDS 连接失败：检查 ECS 与 RDS 是否在同一 VPC、RDS 白名单是否包含 ECS 私网地址、端口是否为控制台实际端口。
- 登录后反复掉线：确认访问地址是 HTTPS，且 `WEB_ORIGIN` 与浏览器地址完全一致；HTTPS 必须保持 `COOKIE_SECURE=true`。
- AI 任务卡住：检查 `worker`、`tools` 日志，以及模型配置的 Base URL 和密钥；Valkey 不需要暴露公网。
- 上传或 PPTX 导入失败：检查 ECS 磁盘空间和 `assets` volume；Nginx 已将单次上传限制设为 35 MB。
