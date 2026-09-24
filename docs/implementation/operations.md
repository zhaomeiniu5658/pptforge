# PostgreSQL 运维（本地起步，支持远程）

当前按最新确认使用本地 Docker PostgreSQL，启动 `docker compose --profile local-db up -d db queue`。本机 5441、容器 5432，数据卷持久化。下述远程步骤用于后续迁移。

## 连接与初始化

1. 在 `.env` 配置远程 PG 地址、数据库、账号、密码和 SSL。不要把密码贴入命令行历史；脚本使用 python-dotenv 按数据读取配置。
2. `scripts/check-db.sh` 仅执行只读连接探测；不打印密码，不创建 schema 或表。
3. 默认 `DATABASE_SCHEMA=quarkmed`。DBA 可以预建 schema 并授权给平台账号；本平台不会创建数据库。
4. 初次启动 `scripts/dev.sh` 或容器 API 时执行 Alembic，迁移只创建/更新平台 schema。初始用户仅在该 schema 的 users 为空时写入。
5. 共享数据库必须给本平台独立 schema。测试不应指向生产；`scripts/test.sh` 需要 `QUARKMED_RUN_INTEGRATION=1`，并使用显式 demo 测试账号。

## 备份

`PYTHONPATH=services/api scripts/backup.sh` 使用 `pg_dump --schema=quarkmed`，密码只通过子进程环境传递。需要本机安装与远程数据库兼容版本的 PostgreSQL 客户端工具。保存数据库 dump 和同一时刻的资产 tar；大型生产系统需采用存储快照/暂停写入获得一致备份点。

本地测试容器已按最新确认恢复，备份保留在 artifacts，不向远程自动恢复。Compose 的 local-db profile 显式启用本地 PostgreSQL。

## 恢复

恢复由 DBA 在准备好的目标数据库/schema 中执行。先停 API/Worker，确认目标不包含要保留的现有平台数据。不要对共享库整体执行 `--clean`。

在全新专用目标数据库中，可使用 `pg_restore --no-owner --no-privileges --dbname=<目标连接> database.dump`。连接密码使用 PGPASSWORD/pgpass，勿写进命令行。该 dump 只含平台 schema；执行前用 `pg_restore --list` 检查。

本机模式将 `assets.tar.gz` 解压到 `data/`。容器模式将 `assets` 文件夹还原到 `quarkmed_assets` 卷（容器内 `/data/assets`）。迁移环境后，数据库 assets.path 必须和 STORAGE_ROOT 一致；本机备份恢复进容器时由迁移脚本/DBA统一更新资产路径前缀，不能只恢复 SQL 而遗漏二进制。

恢复后只读检查项目、页面数量和附件，再启动 Worker。正式发布前应针对实际远程环境演练备份和恢复；当前未获得远程连接，未宣称通过该演练。
