import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FolderOpen, GripVertical, LayoutGrid, Plus, Search } from "lucide-react";
import { api } from "./api";
import { Badge, Field, Modal } from "./components";
import { CategoryNode } from "./categoryTree";
import { classificationIcon } from "./categoryIcons";

type TreeNode = { id: string; name: string; kind: "company" | "department" | "category"; department_id: string | null; category?: CategoryNode; children: TreeNode[] };

export function CategoryManagement({ categories, departments, reload, run }: any) {
  const cats: CategoryNode[] = categories || [];
  const [selectedId, setSelectedId] = useState("company");
  const [expanded, setExpanded] = useState<string[]>(["company"]);
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TreeNode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragId, setDragId] = useState("");
  const [dropId, setDropId] = useState("");
  const [moving, setMoving] = useState(false);
  const [moveMessage, setMoveMessage] = useState("");
  const [moveError, setMoveError] = useState("");
  const tree = useMemo(() => {
    const categoryNode = (c: CategoryNode): TreeNode => ({ id: c.id, name: c.name, kind: "category", department_id: c.department_id || null, category: c,
      children: cats.filter(child => child.parent_id === c.id).map(categoryNode) });
    const groups: TreeNode[] = [{ id: "department:public", name: "通用", kind: "department", department_id: null,
      children: cats.filter(c => !c.department_id && !c.parent_id).map(categoryNode) },
      ...(departments || []).filter((d: any) => d.name !== "夸克医药").map((d: any) => ({ id: "department:" + d.id, name: d.name, kind: "department" as const, department_id: d.id,
        children: cats.filter(c => c.department_id === d.id && !c.parent_id).map(categoryNode) }))];
    // Keep any company-owned categories selectable, including legacy records.
    const companyDepartment = (departments || []).find((d: any) => d.name === "夸克医药");
    if (companyDepartment && cats.some(c => c.department_id === companyDepartment.id)) groups.push({ id: "department:" + companyDepartment.id, name: "公司直属", kind: "department", department_id: companyDepartment.id, children: cats.filter(c => c.department_id === companyDepartment.id && !c.parent_id).map(categoryNode) });
    groups.sort((a, b) => Number(!a.children.length) - Number(!b.children.length));
    return { id: "company", name: "夸克医药", kind: "company", department_id: null, children: groups } as TreeNode;
  }, [categories, departments]);
  const paths = new Map<string, TreeNode[]>();
  function index(node: TreeNode, parents: TreeNode[] = []) { paths.set(node.id, [...parents, node]); node.children.forEach(child => index(child, [...parents, node])); }
  index(tree);
  const path = paths.get(selectedId) || [tree];
  const selected = path[path.length - 1];
  useEffect(() => { if (!paths.has(selectedId)) setSelectedId("company"); }, [categories, departments]);
  const total = (node: TreeNode): number => node.children.reduce((sum, child) => sum + 1 + total(child), 0);
  const keyword = search.trim().toLocaleLowerCase();
  const matches = (node: TreeNode): boolean => node.name.toLocaleLowerCase().includes(keyword) || node.children.some(matches);
  function select(node: TreeNode) {
    setSelectedId(node.id);
    const ancestors = paths.get(node.id) || [];
    setExpanded(current => [...new Set([...current, ...ancestors.map(n => n.id)])]);
  }
  const canAdd = selected.kind !== "category" || !selected.category?.parent_id;
  const newCategory = () => setEdit({ name: "", active: true, department_id: selected.department_id,
    parent_id: selected.kind === "category" ? selected.id : null });
  const parentOptions = cats.filter(c => !c.parent_id && c.id !== edit?.id && (c.department_id || null) === (edit?.department_id || null));
  const icon = (node: TreeNode, size = 17) => {
    const Icon = classificationIcon(node.name, node.kind, node.category?.department_name || "", Boolean(node.children.length));
    return <Icon size={size} aria-hidden="true" />;
  };
  const dragged = paths.get(dragId)?.at(-1);
  function moveProblem(source: TreeNode | undefined, target: TreeNode) {
    if (!source || source.kind !== "category") return "";
    if (target.kind === "company") return "请拖到部门节点，设为一级分类";
    if (paths.get(target.id)?.some(n => n.id === source.id)) return "不能移动到自身或自己的下级";
    if (target.kind === "category" && (target.category?.parent_id || source.children.length)) return "分类最多两级；有子分类的节点请拖到部门下";
    if (target.category?.active === false && source.category?.active) return "启用分类不能移动到停用分类下";
    return "";
  }
  async function move(source: TreeNode, target: TreeNode) {
    if (moving) return;
    const problem = moveProblem(source, target);
    if (problem) { setMoveError(problem); return; }
    const parent_id = target.kind === "category" ? target.id : null;
    if ((source.category?.parent_id || null) === parent_id && source.department_id === target.department_id) return;
    setMoving(true); setMoveError(""); setMoveMessage("");
    try {
      const result = await api(`/template-categories/${source.id}/move`, { department_id: target.department_id, parent_id }, "POST");
      setSelectedId(source.id);
      setExpanded(current => [...new Set([...current, ...(paths.get(target.id) || []).map(n => n.id)])]);
      setMoveMessage(`已将“${source.name}”移动到“${target.name}”下${result.templates ? `，${result.templates} 套模板归属已同步` : ""}`);
      reload();
    } catch (error: any) { setMoveError(error.message); }
    finally { setMoving(false); }
  }
  function drop(e: React.DragEvent, target: TreeNode) {
    e.preventDefault(); e.stopPropagation();
    const source = paths.get(e.dataTransfer.getData("application/x-quark-category") || dragId)?.at(-1);
    setDragId(""); setDropId("");
    if (source) void move(source, target);
  }
  function dragOver(e: React.DragEvent, target: TreeNode) {
    if (!dragged || moving) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = moveProblem(dragged, target) ? "none" : "move";
    setDropId(target.id);
  }
  function renderNode(node: TreeNode, depth = 0, ancestorMatches = false): React.ReactNode {
    const ownMatch = node.name.toLocaleLowerCase().includes(keyword);
    if (keyword && !ancestorMatches && !matches(node)) return null;
    const open = Boolean(keyword) || expanded.includes(node.id);
    return <div key={node.id} role="treeitem" aria-selected={selected.id === node.id} aria-expanded={node.children.length ? open : undefined}>
      <div data-node-id={node.id} draggable={node.kind === "category" && !moving}
        onDragStart={e => { if (node.kind !== "category") return; e.stopPropagation(); e.dataTransfer.setData("application/x-quark-category", node.id); e.dataTransfer.effectAllowed = "move"; setDragId(node.id); setMoveMessage(""); setMoveError(""); }}
        onDragEnd={() => { setDragId(""); setDropId(""); }} onDragOver={e => dragOver(e, node)} onDrop={e => drop(e, node)}
        className={"classification-node" + (selected.id === node.id ? " selected" : "") + (node.category?.active === false ? " inactive" : "") + (dragId === node.id ? " dragging" : "") + (dropId === node.id ? (moveProblem(dragged, node) ? " drop-invalid" : " drop-target") : "")} style={{ paddingLeft: 8 + depth * 28 }}>
        {node.children.length ? <button type="button" className="classification-toggle" aria-label={`${open ? "收起" : "展开"}${node.name}`} onClick={() => setExpanded(current => current.includes(node.id) ? current.filter(id => id !== node.id) : [...current, node.id])}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="classification-dot">·</span>}
        <button type="button" className="classification-select" onClick={() => select(node)} title={node.kind === "category" ? `${node.name}（可拖动调整层级和部门）` : node.name}>{icon(node)}<span>{node.name}</span>{node.category?.active === false && <small>停用</small>}</button>
        {node.kind === "category" && <GripVertical size={12} className="classification-drag-handle" aria-hidden="true" />}
        <span className="classification-count">{node.children.length}</span>
      </div>
      {open && node.children.length > 0 && <div role="group">{node.children.map(child => renderNode(child, depth + 1, ancestorMatches || (Boolean(keyword) && ownMatch)))}</div>}
    </div>;
  }
  return <main className="main classification-page">
    <div className="classification-workspace">
      <aside className="classification-sidebar"><div className="classification-sidehead"><h1><LayoutGrid size={18} />企业组织分类管理</h1><div className="classification-search"><Search size={15} /><input aria-label="搜索部门或分类" placeholder="搜索部门或分类" value={search} onChange={e => setSearch(e.target.value)} />{search && <button type="button" aria-label="清空搜索" onClick={() => setSearch("")}>×</button>}</div></div>
        <div className="classification-tree" role="tree" aria-label="企业部门模板分类树">{renderNode(tree)}{keyword && !matches(tree) && <div className="classification-no-results">没有匹配的部门或分类</div>}</div>
        <div className="classification-foot">{moving ? "正在保存移动…" : dragId ? (dropId && moveProblem(dragged, paths.get(dropId)!.at(-1)!) || "拖到分类成为下级，拖到部门成为一级分类") : "拖动分类可调整层级和部门；关联模板归属同步调整"}</div>
      </aside>
      <section className="classification-detail" aria-label="分类详情">
        <header className="classification-top"><div className="classification-heading"><nav aria-label="分类路径" className="classification-breadcrumb">{path.map((node, i) => <span key={node.id}>{i > 0 && <span className="classification-divider">/</span>}<button type="button" onClick={() => select(node)} title={node.name}>{node.name}</button></span>)}</nav><h2>{icon(selected, 23)}{selected.name}{selected.category && <Badge status={selected.category.active ? "approved" : "returned"}>{selected.category.active ? "已启用" : "已停用"}</Badge>}</h2></div>
          <div className="classification-actions"><button type="button" disabled={selected.kind !== "category"} onClick={() => setEdit(selected.category)}>重命名</button><button type="button" disabled={selected.kind !== "category"} onClick={() => setDeleteTarget(selected)}>删除</button>{selected.category && <button type="button" onClick={() => run(async () => { await api("/template-categories/" + selected.id, { active: !selected.category?.active }, "PATCH"); reload(); })}>{selected.category.active ? "停用" : "启用"}</button>}<button type="button" className="primary" disabled={!canAdd} title={!canAdd ? "当前分类已是二级分类" : undefined} onClick={newCategory}><Plus size={16} />新建下级分类</button></div>
        </header>
        <div className="classification-content">
          {moveMessage && <p role="status" className="classification-move-status">{moveMessage}</p>}
          {moveError && <p role="alert" className="error">{moveError}</p>}
          {dragged?.category?.parent_id && <button type="button" className="classification-promote" onDragOver={e => dragOver(e, paths.get(dragged.id)!.at(-3)!)} onDrop={e => drop(e, paths.get(dragged.id)!.at(-3)!)}>拖到这里：移至上一级（部门下）</button>}
          <div className="classification-stats"><div><span>直属下级{selected.kind === "company" ? "部门" : "分类"}</span><strong>{selected.children.length}</strong></div><div><span>全部下级节点</span><strong>{total(selected)}</strong></div></div>
          <div className="classification-section"><h3>下级{selected.kind === "company" ? "部门" : "分类"}</h3><span>{selected.children.length} 个{selected.kind === "company" ? "部门" : "分类"}</span></div>
          <div className="classification-cards">{selected.children.map(child => <button type="button" className={"classification-card" + (dropId === child.id ? (moveProblem(dragged, child) ? " drop-invalid" : " drop-target") : "")} key={child.id} onClick={() => select(child)} onDragOver={e => dragOver(e, child)} onDrop={e => drop(e, child)}><span className="classification-card-title">{icon(child, 19)}<b>{child.name}</b>{child.category?.active === false && <small>停用</small>}</span><span>{total(child)} 个下级分类{child.category ? ` · ${child.category.subtree_count || 0} 套模板` : ""}</span></button>)}</div>
          {!selected.children.length && <div className="classification-empty"><FolderOpen size={32} /><b>暂无下级分类</b><p>{canAdd ? "点击右上方新建下级分类，开始维护分类树。" : "当前为二级分类，可在上级分类下新增同级分类。"}</p></div>}
        </div>
      </section>
    </div>
    {edit && <Modal title={edit.id ? "重命名分类" : "新建下级分类"} onClose={() => { if (!saving) setEdit(null); }}>
      <form onSubmit={e => { e.preventDefault(); if (saving) return; run(async () => { setSaving(true); try {
        const saved = await api("/template-categories" + (edit.id ? "/" + edit.id : ""), { name: edit.name, active: edit.active, department_id: edit.department_id || null, parent_id: edit.parent_id || null }, edit.id ? "PATCH" : "POST"); setSelectedId(saved.id); setEdit(null); reload();
      } finally { setSaving(false); } }); }}>
        <div className="modal-body"><Field label="分类名称"><input autoFocus required maxLength={100} value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="所属部门"><select value={edit.department_id || ""} onChange={e => setEdit({ ...edit, department_id: e.target.value || null, parent_id: null })}><option value="">通用</option>{departments?.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="上级分类"><select value={edit.parent_id || ""} onChange={e => setEdit({ ...edit, parent_id: e.target.value || null })}><option value="">无（一级分类）</option>{parentOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        </div><footer className="modal-footer"><button type="button" disabled={saving} onClick={() => setEdit(null)}>取消</button><button className="primary" disabled={saving}>{saving ? "保存中…" : "保存分类"}</button></footer>
      </form></Modal>}
    {deleteTarget && <Modal title="删除分类" onClose={() => { if (!deleting) setDeleteTarget(null); }}><div className="modal-body"><p>确认删除“{deleteTarget.name}”{deleteTarget.children.length ? "及其全部子分类" : ""}？</p><p className="muted">已关联模板的分类不能删除，可使用停用保留历史记录。</p></div><footer className="modal-footer"><button type="button" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</button><button type="button" className="danger" disabled={deleting} onClick={() => run(async () => { setDeleting(true); try { await api("/template-categories/" + deleteTarget.id, undefined, "DELETE"); const parent = paths.get(deleteTarget.id)?.at(-2); setSelectedId(parent?.id || "company"); setDeleteTarget(null); reload(); } finally { setDeleting(false); } })}>{deleting ? "删除中…" : "确认删除"}</button></footer></Modal>}
  </main>;
}
