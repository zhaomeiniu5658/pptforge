import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Plus,
  Copy,
  Trash2,
  Save,
  Sparkles,
  Layers3,
  Code2,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Undo2,
  Redo2,
  Upload,
  Download,
  Send,
  MousePointer2,
  Image,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  X,
  LoaderCircle,
  Check,
  History,
  Square,
  Play,
  ChevronDown,
  Maximize2,
  GripVertical,
} from "lucide-react";
import { EditorView, basicSetup } from "codemirror";
import { html as htmlLanguage } from "@codemirror/lang-html";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  normalize,
  patchNode,
  deleteNode,
  editablePreview,
  compile,
} from "@quark/html-engine";
import { api, upload, statusNames, remaining } from "./api";
import { Modal, Preview, Field, Badge, Empty, JobView } from "./components";
import { useApp, TemplatePicker } from "./App";
const blank = () =>
  normalize({
    html: '<article><span class="eyebrow">QUARKMED · 临床方案</span><h1>新的专业篇章</h1><p>点击这段文字，在右侧填写您的专业内容。</p><div class="note">研究数据与结论请以已确认的资料为准。</div></article>',
    css: "article{padding:64px;min-height:500px;font-family:Arial,sans-serif;color:#15243e}h1{font-size:38px;margin:26px 0}p{font-size:20px;line-height:1.8;color:#58677e}.eyebrow{font-size:13px;letter-spacing:2px;color:#2563eb}.note{margin-top:64px;padding:20px;background:#eff5ff;border-left:4px solid #2563eb}",
  });
function SourceEditor({ value, onChange }: any) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const v = new EditorView({
      doc: value,
      extensions: [
        basicSetup,
        htmlLanguage(),
        oneDark,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString());
        }),
      ],
      parent: host.current!,
    });
    return () => v.destroy();
  }, []);
  return <div className="source-editor" ref={host} />;
}
export function Editor() {
  const { id } = useParams();
  const { user, run, notify, settings } = useApp();
  const [b, setB] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [pageId, setPageId] = useState("");
  const [doc, setDoc] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [undo, setUndo] = useState<any[]>([]);
  const [redo, setRedo] = useState<any[]>([]);
  const [template, setTemplate] = useState(false);
  const [library, setLibrary] = useState<any[] | null>(null);
  const [ai, setAi] = useState<any>(null);
  const [job, setJob] = useState<any>(null);
  const [source, setSource] = useState<string | null>(null);
  const [history, setHistory] = useState<any[] | null>(null);
  const [play, setPlay] = useState(false);
  const [saving, setSaving] = useState(false);
  const [height, setHeight] = useState(680);
  const [zoom, setZoom] = useState(0.7);
  const [drag, setDrag] = useState("");
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const channel = useMemo(() => crypto.randomUUID(), [pageId]);
  const page = b?.pages.find((p: any) => p.id === pageId);
  const canEdit = b?.owner_id === user.id;
  const canvasWidth = doc?.layoutMode === "fixed"
    ? Math.max(320, Math.min(Number(doc?.sourceSize?.width) || 1000, 2560))
    : 1360;
  function selectPage(p: any) {
    setPageId(p.id);
    setDoc(normalize(p.document));
    setTitle(p.title);
    setSelected(null);
    setUndo([]);
    setRedo([]);
    setDirty(false);
    setHeight(
      p.document.layoutMode === "fixed" ? p.document.sourceSize.height : 680,
    );
  }
  async function load(preferred?: string) {
    const next = await api("/booklets/" + id);
    setB(next);
    setProject(await api("/projects/" + next.project_id));
    const p =
      next.pages.find((p: any) => p.id === (preferred || pageId)) ||
      next.pages[0];
    if (p) selectPage(p);
    else {
      setDoc(null);
      setPageId("");
    }
    return next;
  }
  useEffect(() => {
    run(() => load());
  }, [id]);
  useEffect(() => {
    const fn = (e: MessageEvent) => {
      if (
        e.source !== iframe.current?.contentWindow ||
        e.data?.channel !== channel
      )
        return;
      if (e.data.type === "quark:select") setSelected(e.data);
      if (e.data.type === "quark:height")
        setHeight(Math.min(18000, Math.max(350, e.data.height)));
    };
    window.addEventListener("message", fn);
    return () => window.removeEventListener("message", fn);
  }, [channel]);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);
  const preview = useMemo(() => {
    if (!doc) return "";
    try {
      return play
        ? compile([{ document: doc }], { navigation: false }).html
        : editablePreview(doc, channel);
    } catch {
      return "<p>HTML 语法需要修正</p>";
    }
  }, [doc, channel, play]);
  function change(next: any) {
    setUndo((xs) => [...xs.slice(-29), doc]);
    setRedo([]);
    setDoc(next);
    setDirty(true);
  }
  function patch(p: any) {
    try {
      change(patchNode(doc, selected.id, p));
      return true;
    } catch (e: any) {
      notify(e.message);
      return false;
    }
  }
  function deleteSelected() {
    if (!selected || !canEdit) return;
    try {
      change(deleteNode(doc, selected.id));
      setSelected(null);
    } catch (e: any) {
      notify(e.message);
    }
  }
  async function save() {
    if (!dirty || !page) return page;
    setSaving(true);
    try {
      const p = await api("/pages/" + page.id + "/revisions", {
        title,
        document: doc,
        base_revision_id: page.current_revision_id,
      });
      setB((v: any) => ({
        ...v,
        version: v.version + 1,
        pages: v.pages.map((x: any) => (x.id === p.id ? p : x)),
      }));
      setDoc(p.document);
      setDirty(false);
      return p;
    } finally {
      setSaving(false);
    }
  }
  async function switchPage(p: any) {
    if (p.id === pageId) return;
    await save();
    selectPage(p);
  }
  async function add(document = blank(), newTitle = "新页面") {
    await save();
    const p = await api("/booklets/" + id + "/pages", {
      title: newTitle,
      document,
    });
    await load(p.id);
  }
  async function reorder(from: string, to: string) {
    if (!canEdit || from === to) return;
    await save();
    const latest = await api("/booklets/" + id);
    const ids = latest.pages.map((p: any) => p.id);
    ids.splice(ids.indexOf(from), 1);
    ids.splice(ids.indexOf(to), 0, from);
    await api(
      "/booklets/" + id + "/pages/order",
      { ids, version: latest.version },
      "PUT",
    );
    await load(pageId);
  }
  async function startAI(replace = false) {
    await save();
    setAi({ replace });
  }
  if (!b) return <div className="loading">载入专业工作台…</div>;
  return (
    <div className="editor-shell">
      <div className="editor-heading">
        <div className="flex">
          <Link
            className="icon"
            to={"/projects/" + b.project_id}
            onClick={(e) => {
              if (dirty) {
                e.preventDefault();
                run(async () => {
                  await save();
                  window.location.href = "/projects/" + b.project_id;
                });
              }
            }}
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <div className="breadcrumb">
              {project?.name} <span>/ 专业分册</span>
            </div>
            <h2>{b.title}</h2>
          </div>
          <Badge status={b.submission?.status || "draft"} />
        </div>
        <div className="flex">
          <span className={"save-status " + (dirty ? "unsaved" : "")}>
            {saving ? "保存中…" : dirty ? "有未保存修改" : "✓ 已保存至工作空间"}
          </span>
          {canEdit && (
            <>
              <button onClick={() => setTemplate(true)}>
                <Layers3 size={16} />
                从部门模板库添加
              </button>
              {settings?.ai_enabled !== false && (
                <button className="primary" onClick={() => run(() => startAI())}>
                  <Sparkles size={16} />
                  AI 生成页面
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="editor-layout">
        <aside className="outline">
          <div className="outline-title">
            <b>页面大纲</b>
            <span>{b.pages.length} 页</span>
          </div>
          <div className="outline-pages">
            {b.pages.map((p: any, i: number) => (
              <div
                key={p.id}
                className={"outline-page " + (pageId === p.id ? "active" : "")}
                draggable={canEdit}
                onDragStart={() => setDrag(p.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => run(() => reorder(drag, p.id))}
              >
                <div className="outline-page-head">
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <b>{p.title}</b>
                  <GripVertical size={14} />
                </div>
                <button
                  className="thumbnail-button"
                  onClick={() => run(() => switchPage(p))}
                >
                  <Preview
                    document={p.id === pageId ? doc : p.document}
                    mini
                    title={p.title}
                  />
                </button>
              </div>
            ))}
          </div>
          {canEdit && (
            <button className="add-page" onClick={() => run(() => add())}>
              <Plus size={16} />
              添加空白页面
            </button>
          )}
        </aside>
        <section className="canvas-area">
          <div className="editor-toolbar">
            <div className="flex">
              <button
                className="icon"
                title="撤销"
                disabled={!undo.length}
                onClick={() => {
                  setRedo([doc, ...redo]);
                  setDoc(undo[undo.length - 1]);
                  setUndo(undo.slice(0, -1));
                  setDirty(true);
                }}
              >
                <Undo2 size={17} />
              </button>
              <button
                className="icon"
                title="重做"
                disabled={!redo.length}
                onClick={() => {
                  setUndo([...undo, doc]);
                  setDoc(redo[0]);
                  setRedo(redo.slice(1));
                  setDirty(true);
                }}
              >
                <Redo2 size={17} />
              </button>
              <i />
              {canEdit && (
                <>
                  <button
                    className="toolbar-button"
                    disabled={!doc}
                    onClick={() => run(() => add(doc, title + " · 副本"))}
                  >
                    <Copy size={15} />
                    复制
                  </button>
                  <button
                    className="toolbar-button"
                    onClick={() =>
                      run(async () => setLibrary(await api("/page-library")))
                    }
                  >
                    页面库
                  </button>
                  <button
                    className="toolbar-button"
                    onClick={() => uploadRef.current?.click()}
                  >
                    <Upload size={15} />
                    导入
                  </button>
                  <input
                    ref={uploadRef}
                    hidden
                    type="file"
                    accept=".html,.htm,.zip,.pptx"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        run(async () => {
                          await save();
                          const a = await upload(f, b.project_id);
                          const j = await api("/imports", {
                            asset_id: a.id,
                            booklet_id: id,
                          });
                          setAi({ initial: j });
                        });
                      e.target.value = "";
                    }}
                  />
                </>
              )}
            </div>
            <div className="flex">
              <button
                className={"toolbar-button " + (play ? "selected" : "")}
                onClick={() => setPlay(!play)}
              >
                <Play size={15} />
                {play ? "预览中" : "交互预览"}
              </button>
              <select
                aria-label="画布缩放"
                value={zoom}
                onChange={(e) => setZoom(+e.target.value)}
              >
                {[0.5, 0.6, 0.7, 0.8, 1].map((z) => (
                  <option key={z} value={z}>
                    {Math.round(z * 100)}%
                  </option>
                ))}
              </select>
              <button
                className="icon"
                title="源码编辑"
                disabled={!doc || !canEdit}
                onClick={() =>
                  setSource("<style>" + doc.css + "</style>\n" + doc.html)
                }
              >
                <Code2 size={18} />
              </button>
            </div>
          </div>
          <div className="canvas-scroll">
            {doc ? (
              <>
                <div className="canvas-caption">
                  <span>
                    {doc.layoutMode === "fixed"
                      ? "原始 PPTX 比例"
                      : "自然高度 · HTML 页面"}
                  </span>
                  <span>
                    {play
                      ? "支持的页面交互已启用，链接可直接打开"
                      : "点击元素编辑；按住 Cmd/Ctrl 点击链接可打开"}
                  </span>
                </div>
                <div
                  className="canvas-frame"
                  style={{ width: canvasWidth * zoom, height: height * zoom }}
                >
                  <iframe
                    ref={iframe}
                    title="页面编辑画布"
                    sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                    srcDoc={preview}
                    style={{
                      width: canvasWidth,
                      height,
                      transform: `scale(${zoom})`,
                      transformOrigin: "top left",
                    }}
                  />
                </div>
                <div className="canvas-label">
                  QUARKMED · PROFESSIONAL CONTENT WORKSPACE
                </div>
              </>
            ) : (
              <Empty>
                <p>分册还没有页面</p>
                {canEdit && (
                  <button className="primary" onClick={() => run(() => add())}>
                    <Plus size={16} />
                    开始制作第一页
                  </button>
                )}
              </Empty>
            )}
          </div>
        </section>
        <aside className="properties">
          <div className="properties-head">
            <SlidersIcon />
            <b>页面与要素</b>
            <span>PROPERTIES</span>
          </div>
          {doc && (
            <>
              <div className="property-section">
                <Field label="页面标题">
                  <input
                    disabled={!canEdit}
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setDirty(true);
                    }}
                  />
                </Field>
                <div className="flex">
                  <button
                    disabled={!canEdit || b.pages[0]?.id === pageId}
                    className="grow"
                    onClick={() =>
                      run(() =>
                        reorder(
                          pageId,
                          b.pages[
                            b.pages.findIndex((p: any) => p.id === pageId) - 1
                          ].id,
                        ),
                      )
                    }
                  >
                    <ArrowUp size={15} />
                    上移
                  </button>
                  <button
                    disabled={!canEdit || b.pages.at(-1)?.id === pageId}
                    className="grow"
                    onClick={() =>
                      run(() =>
                        reorder(
                          pageId,
                          b.pages[
                            b.pages.findIndex((p: any) => p.id === pageId) + 1
                          ].id,
                        ),
                      )
                    }
                  >
                    <ArrowDown size={15} />
                    下移
                  </button>
                </div>
              </div>
              <div className="property-section">
                <div className="property-label">
                  <MousePointer2 size={15} />
                  选中元素{" "}
                  {selected && <Badge>{selected.tag.toLowerCase()}</Badge>}
                </div>
                {selected ? (
                  <>
                    <button
                      className="danger delete-element-button"
                      disabled={!canEdit}
                      onClick={deleteSelected}
                    >
                      <Trash2 size={14} />
                      删除选中元素
                    </button>
                    <Field label="链接网址">
                      <input
                        key={selected.id + (selected.href || "")}
                        defaultValue={selected.href || ""}
                        placeholder="https://www.qmcro.com"
                        disabled={!canEdit}
                        onBlur={(e) => {
                          const href = e.target.value;
                          if (href !== (selected.href || "")) {
                            if (patch({ href }))
                              setSelected({ ...selected, href });
                          }
                        }}
                      />
                      <button
                        disabled={!canEdit || !selected.href}
                        onClick={() => {
                          if (patch({ href: "" }))
                            setSelected({ ...selected, href: "" });
                        }}
                      >
                        清除链接
                      </button>
                    </Field>
                    {selected.readonly ? (
                      <p className="diagnostic">
                        此对象以保真图形保存，内部文字不能单独修改；可删除整个对象。
                      </p>
                    ) : (
                      <>
                      <small className="muted">
                        {selected.id.slice(0, 25)}
                      </small>
                      {selected.leaf && selected.tag !== "IMG" && (
                        <Field label="文本内容">
                          <textarea
                            key={selected.id + selected.text}
                            rows={4}
                            defaultValue={selected.text}
                            disabled={!canEdit}
                            onBlur={(e) => {
                              if (e.target.value !== selected.text) {
                                patch({ text: e.target.value });
                                setSelected({
                                  ...selected,
                                  text: e.target.value,
                                });
                              }
                            }}
                          />
                        </Field>
                      )}
                      <div className="form-grid">
                        <Field label="字号 px">
                          <input
                            key={selected.id}
                            type="number"
                            min={8}
                            max={200}
                            defaultValue={parseFloat(selected.styles.fontSize)}
                            disabled={!canEdit}
                            onBlur={(e) =>
                              patch({
                                styles: {
                                  "font-size":
                                    Math.max(
                                      8,
                                      Math.min(200, +e.target.value),
                                    ) + "px",
                                },
                              })
                            }
                          />
                        </Field>
                        <Field label="文字颜色">
                          <input
                            type="color"
                            disabled={!canEdit}
                            defaultValue="#15243e"
                            onChange={(e) =>
                              patch({ styles: { color: e.target.value } })
                            }
                          />
                        </Field>
                      </div>
                      <Field label="字体">
                        <select
                          disabled={!canEdit}
                          defaultValue=""
                          onChange={(e) =>
                            patch({ styles: { "font-family": e.target.value } })
                          }
                        >
                          <option value="">选择字体</option>
                          {[
                            "Arial",
                            "Noto Sans CJK SC",
                            "Microsoft YaHei",
                            "serif",
                          ].map((f) => (
                            <option key={f}>{f}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="段落对齐">
                        <div className="segmented">
                          {[
                            ["left", AlignLeft],
                            ["center", AlignCenter],
                            ["right", AlignRight],
                          ].map(([v, Icon]: any) => (
                            <button
                              key={v}
                              disabled={!canEdit}
                              title={v}
                              onClick={() =>
                                patch({ styles: { "text-align": v } })
                              }
                            >
                              <Icon size={18} />
                            </button>
                          ))}
                        </div>
                      </Field>
                      <div className="form-grid">
                        <Field label="内边距 px">
                          <input
                            type="number"
                            min={0}
                            max={160}
                            defaultValue={0}
                            disabled={!canEdit}
                            onBlur={(e) =>
                              patch({
                                styles: {
                                  padding: Math.max(0, +e.target.value) + "px",
                                },
                              })
                            }
                          />
                        </Field>
                        <Field label="背景颜色">
                          <input
                            type="color"
                            defaultValue="#ffffff"
                            disabled={!canEdit}
                            onChange={(e) =>
                              patch({
                                styles: { "background-color": e.target.value },
                              })
                            }
                          />
                        </Field>
                      </div>
                      {selected.tag === "IMG" && (
                        <Field label="替换图片">
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={!canEdit}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) {
                                const r = new FileReader();
                                r.onload = () => patch({ src: r.result });
                                r.readAsDataURL(f);
                              }
                            }}
                          />
                        </Field>
                      )}
                      </>
                    )}
                  </>
                ) : (
                  <div className="select-hint">
                    <MousePointer2 size={27} />
                    <p>
                      在画布中点击文本、图片
                      <br />
                      或基础元素进行修改
                    </p>
                  </div>
                )}
              </div>
              {settings?.ai_enabled !== false && (
                <div className="property-section">
                  <div className="ai-hint">
                    <Sparkles size={21} />
                    <h4>让 AI 帮您优化这一页</h4>
                    <p>
                      描述修改需求，预览并采用结果。
                      <br />
                      医学内容由专业人员确认。
                    </p>
                    <button
                      disabled={!canEdit}
                      onClick={() => run(() => startAI(true))}
                    >
                      AI 修改当前页面 <ArrowUp size={14} />
                    </button>
                  </div>
                </div>
              )}
              <div className="property-section">
                <button
                  className="text-button"
                  disabled={!canEdit}
                  onClick={() =>
                    run(async () => {
                      await save();
                      await api("/pages/" + pageId + "/library", {});
                      notify("已保存当前版本到个人页面库");
                    })
                  }
                >
                  <Layers3 size={16} />
                  保存到页面库
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    run(async () =>
                      setHistory(await api("/pages/" + pageId + "/revisions")),
                    )
                  }
                >
                  <History size={16} />
                  查看版本记录
                </button>
                {canEdit && (
                  <button
                    className="text-button danger"
                    onClick={() => {
                      if (
                        window.confirm(
                          "从当前草稿移除此页面？已有提交版本仍保留。",
                        )
                      )
                        run(async () => {
                          await api("/pages/" + pageId, undefined, "DELETE");
                          await load();
                        });
                    }}
                  >
                    <Trash2 size={15} />
                    移除当前页面
                  </button>
                )}
                {doc.diagnostics?.map((d: any, i: number) => (
                  <p
                    key={i}
                    className={
                      "diagnostic " + (d.severity === "error" ? "error" : "")
                    }
                  >
                    {d.message}
                  </p>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
      <footer className="editor-footer">
        <div className="flex">
          <span className="status-dot" />
          <span>
            {canEdit ? "专业内容编写" : "只读预览"} · {remaining(b.deadline)}
          </span>
          <span className="muted">
            {b.instructions || "遵循部门专业规范，提交前核对核心医学数据。"}
          </span>
        </div>
        <div className="flex">
          <button
            onClick={() =>
              run(async () => {
                await save();
                setJob(
                  await api("/projects/" + b.project_id + "/exports", {
                    format: "html",
                    draft: true,
                    booklet_id: id,
                  }),
                );
              })
            }
          >
            <Download size={16} />
            导出当前分册
          </button>
          {canEdit && (
            <>
              <button
                disabled={saving || !dirty}
                onClick={() =>
                  run(async () => {
                    await save();
                    notify("草稿已保存");
                  })
                }
              >
                <Save size={16} />
                保存草稿
              </button>
              <button
                className="primary"
                disabled={!b.pages.length}
                onClick={() => setConfirmSubmit(true)}
              >
                <Send size={16} />
                确认完成
              </button>
            </>
          )}
        </div>
      </footer>
      {library && (
        <Modal
          title="我的 HTML 页面库"
          subtitle="收藏的页面版本可重复导入，原件保持不变。"
          wide
          onClose={() => setLibrary(null)}
        >
          <div className="modal-body template-grid">
            {library.length ? (
              library.map((l: any) => (
                <button
                  className="template-card"
                  key={l.id}
                  onClick={() =>
                    run(async () => {
                      await save();
                      const p = await api(
                        "/booklets/" + id + "/library/" + l.id,
                        {},
                      );
                      setLibrary(null);
                      await load(p.id);
                    })
                  }
                >
                  <Preview document={l.document} mini />
                  <h3>{l.title}</h3>
                  <p>导入为新页面</p>
                </button>
              ))
            ) : (
              <Empty>在右侧点击“保存到页面库”，即可收藏页面</Empty>
            )}
          </div>
        </Modal>
      )}
      {template && (
        <TemplatePicker
          onClose={() => setTemplate(false)}
          onSelect={(ids: string[]) =>
            run(async () => {
              await save();
              await api("/booklets/" + id + "/templates", {
                template_ids: ids,
              });
              setTemplate(false);
              await load();
              notify("模板已导入为分册副本");
            })
          }
        />
      )}{" "}
      {ai && settings?.ai_enabled !== false && (
        <AIDesigner
          booklet={b}
          page={ai.replace ? page : null}
          initial={ai.initial}
          onClose={() => setAi(null)}
          onAdopt={async () => {
            setAi(null);
            await load();
          }}
        />
      )}
      {source !== null && (
        <Modal
          title="HTML 源码编辑"
          subtitle="脚本会被移除，图片与字体需内嵌或随 ZIP 归档。"
          wide
          onClose={() => setSource(null)}
        >
          <SourceEditor value={source} onChange={setSource} />
          <footer className="modal-footer">
            <button onClick={() => setSource(null)}>取消</button>
            <button
              className="primary"
              onClick={() => {
                try {
                  change(normalize({ ...doc, html: source, css: "" }));
                  setSource(null);
                } catch (e: any) {
                  notify(e.message);
                }
              }}
            >
              应用到当前草稿
            </button>
          </footer>
        </Modal>
      )}
      {history && (
        <Modal
          title="页面版本记录"
          subtitle="恢复旧版会创建新草稿版本，不改动已提交内容。"
          wide
          onClose={() => setHistory(null)}
        >
          <div className="modal-body">
            {history.map((r: any, i: number) => (
              <div className="history-row" key={r.id}>
                <div>
                  <b>版本 {history.length - i}</b>
                  <p>
                    {new Date(r.created_at).toLocaleString("zh-CN")} ·{" "}
                    {r.source}
                  </p>
                </div>
                <button
                  disabled={!canEdit}
                  onClick={() => {
                    change(r.document);
                    setHistory(null);
                  }}
                >
                  恢复到草稿
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {confirmSubmit && (
        <Modal
          title="确认分册完成"
          subtitle="确认后商务人员可查看该固定版本，后续修改另存为新草稿。"
          onClose={() => setConfirmSubmit(false)}
        >
          <div className="modal-body">
            <h3>{b.title}</h3>
            <p>共 {b.pages.length} 页。请确认医学数据、术语与图表来源。</p>
          </div>
          <footer className="modal-footer">
            <button onClick={() => setConfirmSubmit(false)}>继续编辑</button>
            <button
              className="primary"
              onClick={() =>
                run(async () => {
                  await save();
                  await api("/booklets/" + id + "/submissions", {});
                  setConfirmSubmit(false);
                  await load();
                  notify("已确认完成，商务人员可查看");
                })
              }
            >
              确认完成
            </button>
          </footer>
        </Modal>
      )}
      {job && <JobView initial={job} onClose={() => setJob(null)} />}
    </div>
  );
}
function SlidersIcon() {
  return <span className="slider-icon">☷</span>;
}
function AIDesigner({ booklet, page, initial, onClose, onAdopt }: any) {
  const { run, notify } = useApp();
  const [prompt, setPrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<any>(initial || null);
  const [recent, setRecent] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState(0);
  const [tab, setTab] = useState("设计需求");
  const [htmlSource, setHtmlSource] = useState("");
  useEffect(() => {
    api("/jobs").then((js) =>
      setRecent(
        js.filter(
          (j: any) =>
            j.payload.booklet_id === booklet.id &&
            ["ai", "html_import"].includes(j.kind),
        ),
      ),
    );
  }, []);
  useEffect(() => {
    if (!job || ["succeeded", "failed", "cancelled"].includes(job.status))
      return;
    const source = new EventSource("/api/jobs/" + job.id + "/events");
    source.onmessage = (e) => setJob(JSON.parse(e.data));
    source.onerror = () => source.close();
    return () => source.close();
  }, [job?.id]);
  async function generate() {
    setBusy(true);
    try {
      let a;
      if (file) a = await upload(file, booklet.project_id);
      const j = await api("/ai/tasks", {
        project_id: booklet.project_id,
        booklet_id: booklet.id,
        page_id: page?.id,
        base_revision_id: page?.current_revision_id,
        prompt:
          prompt.trim() ||
          "根据参考图片还原为可编辑 HTML，保留原始文字、布局与颜色，不添加未提供的数据。",
        asset_id: a?.id,
        parent_job_id: job?.status === "succeeded" ? job.id : undefined,
      });
      setJob(j);
      setCandidate(0);
      setRecent([j, ...recent]);
      setPrompt("");
    } finally {
      setBusy(false);
    }
  }
  const running = job && ["queued", "running"].includes(job.status);
  return (
    <Modal
      title={page ? "AI 修改当前页面" : "AI 页面设计"}
      subtitle={`${booklet.title} · ${page ? "修改候选采用后替换当前页" : "采用结果后添加到分册"}`}
      wide
      onClose={onClose}
    >
      <div className="ai-layout">
        <aside className="ai-input">
          <div className="tabs">
            <button
              className={tab === "设计需求" ? "selected" : ""}
              onClick={() => setTab("设计需求")}
            >
              设计需求
            </button>
            <button
              className={tab === "导入 HTML" ? "selected" : ""}
              onClick={() => setTab("导入 HTML")}
            >
              导入 HTML
            </button>
          </div>
          {tab === "设计需求" ? (
            <>
              <div className="ai-context">
                <Sparkles size={17} />
                <div>
                  <b>专业上下文已就绪</b>
                  <p>
                    {booklet.instructions ||
                      "夸克医药设计规范 · 当前项目与分册要求"}
                  </p>
                </div>
              </div>
              <Field
                label={
                  job?.status === "succeeded"
                    ? "继续描述修改需求"
                    : "您希望制作怎样的页面？"
                }
              >
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={8}
                  placeholder="例如：根据参考截图，制作临床研究方案概览。保留研究阶段、主要终点与团队职责，缺失数据标为待确认。"
                />
              </Field>
              <p className="muted ai-model-note">
                已配置的 AI 服务会根据文字或参考图片自动选择合适模型。
              </p>
              <Field label="参考图片 / 截图（可选）">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </Field>
              {file && (
                <p className="muted">
                  已选：{file.name}{" "}
                  <button onClick={() => setFile(null)} disabled={running}>
                    移除图片
                  </button>
                </p>
              )}
              <button
                className="primary full"
                disabled={
                  (!prompt.trim() && !file) ||
                  running ||
                  busy
                }
                onClick={() => run(generate)}
              >
                <Sparkles size={17} />
                {job?.status === "succeeded" ? "继续修改候选" : "开始设计"}
              </button>
            </>
          ) : (
            <>
              <Field label="粘贴 HTML">
                <textarea
                  rows={12}
                  value={htmlSource}
                  onChange={(e) => setHtmlSource(e.target.value)}
                  placeholder="<!doctype html>…"
                />
              </Field>
              <button
                className="primary full"
                disabled={!htmlSource.trim() || running}
                onClick={() =>
                  run(async () => {
                    const f = new File([htmlSource], "导入页面.html", {
                      type: "text/html",
                    });
                    const a = await upload(f, booklet.project_id);
                    setJob(
                      await api("/imports", {
                        asset_id: a.id,
                        booklet_id: booklet.id,
                      }),
                    );
                  })
                }
              >
                解析为候选页面
              </button>
              <p className="muted">
                带本地图片和 CSS 的页面，请从工作台“导入”上传完整 ZIP。
              </p>
            </>
          )}
          <div className="ai-history">
            <h4>本分册最近任务</h4>
            {recent.slice(0, 8).map((j) => (
              <button
                key={j.id}
                onClick={() =>
                  run(async () => {
                    setJob(await api("/jobs/" + j.id));
                    setCandidate(0);
                  })
                }
              >
                <History size={14} />
                <span>
                  {j.payload.prompt?.slice(0, 25) || "页面导入"}
                  <small>
                    {new Date(j.created_at).toLocaleString("zh-CN")}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </aside>
        <section className="ai-candidate">
          <div className="candidate-toolbar">
            <b>候选预览</b>
            {job && <Badge status={job.status} />}
            <span className="muted">未采用结果不会覆盖已保存页面</span>
          </div>
          {job?.result?.documents?.length ? (
            <>
              <div className="candidate-tabs">
                {job.result.documents.map((_: any, i: number) => (
                  <button
                    key={i}
                    className={candidate === i ? "selected" : ""}
                    onClick={() => setCandidate(i)}
                  >
                    第 {i + 1} 页
                  </button>
                ))}
              </div>
              <Preview document={job.result.documents[candidate]} />
              {job.result.warnings?.map((w: string) => (
                <p className="diagnostic" key={w}>
                  {w}
                </p>
              ))}
              {job.result.rounds && (
                <div className="candidate-rounds">
                  {job.result.rounds.map((r: any) => (
                    <span key={r.round}>
                      第 {r.round} 轮检查 · {Math.round(r.score * 100)}%
                      {r.dimensionMismatch ? " · 尺寸存在差异" : ""}
                    </span>
                  ))}
                </div>
              )}
              {job.result.documents[candidate]?.diagnostics?.map(
                (d: any, i: number) => (
                  <p key={i} className="diagnostic">
                    {d.message}
                  </p>
                ),
              )}
            </>
          ) : running ? (
            <div className="ai-wait">
              <div className="ai-orb">
                <Sparkles size={40} />
              </div>
              <h3>{job.stage}</h3>
              <p>正在处理页面，可关闭窗口后从最近任务继续查看。</p>
              <LoaderCircle className="spin" />
            </div>
          ) : job?.error ? (
            <div className="ai-wait">
              <h3>本次处理未完成</h3>
              <p className="error">{job.error}</p>
              <button
                onClick={() =>
                  run(async () =>
                    setJob(await api("/jobs/" + job.id + "/retry", {})),
                  )
                }
              >
                重试任务
              </button>
            </div>
          ) : (
            <div className="ai-wait">
              <div className="ai-orb">
                <Sparkles size={40} />
              </div>
              <h3>从您的专业构想开始</h3>
              <p>
                输入文字或上传参考图，让 AI 辅助表达。
                <br />
                查看候选，继续调整，满意后再采用。
              </p>
            </div>
          )}
        </section>
      </div>
      <footer className="modal-footer">
        <span className="grow muted">
          医学内容、研究数据与引用需由专业人员核对
        </span>
        {running && (
          <button
            className="danger"
            onClick={() =>
              run(async () =>
                setJob(await api("/jobs/" + job.id + "/cancel", {})),
              )
            }
          >
            <Square size={14} />
            停止
          </button>
        )}
        <button onClick={onClose}>稍后继续</button>
        <button
          className="primary"
          disabled={
            job?.status !== "succeeded" ||
            !job?.result?.documents?.length ||
            job?.result?.adopted
          }
          onClick={() =>
            run(async () => {
              await api("/jobs/" + job.id + "/adopt", {});
              notify("候选页面已采用");
              await onAdopt();
            })
          }
        >
          <Check size={17} />
          {job?.result?.adopted ? "结果已采用" : "采用结果"}
        </button>
      </footer>
    </Modal>
  );
}
