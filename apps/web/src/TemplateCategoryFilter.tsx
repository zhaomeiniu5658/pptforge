import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

type Category = { id: string; name: string };

export function TemplateCategoryFilter({
  categories,
  selected,
  onChange,
}: {
  categories: Category[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const label = !selected.length
    ? "全部分类"
    : selected.length === 1
      ? categories.find((category) => category.id === selected[0])?.name ||
        "已选 1 类"
      : `已选 ${selected.length} 类`;

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <div
      className="template-category-select"
      ref={root}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={
          "template-category-trigger" +
          (selected.length ? " has-selection" : "")
        }
        aria-label={`模板分类：${label}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <span>{label}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div
          id={panelId}
          className="template-category-menu"
          role="group"
          aria-label="模板分类多选"
        >
          <div className="template-category-menu-head">
            <span>模板分类（可多选）</span>
            <button type="button" onClick={() => onChange([])}>
              清空
            </button>
          </div>
          <label>
            <input
              type="checkbox"
              checked={!selected.length}
              onChange={() => onChange([])}
            />
            全部分类
          </label>
          {categories.map((category) => (
            <label key={category.id}>
              <input
                type="checkbox"
                checked={selected.includes(category.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, category.id]
                      : selected.filter((id) => id !== category.id),
                  )
                }
              />
              {category.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
