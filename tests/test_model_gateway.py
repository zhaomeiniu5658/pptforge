"""Provider contract tests use deterministic mock transport, never pretend to validate live AI."""

import httpx, pytest
from quark import model_gateway


@pytest.mark.parametrize("provider", ["openai", "ollama", "anthropic", "gemini"])
def test_provider_contracts(monkeypatch, provider):
    monkeypatch.setenv("MODEL_NAME", "contract-test")
    monkeypatch.setenv("MODEL_PROVIDER", provider)
    monkeypatch.setenv("MODEL_BASE_URL", "https://model.invalid/v1")
    monkeypatch.setenv("MODEL_API_KEY", "test-only")
    captured = []

    def transport(req):
        captured.append(req)
        out = {
            "openai": {"choices": [{"message": {"content": "<h1>测试结果</h1>"}}]},
            "ollama": {"message": {"content": "<h1>测试结果</h1>"}},
            "anthropic": {"content": [{"text": "<h1>测试结果</h1>"}]},
            "gemini": {
                "candidates": [{"content": {"parts": [{"text": "<h1>测试结果</h1>"}]}}]
            },
        }[provider]
        return httpx.Response(200, json=out)

    original = httpx.Client
    monkeypatch.setattr(
        model_gateway.httpx,
        "Client",
        lambda **kw: original(transport=httpx.MockTransport(transport), **kw),
    )
    result = model_gateway.generate(
        "仅生成已确认资料", ["data:image/png;base64,aGVsbG8="]
    )
    assert result == "<h1>测试结果</h1>"
    assert len(captured) == 1
    assert b"contract-test" in captured[0].content or "contract-test" in str(
        captured[0].url
    )


def test_image_disabled_deployment_is_actionable_and_never_retried_as_text(monkeypatch):
    monkeypatch.setenv("MODEL_NAME", "vision-deployment")
    monkeypatch.setenv("MODEL_PROVIDER", "openai")
    monkeypatch.setenv("MODEL_BASE_URL", "https://model.invalid/v1")
    calls = []

    def transport(req):
        calls.append(req)
        return httpx.Response(400, json={"error": {
            "message": "At most 0 image(s) may be provided in one prompt. (parameter=image)"
        }})

    original = httpx.Client
    monkeypatch.setattr(model_gateway.httpx, "Client",
                        lambda **kw: original(transport=httpx.MockTransport(transport), **kw))
    with pytest.raises(ValueError, match="当前模型部署不接受图片输入"):
        model_gateway.generate("还原图片", ["data:image/png;base64,aGVsbG8="])
    assert len(calls) == 1


@pytest.mark.parametrize("status", [400, 401, 403, 429, 500])
def test_provider_error_does_not_expose_response_payload(status):
    response = httpx.Response(status, json={"error": {"message": "secret-payload"}})
    with pytest.raises(ValueError) as error:
        model_gateway.check_response(response)
    assert "secret-payload" not in str(error.value)
