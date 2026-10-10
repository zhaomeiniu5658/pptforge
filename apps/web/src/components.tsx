import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, LoaderCircle, Check, Download, AlertCircle } from "lucide-react";
import { compile } from "@quark/html-engine";
import { api, statusNames } from "./api";
const visibleDiagnostic = (d: any) =>
  !String(d?.message || "").includes("w3.org/2000/svg") &&
  !String(d?.message || "").includes("w3.org/1999/xlink");
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  className = "",
  style,
}: any) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="overlay" role="presentation">
      <section
        className={"modal " + (wide ? "wide " : "") + className}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={style}
      >
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Preview({
  document: doc,
  mini = false,
  title = "页面预览",
  interactive = false,
  fitCanvas = false,
  scrollable = false,
  className = "",
  miniViewportWidth,
  miniViewportHeight,
}: any) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(270);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  useEffect(() => {
    if ((!mini && !fitCanvas && !scrollable) || !ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [mini, fitCanvas, scrollable]);
  const html = useMemo(() => {
    try {
      const compiled = compile([{ document: doc }], {
        navigation: false,
        preserveFixed: interactive && scrollable,
      }).html;
      if (!interactive || mini) return compiled;
      const bridge = `(()=>{const style=document.createElement('style');style.textContent='[class~="rv"]{opacity:1!important;transform:none!important;transition:none!important}.dots span{opacity:1!important;transform:none!important}.dots button{min-width:26px}';document.head.appendChild(style);const metrics=()=>{const roots=[document.documentElement,document.body,document.querySelector('main'),document.querySelector('[data-page-instance]')].filter(Boolean);let width=0,height=0;for(const el of roots){const r=el.getBoundingClientRect();width=Math.max(width,el.scrollWidth||0,el.offsetWidth||0,r.right);height=Math.max(height,el.scrollHeight||0,el.offsetHeight||0,r.bottom);}document.body?.querySelectorAll('*').forEach(el=>{const r=el.getBoundingClientRect();width=Math.max(width,r.right,el.scrollWidth?el.getBoundingClientRect().left+el.scrollWidth:0);height=Math.max(height,r.bottom,el.scrollHeight?el.getBoundingClientRect().top+el.scrollHeight:0);});return {width:Math.ceil(width),height:Math.ceil(height)}};const send=()=>parent.postMessage({type:'quark:preview-metrics',...metrics()},'*');new ResizeObserver(send).observe(document.documentElement);if(document.body)new ResizeObserver(send).observe(document.body);addEventListener('load',send);setTimeout(send,300);setTimeout(send,1000);send();})();`;
      return compiled.replace("</body>", `<script>${bridge}</script></body>`);
    } catch {
      return "<p>页面暂不可预览</p>";
    }
  }, [doc, interactive, mini]);
  useEffect(() => {
    if (!interactive || mini || !ref.current) return;
    const frame = ref.current.querySelector("iframe");
    if (!frame) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      if (!["quark:preview-height", "quark:preview-metrics"].includes(event.data?.type)) return;
      const height = Number(event.data.height);
      if (Number.isFinite(height) && height > 0) {
        setContentHeight(Math.min(Math.max(height, 300), 18000));
      }
      const nextWidth = Number(event.data.width);
      if (Number.isFinite(nextWidth) && nextWidth > 0) {
        setContentWidth(Math.min(Math.max(nextWidth, 320), 2560));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [interactive, mini, html]);
  const declaredWidth = Number(doc?.sourceSize?.width);
  // A few early imports do not have a persisted sourceSize. In that case the
  // runtime metric can be inflated by off-canvas artwork or fixed navigation
  // and make the preview look like a tiny strip. Use the normal desktop canvas
  // until a trusted imported size is available.
  const fitWidth = Math.max(
    320,
    Math.min(
      Number.isFinite(declaredWidth) && declaredWidth > 0
        ? contentWidth || declaredWidth
        : 1440,
      2560,
    ),
  );
  const fitBaseHeight = Math.max(300, Math.min(Number(doc?.sourceSize?.height) || 765, 18000));
  const miniWidth = Math.max(320, Math.min(Number(miniViewportWidth) || 1000, 2560));
  const miniHeight = Math.max(300, Math.min(Number(miniViewportHeight) || 650, 18000));
  const fitHeight = Math.max(contentHeight || fitBaseHeight, fitBaseHeight);
  const fitScale = Math.min(1, width / fitWidth);
  // Keep long interactive pages inside a real browser viewport. If the iframe
  // is stretched to the full document height, `100vh`/`100svh` and fixed
  // navigation inside the imported page are calculated against that huge
  // height, which creates blank opening sections and breaks scroll-driven UI.
  // The document can still be viewed in full by scrolling the iframe itself.
  const interactiveViewportHeight = Math.max(
    720,
    Math.min(1200, Math.round(typeof window === "undefined" ? 900 : window.innerHeight)),
  );
  const frameStyle = scrollable
    ? {
        width: fitWidth,
        height: interactiveViewportHeight,
        transform: `scale(${fitScale})`,
        transformOrigin: "top left",
      }
    : mini
    ? { width: miniWidth, height: miniHeight, transform: `scale(${width / miniWidth})` }
    : fitCanvas
      ? {
          width: fitWidth,
          height: fitHeight,
          transform: `scale(${fitScale})`,
          transformOrigin: "top left",
        }
      : contentHeight
        ? { height: Math.max(contentHeight, 720) }
        : undefined;
  const frame = (
    <iframe
      sandbox={
        interactive
          ? "allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
          : "allow-scripts allow-popups allow-popups-to-escape-sandbox"
      }
      title={title}
      srcDoc={html}
      loading={mini ? "lazy" : undefined}
      tabIndex={mini ? -1 : 0}
      className={interactive ? "interactive-preview-frame" : undefined}
      style={frameStyle}
    />
  );
  return (
    <div
      ref={ref}
      className={
        (mini ? "mini-preview" : "preview") +
        (interactive ? " interactive-preview" : "") +
        (fitCanvas ? " fit-canvas-preview" : "") +
        (className ? ` ${className}` : "")
      }
    >
      {scrollable && !mini ? (
        <div
          className="preview-scroll-stage"
          style={{
            width: fitWidth * fitScale,
            height: interactiveViewportHeight * fitScale,
          }}
        >
          {frame}
        </div>
      ) : fitCanvas && !mini ? (
        <div
          className="preview-fit-stage"
          style={{ width: fitWidth * fitScale, height: fitHeight * fitScale }}
        >
          {frame}
        </div>
      ) : (
        frame
      )}
    </div>
  );
}
export function Badge({ status, children }: any) {
  return (
    <span className={"badge " + (status || "")}>
      {children || statusNames[status] || status}
    </span>
  );
}
export function Empty({ children }: any) {
  return (
    <div className="empty">
      <div className="empty-mark">Q</div>
      {children || "暂无内容"}
    </div>
  );
}
export function Field({ label, children, hint }: any) {
  const renderedLabel =
    typeof label === "string" && label.endsWith(" *") ? (
      <>
        {label.slice(0, -2)} <span className="required">*</span>
      </>
    ) : (
      label
    );
  return (
    <label className="field">
      <span>{renderedLabel}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Progress({ value }: any) {
  return (
    <div className="progress">
      <i style={{ width: Math.max(0, Math.min(100, value)) + "%" }} />
    </div>
  );
}
export function JobView({ initial, onClose, onDone, onTemplate }: any) {
  const [job, setJob] = useState(initial);
  const done = useRef(false);
  useEffect(() => {
    if (["succeeded", "failed", "cancelled"].includes(job.status)) {
      if (job.status === "succeeded" && !done.current) {
        done.current = true;
        onDone?.(job);
      }
      return;
    }
    const t = setInterval(
      () =>
        api("/jobs/" + job.id)
          .then(setJob)
          .catch(() => {}),
      1200,
    );
    return () => clearInterval(t);
  }, [job.status, job.id]);
  return (
    <Modal title="处理任务" subtitle={job.stage} onClose={onClose}>
      <div className="modal-body job-result">
        {job.status === "succeeded" ? (
          <Check size={42} color="#16a085" />
        ) : job.status === "failed" ? (
          <AlertCircle size={42} color="#dc4c64" />
        ) : (
          <LoaderCircle className="spin" size={42} />
        )}
        <h3>{statusNames[job.status]}</h3>
        {job.error && <p className="error">{job.error}</p>}
        {job.status === "succeeded" && job.result?.template_id && (
          <div>
            <p>{job.result.page_count} 页已入库，待检查启用。</p>
            {onTemplate && (
              <button
                className="primary"
                onClick={() => onTemplate(job.result.template_id)}
              >
                查看入库模板
              </button>
            )}
          </div>
        )}
        {job.result?.url && (
          <a className="button primary" href={job.result.url} download>
            <Download size={16} />
            下载 {job.result.name}
          </a>
        )}
        {job.result?.diagnostics?.filter(visibleDiagnostic).map((d: any, i: number) => (
          <p key={i} className="diagnostic">
            {d.message}
          </p>
        ))}
        {!["succeeded", "failed", "cancelled"].includes(job.status) && (
          <button
            onClick={() => api("/jobs/" + job.id + "/cancel", {}).then(setJob)}
          >
            停止任务
          </button>
        )}
        {["failed", "cancelled"].includes(job.status) && (
          <button
            onClick={() => api("/jobs/" + job.id + "/retry", {}).then(setJob)}
          >
            重试
          </button>
        )}
        <p className="muted">关闭窗口后任务仍保留，可在任务中心重新查看。</p>
      </div>
    </Modal>
  );
}
