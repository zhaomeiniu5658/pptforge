"""Export bundles share binary assets by content hash, with relative offline URLs."""

import base64, hashlib, io, json, re, zipfile, mimetypes


def bundle(index_html, pages, manifest):
    assets = {}

    def archive(text, prefix):
        def replace(m):
            typ, encoded = m[1], m[2]
            try:
                raw = base64.b64decode(encoded, validate=True)
            except Exception:
                return m[0]
            extension = mimetypes.guess_extension(typ) or ".bin"
            name = hashlib.sha256(raw).hexdigest()[:32] + extension
            assets[name] = raw
            return prefix + "assets/" + name

        text = re.sub(
            r"data:((?:image|font)/[a-zA-Z0-9.+-]+|application/font[^;,]*);base64,([A-Za-z0-9+/=]+)",
            replace,
            text,
        )
        return text.replace(
            "img-src data:; font-src data:;",
            "img-src 'self' data:; font-src 'self' data:;",
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("index.html", archive(index_html, ""))
        for i, page in enumerate(pages):
            z.writestr(f"pages/{i + 1:03}.html", archive(page, "../"))
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for name, data in assets.items():
            z.writestr("assets/" + name, data)
    return buf.getvalue()
