import { useEffect, useMemo, useRef, useState } from "react";
import {
  Save,
  Code2,
  MousePointer2,
  Plus,
  Copy,
  Trash2,
  ArrowUp,
  ArrowDown,
  Undo2,
  ArrowLeft,
  Sparkles,
} from "lucide-react";
import {
  normalize,
  patchNode,
  deleteNode,
  editablePreview,
} from "@quark/html-engine";
import { api } from "./api";
import { Field } from "./components";
import { useApp } from "./App";
import { TemplateAI, documentKey } from "./TemplateAI";

const blank = () =>
  normalize({
    html: '<article style="padding:48px"><h1>新的模板页面</h1><p>点击文字，在右侧修改内容。</p></article>',
    css: "article{font-family:Arial,sans-serif;color:#15243e;min-height:560px}",
  });
const sourceOf = (doc: any) =>
  `<style>\n${doc.css || ""}\n</style>\n${doc.html || ""}`;
const fromSource = (source: string, doc: any) =>
  normalize({ ...doc, html: source, css: "" });

export function TemplateContentEditor({ template, onClose, onSaved }: any) {
  const { settings } = useApp();
  const [documents, setDocuments] = useState<any[]>(() =>
    template.documents.length
      ? template.documents.map((d: any) => normalize(d))
      : [blank()],
  );
  const [active, setActive] = useState(0);
  const [history, setHistory] = useState<any[][]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [text, setText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [styles, setStyles] = useState<Record<string, string>>({});
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMounted, setAiMounted] = useState(false);
  const [aiMode, setAiMode] = useState<"append" | "replace">("append");
  const [height, setHeight] = useState(720);
  const [canvasWidth, setCanvasWidth] = useState(700);
  const iframe = useRef<HTMLIFrameElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const channel = useMemo(() => crypto.randomUUID(), [active]);
  const current = documents[active];
  const width =
    current?.layoutMode === "fixed" ? current.sourceSize.width : 1280;
  const scale = Math.min(1, canvasWidth / width);
  const preview = useMemo(
    () => editablePreview(current, channel),
    [current, channel],
  );
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.source !== iframe.current?.contentWindow ||
        event.data?.channel !== channel
      )
        return;
      const data = event.data;
      if (data.type === "quark:height")
        setHeight(Math.min(18000, Math.max(200, data.height)));
      if (data.type === "quark:select") {
        setSelected(data);
        setText(data.text || "");
        setLinkUrl(data.href || "");
        setStyles({
          "font-size": data.styles.fontSize,
          color: data.styles.color,
          "background-color": data.styles.backgroundColor,
          "text-align": data.styles.textAlign,
          padding: data.styles.padding,
        });
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [channel]);
  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setCanvasWidth(Math.max(240, entry.contentRect.width - 24)),
    );
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirty || source !== null) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty, source]);
  function change(next: any[]) {
    setHistory((items) => [...items.slice(-19), documents]);
    setDocuments(next);
    setDirty(true);
    setError("");
  }
  function patch(value: any) {
    try {
      change(
        documents.map((doc, index) =>
          index === active ? patchNode(doc, selected.id, value) : doc,
        ),
      );
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  }
  function deleteSelected() {
    if (!selected) return;
    try {
      const target = selected.id;
      change(
        documents.map((doc, index) =>
          index === active ? deleteNode(doc, target) : doc,
        ),
      );
      setSelected(null);
      setText("");
      setLinkUrl("");
      setStyles({});
    } catch (e: any) {
      setError(e.message);
    }
  }
  function move(offset: number) {
    const next = [...documents];
    [next[active], next[active + offset]] = [
      next[active + offset],
      next[active],
    ];
    change(next);
    setActive(active + offset);
    setSelected(null);
  }
  const saveTemplateVersion = async () => {
    setSaving(true);
    setError("");
    try {
      const result = await api(
        `/templates/${template.id}/content`,
        { documents, base_version_id: template.current_version_id },
        "PATCH",
      );
      onSaved(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const close = () => {
    if (saving) return;
    if (dirty || source !== null) setConfirmClose(true);
    else onClose();
  };
  return (
    <main className="template-design-page">
      <header className="template-design-header">
        <button onClick={close} disabled={saving}><ArrowLeft size={17} />返回模板库</button>
        <div className="grow"><h1>设计模板 · {template.name}</h1>
          <p>点击画布元素修改文字、图片和样式；保存新版本后重新启用即可使用。</p></div>
        <div className="template-design-actions">
          <span className="template-save-status">
            {dirty ? "有未保存修改" : "已保存"}
          </span>
          {settings?.ai_enabled !== false && (
            <button className="primary" disabled={saving || source !== null} onClick={() => {
              setAiMode("append");
              setAiMounted(true);
              setAiOpen((open) => !open);
            }}><Sparkles size={17} />AI 生成新界面</button>
          )}
          <button
            className="primary"
            disabled={saving || !dirty || source !== null}
            onClick={saveTemplateVersion}
          >
            <Save size={15} />
            {saving ? "保存中…" : "保存为新版本"}
          </button>
        </div>
      </header>
      {settings?.ai_enabled !== false && aiMounted && aiMode === "append" && <div hidden={!aiOpen}>
        <TemplateAI template={template} document={current} pageIndex={active}
          disabled={saving || source !== null} onClose={() => setAiOpen(false)}
          initialMode="append" fixedMode
          title="AI 生成新界面"
          subtitle="生成候选页面，采用后添加到当前模板草稿"
          onAdopt={(job: any) => {
            if (job.payload.base_version_id !== template.current_version_id)
              throw Error("候选来自旧模板版本，请基于当前版本重新生成");
            const incoming = job.result.documents.map((d: any) => normalize(d));
            if (incoming.some((d: any) => d.diagnostics?.some((x: any) => x.severity === "error")))
              throw Error("候选存在转换错误，请修改后重新生成");
            if (job.payload.mode === "replace") {
              const index = job.payload.page_index;
              if (documentKey(documents[index]) !== documentKey(job.payload.document))
                throw Error("原页面草稿已变化，请基于最新页面重新生成，避免覆盖修改");
              change(documents.map((d, i) => i === index ? incoming[0] : d));
              setActive(index);
            } else {
              if (documents.length + incoming.length > 60) throw Error("模板最多支持 60 页");
              change([...documents, ...incoming]);
              setActive(documents.length);
            }
            setSelected(null);
          }} />
      </div>}
      <div className="template-content-editor">
        <aside className="template-content-pages">
          <b>页面 · {documents.length}</b>
          {documents.map((_: any, index: number) => (
            <button
              disabled={saving || source !== null}
              key={index}
              className={active === index ? "selected" : ""}
              onClick={() => {
                setActive(index);
                setSelected(null);
                setError("");
              }}
            >
              第 {index + 1} 页
            </button>
          ))}
          <button
            disabled={saving || source !== null || documents.length >= 60}
            onClick={() => {
              change([...documents, blank()]);
              setActive(documents.length);
              setSelected(null);
            }}
          >
            <Plus size={14} />
            添加页面
          </button>
        </aside>
        <section className="template-content-workspace">
          <div className="template-design-toolbar">
            <button
              disabled={saving || !history.length || source !== null}
              onClick={() => {
                const previous = history[history.length - 1];
                setDocuments(previous);
                setHistory(history.slice(0, -1));
                setActive(Math.min(active, previous.length - 1));
                setSelected(null);
                setDirty(true);
              }}
            >
              <Undo2 size={14} />
              撤销
            </button>
            <button
              disabled={saving || source !== null || documents.length >= 60}
              onClick={() => {
                const next = [...documents];
                next.splice(active + 1, 0, structuredClone(current));
                change(next);
                setActive(active + 1);
                setSelected(null);
              }}
            >
              <Copy size={14} />
              复制
            </button>
            <button
              aria-label="上移页面"
              disabled={saving || source !== null || !active}
              onClick={() => move(-1)}
            >
              <ArrowUp size={14} />
            </button>
            <button
              aria-label="下移页面"
              disabled={
                saving || source !== null || active === documents.length - 1
              }
              onClick={() => move(1)}
            >
              <ArrowDown size={14} />
            </button>
            <button
              disabled={saving || source !== null || documents.length === 1}
              onClick={() => {
                change(documents.filter((_, index) => index !== active));
                setActive(Math.max(0, active - 1));
                setSelected(null);
              }}
            >
              <Trash2 size={14} />
              删除页
            </button>
            <button
              disabled={saving || source !== null}
              onClick={() => setSource(sourceOf(current))}
            >
              <Code2 size={14} />
              源码编辑
            </button>
            {settings?.ai_enabled !== false && (
              <button
                className="template-ai-edit-button"
                disabled={saving || source !== null}
                onClick={() => {
                  setAiMode("replace");
                  setAiMounted(true);
                  setAiOpen(true);
                }}
              >
                <Sparkles size={14} />
                AI 修改
              </button>
            )}
          </div>
          <div className="template-content-preview" ref={canvas}>
            <div
              style={{
                width: width * scale,
                height: height * scale,
                position: "relative",
                margin: "12px auto",
              }}
            >
              <iframe
                ref={iframe}
                title="模板设计画布"
                sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                srcDoc={preview}
                style={{
                  border: 0,
                  width,
                  height,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                  background: "white",
                }}
              />
            </div>
          </div>
          <aside className="template-design-properties">
            {source !== null ? (
              <>
                <label className="template-source-label">
                  HTML / CSS 源码
                  <textarea
                    aria-label="模板页面源码"
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                    spellCheck={false}
                  />
                </label>
                <div className="flex">
                  <button
                    disabled={saving}
                    onClick={() => {
                      setSource(null);
                      setError("");
                    }}
                  >
                    取消源码修改
                  </button>
                  <button
                    className="primary"
                    disabled={saving}
                    onClick={() => {
                      try {
                        const doc = fromSource(source, current);
                        change(
                          documents.map((item, index) =>
                            index === active ? doc : item,
                          ),
                        );
                        setSource(null);
                        setSelected(null);
                      } catch (e: any) {
                        setError(e.message);
                      }
                    }}
                  >
                    应用源码
                  </button>
                </div>
              </>
            ) : selected ? (
              <>
                <div className="template-properties-head">
                  <b>选中元素 · {selected.tag.toLowerCase()}</b>
                  {selected.readonly ? null : (
                    <button
                      className="primary"
                      disabled={saving}
                      onClick={() =>
                        patch({
                          styles: Object.fromEntries(
                            Object.entries(styles).filter(([, value]) =>
                              value.trim(),
                            ),
                          ),
                        })
                      }
                    >
                      应用样式
                    </button>
                  )}
                </div>
                <button
                  className="danger template-delete-element-button"
                  disabled={saving}
                  onClick={deleteSelected}
                >
                  <Trash2 size={14} />
                  删除选中元素
                </button>
                <Field label="链接网址">
                  <input
                    aria-label="链接网址"
                    value={linkUrl}
                    placeholder="https://www.qmcro.com"
                    disabled={saving}
                    onChange={(event) => setLinkUrl(event.target.value)}
                  />
                  <div className="template-link-actions">
                    <button
                      disabled={saving}
                      onClick={() => {
                        if (patch({ href: linkUrl }))
                          setSelected({ ...selected, href: linkUrl });
                      }}
                    >
                      应用链接
                    </button>
                    <button
                      disabled={saving || !linkUrl}
                      onClick={() => {
                        if (patch({ href: "" })) {
                          setLinkUrl("");
                          setSelected({ ...selected, href: "" });
                        }
                      }}
                    >
                      清除链接
                    </button>
                  </div>
                </Field>
                {selected.readonly ? (
                  <p className="muted">
                    此元素为保真图形，不能编辑内部内容；可直接删除整个对象。
                  </p>
                ) : (
                  <>
                    {selected.leaf && selected.tag !== "IMG" && (
                      <Field label="文字内容">
                        <textarea
                          aria-label="元素文字"
                          value={text}
                          onChange={(event) => setText(event.target.value)}
                          rows={4}
                        />
                        <button
                          disabled={saving}
                          onClick={() => patch({ text })}
                        >
                          应用文字
                        </button>
                      </Field>
                    )}
                    {selected.tag === "IMG" && (
                      <Field label="替换图片">
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                          disabled={saving}
                          onChange={async (event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            if (file.size > 2 * 1024 * 1024) {
                              setError("图片请控制在 2 MB 以内");
                              return;
                            }
                            const target = selected.id,
                              index = active;
                            const reader = new FileReader();
                            reader.onload = () => {
                              try {
                                change(
                                  documents.map((doc, i) =>
                                    i === index
                                      ? patchNode(doc, target, {
                                          src: reader.result,
                                        })
                                      : doc,
                                  ),
                                );
                              } catch (e: any) {
                                setError(e.message);
                              }
                            };
                            reader.readAsDataURL(file);
                          }}
                        />
                      </Field>
                    )}
                    {[
                      ["font-size", "字号", "32px"],
                      ["font-family", "字体", "Arial"],
                      ["color", "文字颜色", "#2563eb"],
                      ["background-color", "背景颜色", "#ffffff"],
                      ["padding", "内间距", "16px"],
                      ["margin", "外间距", "0px"],
                      ["width", "宽度", "100%"],
                      ["height", "高度", "auto"],
                    ].map(([key, label, placeholder]) => (
                      <Field key={key} label={label}>
                        <input
                          aria-label={label}
                          value={styles[key] || ""}
                          placeholder={placeholder}
                          onChange={(event) =>
                            setStyles({ ...styles, [key]: event.target.value })
                          }
                        />
                      </Field>
                    ))}
                    <Field label="文字对齐">
                      <select
                        aria-label="文字对齐"
                        value={styles["text-align"] || "left"}
                        onChange={(event) =>
                          setStyles({
                            ...styles,
                            "text-align": event.target.value,
                          })
                        }
                      >
                        <option value="left">左对齐</option>
                        <option value="center">居中</option>
                        <option value="right">右对齐</option>
                      </select>
                    </Field>
                  </>
                )}
              </>
            ) : (
              <div className="template-design-hint">
                <MousePointer2 size={24} />
                <p>点击左侧画布中的文字、图片或容器，在这里编辑。</p>
              </div>
            )}
          </aside>
        </section>
      </div>
      {settings?.ai_enabled !== false && aiMounted && aiMode === "replace" && aiOpen && (
        <aside className="template-ai-drawer">
          <TemplateAI template={template} document={current} pageIndex={active}
            disabled={saving || source !== null} onClose={() => setAiOpen(false)}
            initialMode="replace" fixedMode variant="drawer"
            title="AI 修改当前界面"
            subtitle={`只修改当前第 ${active + 1} 页，采用后替换当前草稿`}
            onAdopt={(job: any) => {
              if (job.payload.base_version_id !== template.current_version_id)
                throw Error("候选来自旧模板版本，请基于当前版本重新生成");
              const incoming = job.result.documents.map((d: any) => normalize(d));
              if (incoming.some((d: any) => d.diagnostics?.some((x: any) => x.severity === "error")))
                throw Error("候选存在转换错误，请修改后重新生成");
              const index = job.payload.page_index;
              if (documentKey(documents[index]) !== documentKey(job.payload.document))
                throw Error("原页面草稿已变化，请基于最新页面重新生成，避免覆盖修改");
              change(documents.map((d, i) => i === index ? incoming[0] : d));
              setActive(index);
              setSelected(null);
            }} />
        </aside>
      )}
      {error && (
        <p className="error template-edit-error" role="alert">
          {error}
        </p>
      )}
      {confirmClose && (
        <footer className="modal-footer">
          <span className="grow">有未保存修改，确定放弃吗？</span>
          <button onClick={() => setConfirmClose(false)}>继续编辑</button>
          <button className="danger" onClick={onClose}>
            放弃修改
          </button>
        </footer>
      )}
    </main>
  );
}
