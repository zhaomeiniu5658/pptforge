import { useState } from "react";
import { ChevronDown, ChevronRight, LayoutGrid, Search } from "lucide-react";
import { CategoryNode, categoryIds } from "./categoryTree";
import { classificationIcon } from "./categoryIcons";

export function TemplateLibraryTree({ categories, departments, templates, user, department, selected, onSelect }: any) {
  const cats: CategoryNode[] = categories || [];
  const restricted = user.role !== "admin";
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string[]>(restricted ? [user.department_id] : ["public"]);
  const groups = restricted
    ? (departments || []).filter((d: any) => d.id === user.department_id)
    : [{ id: "public", name: "通用" }, ...(departments || [])];
  const scopedCats = (id: string) => cats.filter(c => (c.department_id || "public") === id && (user.role === "admin" || c.active));
  const groupTemplates = (id: string) => (templates || []).filter((t: any) => id === "public"
    ? scopedCats(id).some(c => c.id === t.category_id)
    : t.department_id === id);
  const keyword = search.trim().toLocaleLowerCase();
  const toggle = (id: string) => setExpanded(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
  const icon = (name: string, kind: "department" | "category", departmentName = "") => {
    const Icon = classificationIcon(name, kind, departmentName);
    return <Icon size={17} aria-hidden="true" />;
  };
  function categoryRow(c: CategoryNode, group: any, depth: number, inheritedMatch = false): React.ReactNode {
    const children = scopedCats(group.id).filter(x => x.parent_id === c.id);
    const ownMatch = c.name.toLocaleLowerCase().includes(keyword);
    if (keyword && !inheritedMatch && !ownMatch && !children.some(x => x.name.toLocaleLowerCase().includes(keyword))) return null;
    const open = Boolean(keyword) || expanded.includes(c.id);
    const ids = categoryIds(cats, [c.id]);
    const count = groupTemplates(group.id).filter((t: any) => ids.has(t.category_id)).length;
    return <div key={c.id} role="treeitem" aria-selected={department === group.id && selected === c.id} aria-expanded={children.length ? open : undefined}>
      <div className={"library-tree-row" + (department === group.id && selected === c.id ? " selected" : "")} style={{ paddingLeft: 8 + depth * 24 }}>
        {children.length ? <button type="button" className="library-tree-toggle" aria-label={`${open ? "收起" : "展开"}${c.name}`} onClick={() => toggle(c.id)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="library-tree-dot">·</span>}
        <button type="button" className="library-tree-select" title={c.name} onClick={() => { onSelect(group.id, c.id); if (!expanded.includes(c.id)) toggle(c.id); }}>{icon(c.name, "category", c.department_name)}<span>{c.name}</span>{c.active === false && <small>停用</small>}</button><em>{count}</em>
      </div>{open && children.length > 0 && <div role="group">{children.map(child => categoryRow(child, group, depth + 1, inheritedMatch || ownMatch))}</div>}
    </div>;
  }
  return <aside className="template-category-sidebar library-tree-sidebar" aria-label="模板分类树">
    <div className="library-tree-title"><LayoutGrid size={17} /><b>模板分类</b></div>
    <div className="library-tree-search"><Search size={14} /><input aria-label="搜索模板分类" placeholder="搜索分类" value={search} onChange={e => setSearch(e.target.value)} /></div>
    <div className="library-tree-scroll">
      {!restricted && <button type="button" className={"library-tree-all" + (department === "all" ? " selected" : "")} onClick={() => onSelect("all", "")}><span>全部模板</span><em>{templates?.length || 0}</em></button>}
      <div role="tree" aria-label="可见模板分类">{groups.map((group: any) => {
        const rows = scopedCats(group.id);
        const roots = rows.filter(c => !c.parent_id);
        const groupMatch = group.name.toLocaleLowerCase().includes(keyword);
        if (keyword && !groupMatch && !rows.some(c => c.name.toLocaleLowerCase().includes(keyword))) return null;
        const open = Boolean(keyword) || expanded.includes(group.id);
        const uncategorized = restricted ? groupTemplates(group.id).filter((t: any) => !rows.some(c => c.id === t.category_id)).length : 0;
        return <div key={group.id} role="treeitem" aria-expanded={open} aria-selected={department === group.id && !selected}>
          <div className={"library-tree-row" + (department === group.id && !selected ? " selected" : "")}>{roots.length ? <button type="button" className="library-tree-toggle" aria-label={`${open ? "收起" : "展开"}${group.name}`} onClick={() => toggle(group.id)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="library-tree-dot">·</span>}
            <button type="button" className="library-tree-select" title={group.name} onClick={() => { onSelect(group.id, ""); if (!expanded.includes(group.id)) toggle(group.id); }}>{icon(group.name, "department")}<span>{group.name}</span></button><em>{groupTemplates(group.id).length}</em>
          </div>{open && <div role="group">{roots.map(c => categoryRow(c, group, 1, groupMatch))}{uncategorized > 0 && !keyword && <button type="button" className={"library-tree-unclassified" + (selected === "unclassified" ? " selected" : "")} onClick={() => onSelect(group.id, "unclassified")}><span>未归入本部门分类</span><em>{uncategorized}</em></button>}{!roots.length && <p className="library-tree-empty">本部门暂无分类</p>}</div>}
        </div>;
      })}</div>
      {restricted && !groups.length && <p className="library-tree-empty">账号尚未分配部门</p>}
    </div>
  </aside>;
}
