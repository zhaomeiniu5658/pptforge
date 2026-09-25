# 阿里云 ECS 部署

本文是 PPTForge 在阿里云 ECS 上的可执行部署方案。当前方案使用 ECS 内的 PostgreSQL 和 Valkey，数据不依赖 RDS。

```text
浏览器 → ECS:18080 → web(Nginx) → api/worker/tools
                              ├─ db(PostgreSQL，仅 Compose 网络)
                              └─ queue(Valkey，仅 Compose 网络)
```

当前示例服务器使用项目目录 `/opt/pptforge`，公网访问地址为 `http://101.200.145.196:18080`。生产环境建议绑定域名并启用 HTTPS。

## 1. 准备 ECS

建议 Ubuntu ARM64，至少 4 vCPU / 16 GiB。安全组入方向放行 TCP 22（限制为办公 IP）和 TCP 18080（网站访问）。不要暴露 PostgreSQL、Valkey、API 或工具端口。

安装 Docker，重新登录后继续：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

## 2. 获取代码

```bash
sudo git clone https://github.com/zhaomeiniu5658/pptforge.git /opt/pptforge
sudo chown -R "$USER":"$USER" /opt/pptforge
cd /opt/pptforge
```

已有目录更新：

```bash
cd /opt/pptforge
git pull --ff-only origin main
```

必须使用这三个 Compose 文件：`compose.yaml`、`compose.aliyun.yaml`、`compose.aliyun.local.yaml`。

## 3. 配置 .env

```bash
cd /opt/pptforge
cp deploy/aliyun.env.example .env
chmod 600 .env
nano .env
```

ECS 内置数据库配置至少应包含：

```env
PGHOST=db
PGPORT=5432
PGDATABASE=quarkmed
PGUSER=quark
PGPASSWORD='替换为数据库密码'
PGSSLMODE=disable
DATABASE_SCHEMA=public
DOCKER_PGHOST=db
DOCKER_PGPORT=5432
BROKER_URL=redis://queue:6379/0
TOOL_URL=http://tools:8012
STORAGE_ROOT=/data/assets
TOOL_SECRET=替换为随机密钥
WEB_ORIGIN=http://101.200.145.196:18080
COOKIE_SECURE=false
WEB_BIND_PORT=18080
BOOTSTRAP_ADMIN_PASSWORD='替换为初始管理员密码'
SEED_DEMO=false
MODEL_ENCRYPTION_KEY=替换为随机密钥
MODEL_SUPPORTS_IMAGES=false
MODEL_PROVIDER=
MODEL_BASE_URL=
MODEL_NAME=
MODEL_API_KEY=
CALQUE_ENABLED=false
IMPORT_RESOURCE_PROXY=
LOCAL_POSTGRES_PASSWORD='与 PGPASSWORD 相同'
```

生成随机密钥：`openssl rand -hex 32`。变量名不要写反斜杠，例如使用 `DATABASE_SCHEMA`。不要提交 `.env`。

## 4. 恢复现有数据

上传到以下准确路径，文件名不能改：

```text
/opt/pptforge/migration/quarkmed-database-public.dump
/opt/pptforge/migration/quarkmed-assets.tar.gz
```

启动数据库和队列：

```bash
cd /opt/pptforge
docker compose -p pptforge -f compose.yaml -f compose.aliyun.yaml -f compose.aliyun.local.yaml --profile local-db up -d db queue
```

删除空数据库默认 schema：

```bash
docker compose -p pptforge -f compose.yaml -f compose.aliyun.yaml -f compose.aliyun.local.yaml exec -T db psql -U quark -d quarkmed -c "DROP SCHEMA public CASCADE;"
```

恢复 dump：

```bash
docker compose -p pptforge -f compose.yaml -f compose.aliyun.yaml -f compose.aliyun.local.yaml exec -T db pg_restore -U quark -d quarkmed --no-owner --no-privileges --exit-on-error < ./migration/quarkmed-database-public.dump
```

不要使用 `pg_restore -l`、`/tmp/quarkmed.list` 或 `--use-list`。

恢复资产：

```bash
docker run --rm -v pptforge_assets:/data -v /opt/pptforge/migration:/backup:ro alpine sh -c 'mkdir -p /data/assets && tar -xzf /backup/quarkmed-assets.tar.gz -C /data'
```

## 5. 修复依赖和端口

当前 lock 文件与 package.json 不同步，原始 `npm ci` 会因缺少 sharp 条目失败。部署前执行：

```bash
cd /opt/pptforge
cp deploy/tools.Dockerfile deploy/tools.Dockerfile.bak
sed -i 's/npm ci && npm run build -w third_party\/calque/npm install --no-audit --no-fund --legacy-peer-deps \&\& npm run build -w third_party\/calque/' deploy/tools.Dockerfile
cp deploy/web.Dockerfile deploy/web.Dockerfile.bak
sed -i 's/npm ci && npm run build -w apps\/web/npm install --no-audit --no-fund --legacy-peer-deps \&\& npm run build -w apps\/web/' deploy/web.Dockerfile
```

如果 `5174` 已被其他项目占用：

```bash
cp compose.yaml compose.yaml.bak
sed -i 's/"5174:80"/"18080:80"/' compose.yaml
```

## 6. 后台构建

后台构建可避免 ECS Workbench 断开导致任务停止：

```bash
nohup docker compose -p pptforge -f compose.yaml -f compose.aliyun.yaml -f compose.aliyun.local.yaml build --progress=plain tools > /tmp/pptforge-tools-build.log 2>&1 &
tail -n 40 /tmp/pptforge-tools-build.log
```

工具日志出现 `exporting to image` 后：

```bash
nohup docker compose -p pptforge -f compose.yaml -f compose.aliyun.yaml -f compose.aliyun.local.yaml --profile full build --progress=plain api worker web > /tmp/pptforge-rest-build.log 2>&1 &
tail -n 40 /tmp/pptforge-rest-build.log
```

断线后检查，不要重复启动：

```bash
ps aux | grep '[d]ocker compose'
tail -n 40 /tmp/pptforge-rest-build.log
```

## 7. 启动和验证

```bash
cd /opt/pptforge
docker compose -p pptforge -f compose.yaml -f compose.aliyun.yaml -f compose.aliyun.local.yaml --profile local-db --profile full up -d
docker compose -p pptforge -f compose.yaml -f compose.aliyun.yaml -f compose.aliyun.local.yaml --profile local-db --profile full ps
curl -I http://127.0.0.1:18080
curl http://127.0.0.1:18080/api/health
```

应包含 `db`、`queue`、`tools`、`api`、`worker`、`web`。浏览器访问 `http://101.200.145.196:18080`。本机返回 200 但外网打不开时，检查安全组 TCP 18080。

## 8. 后续更新

普通代码更新不需要重新导入数据库或资产：

```bash
cd /opt/pptforge
git pull --ff-only origin main
docker compose -p pptforge -f compose.yaml -f compose.aliyun.yaml -f compose.aliyun.local.yaml --profile full build api worker web tools
docker compose -p pptforge -f compose.yaml -f compose.aliyun.yaml -f compose.aliyun.local.yaml --profile local-db --profile full up -d
```

只改前端可构建 `web`，只改后端可构建 `api worker`。修改 `.env` 后重新 `up -d`。不要执行 `docker compose down -v`，否则可能删除数据库和资产卷。数据库结构变化后查看 API 的 Alembic 日志。

## 9. 常见排错

```bash
docker compose -p pptforge -f compose.yaml -f compose.aliyun.yaml -f compose.aliyun.local.yaml --profile local-db --profile full ps
docker logs --tail 100 pptforge-api-1
docker logs --tail 100 pptforge-worker-1
docker logs --tail 100 pptforge-tools-1
docker logs --tail 100 pptforge-web-1
ss -ltnp | grep ':18080\|:5174'
docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'
```

`tools` 不健康时重点看 Chromium 和工具日志；API 不健康时检查数据库、`.env` 和 Alembic；上传失败时检查磁盘和 `pptforge_assets` 卷。初始管理员密码登录成功后立即修改，所有密码和模型 API Key 不要提交到 Git。
