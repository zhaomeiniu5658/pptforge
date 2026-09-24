import { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Folder,
  Tag,
  Search,
  Plus,
  Download,
  ChevronLeft,
  ChevronRight,
  Pencil,
} from "lucide-react";
import { Context } from "./App";
import { api } from "./api";
import { Empty, Modal, Field, JobView } from "./components";
import { ProjectDatePicker } from "./ProjectDatePicker";
import "./project-management.css";

type Project = {
  id: string;
  name: string;
  code: string;
  description: string;
  field: string;
  deadline: string;
  project_type?: string;
  bid_date?: string;
  leader_phone?: string;
  leader_email?: string;
  leader_id: string;
  business_id: string;
  created_at: string;
  updated_at?: string;
  page_count: number;
  approved: number;
  booklets: any[];
  members: { user_id: string }[];
};
const fields = [
  "核药",
  "CNS",
  "心血管",
  "肿瘤",
  "呼吸",
  "医疗器械",
  "抗感染",
  "代谢/内分泌",
  "消化/肝病",
  "其他",
];
const colors = [
  "#f59e0b",
  "#f43f5e",
  "#ef4444",
  "#eab308",
  "#f97316",
  "#14b8a6",
  "#d97706",
  "#6366f1",
  "#db2777",
  "#94a3b8",
];
const initialFilters = { q: "", status: "", start: "", end: "" };
function progress(p: Project) {
  if (p.booklets.length && p.approved === p.booklets.length) return "approved";
  if (p.page_count) return "draft";
  return "pending";
}
function day(v: string) {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(+d)
    ? "—"
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function time(v: string) {
  return v
    ? new Date(v).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "";
}

export function ProjectManagement() {
  const { user, notify } = useContext(Context);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("");
  const [form, setForm] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [targets, setTargets] = useState<Project[] | null>(null);
  const [format, setFormat] = useState("zip");
  const [draft, setDraft] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exports, setExports] = useState<
    { id: string; name: string; job?: any; error?: string }[]
  >([]);
  const [job, setJob] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([api("/projects"), api("/users")])
      .then(([ps, us]) => {
        if (active) {
          setProjects(ps);
          setUsers(us);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const categories = [
    ...fields,
    ...new Set(projects.map((p) => p.field).filter((x) => !fields.includes(x))),
  ];
  const color = (field: string) =>
    colors[categories.indexOf(field) % colors.length] || colors[9];
  const name = (id: string) => users.find((u) => u.id === id)?.name || "—";
  const visible = projects.filter(
    (p) =>
      (!category || p.field === category) &&
      (!filters.q ||
        (p.name + " " + p.code)
          .toLowerCase()
          .includes(filters.q.trim().toLowerCase())) &&
      (!filters.status || progress(p) === filters.status) &&
      (!filters.start || day(p.deadline) >= filters.start) &&
      (!filters.end || day(p.deadline) <= filters.end),
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / 7));
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);
  const rows = visible.slice((page - 1) * 7, page * 7);
  const allChecked =
    rows.length > 0 && rows.every((p) => selected.includes(p.id));
  const canFormal = (p: Project) =>
    progress(p) === "approved" &&
    (user.role === "admin" || p.business_id === user.id);
  function openExport(ps: Project[]) {
    setTargets(ps);
    setExports([]);
    setDraft(!ps.every(canFormal));
    setFormat("zip");
  }
  function selectCategory(value: string) {
    setCategory(value);
    setPage(1);
    setSelected([]);
  }
  async function deleteProject() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api("/projects/" + deleteTarget.id, undefined, "DELETE");
      setProjects((current) => current.filter((p) => p.id !== deleteTarget.id));
      setSelected((current) => current.filter((id) => id !== deleteTarget.id));
      setPage(1);
      setDeleteTarget(null);
      notify("项目已删除");
    } catch (e: any) {
      setDeleteError(e.message);
    } finally {
      setDeleting(false);
    }
  }
  function openEdit(project: Project) {
    setEditTarget(project);
    setEditError("");
    setEditForm({
      name: project.name,
      project_type: project.project_type || "",
      bid_date: project.bid_date || day(project.deadline),
      leader_id: project.leader_id,
      leader_phone: project.leader_phone || "",
      leader_email: project.leader_email || "",
      description: project.description || "",
    });
  }
  async function saveProject() {
    if (!editTarget || editing) return;
    setEditing(true);
    setEditError("");
    try {
      const updated = await api(
        "/projects/" + editTarget.id,
        {
          ...editForm,
          deadline: editForm.bid_date
            ? new Date(editForm.bid_date + "T23:59:59").toISOString()
            : editTarget.deadline,
        },
        "PUT",
      );
      setProjects((current) =>
        current.map((project) =>
          project.id === editTarget.id ? { ...project, ...updated } : project,
        ),
      );
      setEditTarget(null);
      setEditForm(null);
      notify("项目已更新");
    } catch (e: any) {
      setEditError(e.message);
    } finally {
      setEditing(false);
    }
  }
  async function startExports() {
    if (!targets) return;
    setBusy(true);
    const outcomes = [];
    for (const p of targets) {
      try {
        outcomes.push({
          id: p.id,
          name: p.name,
          job: await api("/projects/" + p.id + "/exports", { format, draft }),
        });
      } catch (e: any) {
        outcomes.push({ id: p.id, name: p.name, error: e.message });
      }
      setExports([...outcomes]);
    }
    setBusy(false);
  }
  return (
    <main className="pm-page">
      <section className="pm-hero">
        <div className="pm-hero-copy">
          <span className="pm-folder">
            <Folder size={30} />
          </span>
          <div>
            <h1>项目管理</h1>
            <p>管理和复用项目方案，快速创建专业内容，提升工作效率。</p>
          </div>
        </div>
        <div className="pm-deck" aria-hidden="true">
          <b>PRESENTATION</b>
          <div>
            <span>P</span>
            <i />
          </div>
        </div>
      </section>
      <section className="pm-panel" aria-label="项目方案管理">
        <div className="pm-categories-row">
          <div className="pm-categories">
            <span className="pm-category-label">
              <Tag size={14} />
              项目分类:
            </span>
            <button
              className={!category ? "active" : ""}
              onClick={() => selectCategory("")}
            >
              全部 ({projects.length})
            </button>
            {categories.map((f) => (
              <button
                key={f}
                className={category === f ? "active" : ""}
                onClick={() => selectCategory(f)}
              >
                <i style={{ background: color(f) }} />
                {f} ({projects.filter((p) => p.field === f).length})
              </button>
            ))}
          </div>
          <div className="pm-primary-actions">
            <button
              disabled={!selected.length}
              onClick={() =>
                openExport(projects.filter((p) => selected.includes(p.id)))
              }
            >
              <Download size={14} />
              批量导出{selected.length ? ` (${selected.length})` : ""}
            </button>
            {user.role === "business" && (
              <Link className="button primary" to="/projects/new">
                <Plus size={15} />
                新建项目
              </Link>
            )}
          </div>
        </div>
        <form
          className="pm-filters"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.start && form.end && form.start > form.end) {
              notify("开始日期不能晚于结束日期");
              return;
            }
            setFilters({ ...form });
            setPage(1);
            setSelected([]);
          }}
        >
          <div className="pm-filter-inputs">
            <label className="pm-search">
              <Search size={14} />
              <input
                aria-label="搜索项目名称、方案编号"
                placeholder="搜索项目名称、方案编号..."
                value={form.q}
                onChange={(e) => setForm({ ...form, q: e.target.value })}
              />
            </label>
            <select
              aria-label="方案状态"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="">方案状态：全部</option>
              <option value="approved">已完成（全部确认）</option>
              <option value="draft">草稿（编辑中）</option>
              <option value="pending">待制作</option>
            </select>
            <div className="pm-date-range">
              <span>截止时间:</span>
              <ProjectDatePicker
                label="截止开始日期"
                value={form.start}
                max={form.end || undefined}
                onChange={(start) =>
                  setForm((current) => ({ ...current, start }))
                }
              />
              <span>–</span>
              <ProjectDatePicker
                label="截止结束日期"
                min={form.start || undefined}
                value={form.end}
                onChange={(end) => setForm((current) => ({ ...current, end }))}
              />
            </div>
          </div>
          <div className="pm-filter-actions">
            <button className="primary" type="submit">
              查询
            </button>
            <button
              type="button"
              onClick={() => {
                setForm(initialFilters);
                setFilters(initialFilters);
                setCategory("");
                setPage(1);
                setSelected([]);
              }}
            >
              重置
            </button>
          </div>
        </form>
        <div className="pm-table-scroll">
          <table className="pm-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="选择本页项目"
                    checked={allChecked}
                    ref={(el) => {
                      if (el)
                        el.indeterminate =
                          !allChecked &&
                          rows.some((p) => selected.includes(p.id));
                    }}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [
                              ...new Set([
                                ...selected,
                                ...rows.map((p) => p.id),
                              ]),
                            ]
                          : selected.filter(
                              (id) => !rows.some((p) => p.id === id),
                            ),
                      )
                    }
                  />
                </th>
                <th>项目编号</th>
                <th>项目名称 / 方案概述</th>
                <th>截止时间</th>
                <th>所属分类</th>
                <th>项目负责人</th>
                <th>参与成员</th>
                <th>方案进度/状态</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const state = progress(p);
                const memberIds = [...new Set(p.members.map((m) => m.user_id))];
                return (
                  <tr
                    key={p.id}
                    className={selected.includes(p.id) ? "pm-selected" : ""}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={"选择项目 " + p.name}
                        checked={selected.includes(p.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, p.id]
                              : selected.filter((id) => id !== p.id),
                          )
                        }
                      />
                    </td>
                    <td className="pm-code">{p.code}</td>
                    <td className="pm-title-cell">
                      <Link to={"/projects/" + p.id}>{p.name}</Link>
                      <p title={p.description}>
                        {p.description || "暂无方案概述"}
                      </p>
                    </td>
                    <td className="pm-date">{day(p.deadline)}</td>
                    <td>
                      <span
                        className="pm-field-tag"
                        style={{
                          color: color(p.field),
                          background: color(p.field) + "0d",
                          borderColor: color(p.field) + "30",
                        }}
                      >
                        <i style={{ background: color(p.field) }} />
                        {p.field}
                      </span>
                    </td>
                    <td>
                      <span className="pm-person">
                        <i className="pm-avatar">
                          {name(p.leader_id).slice(0, 1)}
                        </i>
                        {name(p.leader_id)}
                      </span>
                    </td>
                    <td>
                      <div className="pm-members">
                        {memberIds.slice(0, 3).map((id, i) => (
                          <span
                            key={id}
                            title={name(id)}
                            className={"pm-avatar pm-avatar-" + i}
                          >
                            {name(id).slice(0, 1)}
                          </span>
                        ))}
                        <small>{memberIds.length}人</small>
                      </div>
                    </td>
                    <td>
                      <span className={"pm-status pm-status-" + state}>
                        <i />
                        {state === "approved"
                          ? `已完成 (${p.page_count}页)`
                          : state === "draft"
                              ? "草稿 (编辑中)"
                              : "待制作"}
                      </span>
                      <small className="pm-progress-note">
                        {p.approved}/{p.booklets.length} 分册确认
                        {state !== "approved" ? ` · ${p.page_count}页` : ""}
                      </small>
                    </td>
                    <td className="pm-updated">
                      {day(p.updated_at || p.created_at)}
                      <small>{time(p.updated_at || p.created_at)}</small>
                    </td>
                    <td>
                      <div className="pm-row-actions">
                        <Link to={"/projects/" + p.id}>查看方案</Link>
                        {user.role === "business" &&
                          p.business_id === user.id && (
                            <button
                              type="button"
                              className="pm-secondary-link"
                              onClick={() => openEdit(p)}
                            >
                              <Pencil size={12} />
                              编辑
                            </button>
                          )}
                        {user.role === "contributor" &&
                          p.booklets.find((b) => b.owner_id === user.id) && (
                            <Link
                              className="pm-secondary-link"
                              to={
                                "/booklets/" +
                                p.booklets.find((b) => b.owner_id === user.id)
                                  .id
                              }
                            >
                              编辑
                            </Link>
                          )}
                        <button
                          type="button"
                          onClick={() => openExport([p])}
                          disabled={!p.page_count}
                        >
                          导出
                        </button>
                        {user.role === "business" &&
                          p.business_id === user.id && (
                            <button
                              type="button"
                              className="pm-delete-button"
                              aria-label={"删除项目 " + p.name}
                              onClick={() => {
                                setDeleteError("");
                                setDeleteTarget(p);
                              }}
                            >
                              删除
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loading ? (
            <div className="loading">正在加载项目…</div>
          ) : error ? (
            <p className="error">{error}</p>
          ) : (
            !visible.length && <Empty>没有符合筛选条件的项目</Empty>
          )}
        </div>
        <div className="pm-pagination">
          <span>
            共 {visible.length} 个项目
            {selected.length ? ` · 已选 ${selected.length} 项` : ""}
          </span>
          <div>
            <button
              aria-label="上一页"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft size={14} />
            </button>
            <span>
              {page} / {pageCount}
            </span>
            <button
              aria-label="下一页"
              disabled={page >= pageCount}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </section>
      {editTarget && editForm && (
        <Modal
          title="编辑项目"
          subtitle="更新项目基本信息"
          onClose={() => {
            if (!editing) setEditTarget(null);
          }}
        >
          <div className="modal-body pm-edit-body">
            <div className="pm-edit-grid">
              <Field label="项目名称 *">
                <input
                  required
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm({ ...editForm, name: e.target.value })
                  }
                />
              </Field>
              <Field label="项目类型">
                <select
                  value={editForm.project_type}
                  onChange={(e) =>
                    setEditForm({ ...editForm, project_type: e.target.value })
                  }
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
              <Field label="项目投标日期 *">
                <input
                  type="date"
                  required
                  value={editForm.bid_date}
                  onChange={(e) =>
                    setEditForm({ ...editForm, bid_date: e.target.value })
                  }
                />
              </Field>
              <Field label="项目负责人 *">
                <select
                  required
                  value={editForm.leader_id}
                  onChange={(e) =>
                    setEditForm({ ...editForm, leader_id: e.target.value })
                  }
                >
                  {(users || []).filter((u) => u.active).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.employee_no}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="负责人联系方式">
                <input
                  type="tel"
                  value={editForm.leader_phone}
                  onChange={(e) =>
                    setEditForm({ ...editForm, leader_phone: e.target.value })
                  }
                />
              </Field>
              <Field label="负责人企业邮箱">
                <input
                  type="email"
                  value={editForm.leader_email}
                  onChange={(e) =>
                    setEditForm({ ...editForm, leader_email: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="项目简介与方案背景">
              <textarea
                rows={5}
                maxLength={500}
                value={editForm.description}
                onChange={(e) =>
                  setEditForm({ ...editForm, description: e.target.value })
                }
              />
            </Field>
            {editError && (
              <p className="error" role="alert">
                {editError}
              </p>
            )}
          </div>
          <footer className="modal-footer">
            <button
              type="button"
              disabled={editing}
              onClick={() => setEditTarget(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="primary"
              disabled={editing}
              onClick={saveProject}
            >
              {editing ? "正在保存…" : "保存修改"}
            </button>
          </footer>
        </Modal>
      )}
      {deleteTarget && (
        <Modal
          title="删除项目"
          onClose={() => {
            if (!deleting) setDeleteTarget(null);
          }}
        >
          <div className="modal-body pm-delete-body">
            <p>确定删除「{deleteTarget.name}」吗？</p>
            <p className="muted">
              删除后，项目将从列表移除，成员无法继续查看、编辑或导出该项目及其分册。历史数据保留。
            </p>
            {deleteError && (
              <p className="error" role="alert">
                {deleteError}
              </p>
            )}
          </div>
          <footer className="modal-footer">
            <button
              type="button"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="danger"
              disabled={deleting}
              onClick={deleteProject}
            >
              {deleting ? "正在删除…" : "确认删除"}
            </button>
          </footer>
        </Modal>
      )}
      {targets && (
        <Modal
          title={targets.length > 1 ? "批量导出项目方案" : "导出项目方案"}
          subtitle={`共 ${targets.length} 个项目，分别生成独立交付文件。`}
          onClose={() => {
            if (!busy) setTargets(null);
          }}
        >
          <div className="modal-body pm-export-body">
            <Field label="导出格式">
              <select
                disabled={busy || !!exports.length}
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                <option value="zip">ZIP（HTML 与资源包）</option>
                <option value="html">单文件 HTML</option>
              </select>
            </Field>
            <Field label="交付版本">
              <select
                value={draft ? "draft" : "official"}
                disabled={busy || !!exports.length}
                onChange={(e) => setDraft(e.target.value === "draft")}
              >
                <option value="draft">草稿预览（包含未确认内容）</option>
                <option value="official" disabled={!targets.every(canFormal)}>
                  正式交付（仅已确认版本）
                </option>
              </select>
            </Field>
            <p className="muted">
              未全部确认的项目仅可导出草稿。任务关闭后可在任务中心继续查看。
            </p>
            {targets.map((p) => {
              const result = exports.find((x) => x.id === p.id);
              return (
                <div className="pm-export-item" key={p.id}>
                  <span>{p.name}</span>
                  {result?.job ? (
                    <button onClick={() => setJob(result.job)}>
                      查看下载任务
                    </button>
                  ) : result?.error ? (
                    <span className="error">{result.error}</span>
                  ) : (
                    <small>待处理</small>
                  )}
                </div>
              );
            })}
          </div>
          <footer className="modal-footer">
            <button disabled={busy} onClick={() => setTargets(null)}>
              关闭
            </button>
            <button
              className="primary"
              disabled={busy || !!exports.length}
              onClick={startExports}
            >
              {busy ? "正在创建导出任务…" : "开始导出"}
            </button>
          </footer>
        </Modal>
      )}
      {job && <JobView initial={job} onClose={() => setJob(null)} />}
    </main>
  );
}
