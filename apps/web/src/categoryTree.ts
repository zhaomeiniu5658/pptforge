export type CategoryNode = {
  id: string; name: string; parent_id?: string | null; department_id?: string | null;
  department_name?: string; path?: string; active?: boolean; position?: number; count?: number; subtree_count?: number;
};

export function categoryIds(categories: CategoryNode[], selected: string[]): Set<string> {
  const ids = new Set(selected);
  let size = -1;
  while (size !== ids.size) {
    size = ids.size;
    categories.forEach(c => { if (c.parent_id && ids.has(c.parent_id)) ids.add(c.id); });
  }
  return ids;
}

export function categoryLabel(c: CategoryNode): string {
  return `${c.department_name || "通用"} · ${c.path || c.name}`;
}

export function availableCategories(categories: CategoryNode[], department: string | null | undefined) {
  return categories.filter(c => c.active && (!c.department_id || c.department_id === department)
    && (!c.parent_id || categories.some(p => p.id === c.parent_id && p.active)));
}

export function templateCategoryOptions(categories: CategoryNode[], user?: { role: string; department_id?: string | null }) {
  return categories.filter(c => c.active
    && (!c.parent_id || categories.some(p => p.id === c.parent_id && p.active))
    && (user?.role === "admin" || (user?.role === "contributor"
      ? Boolean(user.department_id) && c.department_id === user.department_id
      : !c.department_id || c.department_id === user?.department_id)));
}
