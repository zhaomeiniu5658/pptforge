import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { CategoryNode, templateCategoryOptions } from "./categoryTree";
import "./category-cascade.css";

type UserScope = { role: string; department_id?: string | null };

export function CategoryCascade({ categories, user, value, onChange, disabled = false }: {
  categories: CategoryNode[]; user?: UserScope; value: string;
  onChange: (id: string) => void; disabled?: boolean;
}) {
  const options = useMemo(() => templateCategoryOptions(categories, user), [categories, user]);
  const byId = useMemo(() => new Map(options.map(c => [c.id, c])), [options]);
  const departments = useMemo(() => {
    const result = new Map<string, string>();
    options.forEach(c => result.set(c.department_id || "public", c.department_name || "通用"));
    return [...result.entries()];
  }, [options]);
  const selected = byId.get(value);
  const [department, setDepartment] = useState(selected ? selected.department_id || "public" : "");
  const [root, setRoot] = useState(selected?.parent_id || selected?.id || "");
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 320 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const validationRef = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    if (!value) return;
    const current = byId.get(value);
    setDepartment(current ? current.department_id || "public" : "");
    setRoot(current?.parent_id || current?.id || "");
  }, [value, byId]);
  useEffect(() => {
    validationRef.current?.setCustomValidity(selected ? "" : "请至少选择部门下的一级分类");
  }, [selected]);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 520), window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const upwards = below < 250 && above > below;
      const compact = Math.max(above, below) < 280;
      const maxHeight = Math.min(350, compact ? window.innerHeight - 24 : upwards ? above : below);
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: compact ? (window.innerHeight - maxHeight) / 2 : upwards ? rect.top - maxHeight - 6 : rect.bottom + 6, width, maxHeight });
    };
    const outside = (e: PointerEvent) => {
      if (!triggerRef.current?.contains(e.target as Node) && !panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
    };
    place();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const roots = options.filter(c => (c.department_id || "public") === department && !c.parent_id);
  const children = options.filter(c => c.parent_id === root);
  const departmentName = departments.find(([key]) => key === department)?.[1];
  const path = selected ? [selected.department_name || "通用", selected.parent_id && byId.get(selected.parent_id)?.name, selected.name].filter(Boolean).join(" / ") : "";
  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  const navigateColumn = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (current + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    e.preventDefault(); buttons[next]?.focus();
  };
  const categoryRow = (c: CategoryNode, branch: boolean) => <button key={c.id} type="button"
    aria-pressed={branch ? root === c.id : value === c.id} onClick={() => {
      if (branch) setRoot(c.id);
      onChange(c.id);
      if (!branch || !options.some(child => child.parent_id === c.id)) close();
    }}>
    <span>{c.name}</span>
    {value === c.id && <Check size={14} className="cascade-check" />}
    {branch && options.some(child => child.parent_id === c.id) && <ChevronRight size={14} />}
  </button>;

  return <div className="field category-cascade">
    <span id={`${id}-label`}>模板分类</span>
    <button ref={triggerRef} type="button" className={`cascade-trigger${open ? " is-open" : ""}`}
      aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-panel`}
      disabled={disabled} onClick={() => setOpen(!open)}>
      <span id={`${id}-value`} className={path ? "" : "cascade-placeholder"}>{path || "请选择模板分类"}</span>
      <ChevronDown size={16} />
    </button>
    <input ref={validationRef} className="cascade-validation" aria-label="模板分类校验" tabIndex={-1}
      required disabled={disabled} value={selected?.id || ""} onChange={() => {}} onInvalid={e => {
        e.preventDefault(); setOpen(true); triggerRef.current?.focus();
      }} />
    <small>至少选择到部门下的一级分类，可继续选择二级分类。</small>
    {open && createPortal(<div ref={panelRef} id={`${id}-panel`} className="cascade-panel" role="dialog"
      aria-label="选择模板分类" style={position}>
      <div className="cascade-breadcrumb">{departmentName || "选择部门"}{root && <> <ChevronRight size={12} /> {byId.get(root)?.name}</>}
        {selected?.parent_id && <> <ChevronRight size={12} /> {selected.name}</>}
      </div>
      <div className="cascade-columns">
        <section onKeyDown={navigateColumn} aria-label="分类部门">
          <h4>部门</h4>
          <div className="cascade-options">{departments.map(([key, name]) => <button type="button" key={key}
            aria-pressed={department === key} onClick={() => {
              if (key !== department) { setDepartment(key); setRoot(""); onChange(""); }
            }}><span>{name}</span><ChevronRight size={14} /></button>)}</div>
        </section>
        <section onKeyDown={navigateColumn} aria-label="一级分类">
          <h4>一级分类</h4>
          <div className="cascade-options">{department ? roots.map(c => categoryRow(c, true)) : <p>请先选择部门</p>}</div>
        </section>
        {children.length > 0 && <section onKeyDown={navigateColumn} aria-label="二级分类">
          <h4>二级分类 <small>可选</small></h4>
          <div className="cascade-options">{children.map(c => categoryRow(c, false))}</div>
        </section>}
      </div>
      <div className="cascade-panel-footer"><small>{selected ? path : "请选择部门下的一级分类"}</small>
        <button type="button" disabled={!selected} onClick={close}>确定</button></div>
    </div>, document.body)}
  </div>;
}
