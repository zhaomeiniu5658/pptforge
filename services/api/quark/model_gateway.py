"""Explicit provider adapters; secrets remain in the worker environment."""

import os, json, re, runpy
from pathlib import Path

PROMPT_PATH = (
    Path(__file__).resolve().parents[3]
    / "third_party/openstitch/backend/src/prompts/html_css.py"
)
BASE_PROMPT = runpy.run_path(str(PROMPT_PATH))["SYSTEM_PROMPT"]
# Remove the upstream invitation to invent plausible data in this clinical context.
BASE_PROMPT = "\n".join(
    line for line in BASE_PROMPT.splitlines() if "plausible data" not in line
)
import httpx


def check_response(response, *, has_images=False):
    """Expose actionable provider failures without leaking URLs, keys or payloads."""
    if not response.is_error:
        return
    message = ""
    try:
        error = response.json().get("error", {})
        message = error.get("message", "") if isinstance(error, dict) else str(error)
    except (ValueError, AttributeError):
        pass
    if has_images and re.search(
        r"at most\s+0\s+image|image.{0,40}(?:not supported|unsupported)|"
        r"(?:not support|unsupported).{0,40}image|does not support.{0,40}vision",
        message,
        re.IGNORECASE,
    ):
        raise ValueError(
            "图片已上传，但当前模型部署不接受图片输入。请在模型服务端启用视觉输入，"
            "或配置支持图片的模型接口后重新生成；当前接口仍可用于文字生成 HTML。"
        )
    if response.status_code in (401, 403):
        raise ValueError("模型服务鉴权失败，请检查 API Key 及模型访问权限。")
    if response.status_code == 429:
        raise ValueError("模型服务请求受限或额度不足，请检查服务额度并稍后重试。")
    raise ValueError(
        f"模型服务拒绝了请求（HTTP {response.status_code}）。"
        "请检查模型名称、输入能力和服务端日志。"
    )


def request_timeout():
    try:
        return int(os.getenv("MODEL_TIMEOUT", "360"))
    except ValueError:
        return 360


def generate(prompt, images=(), *, config=None):
    config = config or {}
    name = config.get("name", os.getenv("MODEL_NAME", ""))
    if not name:
        raise ValueError(
            "尚未配置 AI 模型。请在服务端设置 MODEL_NAME、MODEL_PROVIDER 和模型连接信息。"
        )
    provider = config.get("provider", os.getenv("MODEL_PROVIDER", "openai"))
    key = config.get("key", os.getenv("MODEL_API_KEY", ""))
    system = (
        BASE_PROMPT
        + "\n以下 Quarkmed 约束优先于以上通用设计规则：\n"
        + "你是 Quarkmed 医药方案 HTML 设计师。仅输出完整 HTML（内嵌 CSS），不输出 Markdown。使用中文、夸克蓝 #2563EB，专业留白，默认自然流布局。禁止外部资源、脚本、CDN。图片用内嵌 data URI 或留出明确占位。不得编造医学数据、剂量、终点和研究结论；缺失内容标为待确认。保留已有 data-node-id。"
    )
    try:
        with httpx.Client(timeout=request_timeout()) as c:
            if provider == "ollama":
                base = (
                    config.get("base_url", os.getenv("MODEL_BASE_URL", "http://localhost:11434"))
                    .removesuffix("/v1")
                    .rstrip("/")
                )
                r = c.post(
                    base + "/api/chat",
                    json={
                        "model": name,
                        "stream": False,
                        "messages": [
                            {"role": "system", "content": system},
                            {
                                "role": "user",
                                "content": prompt,
                                "images": [i.split(",", 1)[1] for i in images],
                            },
                        ],
                    },
                )
                check_response(r, has_images=bool(images))
                out = r.json()["message"]["content"]
            elif provider == "anthropic":
                content = [{"type": "text", "text": prompt}] + [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": i.split(";")[0][5:],
                            "data": i.split(",", 1)[1],
                        },
                    }
                    for i in images
                ]
                r = c.post(
                    config.get("base_url", os.getenv("MODEL_BASE_URL", "https://api.anthropic.com")).rstrip("/")
                    + "/v1/messages",
                    headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
                    json={
                        "model": name,
                        "max_tokens": 12000,
                        "system": system,
                        "messages": [{"role": "user", "content": content}],
                    },
                )
                check_response(r, has_images=bool(images))
                out = "".join(x.get("text", "") for x in r.json()["content"])
            elif provider == "gemini":
                parts = [{"text": system + "\n" + prompt}] + [
                    {
                        "inlineData": {
                            "mimeType": i.split(";")[0][5:],
                            "data": i.split(",", 1)[1],
                        }
                    }
                    for i in images
                ]
                r = c.post(
                    config.get("base_url", os.getenv(
                        "MODEL_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"
                    )).rstrip("/")
                    + "/models/"
                    + name
                    + ":generateContent",
                    headers={"x-goog-api-key": key},
                    json={"contents": [{"parts": parts}]},
                )
                check_response(r, has_images=bool(images))
                out = "".join(
                    x.get("text", "") for x in r.json()["candidates"][0]["content"]["parts"]
                )
            else:
                content = [{"type": "text", "text": prompt}] + [
                    {"type": "image_url", "image_url": {"url": i}} for i in images
                ]
                r = c.post(
                    config.get("base_url", os.getenv("MODEL_BASE_URL", "https://api.openai.com/v1")).rstrip("/")
                    + "/chat/completions",
                    headers={"Authorization": "Bearer " + key},
                    json={
                        "model": name,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": content},
                        ],
                        "max_tokens": 12000,
                    },
                )
                check_response(r, has_images=bool(images))
                out = r.json()["choices"][0]["message"]["content"]
    except httpx.TimeoutException as exc:
        raise ValueError(
            "模型服务响应超时。请稍后重试，或在模型配置中选择响应更快的模型；"
            "如使用图片生成，建议先降低图片尺寸。"
        ) from exc
    except httpx.HTTPError as exc:
        raise ValueError("模型服务连接失败，请检查模型地址、网络和服务端状态。") from exc
    out = re.sub(r"^```(?:html)?\s*|\s*```$", "", out.strip())
    if "<" not in out:
        raise ValueError("模型未返回有效 HTML，请重试或更换模型")
    return out
