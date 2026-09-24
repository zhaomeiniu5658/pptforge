import { useEffect, useState } from "react";
import { Sparkles, Square, Check, LoaderCircle, X, Circle, CircleCheck, CircleAlert } from "lucide-react";
import { api, upload } from "./api";
import { Badge, Field, Preview } from "./components";

// PostgreSQL JSONB may reorder object keys; compare document values, not wire order.
export function documentKey(value: any): string {
  if (Array.isArray(value)) return `[${value.map(documentKey).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${documentKey(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function TemplateAI({
  template,
  document,
  pageIndex,
  disabled,
  onAdopt,
  onClose,
  initialMode = "append",
  fixedMode = false,
  title,
  subtitle,
  variant = "panel",
}: any) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState(initialMode);
  const [file, setFile] = useState<File | null>(null);
  const [models, setModels] = useState<any[]>([]);
  const [modelId, setModelId] = useState("");
  const [job, setJob] = useState<any>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [used, setUsed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = job && ["queued", "running"].includes(job.status);
  const locked = disabled || busy || running;
  useEffect(() => {
    api("/models").then(setModels).catch((e) => setError(e.message));
    api("/jobs").then((jobs) => setRecent(jobs.filter((j: any) =>
      j.kind === "template_ai" && j.payload.template_id === template.id,
    ))).catch((e) => setError(e.message));
  }, [template.id]);
  useEffect(() => {
    setMode(initialMode);
    setJob(null);
    setError("");
  }, [initialMode, pageIndex]);
  useEffect(() => {
    if (!running) return;
    const source = new EventSource(`/api/jobs/${job.id}/events`);
    source.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data);
        setJob(next);
        if (["succeeded", "failed", "cancelled"].includes(next.status)) source.close();
      } catch (e: any) {
        setError("无法读取任务进度");
        source.close();
      }
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, [job?.id, running]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await fn(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function generate() {
    const asset = file ? await upload(file) : undefined;
    const sameBase = job?.payload.base_version_id === template.current_version_id &&
      job?.payload.mode === mode && job?.payload.page_index === pageIndex &&
      (mode !== "replace" || documentKey(job.payload.document) === documentKey(document));
    const next = await api(`/templates/${template.id}/ai/tasks`, {
      base_version_id: template.current_version_id,
      mode, page_index: pageIndex,
      document: mode === "replace" ? document : undefined,
      prompt: prompt.trim() || "根据参考图片还原为可编辑 HTML，保留原始文字、布局与颜色，不添加未提供的数据。",
      asset_id: asset?.id,
      model_id: modelId || undefined,
      parent_job_id: job?.status === "succeeded" && sameBase && !used.includes(job.id) ? job.id : undefined,
    });
    setJob(next);
    setRecent((items) => [next, ...items]);
  }
  return (
    <section className={`template-ai-panel ${variant === "drawer" ? "template-ai-panel-drawer" : ""}`} aria-label="模板 AI 设计">
      <header className="template-ai-head">
        <div><Sparkles size={18} /><b>{title || (mode === "replace" ? "AI 修改当前界面" : "AI 生成新界面")}</b><span>{subtitle || "先预览候选，采用后保存为模板新版本"}</span></div>
        <button className="icon" aria-label="收起 AI 设计" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="template-ai-layout">
        <aside className="template-ai-input">
          {fixedMode ? (
            <Field label="生成方式">
              <input readOnly value={mode === "replace" ? `AI 修改当前页（第 ${pageIndex + 1} 页）` : "AI 生成新界面"} />
            </Field>
          ) : (
            <Field label="生成方式">
              <select value={mode} disabled={locked} onChange={(e) => { setMode(e.target.value); setJob(null); }}>
                <option value="append">生成新页面</option>
                <option value="replace">AI 修改当前页（第 {pageIndex + 1} 页）</option>
              </select>
            </Field>
          )}
          <Field label="设计需求">
            <textarea rows={5} value={prompt} disabled={locked} onChange={(e) => setPrompt(e.target.value)}
              placeholder="例如：保持现有医学数据不变，将这一页调整为夸克蓝的双栏布局。" />
          </Field>
          <Field label="参考图片 / 截图（可选）">
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={locked}
              onChange={(e) => { setFile(e.target.files?.[0] || null); setModelId(""); }} />
          </Field>
          <Field label="AI 模型">
            <select value={modelId} disabled={locked} onChange={(e) => setModelId(e.target.value)}>
              <option value="">使用已配置的{file ? "图片" : "文字"}默认模型</option>
              {models.filter((m) => m.enabled && (!file || m.supports_images)).map((m) =>
                <option key={m.id} value={m.id}>{m.name}{m.supports_images ? " · 支持图片" : ""}</option>,
              )}
            </select>
          </Field>
          <button className="primary full" disabled={locked || (!prompt.trim() && !file)} onClick={() => act(generate)}>
            <Sparkles size={16} />{busy ? "正在提交…" : mode === "replace" ? "生成修改候选" : "生成新界面"}
          </button>
          <Field label="本模板最近任务">
            <select value={job?.id || ""} disabled={locked} onChange={(e) => {
              const id = e.target.value;
              if (id) act(async () => setJob(await api(`/jobs/${id}`)));
              else setJob(null);
            }}>
              <option value="">选择历史候选</option>
              {recent.map((j) => <option key={j.id} value={j.id}>{j.payload.prompt.slice(0, 25)}</option>)}
            </select>
          </Field>
          {error && <p role="alert" className="error">{error}</p>}
        </aside>
        <div className="template-ai-candidate">
          <div className="candidate-toolbar"><b>候选预览</b>{job && <Badge status={job.status} />}</div>
          {job && <JobProcess job={job} />}
          {job?.result?.documents?.[0] ? <Preview document={job.result.documents[0]} interactive fitCanvas /> :
            <div className="template-design-hint"><Sparkles size={30} /><p>输入文字或上传截图，生成可继续编辑的 HTML 页面。</p></div>}
          {job?.error && <p className="error" role="alert">{job.error}</p>}
          {job?.result?.warnings?.map((w: string) => <p key={w} className="diagnostic">{w}</p>)}
          <div className="template-ai-actions">
            {running && <button disabled={busy} onClick={() => act(async () => setJob(await api(`/jobs/${job.id}/cancel`, {})))}><Square size={14} />停止</button>}
            {["failed", "cancelled"].includes(job?.status) && <button disabled={busy || disabled} onClick={() => act(async () => {
              const next = await api(`/jobs/${job.id}/retry`, {});
              setJob(next); setRecent((items) => [next, ...items]);
            })}>重试任务</button>}
            <button className="primary" disabled={locked || job?.status !== "succeeded" || !job?.result?.documents?.length || used.includes(job?.id)} onClick={() => act(async () => {
              await onAdopt(job);
              setUsed((items) => [...items, job.id]);
            })}><Check size={16} />{used.includes(job?.id) ? "已采用到草稿" : "采用到草稿"}</button>
          </div>
          <p className="muted">未采用结果不会覆盖模板。收起面板后任务继续，可从最近任务查看。</p>
        </div>
      </div>
    </section>
  );
}

function JobProcess({ job }: { job: any }) {
  const events = Array.isArray(job.events) ? job.events : [];
  const terminal = ["succeeded", "failed", "cancelled"].includes(job.status);
  return (
    <div className="template-ai-process" aria-live="polite">
      <div className="template-ai-process-head">
        <span>执行过程</span>
        {job.status === "running" && <em><LoaderCircle size={13} className="spin" />正在执行</em>}
        {job.status === "queued" && <em>等待 Worker</em>}
        {job.status === "succeeded" && <em className="is-done">已完成</em>}
        {job.status === "failed" && <em className="is-failed">已失败</em>}
        {job.status === "cancelled" && <em>已停止</em>}
      </div>
      {events.length ? (
        <ol className="template-ai-process-list">
          {events.map((event: any, index: number) => {
            const data = event.data || {};
            const isLast = index === events.length - 1;
            const active = !terminal && isLast;
            const failed = job.status === "failed" && isLast;
            return (
              <li key={event.id || `${data.stage}-${index}`} className={active ? "is-active" : ""}>
                <span className="template-ai-process-icon">
                  {failed ? <CircleAlert size={15} /> : active ? <LoaderCircle size={15} className="spin" /> : <CircleCheck size={15} />}
                </span>
                <div>
                  <strong>{data.stage || "处理中"}</strong>
                  {data.detail && <p>{data.detail}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="template-ai-process-empty"><Circle size={14} />任务已创建，等待执行过程返回…</p>
      )}
    </div>
  );
}
