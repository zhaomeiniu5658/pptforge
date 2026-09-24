# Quarkmed 夸克医药 · PPT/HTML 方案智造平台

独立 React 工作台 + FastAPI + PostgreSQL。保留原型的三角色布局，以可编辑 HTML 页面为统一内容，支持模板、分册、冻结提交、商务审核和连续长页面交付。

## 访问与数据库

- 工作台地址：<http://localhost:5174>（当前本地开发环境）
- API 文档：<http://localhost:8011/docs>（API 启动后）
- 当前演示账号：`admin`（管理员）、`bd`（商务）、`writer`（医学编写）、`stat`（数统编写）。初始密码为本地 `.env` 中的 `BOOTSTRAP_ADMIN_PASSWORD`，未写入代码或提交记录。
- 演示资产只用于功能验证，不含真实临床数据。带 `QA` 的项目是自动化验收记录。
- 页面内容、提交、审核、任务和版本保存在 PostgreSQL；文件在 `data/assets`（本地）或 Docker `assets` 卷。

## 已实现业务

- 内部账号会话登录、角色和项目范围校验、部门树及人员管理。
- 八类模板管理、分类停用、PPTX 批量入库、转换诊断、逐页原稿对照、检查后发布。
- 商务两步立项、人员与分册指派、真实截止提醒、站内催办、分册排序和审核。
- 一般人员三栏编辑器：持久节点 ID 的文本、字体、颜色、图片、间距和对齐编辑；源码编辑、撤销重做、复制、导入、页面排序、版本恢复。
- 个人 HTML 页面库；模板与页面库导入均创建副本。
- AI 设计窗口：文字／图片生成、修改当前页、继续修改候选、SSE 状态、停止／重试、任务重新打开、显式采用。
- 提交固定页面版本列表；继续修改形成草稿。商务只能审核项目内最新提交；退回必填意见。
- HTML 长页面及 ZIP：CSS／ID／锚点／ARIA／SVG 引用／动画名隔离，固定 PPTX 页面按比例缩放，ZIP 资源按内容去重。正式导出只使用已通过的提交。
- 页面修改与分册排序快照、提交／审核／导出审计记录。

## 当前先使用本地 PostgreSQL

按最新确认，当前使用 Docker 中的本地 PostgreSQL，数据保存在 `quarkmed_pgdata` 卷，地址 `127.0.0.1:5441`。保留先前验证数据，当前 schema 为 `public`。本地端口仅绑定回环地址。

```bash
docker compose --profile local-db up -d db queue
scripts/dev.sh
```

`.env` 已配置本地连接；远程模式仍可用，下面说明用于后续切换。

## 后续切换远程 PostgreSQL

PostgreSQL 容器只在 `local-db` profile 中启用，远程部署不启用该 profile。先在 `.env` 填写 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`，或填写完整 `DATABASE_URL`。默认要求 TLS：`PGSSLMODE=require`；如企业数据库要求证书验证，设置 `verify-full` 与 `PGSSLROOTCERT`。

默认在远程数据库的独立 `quarkmed` schema 下创建本平台表，避免使用共享 `public` 表名。账号需要连接、schema 创建及本 schema DDL/DML 权限；也可由 DBA 预建 schema 并授权。不会创建数据库本身，不迁移或覆盖其它 schema。

```bash
# 只读连接检查，不创建表
scripts/check-db.sh
```

本地测试数据备份在 `artifacts/local-test-backup/database.dump`，未迁往远程。切换远程时将 `DOCKER_PGHOST`、`DOCKER_PGPORT` 一并修改为远程地址和端口（或删除这两个覆盖值），推荐使用独立 `DATABASE_SCHEMA=quarkmed`。配置缺失不会静默回退到其它数据库。

## 启动：完整 Docker 部署

要求 Docker Compose。首次构建会下载官方基础镜像、Chromium、LibreOffice 和字体。

```bash
python3 scripts/init-env.py
# 首次本地安装选择本地模式（已有数据库配置时不会覆盖）
python3 scripts/init-local-env.py
# 使用当前本地数据库；需要演示账号时设置 SEED_DEMO=true，仅空 schema 首次初始化生效。
docker compose --profile local-db up -d db queue
docker compose --profile full up -d --build
# 远程部署：填入远程连接信息后只启用 full，不启动 local-db。
```

前端 `5174`；API 仅绑定本机 `8011`；任务队列 Valkey 仅绑定本机 `6387`；PostgreSQL 使用 .env 指定的本地或远程地址。浏览器通过前端 `/api` 代理访问后端；内部工具服务不对外公开。

内网部署时将 `.env` 的 `WEB_ORIGIN` 改为实际访问地址（多个地址用逗号分隔）。TLS 由内网反向代理终结时配置 `COOKIE_SECURE=true`。模型密钥只配置在服务端。不要将 `.env` 提交到 Git。

```bash
docker compose --profile full logs -f api worker tools
# 停止当前平台，保留数据卷
docker compose --profile full down
```

## 启动：本机开发

要求 Node >=22.12、Python 3.12、Docker、Google Chrome/Chromium、LibreOffice。代码不兼容系统自带 Python 3.9。

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r services/api/requirements.txt
npm ci
npm run build
python3 scripts/init-env.py
python3 scripts/init-local-env.py
docker compose --profile local-db up -d db queue
# 可选：设置 CHROME_PATH 和 SOFFICE_PATH，默认查本机 Chrome / soffice
scripts/dev.sh
```

脚本运行迁移并启动 API、Worker、渲染工具和 Vite；日志在 `artifacts/*.log`。`Ctrl+C` 停止该脚本启动的进程。关闭窗口不删除数据库或已保存草稿。部署切换前先停止本机进程，避免占用相同端口。

## 模型配置

管理员进入顶部 **模型配置**，可新增多个接口、编辑、停用、测试连接，分别设置文字和图片默认模型。AI 设计窗口可自动选择默认模型或手动切换；保存立即用于新任务，无需重启。现有 `.env` 配置在首次启动且模型表为空时导入，之后以界面配置为准。

每个配置填写名称、接口类型、Base URL、Model name、API Key。密钥加密存储在 PostgreSQL，接口不回显；编辑时留空保留密钥。加密根密钥使用 `MODEL_ENCRYPTION_KEY`，未设置时使用当前 `TOOL_SECRET`，API 与 Worker 必须保持一致；备份恢复时必须同时保留该密钥，不能随意更换。

勾选“支持图片”仅用于任务路由，不能改变远端部署能力。勾选后点击“测试连接”会发送一张合成图片；未勾选时发送简短文字。测试会实际调用所选模型。2026-09-21 当前 Qwen 接口文字调用成功，但返回 `At most 0 image(s)` 拒绝图片，故仅设为文字默认。图片任务需添加已启用视觉输入的接口，并设为图片默认；没有可用图片模型时界面和 API 都会阻止误提交。

首次部署也可在 `.env` 设置下表字段；没有配置时不返回伪造的 AI 页面。

| MODEL_PROVIDER | MODEL_BASE_URL 示例 | 配置 |
|---|---|---|
| openai | `https://api.openai.com/v1` 或兼容接口根地址 | `MODEL_NAME`、`MODEL_API_KEY` |
| anthropic | `https://api.anthropic.com` | Claude 模型名称、密钥 |
| gemini | `https://generativelanguage.googleapis.com/v1beta` | Gemini 模型名称、密钥 |
| ollama | `http://localhost:11434` | 已拉取的模型名称；无需密钥 |

Docker 内访问宿主 Ollama 使用 `http://host.docker.internal:11434`。图片生成需要模型支持视觉输入；文字模型不能自动获得视觉能力。云调用只发往管理员配置的模型服务。当前实现使用完整 HTML 候选，不执行模型返回的任意脚本或系统命令。

截图流程：可选 Calque → 模型生成 → Chromium 真渲染 → 尺寸不拉伸的像素比较 → 最多 3 次渲染检查 / 2 次纠正 → 保留最佳候选。比较分数是阈值内像素占比，不代表医学正确性或视觉验收结论。纠正调用失败时保留已生成候选。

`CALQUE_ENABLED=false` 为默认值。启用时需准备 Tesseract 的 `eng`、`chi_sim` 语言数据；首次联网下载由 Tesseract 完成，可用 `TESSERACT_CACHE` 指定已预置缓存目录（工具服务环境变量）。Calque 分析失败会降级为直接图片生成。中文 OCR 和字号估计需人工检查。

## 内容与导入边界

- HTML 和 CSS 经过 AST 处理，预览在不带 `allow-same-origin` 的 sandbox iframe 中运行。最终导出为单一 DOM，不用 iframe 拼接。
- 原始 HTML 脚本被移除；保留原生锚点、`details`，以及文档 `interactions` 中声明的 toggle/tabs/modal/anchor。任意第三方 JS 应用不是可无损导入范围。
- HTML 可直接导入；包含图片、字体和 CSS 的离线文件请放进 ZIP。资源缺失会显示诊断并阻止提交、采用或导出。不会自动抓取上传 HTML 中的外网 URL。
- ZIP 限制条目数、解压总量与路径；单次上传 32 MB，规范化单页 HTML 4 MB。内嵌图片较大时应先压缩。
- PPTX 原文件保留；母版／布局背景单独渲染为固定背景，避免重复叠加幻灯片文字。文本、简单矩形和图片可编辑；组合、旋转、图表、表格等暂保留参考图裁切。母版内文字不独立编辑。
- LibreOffice 与 PowerPoint 字体／版式不完全等价。继承字体、项目符号、行间距、阴影与透明重叠等仍可能存在转换偏差。每页有原稿和诊断，严重差异阻止发布。复杂企业模板必须用实际样本验收；需要修复时可调整原始 PPTX 后重新入库。
- 独立 HTML 内嵌资源；ZIP 有 `index.html`、`pages/*.html`、去重后的 `assets/` 和冻结 `manifest.json`。未嵌入的系统字体在其他机器可能替换；高保真交付请在源 HTML 包中携带有权使用的字体。

## 目录与接口

```text
apps/web/src/          三角色 React 页面、编辑器、AI 窗口与设计样式
services/api/quark/    业务 API、模型网关、Celery 任务、导入与 PPTX 转换
services/render-tools/ 内部 Chromium 渲染、Calque 与互动检查
packages/html-engine/ HTML/CSS 规范化、节点修改、隔离编译与导出运行时
packages/contracts/   HtmlPageDocument 类型、OpenAPI 契约
migrations/           固定版本 PostgreSQL 迁移
third_party/          固定提交的上游源文件、许可证与来源
compose.yaml, deploy/ 容器部署
scripts/              启动、环境初始化、测试、备份恢复
 tests/               PostgreSQL/API/Worker、模型适配、PPTX 与渲染测试
 docs/                原型、方案、实施与验收文档
```

接口见 `/docs` 及 `packages/contracts/openapi.json`。API 统一管理鉴权和业务规则，Worker 只消费已授权任务。生成返回候选；`/api/jobs/{id}/adopt` 再检查编辑权与基础版本。任何 stale save 返回 409，用户需刷新/合并，不静默覆盖。

## 验证与维护

```bash
npm run build
npm test
# 要求本地栈已启动且 SEED_DEMO=true；生成带 QA 前缀的测试项目
QUARKMED_RUN_INTEGRATION=1 SOFFICE_PATH=/path/to/soffice scripts/test.sh
npm audit --omit=dev
```

完整结果见 `docs/implementation/verification.md`。真实模型效果、真实公司 PPTX 和完整 Docker 首次构建的验证状态以该文档为准。

备份：`scripts/backup.sh` 使用当前配置的 PostgreSQL 连接参数，仅导出平台 schema 与资产。恢复需停 API/Worker，并由 DBA 在专用目标 schema 执行，参见 `docs/implementation/operations.md`。不自动覆盖已有远程数据库。

首版不包含可编辑 PPTX 导出、实时多人编辑、SSO、计费或完整 GMP/21 CFR Part 11 验证。
