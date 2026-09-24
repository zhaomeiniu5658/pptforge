import base64, io, json, mimetypes, re, zipfile, posixpath, stat, os
from pathlib import PurePosixPath
from urllib.parse import urlsplit, urljoin, unquote
import httpx
from bs4 import BeautifulSoup
from .content import normalize, tool

MAX_ARCHIVE_SIZE = 100 * 1024 * 1024
MAX_UPLOAD_SIZE = 32 * 1024 * 1024
MAX_FILES = 500
REMOTE_HOSTS = {
    "lh3.googleusercontent.com",
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "cdnjs.cloudflare.com",
}


def safe_path(name):
    p = PurePosixPath(name)
    if not name or p.is_absolute() or ".." in p.parts or "\\" in name or ":" in name or "\x00" in name:
        raise ValueError("文件路径不安全")
    return str(p)


def ignored(name):
    return any(part.startswith(".") or part == "__MACOSX" for part in PurePosixPath(name).parts)


def archive_files(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        infos = z.infolist()
        if len(infos) > MAX_FILES or sum(i.file_size for i in infos) > MAX_ARCHIVE_SIZE:
            raise ValueError("ZIP 解压大小或文件数量超限（最多 500 项、100 MB）")
        files = {}
        for i in infos:
            name = safe_path(i.filename)
            if stat.S_ISLNK(i.external_attr >> 16) or i.flag_bits & 1:
                raise ValueError("ZIP 不支持符号链接或加密文件")
            if i.is_dir() or ignored(name):
                continue
            if name in files:
                raise ValueError("ZIP 包含重复文件路径")
            files[name] = z.read(i)
    return files


def html_paths(files):
    htmls = sorted(k for k in files if k.lower().endswith((".html", ".htm")))
    # Platform exports contain an index plus copies of individual pages.
    for path in list(htmls):
        prefix = posixpath.dirname(path)
        pages = (prefix + "/" if prefix else "") + "pages/"
        if posixpath.basename(path).lower() == "index.html" and any(x.startswith(pages) for x in htmls):
            htmls.remove(path)
    if not htmls:
        raise ValueError("未找到 HTML 页面，请上传包含 code.html 或 index.html 的导出文件夹/ZIP")
    if len(htmls) > 60:
        raise ValueError("每个模板包最多支持 60 个 HTML 页面")
    return htmls


def remote_asset(url):
    """Fetch known export CDNs only; never send platform cookies or model credentials."""
    with httpx.Client(timeout=15, follow_redirects=False,
                      proxy=os.getenv("IMPORT_RESOURCE_PROXY") or None) as client:
        for _ in range(4):
            p = urlsplit(url)
            if p.scheme != "https" or p.hostname not in REMOTE_HOSTS or p.username or p.password or p.port not in (None, 443):
                raise ValueError("外部资源域名未支持，请将资源一起放入文件夹或 ZIP")
            with client.stream("GET", url, headers={"User-Agent": "Mozilla/5.0"}) as r:
                if r.is_redirect:
                    url = urljoin(url, r.headers.get("location", ""))
                    continue
                r.raise_for_status()
                media = r.headers.get("content-type", "").split(";")[0]
                if not (
                    media.startswith(("image/", "font/"))
                    or media
                    in (
                        "text/css",
                        "application/font-woff",
                        "application/font-woff2",
                        "application/x-font-ttf",
                        "application/vnd.ms-fontobject",
                        "application/octet-stream",
                    )
                ):
                    raise ValueError("不支持的外部资源类型")
                out = bytearray()
                max_size = (
                    16 * 1024 * 1024
                    if p.hostname == "cdnjs.cloudflare.com"
                    and p.path.endswith(".css")
                    else 8 * 1024 * 1024
                )
                for chunk in r.iter_bytes():
                    out.extend(chunk)
                    if len(out) > max_size:
                        raise ValueError(
                            f"单个外部资源超过 {max_size // (1024 * 1024)} MB"
                        )
                return bytes(out), media, url
    raise ValueError("外部资源跳转次数过多")


def html_import(data, name, *, archive_remote=False, on_page=None):
    """Archive local resources. Template imports optionally snapshot known export CDN assets."""
    files = archive_files(data) if name.lower().endswith(".zip") else {safe_path(name): data}
    htmls = html_paths(files)
    cache = {}
    remote_bytes = 0
    diagnostics = []

    def resolve(url, base):
        if urlsplit(base).scheme in ("http", "https"):
            return urljoin(base, url)
        if url.startswith("//"):
            return "https:" + url
        if urlsplit(url).scheme:
            return url
        path = unquote(urlsplit(url).path)
        return posixpath.normpath(posixpath.join(posixpath.dirname(base), path.lstrip("/"))) if not path.startswith("/") else path.lstrip("/")

    def load(url, base):
        nonlocal remote_bytes
        path = resolve(url, base)
        if path in files:
            return files[path], mimetypes.guess_type(path)[0] or "application/octet-stream", path
        if archive_remote and urlsplit(path).scheme in ("http", "https"):
            if path not in cache:
                if len(cache) >= 40:
                    raise ValueError("外部资源数量超过 40，请下载资源后打包导入")
                try:
                    cache[path] = remote_asset(path)
                    remote_bytes += len(cache[path][0])
                    if remote_bytes > 24 * 1024 * 1024:
                        raise ValueError("外部资源总大小超过 24 MB")
                except (ValueError, httpx.HTTPError) as exc:
                    cache[path] = None
                    # Google 的中文字体经常以多个超大 TTF 分片返回。导入时保留系统字体回退即可，
                    # 不把这些可选字体文件显示成一长串失败信息。
                    if urlsplit(path).hostname == "fonts.gstatic.com":
                        return None
                    diagnostics.append({
                        "source": "import",
                        "severity": "warning",
                        "message": f"外部资源未能归档：{path[:180]}（{type(exc).__name__}），已保留页面并使用可用资源回退。",
                    })
            return cache[path]
        return None

    def resource(url, base):
        if url.startswith(("data:", "#")):
            return url
        found = load(url, base)
        if not found:
            return url
        data, typ, _ = found
        if typ == "application/octet-stream":
            typ = mimetypes.guess_type(urlsplit(url).path)[0] or typ
        return "data:" + typ + ";base64," + base64.b64encode(data).decode()

    def css_assets(css, base, seen=()):
        if len(seen) >= 8 or base in seen:
            raise ValueError("CSS 循环引用或嵌套过深")
        # Google Fonts for Chinese pages can expand to tens of MB when archived.
        # Keep the page usable with system font fallbacks instead of embedding
        # large remote font files into every imported template.
        if urlsplit(base).hostname == "fonts.googleapis.com":
            return ""
        def imported(match):
            found = load(match[1] or match[2], base)
            if not found:
                return match[0]
            data, _, path = found
            text = css_assets(data.decode("utf-8-sig"), path, (*seen, base))
            media = match[3].strip()
            return f"@media {media}{{{text}}}" if media else text
        css = re.sub(
            r'@import\s+(?:url\(\s*[\'"]?([^\)\'"\s]+)[\'"]?\s*\)|[\'"]([^\'"]+)[\'"])\s*([^;]*);',
            imported,
            css,
            flags=re.I,
        )
        css = re.sub(
            r'url\(\s*[\'"]?([^\)\'"\s]+)[\'"]?\s*\)',
            lambda m: 'url("' + resource(m[1], base) + '")',
            css,
        )
        # Large optional remote webfonts should fall back to the browser's local
        # fonts instead of leaving unsafe external URLs in the imported document.
        return re.sub(
            r"@font-face\s*\{[^{}]*https?://[^{}]*\}",
            "",
            css,
            flags=re.I | re.S,
        )

    def script_assets(script, base):
        """Archive known image/font URLs embedded in inline demo data."""
        def replace(match):
            url = match.group(0)
            if url.startswith(("data:", "#")):
                return url
            split = urlsplit(url)
            if split.scheme not in ("http", "https"):
                return url
            try:
                return resource(url, base)
            except Exception:
                return url
        return re.sub(r'https?://[^\s\'"<>`\\)]+', replace, script)

    def inline_event_script(handlers):
        lines = ["(() => {"]
        for index, handler in enumerate(handlers):
            lines.append(
                f"const el{index}=document.getElementById({json.dumps(handler['id'], ensure_ascii=False)});"
                f"if(el{index})el{index}.addEventListener({json.dumps(handler['event'], ensure_ascii=False)},"
                f"function(event){{{handler['code']}}});"
            )
        lines.append("})();")
        return "\n".join(lines)

    docs = []
    for index, path in enumerate(htmls):
        if on_page:
            on_page(index, len(htmls))
        diagnostics = []
        original = files[path].decode("utf-8-sig")
        soup = BeautifulSoup(original, "html.parser")
        generated = tool("/internal/import-styles", {"html": original})["css"] if soup.find("script") else ""
        runtime_scripts = []
        inline_handlers = []
        for link in soup.find_all("link"):
            if "stylesheet" not in link.get("rel", []):
                link.decompose()
                continue
            found = load(link.get("href", ""), path)
            if found:
                content, _, csspath = found
                style = soup.new_tag("style")
                style.string = css_assets(content.decode("utf-8-sig"), csspath)
                link.replace_with(style)
        for style in soup.find_all("style"):
            style.string = css_assets(str(style.string or ""), path)
        for element in soup.find_all(True):
            for attr in ("src", "poster"):
                if element.name != "script" and element.has_attr(attr):
                    element[attr] = resource(element[attr], path)
            if element.has_attr("style"):
                element["style"] = css_assets(element["style"], path)
            for attr_name, code in list(element.attrs.items()):
                if not re.fullmatch(r"on[a-z]+", attr_name, flags=re.I):
                    continue
                event = attr_name[2:].lower()
                if event not in {"click", "change", "input", "submit", "focus", "blur", "keydown", "keyup", "mouseenter", "mouseleave", "mouseover", "mouseout"}:
                    del element.attrs[attr_name]
                    continue
                element_id = element.get("id")
                if not element_id:
                    element_id = f"qm-inline-event-{index}-{len(inline_handlers)}"
                    element["id"] = element_id
                inline_handlers.append({"id": element_id, "event": event, "code": str(code)})
                del element.attrs[attr_name]
        # Tailwind CDN/config is compiled locally above. Other inline scripts are
        # preserved as sandboxed page runtime so imported HTML demos keep tabs,
        # filters and click interactions without loading external scripts.
        for script in soup.find_all("script"):
            text = script.get_text() or ""
            src = script.get("src", "")
            if "tailwind" in src or "tailwind.config" in text:
                script.decompose()
                continue
            if src:
                diagnostics.append({"source": "import", "severity": "warning", "message": f"外部脚本已移除：{src[:160]}"})
                script.decompose()
                continue
            if text.strip():
                runtime_scripts.append(script_assets(text, path))
            script.decompose()
        if inline_handlers:
            runtime_scripts.append(inline_event_script(inline_handlers))
        doc = normalize({"html": str(soup), "css": generated, "runtimeScripts": runtime_scripts})
        reference = {"type": "html_import", "path": path, "title": soup.title.get_text() if soup.title else PurePosixPath(path).stem}
        doc["sourceReferences"].append(reference)
        doc["diagnostics"].extend(diagnostics)
        docs.append(doc)
    return docs
