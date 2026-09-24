import { useState } from "react";
import { FileUp, FolderUp } from "lucide-react";
import { api } from "./api";
import { Modal, Field } from "./components";

export function TemplateImportDialog({
  categories,
  departments,
  onClose,
  onImported,
}: {
  categories: { id: string; name: string; active: boolean }[];
  departments: { id: string; name: string }[];
  onClose: () => void;
  onImported: (jobs: any[]) => void;
}) {
  const [mode, setMode] = useState<"files" | "folder">("files");
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState(
    categories.find((c) => c.active)?.id || "",
  );
  const [department, setDepartment] = useState("");
  const [shared, setShared] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const size = files.reduce((sum, file) => sum + file.size, 0);
  const valid =
    files.length > 0 &&
    size <= 32 * 1024 * 1024 &&
    files.length <= (mode === "folder" ? 500 : 10);
  return (
    <Modal
      title="新增模板入库"
      subtitle="直接接入其他平台导出的 HTML 文件夹或 ZIP，也支持 PPTX。导入后预览检查，启用后复用。"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!valid || busy) return;
          setBusy(true);
          setError("");
          try {
            const form = new FormData();
            files.forEach((file) =>
              form.append(
                "files",
                file,
                mode === "folder"
                  ? file.webkitRelativePath || file.name
                  : file.name,
              ),
            );
            form.append("input_mode", mode);
            form.append("template_name", name);
            form.append("category_id", category);
            if (department) form.append("department_id", department);
            form.append("shared", String(shared));
            const jobs = await api("/templates/imports", form);
            onImported(jobs);
          } catch (e: any) {
            setError(e?.message || "导入请求失败，请检查文件格式和服务状态。");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body template-import-body">
          <div className="tabs" aria-label="导入方式">
            {(["files", "folder"] as const).map((value) => (
              <button
                type="button"
                key={value}
                disabled={busy}
                className={mode === value ? "selected" : ""}
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                  setFiles([]);
                  setName("");
                  setError("");
                }}
              >
                {value === "files" ? (
                  <FileUp size={17} />
                ) : (
                  <FolderUp size={17} />
                )}
                {value === "files" ? "文件 / 压缩包" : "上传文件夹"}
              </button>
            ))}
          </div>
          <div className="dropzone">
            {mode === "folder" ? <FolderUp size={32} /> : <FileUp size={32} />}
            <b>
              {mode === "folder"
                ? "选择整个导出文件夹"
                : "选择 PPTX、HTML 或 ZIP 文件"}
            </b>
            <span>
              {mode === "folder"
                ? "保留子目录、HTML、CSS、图片和字体的相对路径"
                : "ZIP 中包含 HTML 页面及配套资源；最多 10 个文件"}
            </span>
            <input
              key={mode}
              type="file"
              multiple
              disabled={busy}
              aria-label={
                mode === "folder" ? "选择模板文件夹" : "选择模板文件或压缩包"
              }
              accept={mode === "files" ? ".pptx,.html,.htm,.zip" : undefined}
              ref={(element) => {
                if (element && mode === "folder")
                  element.setAttribute("webkitdirectory", "");
              }}
              onChange={(event) => {
                const selected = Array.from(event.target.files || []);
                setFiles(selected);
                setError("");
                setName(
                  mode === "folder"
                    ? selected[0]?.webkitRelativePath.split("/")[0] || ""
                    : selected.length === 1
                      ? selected[0].name.replace(/\.[^.]+$/, "")
                      : "",
                );
              }}
            />
          </div>
          <p className="muted">
            单次上传总计不超过 32 MB；文件夹最多 500 个文件。一个文件夹或 ZIP
            导入为一套多页模板。
          </p>
          {!!files.length && (
            <div className="template-import-selection">
              <strong>
                已选择 {files.length} 个文件 · {(size / 1024 / 1024).toFixed(2)}{" "}
                MB
              </strong>
              <ul>
                {files.slice(0, 8).map((file, i) => (
                  <li key={i}>{file.webkitRelativePath || file.name}</li>
                ))}
              </ul>
              {files.length > 8 && (
                <small>另有 {files.length - 8} 个文件</small>
              )}
              {!valid && (
                <p className="error">文件数量或总大小超限，请缩小后重试。</p>
              )}
            </div>
          )}
          {(mode === "folder" || files.length <= 1) && (
            <Field label="模板名称">
              <input
                value={name}
                maxLength={200}
                disabled={busy}
                placeholder="默认使用文件或文件夹名称"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          )}
          <Field label="模板分类">
            <select
              required
              value={category}
              disabled={busy}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="" disabled>
                请选择分类
              </option>
              {categories
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="归属部门">
            <select
              value={department}
              disabled={busy}
              onChange={(e) => setDepartment(e.target.value)}
            >
              <option value="">平台公共资产</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={shared}
              disabled={busy}
              onChange={(e) => setShared(e.target.checked)}
            />
            跨部门共享
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={!valid || !category || busy}>
            {busy ? "正在上传…" : "开始导入"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
