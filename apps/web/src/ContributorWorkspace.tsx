import { useContext, useEffect, useState } from "react";
import { CalendarDays, Clock3, FolderOpen, ArrowRight, ListTodo } from "lucide-react";
import { Link } from "react-router-dom";
import { Context } from "./App";
import { api } from "./api";
import "./contributor-workspace.css";

type Booklet = {
  id: string; owner_id: string; title: string; instructions: string; expected_pages: number;
  page_count: number; has_new_draft: boolean;
  submission?: { status: string; review_comment?: string };
};
type Project = { id: string; name: string; code: string; deadline: string; booklets: Booklet[] };
const pending = (b: Booklet) => !b.submission || b.submission.status === "returned" || b.has_new_draft;
const status = (b: Booklet) => b.has_new_draft ? "有新草稿" : b.submission?.status === "returned" ? "退回修改" : b.submission?.status === "approved" ? "审核通过" : b.submission ? "待商务审核" : "待完成";

export function ContributorWorkspace() {
  const { user } = useContext(Context);
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    api("/projects").then((rows: Project[]) => {
      if (active) setProjects(rows.map(p => ({ ...p, booklets: p.booklets.filter(b => b.owner_id === user.id) })).filter(p => p.booklets.length));
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user.id, attempt]);
  const todoTasks = projects.reduce((count, p) => count + p.booklets.filter(pending).length, 0);
  const completed = projects.filter(p => p.booklets.length > 0 && p.booklets.every(b => b.submission?.status === "approved" && !b.has_new_draft));
  const inProgressCount = projects.length - completed.length;
  const dayNumber = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(+date) ? Infinity : Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
  };
  const today = dayNumber(new Date().toISOString());
  const visible = projects.flatMap(project => project.booklets.filter(pending).map(booklet => ({ project, booklet })))
    .filter(({ project, booklet }) => `${project.name} ${project.code} ${booklet.title}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => dayNumber(a.project.deadline) - dayNumber(b.project.deadline));
  const pageCount = Math.max(1, Math.ceil(visible.length / 10));
  useEffect(() => { setPage(1); }, [query]);
  return <main className="contributor-workspace">
    <section className="workspace-panel">
      <div className="workspace-summary" aria-label="工作台概览">
        <div className="workspace-summary-card todo"><span>待办任务</span><strong>{loading || error ? "—" : todoTasks}</strong><small>需要继续处理的分册</small></div>
        <div className="workspace-summary-card progress"><span>进行中项目</span><strong>{loading || error ? "—" : inProgressCount}</strong><small>本人分册尚未全部完成</small></div>
        <div className="workspace-summary-card done"><span>已完成项目</span><strong>{loading || error ? "—" : completed.length}</strong><small>本人分册全部通过且无新草稿</small></div>
      </div>
      <div className="workspace-toolbar">
        <div className="workspace-task-heading">
          <h2><ListTodo size={18} />待完成任务 <span>{todoTasks}</span></h2>
          <Link className="workspace-all-link" to="/projects">所有项目 <span>{projects.length}</span><span aria-hidden="true">↗</span></Link>
        </div>
        <input aria-label="搜索项目" placeholder="搜索项目或任务" value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      <p className="workspace-hint">按截止时间由近及远排序 · 逾期置顶</p>
      {loading ? <div className="loading">正在加载任务…</div> : error ? <div role="alert">{error} <button onClick={() => setAttempt(x => x + 1)}>重新加载</button></div> : !visible.length ? <div className="workspace-empty">{query ? "没有符合搜索条件的任务" : "暂无待完成任务"}</div> :
        <div className="workspace-task-list">{visible.slice((page - 1) * 10, page * 10).map(({ project: p, booklet: b }) => {
          const days = dayNumber(p.deadline) - today;
          const hasDeadline = Number.isFinite(days);
          const dueText = !hasDeadline ? "未设置截止时间" : days < 0 ? `已逾期 ${-days} 天` : days === 0 ? "今天截止" : `还剩 ${days} 天`;
          return <article className="workspace-task-row" key={b.id}>
            <div className={"workspace-task-date" + (days < 0 ? " overdue" : "")} title={hasDeadline ? new Date(p.deadline).toLocaleDateString("zh-CN") : "未设置截止时间"}>
              <strong><CalendarDays size={17} />{hasDeadline ? new Date(p.deadline).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }).replace("/", "-") : "待定"}</strong>
              <small><Clock3 size={14} />{dueText}</small>
            </div>
            <div className="workspace-task-content">
              <h3 title={b.title}>{b.title}</h3>
              <div className="workspace-task-meta"><FolderOpen size={15} /><Link to={`/projects/${p.id}`} title={p.name}>{p.name}</Link><span>· 已编写 {b.page_count} / 建议 {b.expected_pages} 页</span></div>
              {b.submission?.status === "returned" && b.submission.review_comment && <p className="workspace-task-review">审核意见：{b.submission.review_comment}</p>}
            </div>
            <div className="workspace-task-actions"><span className="workspace-task-status">{status(b)}</span><Link className="workspace-edit" to={`/booklets/${b.id}`}>去完成 <ArrowRight size={15} /></Link></div>
          </article>;
        })}</div>}
      {!loading && !error && pageCount > 1 && <div className="workspace-pagination"><button disabled={page === 1} onClick={() => setPage(x => x - 1)}>上一页</button><span>{page} / {pageCount}</span><button disabled={page === pageCount} onClick={() => setPage(x => x + 1)}>下一页</button></div>}
    </section>
  </main>;
}
