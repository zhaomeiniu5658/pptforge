export async function api(
  path: string,
  body?: unknown,
  method?: string,
): Promise<any> {
  let r: Response;
  try {
    r = await fetch("/api" + path, {
      credentials: "include",
      method: method || (body === undefined ? "GET" : "POST"),
      headers:
        body instanceof FormData
          ? {}
          : body === undefined
            ? {}
            : { "Content-Type": "application/json" },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
  } catch {
    throw Error("后端服务不可用，请确认 API 服务已启动（8011）。");
  }
  if (!r.ok) {
    let d: any;
    let text = "";
    try {
      d = await r.clone().json();
    } catch {
      try {
        text = await r.text();
      } catch {}
    }
    const detail =
      typeof d?.detail === "string"
        ? d.detail
        : d?.detail
          ? JSON.stringify(d.detail)
          : text.trim();
    if (r.status >= 500 && !detail)
      throw Error("后端服务不可用，请确认 API 服务已启动（8011）。");
    throw Error(detail || `请求失败（HTTP ${r.status}）`);
  }
  return r.json();
}
export async function upload(file: File, projectId?: string) {
  const f = new FormData();
  f.append("file", file);
  if (projectId) f.append("project_id", projectId);
  return api("/assets", f);
}
export async function downloadFile(
  path: string,
  body?: unknown,
  method?: string,
) {
  const response = await fetch("/api" + path, {
    credentials: "include",
    method: method || (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = "下载失败";
    try {
      const data = await response.json();
      detail = typeof data?.detail === "string" ? data.detail : detail;
    } catch {}
    throw Error(detail);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || "quarkmed-templates.zip";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
export const roleNames: Record<string, string> = {
  admin: "系统管理员",
  business: "商务人员",
  contributor: "专业组人员",
};
export const statusNames: Record<string, string> = {
  submitted: "待确认",
  approved: "已确认",
  returned: "退回修改",
  draft: "制作中",
  published: "已发布",
  queued: "等待处理",
  running: "处理中",
  succeeded: "已完成",
  failed: "处理失败",
  cancelled: "已取消",
};
export function date(v: string) {
  return v ? new Date(v).toLocaleDateString("zh-CN") : "—";
}
export function remaining(v: string) {
  const hours = Math.ceil((new Date(v).getTime() - Date.now()) / 3600000);
  return hours < 0
    ? "已截止"
    : hours < 48
      ? hours + "H 截止"
      : Math.ceil(hours / 24) + " 天后截止";
}
