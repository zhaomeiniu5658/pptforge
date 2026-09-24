import React, { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Link,
  useNavigate,
  useLocation,
} from "react-router-dom";
import {
  Layers3,
  Bell,
  ChevronDown,
  LogOut,
  Search,
  Plus,
  ArrowUpRight,
  Clock3,
  FileText,
  Users,
  LayoutGrid,
  FolderOpen,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  SlidersHorizontal,
  Download,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Send,
  ShieldCheck,
  Eye,
  Pencil,
  Palette,
  Trash2,
  Settings,
} from "lucide-react";
import { api, downloadFile, roleNames, statusNames, date, remaining } from "./api";
import {
  Modal,
  Preview,
  Badge,
  Empty,
  Field,
  Progress,
  JobView,
} from "./components";
import { Editor } from "./Editor";
import { Models } from "./Models";
import { ProjectManagement } from "./ProjectManagement";
import { TemplateImportDialog } from "./TemplateImportDialog";
import { TemplateCategoryFilter } from "./TemplateCategoryFilter";
import { TemplateContentEditor } from "./TemplateContentEditor";
import "./style.css";
export const Context = React.createContext<any>(null);
function Login({ onLogin }: any) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <div className="login-story">
        <div className="brand light">
          <Layers3 />
          Quarkmed <span>夸克医药</span>
        </div>
        <div>
          <div className="eyebrow">MODERN CLINICAL INTELLIGENCE</div>
          <h1>
            让专业知识，
            <br />
            成为出色的方案。
          </h1>
          <p>
            连接医学资产、专业团队与智能设计。
            <br />
            从一页灵感，到完整的临床方案。
          </p>
          <div className="login-pills">
            <span>标准化资产</span>
            <span>跨部门协同</span>
            <span>AI 辅助设计</span>
          </div>
        </div>
        <small>QUARKMED · PPT / HTML 方案智造平台</small>
      </div>
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            onLogin(await api("/auth/login", { username, password }));
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="eyebrow">WELCOME BACK</div>
        <h2>登录方案智造平台</h2>
        <p>使用内部账号进入您的专属工作台</p>
        <Field label="账号">
          <input
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            placeholder="请输入内部账号"
          />
        </Field>
        <Field label="密码">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="请输入密码"
          />
        </Field>
        {error && <p className="error">{error}</p>}
        <button className="primary full" disabled={busy}>
          {busy ? "登录中…" : "进入工作台"}
          <ArrowRight size={17} />
        </button>
        <p className="login-foot">企业内部工作空间 · 版本留痕与安全会话</p>
      </form>
    </div>
  );
}
function Shell() {
  const [user, setUser] = useState<any>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [notifications, setNotifications] = useState<any[] | null>(null);
  const [settings, setSettings] = useState<any>({ ai_enabled: true });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    api("/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!user) return;
    api("/settings").then(setSettings).catch(() => {});
    const load = () =>
      api("/notifications").then((x) =>
        setUnread(x.filter((n: any) => !n.read).length),
      );
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [user]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 6500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  async function run(fn: () => Promise<any>) {
    try {
      return await fn();
    } catch (e: any) {
      setNotice(e.message);
      return null;
    }
  }
  if (!ready) return <div className="loading">正在连接工作空间…</div>;
  if (!user)
    return (
      <Login
        onLogin={(u: any) => {
          setUser(u);
          nav("/");
        }}
      />
    );
  return (
    <Context.Provider value={{ user, notify: setNotice, run, settings, setSettings }}>
      <div className="app">
        <header className="topbar">
          <Link className="brand" to="/">
            <Layers3 size={28} />
            <strong>Quarkmed</strong>
            <span>夸克医药</span>
          </Link>
          <div className="brand-divider" />
          <span className="product-name">方案智造平台</span>
          <nav>
            {(user.role === "admin"
              ? [
                  ["/", "资产工作台"],
                  ["/templates", "PPT 模板库"],
                  ["/projects", "项目方案管理"],
                  ["/categories", "模板分类"],
                  ["/people", "组织与人员"],
                  ...(settings.ai_enabled ? [["/models", "模型配置"]] : []),
                ]
              : [
                  ["/", "我的工作台"],
                  ["/projects", "项目方案管理"],
                  ["/templates", "部门模板库"],
                ]
            ).map(([url, label]) => (
              <Link
                key={url}
                className={loc.pathname === url ? "active" : ""}
                to={url}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="top-actions">
            {user.role === "admin" && (
              <button
                className="icon top-settings-button"
                title="平台设置"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings size={18} />
              </button>
            )}
            <button
              className="icon notification"
              title="站内通知"
              onClick={() =>
                run(async () => {
                  setNotifications(await api("/notifications"));
                  await api("/notifications/read", {});
                  setUnread(0);
                })
              }
            >
              <Bell size={19} />
              {unread > 0 && <i />}
            </button>
            <Link className="small-link" to="/jobs">
              任务中心
            </Link>
            <div className="avatar">{user.name.slice(-2)}</div>
            <div className="user-text">
              <b>{user.name}</b>
              <small>{roleNames[user.role]}</small>
            </div>
            <button
              className="icon"
              title="退出登录"
              onClick={() =>
                run(async () => {
                  await api("/auth/logout", {});
                  setUser(null);
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<ProjectManagement />} />
          <Route path="/projects/new" element={<Wizard />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/booklets/:id" element={<Editor />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/people" element={<People />} />
          <Route
            path="/models"
            element={settings.ai_enabled ? <Models /> : <Navigate to="/" />}
          />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        {notice && (
          <div className="toast" role="status" onClick={() => setNotice("")}>
            {notice}
          </div>
        )}
        {notifications && (
          <Modal title="站内通知" onClose={() => setNotifications(null)}>
            <div className="modal-body">
              {notifications.length ? (
                notifications.map((n) => (
                  <div className="notice-row" key={n.id}>
                    <Bell size={17} />
                    <div>
                      {n.message}
                      <small>{date(n.created_at)}</small>
                      {n.project_id && (
                        <Link
                          onClick={() => setNotifications(null)}
                          to={"/projects/" + n.project_id}
                        >
                          查看项目 →
                        </Link>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <Empty>暂无通知</Empty>
              )}
            </div>
          </Modal>
        )}
        {settingsOpen && (
          <PlatformSettingsModal
            value={settings}
            onClose={() => setSettingsOpen(false)}
            onSave={(next: any) => setSettings(next)}
          />
        )}
      </div>
    </Context.Provider>
  );
}
export function useApp() {
  return React.useContext(Context);
}
function PlatformSettingsModal({ value, onClose, onSave }: any) {
  const { run, notify } = useApp();
  const [aiEnabled, setAiEnabled] = useState(value.ai_enabled !== false);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="平台设置"
      subtitle="控制企业内部工作台功能入口。关闭 AI 后，不影响已生成和已保存的页面。"
      onClose={onClose}
    >
      <div className="modal-body platform-settings-body">
        <section className="platform-setting-card">
          <div>
            <b>AI 生成与编辑</b>
            <p>
              开启后可使用 AI 生成页面、AI 修改页面和模板 AI 设计；关闭后隐藏相关入口与模型配置菜单。
            </p>
          </div>
          <button
            className={"platform-switch " + (aiEnabled ? "on" : "off")}
            role="switch"
            aria-checked={aiEnabled}
            onClick={() => setAiEnabled((v) => !v)}
          >
            <span />
            {aiEnabled ? "已开启" : "已关闭"}
          </button>
        </section>
      </div>
      <footer className="modal-footer">
        <button disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              setBusy(true);
              try {
                const next = await api(
                  "/settings",
                  { ai_enabled: aiEnabled },
                  "PATCH",
                );
                onSave(next);
                notify(aiEnabled ? "AI 功能已开启" : "AI 功能已关闭");
                onClose();
              } finally {
                setBusy(false);
              }
            })
          }
        >
          {busy ? "保存中…" : "保存设置"}
        </button>
      </footer>
    </Modal>
  );
}
function useLoad(path: string) {
  const [data, setData] = useState<any>(null);
  const { run } = useApp();
  const load = () => run(async () => setData(await api(path)));
  useEffect(() => {
    load();
  }, [path]);
  return [data, load, setData] as const;
}
function Heading({ eyebrow, title, description, children }: any) {
  return (
    <div className="heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
function Dashboard() {
  const { user } = useApp();
  const [d] = useLoad("/dashboard");
  if (!d) return <div className="loading">载入工作台…</div>;
  const ps = d.projects;
  const mine = ps.flatMap((p: any) =>
    p.booklets
      .filter((b: any) => b.owner_id === user.id)
      .map((b: any) => ({ ...b, project: p })),
  );
  return (
    <main className="main">
      <Heading
        eyebrow="WORKSPACE OVERVIEW"
        title={
          user.role === "admin"
            ? "资产治理工作台"
            : `${user.name}，欢迎回到工作台`
        }
        description={
          user.role === "admin"
            ? "统一规范，沉淀专业资产，让每一份方案都有据可依。"
            : "聚焦专业内容，让团队协作更高效。"
        }
      >
        {user.role === "business" && (
          <Link className="button primary" to="/projects/new">
            <Plus size={18} />
            新建项目方案
          </Link>
        )}
        {user.role === "admin" && (
          <Link className="button primary" to="/templates">
            <Plus size={18} />
            模板入库
          </Link>
        )}
      </Heading>
      <section className="stats">
        {(user.role === "admin"
          ? [
              [d.templates, "已发布模板", Layers3],
              [d.categories, "标准化分类", LayoutGrid],
              [d.pending_templates, "待检查模板", ShieldCheck],
              [ps.length, "方案项目", FolderOpen],
            ]
          : [
              [ps.length, "参与项目", FolderOpen],
              [
                mine.length ||
                  ps.reduce((n: number, p: any) => n + p.booklets.length, 0),
                "协同分册",
                FileText,
              ],
              [
                ps.reduce((n: number, p: any) => n + p.approved, 0),
                "已通过分册",
                CheckCircle2,
              ],
              [
                ps.filter(
                  (p: any) =>
                    new Date(p.deadline).getTime() - Date.now() <
                      48 * 3600000 &&
                    new Date(p.deadline).getTime() > Date.now(),
                ).length,
                "48H 内截止",
                Clock3,
              ],
            ]
        ).map(([v, label, Icon]: any) => (
          <div className="stat" key={label}>
            <div className="stat-icon">
              <Icon size={21} />
            </div>
            <span>{label}</span>
            <strong>
              {v}
              <small> {label === "参与项目" ? "项" : "个"}</small>
            </strong>
          </div>
        ))}
      </section>
      <div className="section-head">
        <h2>{user.role === "contributor" ? "我的分册任务" : "进行中的项目"}</h2>
        <Link to="/projects">
          查看全部 <ArrowRight size={14} />
        </Link>
      </div>
      {user.role === "contributor" ? (
        <div className="task-grid">
          {mine.map((b: any) => (
            <article className="task-card" key={b.id}>
              <div className="flex between">
                <span className="category-tag">{b.project.field}</span>
                <Badge status={b.submission?.status || "draft"} />
              </div>
              <h3>{b.title}</h3>
              <p>{b.project.name}</p>
              <div className="task-guidance">
                {b.instructions ||
                  "围绕分册要求完成专业内容，采用部门标准模板。"}
              </div>
              <div className="task-meta">
                <span>
                  <FileText size={15} />
                  建议 {b.expected_pages} 页 · 已有 {b.page_count} 页
                </span>
                <span>
                  <Clock3 size={15} />
                  {remaining(b.deadline)}
                </span>
              </div>
              <Link className="button primary full" to={"/booklets/" + b.id}>
                进入极简工作台
                <ArrowRight size={16} />
              </Link>
            </article>
          ))}
          {!mine.length && <Empty>暂无分配给您的任务</Empty>}
        </div>
      ) : (
        <ProjectTable projects={ps.slice(0, 6)} />
      )}
      <div className="brand-banner">
        <div className="banner-symbol">
          <Sparkles size={34} />
        </div>
        <div>
          <h3>将医学智慧，转化为专业表达</h3>
          <p>从部门模板开始制作，使用 AI 辅助设计，所有内容保留版本记录。</p>
        </div>
        <Link className="button" to="/templates">
          浏览模板库 <ArrowUpRight size={16} />
        </Link>
      </div>
    </main>
  );
}
function ProjectTable({ projects }: any) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>项目名称 / 编号</th>
            <th>专业领域</th>
            <th>分册确认进度</th>
            <th>截止日期</th>
            <th>页面资产</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p: any) => (
            <tr key={p.id}>
              <td>
                <Link className="row-title" to={"/projects/" + p.id}>
                  {p.name}
                </Link>
                <small>{p.code}</small>
              </td>
              <td>
                <span className="category-tag">{p.field}</span>
              </td>
              <td>
                <div className="progress-label">
                  <span>
                    {p.approved}/{p.booklets.length} 分册确认
                  </span>
                  <b>
                    {Math.round(
                      (p.approved / Math.max(1, p.booklets.length)) * 100,
                    )}
                    %
                  </b>
                </div>
                <Progress
                  value={(p.approved / Math.max(1, p.booklets.length)) * 100}
                />
              </td>
              <td>
                {date(p.deadline)}
                <small>{remaining(p.deadline)}</small>
              </td>
              <td>{p.page_count} 页</td>
              <td>
                <Link to={"/projects/" + p.id}>查看项目 →</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!projects.length && <Empty>暂无项目，创建您的第一个方案</Empty>}
    </div>
  );
}
function Wizard() {
  const { run, user, notify } = useApp();
  const nav = useNavigate();
  const [users] = useLoad("/users");
  const [deps] = useLoad("/departments");
  const [step, setStep] = useState(1);
  const [q, setQ] = useState("");
  const [form, setForm] = useState<any>({
    name: "",
    code: "",
    description: "",
    field: "医学",
    deadline: "",
    leader_id: user.id,
    project_type: "",
    bid_date: "",
    leader_phone: "",
    leader_email: "",
    assignments: [],
  });
  if (user.role !== "business")
    return (
      <main className="main">
        <Empty>请使用商务账号立项</Empty>
      </main>
    );
  function change(k: string, v: any) {
    setForm({ ...form, [k]: v });
  }
  function select(u: any) {
    if (form.assignments.some((a: any) => a.user_id === u.id)) return;
    change("assignments", [
      ...form.assignments,
      {
        user_id: u.id,
        title:
          ((deps || []).find((d: any) => d.id === u.department_id)?.name ||
            u.name) + "专业分册",
        expected_pages: 4,
        instructions: "",
      },
    ]);
  }
  return (
    <main className="main wizard">
      <Link to="/projects" className="back">
        ← 返回项目管理
      </Link>
      <Heading
        title="新建项目方案"
        description="填写项目基本信息，邀请专业团队共同完成方案。"
      />
      <div className="stepper">
        <div className={step === 1 ? "current" : "complete"}>
          <b>{step === 1 ? "1" : "✓"}</b>
          <span>
            项目基本信息<small>PROJECT INFORMATION</small>
          </span>
        </div>
        <i />
        <div className={step === 2 ? "current" : ""}>
          <b>2</b>
          <span>
            选择人员<small>TEAM & ASSIGNMENTS</small>
          </span>
        </div>
        <i />
        <div>
          <b>✓</b>
          <span>
            创建完成<small>READY TO COLLABORATE</small>
          </span>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (step === 1) setStep(2);
          else
            run(async () => {
              const p = await api("/projects", {
                ...form,
                deadline: new Date(form.bid_date + "T23:59:59").toISOString(),
              });
              nav("/projects/" + p.id);
            });
        }}
      >
        {step === 1 ? (
          <section className="panel wizard-info">
            <header className="wizard-info-head">
              <div>
                <h2>项目基本信息</h2>
                <p>
                  请详细完善项目方案核心背景与排期，便于团队协作与方案编写。
                </p>
              </div>
              <span><b>*</b> 为必填项</span>
            </header>
            <div className="form-grid">
              <Field label="项目类型 *">
                <select
                  required
                  value={form.project_type}
                  onChange={(e) => change("project_type", e.target.value)}
                >
                  <option value="">请选择项目类型</option>
                  {[
                    "创新药临床研究项目方案（Phase I - III）",
                    "临床科研",
                    "学术演讲",
                    "汇报演示",
                    "数统分析",
                    "方案策划",
                    "培训课件",
                  ].map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </Field>
              <div className="field">
                <label htmlFor="project-code">项目编号</label>
                <input
                  id="project-code"
                  maxLength={80}
                  value={form.code}
                  onChange={(e) => change("code", e.target.value)}
                  placeholder="请输入项目编号"
                />
              </div>
              <div className="wizard-full-width">
                <Field label="项目名称 *">
                  <input
                    required
                    maxLength={200}
                    value={form.name}
                    onChange={(e) => change("name", e.target.value)}
                    placeholder="请输入项目名称"
                  />
                </Field>
              </div>
              <Field label="项目投标日期 *">
                <input
                  type="date"
                  required
                  value={form.bid_date}
                  onChange={(e) => change("bid_date", e.target.value)}
                />
              </Field>
              <Field label="项目负责人 *">
                <select
                  required
                  value={form.leader_id}
                  onChange={(e) => change("leader_id", e.target.value)}
                >
                  <option value="">请选择负责人</option>
                  {(users || [user])
                    .filter((u: any) => u.active)
                    .map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.name} · {u.employee_no}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="负责人联系方式 *">
                <input
                  type="tel"
                  required
                  maxLength={80}
                  value={form.leader_phone}
                  onChange={(e) => change("leader_phone", e.target.value)}
                  placeholder="请输入联系电话/手机号"
                />
              </Field>
              <Field label="负责人企业邮箱 *">
                <input
                  type="email"
                  required
                  maxLength={254}
                  value={form.leader_email}
                  onChange={(e) => change("leader_email", e.target.value)}
                  placeholder="请输入企业邮箱地址"
                />
              </Field>
            </div>
            <Field
              label={
                <span className="wizard-description-label">
                  项目简介与方案背景{" "}
                  <span className="muted">
                    {form.description.length} / 500字
                  </span>
                </span>
              }
            >
              <textarea
                rows={4}
                maxLength={500}
                value={form.description}
                onChange={(e) => change("description", e.target.value)}
                placeholder="请简要说明项目背景、目标及方案编写要求…"
              />
            </Field>
          </section>
        ) : (
          <div className="team-layout">
            <section className="panel team-tree">
              <h2>
                <Users size={20} />
                部门与人员
              </h2>
              <div className="search">
                <Search size={16} />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="搜索姓名 / 工号"
                />
              </div>
              {deps?.map((d: any) => {
                const members =
                  users?.filter(
                    (u: any) =>
                      u.active &&
                      u.department_id === d.id &&
                      (u.name + u.employee_no).includes(q),
                  ) || [];
                return (
                <details key={d.id} open={Boolean(q && members.length)}>
                  <summary>
                    {d.parent_id ? "↳ " : ""}
                    {d.name}
                    <span>{members.length}人</span>
                  </summary>
                  {members.map((u: any) => (
                      <button
                        type="button"
                        className="person-option"
                        key={u.id}
                        onClick={() => select(u)}
                      >
                        <span className="avatar small">{u.name.slice(-2)}</span>
                        <span>
                          {u.name}
                          <small>{u.employee_no}</small>
                        </span>
                        <Plus size={16} />
                      </button>
                    ))}
                </details>
                );
              })}
            </section>
            <section className="panel assignments">
              <div className="section-head">
                <h2>已选项目团队</h2>
                <Badge>{form.assignments.length} 位成员</Badge>
              </div>
              <p className="muted">商务负责人：{user.name} · 统一管理分册</p>
              {!form.assignments.length && (
                <Empty>从左侧选择参与人员，再填写分册要求</Empty>
              )}
              {form.assignments.map((a: any, i: number) => (
                <div className="assignment" key={a.user_id}>
                  <div className="flex between">
                    <b>{users?.find((u: any) => u.id === a.user_id)?.name}</b>
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={() =>
                        change(
                          "assignments",
                          form.assignments.filter(
                            (_: any, n: number) => n !== i,
                          ),
                        )
                      }
                    >
                      移除
                    </button>
                  </div>
                  <Field label="编写要求">
                    <textarea
                      value={a.instructions}
                      rows={2}
                      onChange={(e) =>
                        change(
                          "assignments",
                          form.assignments.map((x: any, n: number) =>
                            n === i
                              ? { ...x, instructions: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                  </Field>
                </div>
              ))}
            </section>
          </div>
        )}
        <div className="wizard-footer">
          <span>
            <ShieldCheck size={16} />
            创建后，成员将在工作台收到分册任务
          </span>
          <div>
            <Link className="button" to="/projects">
              取消
            </Link>
            {step === 2 && (
              <button type="button" onClick={() => setStep(1)}>
                上一步
              </button>
            )}
            <button
              className="primary"
              disabled={step === 2 && !form.assignments.length}
            >
              {step === 1 ? "下一步：选择人员" : "创建项目并分配任务"}
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}
function ProjectDetail() {
  const id = useLocation().pathname.split("/").pop();
  const [p, reload] = useLoad("/projects/" + id);
  const [users] = useLoad("/users");
  const { user, run, notify } = useApp();
  const [job, setJob] = useState<any>(null);
  const [review, setReview] = useState<any>(null);
  const [drag, setDrag] = useState("");
  if (!p) return <div className="loading">载入项目…</div>;
  const manager = user.id === p.business_id && user.role === "business";
  async function reorder(from: string, to: string) {
    if (!manager || from === to) return;
    const ids = p.booklets.map((b: any) => b.id);
    ids.splice(ids.indexOf(from), 1);
    ids.splice(ids.indexOf(to), 0, from);
    await api(
      "/projects/" + id + "/booklets",
      { ids, version: p.version },
      "PUT",
    );
    reload();
  }
  async function exportProject(format: string, draft: boolean) {
    setJob(await api("/projects/" + id + "/exports", { format, draft }));
  }
  return (
    <main className="main">
      <Link to="/projects" className="back">
        ← 项目方案管理
      </Link>
      <Heading
        eyebrow={p.code}
        title={p.name}
        description={p.description || "项目协同、专业确认与多源合订。"}
      >
        <Badge>{remaining(p.deadline)}</Badge>
        {manager && (
          <button
            onClick={() =>
              run(async () => {
                const r = await api("/projects/" + id + "/remind", {});
                notify(`已发送 ${r.count} 条站内提醒`);
              })
            }
          >
            <Bell size={16} />
            提醒协作成员
          </button>
        )}
      </Heading>
      <div className="project-summary panel">
        <div>
          <span className="muted">整体分册进度</span>
          <h2>
            {Math.round((p.approved / Math.max(1, p.booklets.length)) * 100)}
            <small>%</small>
          </h2>
          <Progress
            value={(p.approved / Math.max(1, p.booklets.length)) * 100}
          />
        </div>
        <div>
          <b>
            {p.approved} / {p.booklets.length}
          </b>
          <span>已确认分册</span>
        </div>
        <div>
          <b>{p.booklets.filter((b: any) => b.submission).length}</b>
          <span>已提交分册</span>
        </div>
        <div>
          <b>{p.page_count}</b>
          <span>当前草稿页数</span>
        </div>
        <div>
          <b>{date(p.deadline)}</b>
          <span>交付截止日期</span>
        </div>
      </div>
      <div className="section-head">
        <h2>
          专业分册与团队协同{" "}
          <span className="muted">{p.booklets.length} 个分册</span>
        </h2>
        <span className="muted">
          {manager ? "拖动分册调整合订顺序" : "按专业分工协同制作"}
        </span>
      </div>
      <div className="booklet-list">
        {p.booklets.map((b: any, i: number) => (
          <div
            className="booklet-card"
            key={b.id}
            draggable={manager}
            onDragStart={() => setDrag(b.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => run(() => reorder(drag, b.id))}
          >
            <div className="booklet-number">
              {manager && <GripVertical size={17} />}
              <span>{String(i + 1).padStart(2, "0")}</span>
            </div>
            <div className="booklet-content">
              <div className="flex between">
                <div>
                  <h3>{b.title}</h3>
                  <p>
                    {b.instructions || "使用部门模板规范，完成专业内容编写。"}
                  </p>
                </div>
                <Badge status={b.submission?.status || "draft"} />
              </div>
              <div className="booklet-previews">
                {b.previews?.map((pg: any) => (
                  <div key={pg.id}>
                    <Preview document={pg.document} mini />
                    <small>{pg.title}</small>
                  </div>
                ))}
              </div>
              <div className="booklet-bottom">
                <div className="flex">
                  <span className="avatar small">
                    {users
                      ?.find((u: any) => u.id === b.owner_id)
                      ?.name.slice(-2)}
                  </span>
                  <b>{users?.find((u: any) => u.id === b.owner_id)?.name}</b>
                  <span className="muted">{b.page_count} 页</span>
                  {b.has_new_draft && <Badge>另有未提交修改</Badge>}
                </div>
                <div className="flex">
                  {manager && (
                    <>
                      <button
                        className="icon"
                        disabled={!i}
                        title="上移分册"
                        onClick={() =>
                          run(() => reorder(b.id, p.booklets[i - 1].id))
                        }
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        className="icon"
                        disabled={i === p.booklets.length - 1}
                        title="下移分册"
                        onClick={() =>
                          run(() => reorder(b.id, p.booklets[i + 1].id))
                        }
                      >
                        <ArrowDown size={15} />
                      </button>
                    </>
                  )}
                  {b.submission && (
                    <button
                      onClick={() =>
                        run(async () => {
                          setReview(
                            await api("/submissions/" + b.submission.id),
                          );
                        })
                      }
                    >
                      查看确认版本
                    </button>
                  )}
                  <Link
                    className={
                      "button " + (b.owner_id === user.id ? "primary" : "")
                    }
                    to={"/booklets/" + b.id}
                  >
                    {b.owner_id === user.id ? "继续制作" : "查看草稿"}
                    <ArrowUpRight size={15} />
                  </Link>
                </div>
              </div>
              {b.submission?.review_comment && (
                <div className="review-note">
                  修改意见：{b.submission.review_comment}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="delivery panel">
        <div className="delivery-icon">
          <Layers3 size={27} />
        </div>
        <div>
          <h2>生成项目合订版</h2>
          <p>按分册顺序合并，正式交付采用已确认的固定版本。</p>
        </div>
        <div className="flex">
          <button onClick={() => run(() => exportProject("html", true))}>
            草稿预览
          </button>
          {manager && (
            <>
              <button
                disabled={p.approved !== p.booklets.length}
                onClick={() => run(() => exportProject("html", false))}
              >
                <Download size={16} />
                HTML
              </button>
              <button
                className="primary"
                disabled={p.approved !== p.booklets.length}
                onClick={() => run(() => exportProject("zip", false))}
              >
                <Download size={16} />
                导出合订 ZIP
              </button>
            </>
          )}
        </div>
      </div>
      {job && <JobView initial={job} onClose={() => setJob(null)} />}{" "}
      {review && (
        <Modal
          title="分册提交版本"
          subtitle="以下为提交时冻结的页面，后续草稿不会改变此版本。"
          wide
          onClose={() => setReview(null)}
        >
          <div className="modal-body review-pages">
            {review.pages.map((page: any, i: number) => (
              <article key={i}>
                <h3>
                  {i + 1}. {page.title}
                </h3>
                <Preview document={page.document} />
              </article>
            ))}
          </div>
          <footer className="modal-footer">
            <Badge status={review.status} />
            {review.review_comment}
          </footer>
        </Modal>
      )}
    </main>
  );
}
function Categories() {
  const { user, run } = useApp();
  const [cats, reload] = useLoad("/template-categories");
  const [edit, setEdit] = useState<any>(null);
  const [q, setQ] = useState("");
  if (user.role !== "admin") return <Empty>需要管理员权限</Empty>;
  return (
    <main className="main">
      <Heading
        eyebrow="ASSET CLASSIFICATION"
        title="模板分类维护"
        description="维护统一分类标准，让专业资产有序沉淀。"
      >
        <button
          className="primary"
          onClick={() => setEdit({ name: "", active: true })}
        >
          <Plus size={17} />
          新增一级分类
        </button>
      </Heading>
      <div className="info-banner">
        <LayoutGrid size={27} />
        <div>
          <b>规范分类 · 高效复用</b>
          <p>分类停用后不再显示于模板选择中，已使用的项目页面不受影响。</p>
        </div>
        <span>{cats?.length || 0} 个分类</span>
      </div>
      <div className="panel">
        <div className="filter-bar">
          <h2>分类列表</h2>
          <div className="search">
            <Search size={16} />
            <input
              placeholder="搜索分类名称"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>分类名称</th>
              <th>关联模板</th>
              <th>状态</th>
              <th>创建日期</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {cats
              ?.filter((c: any) => c.name.includes(q))
              .map((c: any) => (
                <tr key={c.id}>
                  <td>
                    <span className="folder-icon">
                      <FolderOpen size={18} />
                    </span>
                    <b>{c.name}</b>
                  </td>
                  <td>{c.count} 套</td>
                  <td>
                    <Badge status={c.active ? "approved" : "returned"}>
                      {c.active ? "已启用" : "已停用"}
                    </Badge>
                  </td>
                  <td>{date(c.created_at)}</td>
                  <td>
                    <button className="text-button" onClick={() => setEdit(c)}>
                      重命名
                    </button>
                    <button
                      className="text-button muted"
                      onClick={() =>
                        run(async () => {
                          await api(
                            "/template-categories/" + c.id,
                            { name: c.name, active: !c.active },
                            "PATCH",
                          );
                          reload();
                        })
                      }
                    >
                      {c.active ? "停用" : "启用"}
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal
          title={edit.id ? "重命名分类" : "新增分类"}
          onClose={() => setEdit(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api(
                  "/template-categories" + (edit.id ? "/" + edit.id : ""),
                  { name: edit.name, active: edit.active },
                  edit.id ? "PATCH" : "POST",
                );
                setEdit(null);
                reload();
              });
            }}
          >
            <div className="modal-body">
              <Field label="分类名称">
                <input
                  autoFocus
                  required
                  maxLength={100}
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </Field>
            </div>
            <footer className="modal-footer">
              <button type="button" onClick={() => setEdit(null)}>
                取消
              </button>
              <button className="primary">保存分类</button>
            </footer>
          </form>
        </Modal>
      )}
    </main>
  );
}
export function TemplatePicker({ onSelect, onClose }: any) {
  const [templates] = useLoad("/templates");
  const [cats] = useLoad("/template-categories");
  const [deps] = useLoad("/departments");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [dep, setDep] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  return (
    <Modal
      title="从部门模板库添加"
      subtitle="选择专业模板，专注核心内容。导入后将创建独立页面副本。"
      wide
      onClose={onClose}
    >
      <div className="template-filter">
        <div className="search">
          <Search size={17} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索模板名称"
          />
        </div>
        <select value={dep} onChange={(e) => setDep(e.target.value)}>
          <option value="">全部部门</option>
          {deps?.map((d: any) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className="category-tabs">
        <button className={!cat ? "selected" : ""} onClick={() => setCat("")}>
          全部模板
        </button>
        {cats
          ?.filter((c: any) => c.active)
          .map((c: any) => (
            <button
              key={c.id}
              className={cat === c.id ? "selected" : ""}
              onClick={() => setCat(c.id)}
            >
              {c.name}
            </button>
          ))}
      </div>
      <div className="modal-body template-grid">
        {templates
          ?.filter(
            (t: any) =>
              t.status === "published" &&
              t.active &&
              t.name.includes(q) &&
              (!cat || t.category_id === cat) &&
              (!dep || t.department_id === dep),
          )
          .map((t: any) => (
            <button
              className={
                "template-card " + (chosen.includes(t.id) ? "chosen" : "")
              }
              key={t.id}
              onClick={() =>
                setChosen(
                  chosen.includes(t.id)
                    ? chosen.filter((x) => x !== t.id)
                    : [...chosen, t.id],
                )
              }
            >
              <div className="template-image">
                <Preview document={t.documents[0]} mini miniViewportWidth={1520} miniViewportHeight={900} />
                <span className="template-tag">
                  {cats?.find((c: any) => c.id === t.category_id)?.name}
                </span>
                <span className="check-box">
                  {chosen.includes(t.id) ? "✓" : ""}
                </span>
              </div>
              <h3>{t.name}</h3>
              <p>
                {t.documents.length} 页 · {t.shared ? "共享模板" : "部门专属"}
              </p>
            </button>
          ))}
      </div>
      <footer className="modal-footer">
        <span className="grow muted">
          已选 <b>{chosen.length}</b> 套模板
        </span>
        <button onClick={onClose}>取消</button>
        <button
          className="primary"
          disabled={!chosen.length}
          onClick={() => onSelect(chosen)}
        >
          确认导入至工作台 <ArrowRight size={16} />
        </button>
      </footer>
    </Modal>
  );
}
function Templates() {
  const { user, run, notify } = useApp();
  const [templates, reload] = useLoad("/templates");
  const [cats] = useLoad("/template-categories");
  const [deps] = useLoad("/departments");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [ingest, setIngest] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [editingInfo, setEditingInfo] = useState<any>(null);
  const [editingContent, setEditingContent] = useState<any>(null);
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoError, setInfoError] = useState("");
  const [job, setJob] = useState<any>(null);
  const [downloadMode, setDownloadMode] = useState(false);
  const [downloadSelection, setDownloadSelection] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  const filteredTemplates = templates?.filter(
    (t: any) =>
      t.name.includes(q) &&
      (!selectedCategories.length ||
        selectedCategories.includes(t.category_id)),
  );
  async function downloadOne(template: any) {
    setDownloading(true);
    try {
      await downloadFile(`/templates/${template.id}/download`);
      notify(`已开始下载「${template.name}」`);
    } catch (error: any) {
      notify(error.message);
    } finally {
      setDownloading(false);
    }
  }
  async function downloadSelected() {
    if (!downloadSelection.length) return;
    setDownloading(true);
    try {
      await downloadFile("/templates/download", { template_ids: downloadSelection });
      notify(`已开始下载 ${downloadSelection.length} 套模板`);
      setDownloadSelection([]);
      setDownloadMode(false);
    } catch (error: any) {
      notify(error.message);
    } finally {
      setDownloading(false);
    }
  }
  if (editingContent) {
    return (
      <TemplateContentEditor
        template={editingContent}
        onClose={() => setEditingContent(null)}
        onSaved={() => {
          setEditingContent(null);
          reload();
          notify("模板内容已保存为新版本");
        }}
      />
    );
  }
  return (
    <main className="main">
      <Heading
        eyebrow="PROFESSIONAL ASSET LIBRARY"
        title={user.role === "admin" ? "PPT 模板资产库" : "部门模板库"}
        description="可复用的医学视觉资产，为每一次专业表达提供标准起点。"
      >
        {user.role === "admin" && (
          <div className="heading-actions">
            <button
              className={downloadMode ? "button selected" : "button"}
              onClick={() => {
                setDownloadMode((value) => !value);
                setDownloadSelection([]);
              }}
            >
              <Download size={16} />
              {downloadMode ? "取消批量下载" : "批量下载"}
            </button>
            <button
              className="primary"
              onClick={() => {
                setIngest(true);
              }}
            >
              <Plus size={17} />
              新增模板入库
            </button>
          </div>
        )}
      </Heading>
      <div className="panel template-library-panel">
        <div className="filter-bar library-filter-bar">
          <span className="muted">
            共 {filteredTemplates?.length || 0} 套模板
          </span>
          {downloadMode && (
            <div className="template-batch-download-bar">
              <span>已选 {downloadSelection.length} 套</span>
              <button
                className="primary"
                disabled={!downloadSelection.length || downloading}
                onClick={downloadSelected}
              >
                <Download size={15} />
                {downloading ? "打包中…" : "下载已选模板"}
              </button>
            </div>
          )}
          <div className="library-filter-controls">
            <TemplateCategoryFilter
              categories={cats || []}
              selected={selectedCategories}
              onChange={setSelectedCategories}
            />
            <div className="search">
              <Search size={16} />
              <input
                placeholder="搜索模板名称"
                aria-label="搜索模板名称"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="template-grid library-grid">
          {filteredTemplates?.map((t: any) => (
            <article className="template-card" key={t.id}>
              <button
                className="template-preview-trigger"
                aria-label={`预览模板 ${t.name}`}
                onClick={() =>
                  downloadMode
                    ? setDownloadSelection((items) =>
                        items.includes(t.id)
                          ? items.filter((id) => id !== t.id)
                          : [...items, t.id],
                      )
                    : setDetail(t)
                }
              >
                <div className="template-image">
                  <Preview document={t.documents[0]} mini miniViewportWidth={1520} miniViewportHeight={900} />
                  <span
                    className={
                      "template-status-label " +
                      (t.active ? "enabled" : "disabled")
                    }
                  >
                    {t.active ? "已启用" : "已停用"}
                  </span>
                  <span className="template-tag">
                    {cats?.find((c: any) => c.id === t.category_id)?.name}
                  </span>
                  {downloadMode && (
                    <span
                      className={
                        "template-download-check " +
                        (downloadSelection.includes(t.id) ? "selected" : "")
                      }
                    >
                      {downloadSelection.includes(t.id) ? "✓" : ""}
                    </span>
                  )}
                </div>
                <h3>{t.name}</h3>
              </button>
              <div className="template-card-bottom">
                <div className="template-card-actions">
                  <button
                    className="template-icon-button"
                    data-tooltip="预览"
                    aria-label={`预览模板 ${t.name}`}
                    onClick={() => setDetail(t)}
                  >
                    <Eye size={16} />
                  </button>
                  <button
                    className="template-icon-button"
                    data-tooltip="下载"
                    aria-label={`下载模板 ${t.name}`}
                    disabled={downloading}
                    onClick={() => downloadOne(t)}
                  >
                    <Download size={16} />
                  </button>
                  {user.role === "admin" && (
                    <>
                      <button
                        className="template-icon-button"
                        data-tooltip="编辑"
                        aria-label={`修改模板信息 ${t.name}`}
                        onClick={() => {
                          setInfoError("");
                          setDetail(t);
                          setEditingInfo({
                            name: t.name,
                            category_id: t.category_id,
                            department_id: t.department_id || "",
                            shared: t.shared,
                          });
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="template-icon-button"
                        data-tooltip="设计"
                        aria-label={`设计模板内容 ${t.name}`}
                        onClick={() => setEditingContent(t)}
                      >
                        <Palette size={16} />
                      </button>
                      <button
                        className="template-icon-button danger-icon"
                        data-tooltip="删除"
                        aria-label={`删除模板 ${t.name}`}
                        onClick={() => {
                          setDeleteError("");
                          setDeleteTarget(t);
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                      <button
                        className={
                          "template-switch " + (t.active ? "on" : "off")
                        }
                        role="switch"
                        aria-checked={t.active}
                        data-tooltip={t.active ? "停用" : "启用"}
                        aria-label={t.active ? "停用模板" : "启用模板"}
                        onClick={() =>
                          run(async () => {
                            await api(
                              `/templates/${t.id}`,
                              { active: !t.active },
                              "PATCH",
                            );
                            reload();
                            notify(t.active ? "模板已停用" : "模板已启用");
                          })
                        }
                      >
                        <span className="template-switch-track">
                          <span className="template-switch-knob" />
                        </span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
        {filteredTemplates?.length === 0 && (
          <Empty>没有符合筛选条件的模板</Empty>
        )}
      </div>
      {ingest && (
        <TemplateImportDialog
          categories={cats || []}
          departments={deps || []}
          onClose={() => setIngest(false)}
          onImported={(jobs) => {
            setIngest(false);
            setJob(jobs[0]);
            if (jobs.length > 1)
              notify(
                `已创建 ${jobs.length} 个导入任务，可在任务中心查看全部进度`,
              );
          }}
        />
      )}
      {detail && !deleteTarget && !editingInfo && !editingContent && (
        <Modal
          title={detail.name}
          wide
          className="template-detail-modal"
          onClose={() => setDetail(null)}
        >
          <div className="modal-body review-pages">
            {detail.diagnostics.map((d: any, i: number) => (
              <p
                className={
                  "diagnostic " + (d.severity === "error" ? "error" : "")
                }
                key={i}
              >
                {d.message}
              </p>
            ))}
            {detail.documents.map((d: any, i: number) => (
              <div key={i}>
                <h3>第 {i + 1} 页</h3>
                <Preview
                  document={d}
                  interactive
                  scrollable
                  className="template-detail-preview"
                  title={`${detail.name} · 第 ${i + 1} 页`}
                />
              </div>
            ))}
          </div>
          <footer className="modal-footer template-detail-footer">
            <p className="template-detail-meta muted">
              分类：
              {cats?.find((c: any) => c.id === detail.category_id)?.name || "—"}
              {" · 所属部门："}
              {deps?.find((d: any) => d.id === detail.department_id)?.name ||
                "平台公共资产"}
              {detail.shared ? " · 跨部门共享" : " · 部门专属"}
            </p>
          </footer>
        </Modal>
      )}
      {editingInfo && (
        <Modal
          title="编辑模板信息"
          subtitle="修改标题、分类和所属部门后立即更新模板资料。"
          onClose={() => {
            if (!savingInfo) {
              setEditingInfo(null);
              setDetail(null);
            }
          }}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (savingInfo) return;
              setSavingInfo(true);
              setInfoError("");
              try {
                const updated = await api(
                  `/templates/${detail.id}`,
                  editingInfo,
                  "PATCH",
                );
                setEditingInfo(null);
                setDetail(null);
                reload();
                notify("模板信息已保存");
              } catch (error: any) {
                setInfoError(error.message);
              } finally {
                setSavingInfo(false);
              }
            }}
          >
            <div className="modal-body">
              <Field label="模板标题">
                <input
                  required
                  maxLength={200}
                  value={editingInfo.name}
                  onChange={(e) =>
                    setEditingInfo({ ...editingInfo, name: e.target.value })
                  }
                />
              </Field>
              <Field label="模板分类">
                <select
                  required
                  value={editingInfo.category_id}
                  onChange={(e) =>
                    setEditingInfo({
                      ...editingInfo,
                      category_id: e.target.value,
                    })
                  }
                >
                  {cats
                    ?.filter(
                      (c: any) => c.active || c.id === detail.category_id,
                    )
                    .map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="所属部门">
                <select
                  value={editingInfo.department_id || ""}
                  onChange={(e) =>
                    setEditingInfo({
                      ...editingInfo,
                      department_id: e.target.value || null,
                    })
                  }
                >
                  <option value="">平台公共资产</option>
                  {deps?.map((d: any) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={editingInfo.shared}
                  onChange={(e) =>
                    setEditingInfo({ ...editingInfo, shared: e.target.checked })
                  }
                />
                跨部门共享
              </label>
              {infoError && (
                <p className="error" role="alert">
                  {infoError}
                </p>
              )}
            </div>
            <footer className="modal-footer">
              <button
                type="button"
                disabled={savingInfo}
                onClick={() => {
                  setEditingInfo(null);
                  setDetail(null);
                }}
              >
                取消
              </button>
              <button className="primary" disabled={savingInfo}>
                {savingInfo ? "保存中…" : "保存信息"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {deleteTarget && (
        <Modal
          title="删除模板"
          onClose={() => {
            if (!deleting) setDeleteTarget(null);
          }}
        >
          <div className="modal-body">
            <p>确定删除「{deleteTarget.name}」吗？</p>
            <p className="muted">
              删除后将从模板库移除，无法再次选用。已有项目中的页面副本和历史版本不受影响。
            </p>
            {deleteError && (
              <p className="error" role="alert">
                {deleteError}
              </p>
            )}
          </div>
          <footer className="modal-footer">
            <button disabled={deleting} onClick={() => setDeleteTarget(null)}>
              取消
            </button>
            <button
              className="danger"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                setDeleteError("");
                try {
                  await api(
                    "/templates/" + deleteTarget.id,
                    undefined,
                    "DELETE",
                  );
                  setDeleteTarget(null);
                  setDetail(null);
                  reload();
                  notify("模板已删除");
                } catch (error: any) {
                  setDeleteError(error.message);
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? "正在删除…" : "确认删除"}
            </button>
          </footer>
        </Modal>
      )}
      {job && (
        <JobView
          initial={job}
          onClose={() => {
            setJob(null);
            reload();
          }}
          onDone={reload}
          onTemplate={(id: string) =>
            run(async () => {
              const items = await api("/templates");
              const item = items.find((t: any) => t.id === id);
              if (!item) throw new Error("模板已删除或不可用");
              setJob(null);
              setDetail(item);
            })
          }
        />
      )}
    </main>
  );
}
function People() {
  const { user, run } = useApp();
  const [users, reload] = useLoad("/users");
  const [deps, reloadDeps] = useLoad("/departments");
  const [edit, setEdit] = useState<any>(null);
  const [department, setDepartment] = useState<any>(null);
  if (user.role !== "admin") return <Empty>需要管理员权限</Empty>;
  return (
    <main className="main">
      <Heading
        eyebrow="ORGANIZATION"
        title="组织与人员"
        description="维护部门架构与内部账号，支持按真实人员指派分册。"
      >
        <button onClick={() => setDepartment({ name: "", parent_id: "" })}>
          新增部门
        </button>
        <button
          className="primary"
          onClick={() =>
            setEdit({
              username: "",
              name: "",
              password: "",
              role: "contributor",
              department_id: "",
              employee_no: "",
            })
          }
        >
          <Plus size={17} />
          新增人员
        </button>
      </Heading>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>人员</th>
              <th>账号 / 工号</th>
              <th>部门</th>
              <th>角色</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((u: any) => (
              <tr key={u.id}>
                <td>
                  <div className="flex">
                    <span className="avatar">{u.name.slice(-2)}</span>
                    <b>{u.name}</b>
                  </div>
                </td>
                <td>
                  {u.username}
                  <small>{u.employee_no || "未设置工号"}</small>
                </td>
                <td>
                  {deps?.find((d: any) => d.id === u.department_id)?.name ||
                    "—"}
                </td>
                <td>{roleNames[u.role]}</td>
                <td>
                  <Badge status={u.active ? "approved" : "returned"}>
                    {u.active ? "启用" : "停用"}
                  </Badge>
                </td>
                <td>
                  <button
                    disabled={u.id === user.id}
                    className="text-button"
                    onClick={() =>
                      run(async () => {
                        await api(
                          "/users/" + u.id,
                          { active: !u.active },
                          "PATCH",
                        );
                        reload();
                      })
                    }
                  >
                    {u.active ? "停用" : "启用"}
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      setEdit({ id: u.id, password: "", name: u.name })
                    }
                  >
                    重设密码
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal
          title={edit.id ? "重设密码 · " + edit.name : "新增内部人员"}
          onClose={() => setEdit(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api(
                  "/users" + (edit.id ? "/" + edit.id : ""),
                  edit.id
                    ? { password: edit.password }
                    : { ...edit, department_id: edit.department_id || null },
                  edit.id ? "PATCH" : "POST",
                );
                setEdit(null);
                reload();
              });
            }}
          >
            <div className="modal-body form-grid">
              {!edit.id && (
                <>
                  {[
                    ["name", "姓名"],
                    ["username", "登录账号"],
                    ["employee_no", "工号"],
                  ].map(([k, l]) => (
                    <Field key={k} label={l}>
                      <input
                        required={k !== "employee_no"}
                        value={edit[k]}
                        onChange={(e) =>
                          setEdit({ ...edit, [k]: e.target.value })
                        }
                      />
                    </Field>
                  ))}
                  <Field label="部门">
                    <select
                      value={edit.department_id}
                      onChange={(e) =>
                        setEdit({ ...edit, department_id: e.target.value })
                      }
                    >
                      <option value="">请选择部门</option>
                      {deps?.map((d: any) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="角色">
                    <select
                      value={edit.role}
                      onChange={(e) =>
                        setEdit({ ...edit, role: e.target.value })
                      }
                    >
                      {Object.entries(roleNames).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
              <Field label="密码（至少 8 位）">
                <input
                  type="password"
                  minLength={8}
                  required
                  value={edit.password}
                  onChange={(e) =>
                    setEdit({ ...edit, password: e.target.value })
                  }
                />
              </Field>
            </div>
            <footer className="modal-footer">
              <button className="primary">保存</button>
            </footer>
          </form>
        </Modal>
      )}
      {department && (
        <Modal title="新增部门" onClose={() => setDepartment(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api("/departments", {
                  ...department,
                  parent_id: department.parent_id || null,
                });
                setDepartment(null);
                reloadDeps();
              });
            }}
          >
            <div className="modal-body">
              <Field label="部门名称">
                <input
                  required
                  value={department.name}
                  onChange={(e) =>
                    setDepartment({ ...department, name: e.target.value })
                  }
                />
              </Field>
              <Field label="上级部门">
                <select
                  value={department.parent_id}
                  onChange={(e) =>
                    setDepartment({ ...department, parent_id: e.target.value })
                  }
                >
                  <option value="">顶级部门</option>
                  {deps?.map((d: any) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <footer className="modal-footer">
              <button className="primary">保存</button>
            </footer>
          </form>
        </Modal>
      )}
    </main>
  );
}
function Jobs() {
  const [jobs, reload] = useLoad("/jobs");
  const [job, setJob] = useState<any>(null);
  useEffect(() => {
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <main className="main">
      <Heading
        eyebrow="TASK CENTER"
        title="任务中心"
        description="生成、转换和导出任务均会保留。关闭窗口不会丢失处理结果。"
      />
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>任务</th>
              <th>当前阶段</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {jobs?.map((j: any) => (
              <tr key={j.id}>
                <td>
                  {
                    {
                      ai: "AI 页面设计",
                      template_ai: "模板 AI 设计",
                      html_import: "页面导入",
                      pptx_import: "PPTX 模板入库",
                      export: "合订导出",
                    }[j.kind as string]
                  }
                  <small>{j.id.slice(0, 8)}</small>
                </td>
                <td>{j.stage}</td>
                <td>
                  <Badge status={j.status} />
                </td>
                <td>{date(j.created_at)}</td>
                <td>
                  {j.payload.booklet_id ? (
                    <Link to={"/booklets/" + j.payload.booklet_id}>
                      返回工作台
                    </Link>
                  ) : (
                    <button className="text-button" onClick={() => setJob(j)}>
                      查看结果
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!jobs?.length && <Empty>暂无处理任务</Empty>}
      </div>
      {job && (
        <JobView initial={job} onClose={() => setJob(null)} onDone={reload} />
      )}
    </main>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
