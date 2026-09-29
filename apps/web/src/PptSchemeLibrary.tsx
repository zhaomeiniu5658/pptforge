import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Eye,
  Layers3,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { api, downloadFile } from "./api";
import { Empty, Modal, Preview } from "./components";
import { TemplateCategoryFilter } from "./TemplateCategoryFilter";
import { useApp } from "./App";

function useLoad(path: string) {
  const [data, setData] = useState<any>(null);
  const { run } = useApp();
  const load = () => run(async () => setData(await api(path)));
  useEffect(() => {
    load();
  }, [path]);
  return [data, load] as const;
}

function SchemeBuilder({
  templates,
  categories,
  initial,
  onClose,
  onSaved,
}: any) {
  const { run, notify } = useApp();
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [selected, setSelected] = useState<string[]>(
    initial?.items?.map((item: any) => item.template_id) ||
      initial?.template_ids ||
      [],
  );
  const [query, setQuery] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const editing = Boolean(initial?.id);
  useEffect(() => {
    if (!initial?.template_ids || !templates?.length) return;
    const available = new Set(templates.map((template: any) => template.id));
    setSelected((current) =>
      current.length
        ? current
        : initial.template_ids.filter((id: string) => available.has(id)),
    );
  }, [initial, templates]);

  const visible = useMemo(
    () =>
      (templates || []).filter(
        (template: any) =>
          template.active &&
          template.status === "published" &&
          template.name.toLowerCase().includes(query.trim().toLowerCase()) &&
          (!categoryIds.length || categoryIds.includes(template.category_id)),
      ),
    [templates, query, categoryIds],
  );
  const chosen = selected
    .map((id) => (templates || []).find((template: any) => template.id === id))
    .filter(Boolean);
  const toggle = (template: any) => {
    if (!template.active || template.status !== "published") return;
    setSelected((items) =>
      items.includes(template.id)
        ? items.filter((id) => id !== template.id)
        : [...items, template.id],
    );
  };
  const move = (index: number, direction: -1 | 1) => {
    const next = [...selected];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSelected(next);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !selected.length || saving) return;
    setSaving(true);
    try {
      const saved = await api(
        editing ? `/ppt-schemes/${initial.id}` : "/ppt-schemes",
        { name: name.trim(), description: description.trim(), template_ids: selected },
        editing ? "PATCH" : "POST",
      );
      notify(editing ? "PPT 方案已更新" : "PPT 方案已创建");
      onSaved(saved);
    } catch (error: any) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={editing ? "编辑 PPT 方案" : "新建 PPT 方案"}
      subtitle="从已启用的单个 PPT 模板中选择页面，并按顺序组合成一套完整方案。"
      wide
      className="ppt-scheme-builder-modal"
      onClose={onClose}
    >
      <form onSubmit={save}>
        <div className="ppt-scheme-builder">
          <section className="ppt-scheme-picker">
            <div className="ppt-scheme-picker-head">
              <div>
                <b>选择单页模板</b>
                <span>{visible.length} 个可选模板</span>
              </div>
              <div className="search">
                <Search size={15} />
                <input
                  aria-label="搜索单页模板"
                  placeholder="搜索模板"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>
            <div className="ppt-scheme-picker-filter">
              <TemplateCategoryFilter
                categories={categories || []}
                selected={categoryIds}
                onChange={setCategoryIds}
              />
            </div>
            <div className="ppt-scheme-template-grid">
              {visible.map((template: any) => {
                const isChosen = selected.includes(template.id);
                const disabled =
                  !template.active || template.status !== "published";
                return (
                  <button
                    type="button"
                    key={template.id}
                    data-template-id={template.id}
                    className={
                      "ppt-scheme-template-option " +
                      (isChosen ? "chosen " : "") +
                      (disabled ? "disabled" : "")
                    }
                    onClick={() => toggle(template)}
                    aria-pressed={isChosen}
                    disabled={disabled}
                  >
                    <div className="ppt-scheme-option-preview">
                      <Preview
                        document={template.documents?.[0]}
                        mini
                        miniViewportWidth={1520}
                        miniViewportHeight={900}
                      />
                      {isChosen && <span className="ppt-scheme-option-index">{selected.indexOf(template.id) + 1}</span>}
                      {disabled && <span className="ppt-scheme-option-state">未启用</span>}
                    </div>
                    <strong>{template.name}</strong>
                  </button>
                );
              })}
              {!visible.length && <Empty>没有符合条件的单页模板</Empty>}
            </div>
          </section>
          <aside className="ppt-scheme-selected">
            <div className="ppt-scheme-selected-head">
              <div>
                <b>方案信息</b>
                <span>{selected.length} 个模板已选</span>
              </div>
            </div>
            <label className="ppt-scheme-field">
              <span>方案名称</span>
              <input
                required
                maxLength={200}
                placeholder="例如：临床投标标准方案"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="ppt-scheme-field">
              <span>方案说明</span>
              <textarea
                rows={3}
                maxLength={2000}
                placeholder="描述这套方案的适用场景和页面结构"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <div className="ppt-scheme-order-head">
              <span>组合顺序</span>
              <small>导出时按此顺序排列</small>
            </div>
            <div className="ppt-scheme-order-list">
              {chosen.map((template: any, index: number) => (
                <div className="ppt-scheme-order-item" key={template.id}>
                  <span className="ppt-scheme-order-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="ppt-scheme-order-name">{template.name}</span>
                  <button
                    type="button"
                    className="icon"
                    title="上移"
                    aria-label={`上移 ${template.name}`}
                    disabled={!index}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon"
                    title="下移"
                    aria-label={`下移 ${template.name}`}
                    disabled={index === chosen.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon"
                    title="移除"
                    aria-label={`移除 ${template.name}`}
                    onClick={() => toggle(template)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {!chosen.length && (
                <p className="ppt-scheme-empty-order">请从左侧勾选单页模板</p>
              )}
            </div>
          </aside>
        </div>
        <footer className="modal-footer">
          <span className="muted">模板原件保持不变，方案保存的是当前模板版本组合。</span>
          <div>
            <button type="button" onClick={onClose} disabled={saving}>
              取消
            </button>
            <button className="primary" type="submit" disabled={saving || !name.trim() || !selected.length}>
              {saving ? "保存中…" : editing ? "保存方案" : "创建方案"}
            </button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}

function SchemePreview({ scheme, onClose }: any) {
  return (
    <Modal
      title={scheme.name}
      subtitle={`${scheme.template_count} 个单页模板 · 共 ${scheme.items.reduce((n: number, item: any) => n + item.template.documents.length, 0)} 页`}
      wide
      className="ppt-scheme-detail-modal"
      onClose={onClose}
    >
      <div className="ppt-scheme-detail-body">
        {scheme.items.map((item: any) => (
          <section key={item.id} className="ppt-scheme-detail-template">
            <div className="ppt-scheme-detail-title">
              <span>{String(item.position + 1).padStart(2, "0")}</span>
              <h3>{item.template.name}</h3>
              <small>{item.template.documents.length} 页</small>
            </div>
            {item.template.documents.map((doc: any, index: number) => (
              <div key={index} className="ppt-scheme-detail-page">
                <h4>第 {index + 1} 页</h4>
                <Preview
                  document={doc}
                  interactive
                  scrollable
                  title={`${item.template.name} · 第 ${index + 1} 页`}
                />
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}

export function PptSchemeLibrary() {
  const { user, notify } = useApp();
  const location = useLocation();
  const templateIdsFromUrl = new URLSearchParams(location.search).get("template_ids");
  const [schemes, reload] = useLoad("/ppt-schemes");
  const [templates] = useLoad("/templates");
  const [categories] = useLoad("/template-categories");
  const [query, setQuery] = useState("");
  const [builder, setBuilder] = useState<any>(() => {
    const ids = templateIdsFromUrl;
    return ids ? { template_ids: ids.split(",").filter(Boolean) } : null;
  });
  const [preview, setPreview] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const filtered = (schemes || []).filter((scheme: any) =>
    scheme.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const isAdmin = user.role === "admin";
  useEffect(() => {
    const ids = templateIdsFromUrl;
    if (ids) {
      setBuilder({ template_ids: ids.split(",").filter(Boolean) });
    }
  }, [templateIdsFromUrl]);
  const remove = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    try {
      await api(`/ppt-schemes/${deleteTarget.id}`, undefined, "DELETE");
      notify("PPT 方案已删除");
      setDeleteTarget(null);
      reload();
    } catch (error: any) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="main ppt-scheme-page">
      <div className="heading">
        <div>
          <div className="eyebrow">PRESENTATION SCHEME LIBRARY</div>
          <h1>PPT 方案库</h1>
          <p>将多个单页 PPT 模板组合成完整方案，模板原件保持独立复用。</p>
        </div>
        <div className="heading-actions">
          <div className="search ppt-scheme-search">
            <Search size={16} />
            <input
              aria-label="搜索 PPT 方案"
              placeholder="搜索方案名称"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {isAdmin && (
            <button className="primary" onClick={() => setBuilder({})}>
              <Plus size={17} />
              新建 PPT 方案
            </button>
          )}
        </div>
      </div>
      <div className="panel ppt-scheme-library-panel">
        <div className="ppt-scheme-library-bar">
          <span className="muted">共 {filtered.length} 套完整方案</span>
          <span className="ppt-scheme-library-hint">
            <Layers3 size={15} />
            方案由单个 PPT 模板组合而成
          </span>
        </div>
        <div className="ppt-scheme-grid">
          {filtered.map((scheme: any) => {
            const first = scheme.items?.[0]?.template?.documents?.[0];
            const pages = scheme.items?.reduce(
              (count: number, item: any) => count + item.template.documents.length,
              0,
            );
            return (
              <article className="ppt-scheme-card" key={scheme.id}>
                <button className="ppt-scheme-card-preview" onClick={() => setPreview(scheme)}>
                  {first ? (
                    <Preview document={first} mini miniViewportWidth={1520} miniViewportHeight={900} />
                  ) : (
                    <div className="ppt-scheme-card-empty">暂无预览</div>
                  )}
                  <span className="ppt-scheme-card-count">{scheme.template_count} 个模板 · {pages} 页</span>
                </button>
                <div className="ppt-scheme-card-body">
                  <h3>{scheme.name}</h3>
                  <p>{scheme.description || "由多个单页模板组合的完整方案。"}</p>
                  <div className="ppt-scheme-card-meta">
                    <span>版本 v{scheme.version}</span>
                    <span>{new Date(scheme.created_at).toLocaleDateString("zh-CN")}</span>
                  </div>
                  <div className="ppt-scheme-card-actions">
                    <button className="icon" data-tooltip="预览" aria-label={`预览方案 ${scheme.name}`} onClick={() => setPreview(scheme)}>
                      <Eye size={16} />
                    </button>
                    <button className="icon" data-tooltip="下载" aria-label={`下载方案 ${scheme.name}`} onClick={async () => {
                      try {
                        await downloadFile(`/ppt-schemes/${scheme.id}/download`);
                        notify(`已开始下载「${scheme.name}」`);
                      } catch (error: any) {
                        notify(error.message);
                      }
                    }}>
                      <Download size={16} />
                    </button>
                    {isAdmin && (
                      <>
                        <button className="icon" data-tooltip="编辑" aria-label={`编辑方案 ${scheme.name}`} onClick={() => setBuilder(scheme)}>
                          <Pencil size={16} />
                        </button>
                        <button className="icon danger-icon" data-tooltip="删除" aria-label={`删除方案 ${scheme.name}`} onClick={() => setDeleteTarget(scheme)}>
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {!schemes && <div className="loading">载入 PPT 方案库…</div>}
        {schemes && !filtered.length && <Empty>暂无 PPT 方案，管理员可以从单个模板创建方案。</Empty>}
      </div>
      {builder && (
        <SchemeBuilder
          key={builder.id || builder.template_ids?.join(",") || "new"}
          templates={templates || []}
          categories={categories || []}
          initial={builder}
          onClose={() => setBuilder(null)}
          onSaved={() => {
            setBuilder(null);
            reload();
          }}
        />
      )}
      {preview && <SchemePreview scheme={preview} onClose={() => setPreview(null)} />}
      {deleteTarget && (
        <Modal title="删除 PPT 方案" onClose={() => !busy && setDeleteTarget(null)}>
          <div className="modal-body">
            <p>确定删除「{deleteTarget.name}」吗？单个 PPT 模板不会受到影响。</p>
          </div>
          <footer className="modal-footer">
            <button onClick={() => setDeleteTarget(null)} disabled={busy}>取消</button>
            <button className="danger-button" onClick={remove} disabled={busy}>{busy ? "删除中…" : "确认删除"}</button>
          </footer>
        </Modal>
      )}
    </main>
  );
}
