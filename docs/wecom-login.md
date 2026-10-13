# 企业微信工作台接入 PPT 智造

本次采用企业自建应用。企业微信内进入应用时使用 `snsapi_base` 静默授权，服务端用一次性 code 获取企业成员 UserID，再建立现有 `quark_session` 会话。员工无需输入本系统账号密码。权限仍由本系统账号的角色、部门与项目分配决定。

## 企业微信后台

1. 由有应用管理权限的管理员在企业微信管理后台「应用管理 → 自建 → 创建应用」创建「PPT 智造」，配置图标、介绍、成员可见范围。
2. 应用主页和桌面端主页都设置为 `https://<正式域名>/api/auth/wecom/start`。无论是否已有本系统会话，从此入口进入都会重新确认企业微信身份。
3. 「网页授权及 JS-SDK」配置与正式回调一致的可信域名。按后台要求完成域名归属校验；若需校验文件，将后台下载的原始校验文件放入 `apps/web/public/` 根目录，随前端发布后核验文件 URL，再在后台提交。域名是否符合企业微信要求，以管理后台验证结果为准。
4. 企业可信 IP 填写 API 服务调用 `qyapi.weixin.qq.com` 时的固定公网出口 IP。它不是入口域名解析 IP；Sealos 需要确认出口是否稳定。
5. 记录企业 CorpID、自建应用 AgentID，将应用 Secret 仅配置在 API 的私密运行环境中，不要放在前端、仓库、聊天、URL 或日志里。

## 服务端配置

```dotenv
WECOM_ENABLED=true
WECOM_CORP_ID=<企业 ID>
WECOM_AGENT_ID=<应用 ID>
WECOM_SECRET=<应用密钥，仅服务端私密配置>
WECOM_CALLBACK_URL=https://ppt-creation-hhglmetl.sealoshzh.site/api/auth/wecom/callback
COOKIE_SECURE=true
WEB_ORIGIN=https://<正式域名>
```

以当前 Sealos 入口为例，候选应用主页为：

`https://ppt-creation-hhglmetl.sealoshzh.site/api/auth/wecom/start`

候选回调地址为：

`https://ppt-creation-hhglmetl.sealoshzh.site/api/auth/wecom/callback`

这两个地址只有在代码发布、凭据配置、企业微信域名校验完成后才可使用。当前代码不自动改动企业微信后台或云端配置。Docker Compose 会从 `.env` 传入配置；Sealos 必须在现有 API 工作负载中单独配置以上环境变量，升级时保留数据库、PVC 与模型加密密钥。

## 现有账号关联

当前 main 的 `users` 表没有企业微信 UserID 字段。历史 `4765904` 的 SSO 使用智核引擎 `/api/auth/me` 返回的 username，它不能直接证明企业微信身份。现成 UserID 字段或统一登录服务的位置尚需确认后接入。

提供了独立的 `wecom_identities` 关联表，包含 CorpID、企业微信 UserID、本系统 user_id。只接受显式关联；不按姓名、邮箱或员工编号自动猜测，不自动创建账号，不自动授予管理员权限。

如需要用明确的对应表关联，管理员登录后可调用：

```http
PUT /api/auth/wecom/bindings
Content-Type: application/json

[
  {"username": "现有系统账号", "wecom_userid": "企业微信成员UserID"}
]
```

账号和 UserID 在同一企业内均唯一，每批最多 1000 条。接口沿用现有管理员认证和写入来源检查。绑定错误、重复绑定将拒绝提交；绑定已有账号会保留其项目记录和原角色。已有字段可以经核验后导入该表，或再实现经验证的身份适配器。

## 发布与验收

先备份当前数据库；API 镜像启动时执行 Alembic 升级到 `0009`，创建关联表、一次性授权状态表及会话认证来源字段。迁移没有修改现有账号和业务数据。前端和 API 均需发布，运行配置完成后重启 API。

验收需用真实企业微信成员进行：

- 企业微信桌面端、手机端从工作台进入，直接到业务页面。
- 管理员、商务人员、一般人员分别进入，保持原来的权限和项目范围。
- 未绑定成员、停用账号、外部联系人被拒绝登录。
- 过期、重复、错误浏览器的回调不可建立会话；失败页面提示原因并可重新进入。
- `/api/auth/wecom/config` 仅公开是否已配置，不公开 Secret 或 access_token。

本地 HTTP 地址不能测试实际回调：OAuth 状态和登录 Cookie 强制使用 Secure，必须使用已配置的 HTTPS 回调域名。账号密码登录已关闭，旧的普通登录会话不可继续访问。企业微信工作台入口使用静默授权；前端不显示账号密码表单。普通外部浏览器的扫码登录不在本次实现范围内。

API 访问日志会移除回调参数，仓库 Nginx 配置关闭该回调路径的访问日志。Sealos 现有 Nginx ConfigMap 与外层 Ingress 需同步设置，避免授权 code 和 state 被访问日志记录。

## 已执行验证

`tests/test_wecom.py` 使用独立 SQLite 测试数据库和模拟企业微信响应，不连接业务数据库，也不使用真实企业微信凭据；它验证授权流程、安全检查和现有账号关联。正式 PostgreSQL 和真实企业微信端到端登录仍需配置完成后验证。

官方接口依据：[构造网页授权链接](https://developer.work.weixin.qq.com/document/path/91022)、[获取访问用户身份](https://developer.work.weixin.qq.com/document/path/91023)。已核对获取身份接口当前返回的 `userid` 字段，并兼容早期 `UserId` 字段。

## 企业微信专用模式（2026-10-13）

所有受保护 API 都要求企业微信验证创建的会话，并检查会话所属企业与当前 CorpID 一致、账号有效且身份仍关联。客户端入口额外检查 wxwork User-Agent，普通浏览器显示从企业微信工作台进入的提示；User-Agent 可伪造，不能替代服务端 OAuth 验证。密码接口即使直接调用也返回 403，没有管理账号密码绕过入口。

迁移 0009 给会话增加认证来源和企业标记，既有会话标记为 local 并被拒绝；不把旧会话当作企业微信身份。OAuth 回调建立的会话标记为 wecom。解除/变更身份关联后，旧会话不能继续使用。

首次绑定可从服务端私密 .env 导入，无需先用密码登录：

```dotenv
WECOM_USER_BINDINGS='[{"username":"现有系统账号","wecom_userid":"该员工的企业微信UserID"}]'
```

```bash
PYTHONPATH=services/api .venv/bin/python scripts/with-env.py .venv/bin/python -m quark.wecom_bindings --actor admin
```

这张对应表与 CorpID、AgentID、Secret 不同：前者关联每位员工的业务账号，后者验证自建应用。导入时保留原角色、部门、项目记录，并记录指定管理员作为审计操作人；未知账号、重复关系被拒绝。只应在有服务端管理权限的环境执行。

目前仍需企业微信后台可信域名/可信 IP 配置、真实成员关联和云端发布后进行桌面端与手机端端到端验证；本地 HTTP 地址不能承担真实 HTTPS 回调。

## 本地功能测试模式（最新规则）

使用 scripts/dev.sh 启动时启用本地系统账号密码登录，浏览器打开 http://localhost:5174 并使用原系统账号密码。已有有效企业微信会话会直接进入。该例外仅支持回环请求及本地主机名；运行环境默认生产模式，不开放系统登录。仅本地创建的 local_test 会话在部署环境无效。本地功能测试无需内网穿透；真实企业微信免登录仍需要 HTTPS 回调、可信域名和员工关联。
