# 实施验证记录

日期：2026-09-21。当前按用户最新确认使用本地 Docker PostgreSQL 16，保留远程连接配置。未向远程数据库写入任何数据。

## 已验证

- TypeScript 编译、Vite 生产构建、Calque TypeScript 构建通过。
- npm 生产依赖审计：0 项已知漏洞（本次解析的 lockfile）；保留第三方许可。
- HTML 引擎测试：同文案单节点编辑、脚本与缺失资源处理、重复页面 CSS/ID/ARIA/动画隔离、只读图形保护、CSS 闭合注入防护。行内缺失资源测试；共 6 项通过。
- Python 测试：24 项通过（PostgreSQL/API/Worker/转换/模型契约/数据库配置）；详见 tests 和 artifacts/test-final.log。测试用 QA 前缀项目保留在本地。
- API：非成员访问拒绝；商务不能代写一般人员分册；一般人员不能审核；非商务不能立项；跨来源写入拒绝；过期基础版本返回 409。
- 冻结提交：提交后更新草稿，商务正式 HTML/ZIP 仍包含旧审核内容；审核前正式导出拒绝。排序生成不可变分册快照。
- 模板副本、页面库副本、页面排序、HTML 导入候选、重复采用拒绝、AI 采用时基础版本复查、取消结果不能采用。
- 实际 Celery/Valkey job：HTML 导入、导出和未配置模型错误路径通过。没有用假 AI 文档冒充模型调用结果。
- Worker 控制流程：受控模型响应配合实际 Chromium 渲染，验证三轮中保留最佳候选；模型请求等待期间取消后不能成功或采用；持久化 running 导入任务重入后不重复产生结果。这些测试不等同于真实云模型或进程断电演练。
- Chromium 实际渲染、同图 Diff=1、不同尺寸报告 mismatch、不拉伸图像。
- LibreOffice 合成 PPTX：文字可编辑，复杂组转图片并明确诊断，生成参考 PNG 与转换 PNG；检查母版背景独立保留。未提供真实公司 PPTX，尚未完成真实样本保真验收。
- ZIP 路径与解压限制；相对 CSS/图片归档；导出资源按内容去重。
- 4 种模型适配器契约测试使用 HTTP MockTransport；只验证 OpenAI-compatible/Ollama/Claude/Gemini 的请求响应结构，不代表真实账号、模型质量或云网络可用性。
- 无数据库配置时明确失败；密码特殊字符正确编码；SSL 选项与 PostgreSQL URL 正规化。
- Alembic 在独立 `quarkmed_migration_test` schema 中完整 upgrade 至 0002（21 张表），随后 downgrade 通过，未触碰业务 schema。
- 本地数据库 dump 恢复到独立 `quarkmed_restore_test` 成功，恢复项目/页面版本数量核对；15 个原文件/导出资产哈希核对通过。该演练不代表远程运维已验证。

## 浏览器验证

使用 ego-browser，桌面 1440×1000，真实 API 和 PostgreSQL。

- 登录一般人员，三栏工作台渲染。
- 在画布选择标题，在属性栏修改文本，保存并刷新后保留。
- 模板弹窗多选两套模板，导入后分册从 4 页变为 6 页；原模板未修改。
- AI 设计窗口内粘贴 HTML → 后台候选 → 显式采用 → 分册新增页面。
- 分册提交，切换商务账号查看冻结版本并审核通过。
- 商务协同页显示真实缩略图、审核状态与完成比例；未完成项目的正式合订禁用。
- 商务两步向导实际创建项目，选择医学与数统两名人员，生成两个独立分册。
- 管理员上传合成 PPTX，经真实 Worker 转换与逐页对照，视觉相似度 98%（仅此样本），完成检查与发布；人员和分类页面核对。
- 发现并修复缩略图坐标/缩放、卡片标题裁切、自然高度预览底部多余留白。

截图保存在 `artifacts/editor.png`、`template-picker.png`、`ai-designer.png`、`business-project.png`、`project-wizard.png`、`project-team.png`、`admin-categories.png`、`pptx-review.png`、`admin-people.png`。截图中的内容是演示与验证数据。

## 尚待真实环境验收

- 已接入用户部署的 Qwen，实际文字生成与管理员连接测试成功；当前部署拒绝图片输入，视觉生成质量和真实失败重试成本仍待可用视觉接口验收。
- Calque OCR 是可选增强，需真实中文模板及已预置 Tesseract 语言包验证。
- PPTX 的中文公司字体、复杂母版、透明重叠、表格、图表、SmartArt 和公式需要实际样本验收。复杂区域并不全可编辑，不承诺 100% PowerPoint 一致。
- Docker Compose 已通过配置校验；本次实际运行模式为本机 API/Worker/Chrome/LibreOffice + Docker PostgreSQL/Valkey。完整 Docker 镜像首次构建与容器中文字体效果尚未作端到端验证。
- Worker 崩溃依赖 Celery late ack/visibility timeout 恢复；取消为协作取消，不是即时中断外部模型 HTTP。故障注入/断电恢复未完整演练。
- 未包含可编辑 PPTX 导出、SSO、实时多人协同、复杂部门授权或完整合规验证。


## 多模型接入增量验收（2026-09-21）

- 新增迁移 0003：PostgreSQL 模型配置，凭据加密，文字／图片独立默认，默认唯一性由数据库约束保证。
- 全量回归 33 项 Python 通过、1 项因已配置真实模型跳过；随后新增的 Worker 按指定配置运行测试单独通过，共 34 项通过。6 项 HTML 引擎测试通过。构建通过。
- 验证管理员维护权限、普通人员密钥不可读、空密钥保留／显式清除、文字模型拒绝图片任务、停用模型不可调度、分模式默认路由、任务中不存密钥。
- 已实际调用部署的 Qwen 生成有效 HTML。上传图片失败的原因为模型服务返回 HTTP 400：At most 0 image(s) may be provided in one prompt。接口模型列表仅有 Qwen3.6-35B-A3B；尚无已验证可用的视觉接口。
- 模型错误现在显示可操作的说明，不再只显示 HTTPStatusError。不会通过删除图片再调用文字模型来伪装还原成功。
- 浏览器验收：管理员模型表与编辑保存（空密钥保留）、真实文字连接测试成功；一般人员模型选择器按上传图片切换默认用途，未配置视觉模型时显示原因并禁用提交。截图：`artifacts/model-settings.png`、`artifacts/model-selector.png`。

## 项目方案管理参考页调整（2026-09-22）

- 依据 `docs/商务人员视角/_2/code.html` 与截图实现独立 React 项目管理页：渐变标题区、分类计数、横向筛选栏、项目表格、分页、批量导出与底部创建入口，使用真实 API 数据。
- 管理员首页内容与原首页导航名称保持不变；仅增加项目方案管理导航入口。
- 浏览器验证商务账号登录、项目搜索、分类筛选、已完成状态筛选、项目勾选、导出弹窗和新建项目向导入口。此次未实际执行批量文件下载。
- 截图检查并修正全局 select 宽度导致的筛选栏换行。验收截图：`artifacts/project-management.png`。
- React/TypeScript 生产构建通过；Python 回归 34 passed、1 skipped。构建仍有既有代码编辑器分块超过 500 kB 的提示。

## HTML 文件夹与 ZIP 模板入库（2026-09-22）

- 新增模板入库支持 PPTX、HTML、ZIP 和浏览器文件夹选择。文件夹 multipart 文件名携带相对路径，服务端统一打包；整个批次先校验再创建任务，避免部分文件不合法却已入库。
- 每次总上传 32 MB；文件夹最多 500 文件，ZIP 解压最多 100 MB，每包最多 60 个 HTML 页面。忽略 macOS 元数据，拒绝越界路径、重复路径、加密 ZIP 和符号链接。
- 同一包成为一套多页模板；保留页面来源，不额外保存 screen.png/screenshot.png 参考图。归档相对路径 CSS、嵌套 CSS、带查询参数和 URL 编码的图片路径。
- Tailwind v3 CDN 导出在本地编译，使用 Acorn 读取静态配置，禁止执行上传脚本或自定义插件。v4 动态运行时需提供编译后的 CSS；其他脚本仍由原文档清理机制移除。
- 已知导出 CDN（lh3.googleusercontent.com、fonts.googleapis.com、fonts.gstatic.com）的图片/字体可在导入时归档。每跳重新校验域名，限制请求时间及资源大小；其他来源需把资源随包上传。可通过 IMPORT_RESOURCE_PROXY 设置资源下载代理，不影响模型请求。
- 资源缺失写入转换诊断，保留待检查模板并阻止发布；不会用 screen.png 替代可编辑 HTML。成功后可直接打开入库模板检查。
- Python 全量回归 40 passed、1 skipped；HTML 引擎 6 项通过；React 生产构建通过。新增覆盖文件夹/ZIP 上传、权限、批次预校验、来源记录、嵌套 CSS、静态 Tailwind 配置及动态脚本拒绝。
- 用户提供的 `stitch_16_9_ui_design_concept.zip` 已经通过实际浏览器上传及 Celery 入库为「夸克医药 · Stitch 封面」，待发布；最终诊断为空。实际入库文档离线渲染 1280×720，无缺图、无横向溢出；HTML 文字仍可编辑。
- 浏览器目录选择工具未返回文件，因此目录 UI 验收使用带 webkitRelativePath 的三文件 FileList 注入，验证了 React 选择状态 → multipart 相对路径 → Worker 资源归档全过程；原生系统目录选择器仍需用户手动操作确认。
- 本机已按系统代理配置 IMPORT_RESOURCE_PROXY，解决 Worker 获取 Google 图片的连接超时；部署到其他机器需使用该环境可访问的代理或让导出包包含全部资源。
- 产物：`artifacts/template-stitch-preview.png`、`artifacts/stitch-import.png`、`artifacts/stitch-import-offline.html`。

### 参考图入口移除（2026-09-22）

按用户最新要求移除模板详情的“查看原始参考图”，HTML/ZIP 导入不再将同目录 screen.png/screenshot.png 额外复制到 sourceReferences。已清理现有 HTML 模板版本中的参考图元数据；HTML 正文图片及源包不变。PPTX 转换内部用于质量比较的图像继续由转换流程使用。构建和两项相关导入回归通过。

### 模板信息与内容编辑（2026-09-22）

- 管理员可在模板详情修改模板标题、分类、所属部门和跨部门共享设置；分类和部门会校验有效性，空标题、停用分类和不存在部门不能保存。
- 新增模板内容设计工作台：点击画布元素后可编辑文字、图片、字号、字体、颜色、背景、对齐、内外间距和尺寸；支持源码编辑、撤销、页面新增、复制、删除和上下排序。
- 内容保存通过 `/api/templates/{id}/content` 创建不可变 `template_versions` 新版本，旧版本和已导入到项目的页面副本不变；保存后模板回到草稿，需要检查后重新发布。基础版本号冲突返回 409。
- 浏览器实际验证了模板信息编辑入口、源码内容修改、保存新版本和返回详情；临时验收模板已清理。Python 全量回归 41 passed、1 skipped，React 构建通过。
