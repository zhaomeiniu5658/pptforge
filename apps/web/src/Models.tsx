import { useContext, useEffect, useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import { Context } from "./App";
import { api } from "./api";
import { Field, Modal, Empty } from "./components";

const defaults: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  ollama: "http://localhost:11434",
};
const providers: Record<string, string> = {
  openai: "OpenAI 兼容接口（Qwen / DeepSeek 等）",
  anthropic: "Claude",
  gemini: "Gemini",
  ollama: "Ollama",
};
const blank = {
  name: "",
  provider: "openai",
  base_url: defaults.openai,
  model_name: "",
  api_key: "",
  clear_key: false,
  enabled: true,
  supports_images: false,
  default_text: false,
  default_image: false,
};

export function Models() {
  const { user, notify } = useContext(Context);
  const [models, setModels] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<Record<string, string>>({});
  const load = () =>
    api("/models")
      .then(setModels)
      .catch((e) => notify(e.message));
  useEffect(() => {
    if (user.role === "admin") load();
  }, []);
  if (user.role !== "admin") return <Empty>仅管理员可以配置模型</Empty>;
  return (
    <main className="main">
      <div className="heading">
        <div>
          <div className="eyebrow">AI MODEL GATEWAY</div>
          <h1>模型配置</h1>
          <p>接入多个已部署模型，为文字与图片任务分别选择默认接口。</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setError("");
            setEdit({ ...blank });
          }}
        >
          <Plus size={16} />
          新增模型
        </button>
      </div>
      <div className="model-guidance">
        图片能力取决于服务端部署。勾选“支持图片”后，请测试连接确认图片请求可用；文字模型不会自动获得视觉能力。
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>配置名称 / 模型</th>
              <th>接口与能力</th>
              <th>默认用途</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id}>
                <td>
                  <b>{m.name}</b>
                  <small className="model-detail">{m.model_name}</small>
                </td>
                <td>
                  {providers[m.provider]}
                  <small className="model-detail">
                    {m.supports_images ? "文字 + 图片" : "仅文字"}
                  </small>
                </td>
                <td>
                  {[m.default_text && "文字默认", m.default_image && "图片默认"]
                    .filter(Boolean)
                    .join(" · ") || "手动选择"}
                </td>
                <td>{m.enabled ? "启用" : "停用"}</td>
                <td>
                  <div className="model-actions">
                    <button
                      onClick={() => {
                        setError("");
                        setEdit({ ...m, api_key: "", clear_key: false });
                      }}
                    >
                      <Settings2 size={14} />
                      编辑
                    </button>
                    <button
                      disabled={!m.enabled || !!testing}
                      onClick={async () => {
                        setTesting(m.id);
                        try {
                          const r = await api("/models/" + m.id + "/test", {});
                          setResults((x) => ({ ...x, [m.id]: r.message }));
                        } catch (e: any) {
                          setResults((x) => ({ ...x, [m.id]: e.message }));
                        } finally {
                          setTesting("");
                        }
                      }}
                    >
                      {testing === m.id ? "测试中…" : "测试连接"}
                    </button>
                  </div>
                  {results[m.id] && (
                    <p className="model-test-result" role="status">
                      {results[m.id]}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!models.length && <Empty>尚未添加模型</Empty>}
      </div>
      {edit && (
        <Modal
          title={edit.id ? "编辑模型配置" : "新增模型"}
          subtitle="配置保存在服务端，保存后立即用于新任务，无需重启。"
          onClose={() => {
            if (!busy) setEdit(null);
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await api(
                  "/models" + (edit.id ? "/" + edit.id : ""),
                  edit,
                  edit.id ? "PUT" : "POST",
                );
                setEdit(null);
                await load();
                notify("模型配置已保存");
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="modal-body model-form">
              <Field label="配置名称">
                <input
                  required
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  placeholder="例如：Qwen 文字 / Qwen 视觉"
                />
              </Field>
              <Field label="接口类型">
                <select
                  value={edit.provider}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      provider: e.target.value,
                      base_url: defaults[e.target.value],
                    })
                  }
                >
                  {Object.entries(providers).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Base URL">
                <input
                  required
                  type="url"
                  value={edit.base_url}
                  onChange={(e) =>
                    setEdit({ ...edit, base_url: e.target.value })
                  }
                />
              </Field>
              <Field label="Model name">
                <input
                  required
                  value={edit.model_name}
                  onChange={(e) =>
                    setEdit({ ...edit, model_name: e.target.value })
                  }
                />
              </Field>
              <Field
                label={
                  edit.has_api_key ? "API Key（已保存，留空保留）" : "API Key"
                }
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  value={edit.api_key}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      api_key: e.target.value,
                      clear_key: false,
                    })
                  }
                  placeholder="仅发送到服务端，不回显已有密钥"
                />
              </Field>
              {edit.has_api_key && (
                <label className="model-check">
                  <input
                    type="checkbox"
                    checked={edit.clear_key}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        clear_key: e.target.checked,
                        api_key: "",
                      })
                    }
                  />
                  清除已保存密钥（无需鉴权的接口）
                </label>
              )}
              <label className="model-check">
                <input
                  type="checkbox"
                  checked={edit.enabled}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      enabled: e.target.checked,
                      ...(!e.target.checked
                        ? { default_text: false, default_image: false }
                        : {}),
                    })
                  }
                />
                启用此模型
              </label>
              <label className="model-check">
                <input
                  type="checkbox"
                  checked={edit.supports_images}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      supports_images: e.target.checked,
                      ...(!e.target.checked ? { default_image: false } : {}),
                    })
                  }
                />
                支持图片输入（服务端需已开启）
              </label>
              <label className="model-check">
                <input
                  type="checkbox"
                  disabled={!edit.enabled}
                  checked={edit.default_text}
                  onChange={(e) =>
                    setEdit({ ...edit, default_text: e.target.checked })
                  }
                />
                设为文字任务默认模型
              </label>
              <label className="model-check">
                <input
                  type="checkbox"
                  disabled={!edit.enabled || !edit.supports_images}
                  checked={edit.default_image}
                  onChange={(e) =>
                    setEdit({ ...edit, default_image: e.target.checked })
                  }
                />
                设为图片任务默认模型
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer className="modal-footer">
              <button
                type="button"
                onClick={() => setEdit(null)}
                disabled={busy}
              >
                取消
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "保存中…" : "保存配置"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </main>
  );
}
