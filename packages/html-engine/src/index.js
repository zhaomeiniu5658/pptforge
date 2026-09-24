import { parse, serialize } from "parse5";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import valueParser from "postcss-value-parser";

export const MAX_HTML_BYTES = 20 * 1024 * 1024;
export const MAX_RUNTIME_SCRIPT_BYTES = 20 * 1024 * 1024;

const banned = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "base",
  "link",
  "meta",
  "foreignObject",
]);
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const safeScript = (s) => String(s).replace(/<\/script/gi, "<\\/script");
export const attr = (n, k) => n.attrs?.find((a) => a.name === k)?.value;
function set(n, k, v) {
  n.attrs ||= [];
  const a = n.attrs.find((a) => a.name === k);
  if (a) a.value = v;
  else n.attrs.push({ name: k, value: v });
}
function walk(n, fn) {
  fn(n);
  for (const c of [...(n.childNodes || [])]) walk(c, fn);
}
function remove(n) {
  if (n.parentNode)
    n.parentNode.childNodes = n.parentNode.childNodes.filter((c) => c !== n);
}
const safeUrl = (v) =>
  !v ||
  v.startsWith("data:image/") ||
  v.startsWith("data:font/") ||
  v.startsWith("data:application/font") ||
  v.startsWith("#");
const safeAnchorUrl = (v) =>
  safeUrl(v) ||
  /^https?:\/\//i.test(v) ||
  /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(v) ||
  /^tel:[0-9+()\-\s]+$/i.test(v);
const patchHref = (v) => {
  let href = String(v || "").trim();
  if (!href) return "";
  if (/^(www\.|[\w-]+(\.[\w-]+)+([/:?#]|$))/i.test(href))
    href = "https://" + href;
  if (!safeAnchorUrl(href)) throw Error("链接地址仅支持 http、https、mailto、tel 或页面锚点");
  return href;
};
const unset = (n, keys) => {
  n.attrs = (n.attrs || []).filter((a) => !keys.includes(a.name));
};
export function normalize(input = {}) {
  const d = typeof input === "string" ? { html: input } : input;
  if (typeof d.html !== "string" || d.html.length > MAX_HTML_BYTES)
    throw Error("HTML 为空或超过 20 MB");
  if (
    d.layoutMode === "fixed" &&
    (!d.sourceSize ||
      !Number.isFinite(d.sourceSize.width) ||
      !Number.isFinite(d.sourceSize.height) ||
      d.sourceSize.width <= 0 ||
      d.sourceSize.height <= 0)
  )
    throw Error("固定布局缺少有效页面尺寸");
  const tree = parse(d.html);
  let css = String(d.css || "");
  const diagnostics = [];
  const nodes = [];
  const seen = new Set();
  let stripped = false;
  walk(tree, (n) => {
    if (n.tagName === "style") {
      css += "\n" + (n.childNodes || []).map((x) => x.value || "").join("");
      remove(n);
      return;
    }
    if (banned.has(n.tagName)) {
      if (n.tagName === "link" && attr(n, "rel") === "stylesheet")
        diagnostics.push({
          severity: "error",
          message: "外部样式未归档，请通过 ZIP 随包导入 CSS",
        });
      if (n.tagName === "script") stripped = true;
      remove(n);
      return;
    }
    if (!n.tagName) return;
    n.attrs = (n.attrs || []).filter(
      (a) =>
        !/^on/i.test(a.name) &&
        ![
          "srcdoc",
          "contenteditable",
          "formaction",
          "action",
          "autofocus",
        ].includes(a.name),
    );
    for (const a of n.attrs) {
      if (["src", "poster", "srcset", "href", "xlink:href"].includes(a.name)) {
        if (a.name === "srcset") {
          a.value = "";
          continue;
        }
        if (n.tagName === "a" && a.name === "href" && (!a.value || safeAnchorUrl(a.value))) {
          if (/^https?:\/\//i.test(a.value)) {
            set(n, "target", "_blank");
            set(n, "rel", "noopener noreferrer");
          }
          continue;
        }
        if (!safeUrl(a.value)) {
          if (n.tagName === "a" && /^https?:\/\//.test(a.value)) {
            set(n, "target", "_blank");
            set(n, "rel", "noopener noreferrer");
          } else {
            diagnostics.push({
              severity: "error",
              message: "未归档资源：" + a.value.slice(0, 120),
            });
            a.value = "";
          }
        }
      }
      if (a.name === "style") {
        if (/expression\s*\(|javascript:|@import/i.test(a.value)) {
          a.value = "";
          diagnostics.push({
            severity: "error",
            message: "行内样式包含不支持的内容",
          });
          continue;
        }
        let inline;
        try {
          inline = postcss.parse("x{" + a.value + "}");
        } catch {
          throw Error("行内 CSS 语法无效");
        }
        if (
          inline.nodes.length !== 1 ||
          inline.first.type !== "rule" ||
          inline.first.selector !== "x" ||
          inline.first.nodes.some(
            (x) => x.type !== "decl" && x.type !== "comment",
          )
        )
          throw Error("行内 CSS 只能包含样式声明");
        inline.walkDecls((decl) =>
          valueParser(decl.value).walk((v) => {
            if (v.type === "function" && v.value.toLowerCase() === "url") {
              const url = valueParser
                .stringify(v.nodes)
                .replace(/^['"]|['"]$/g, "");
              if (!safeUrl(url))
                diagnostics.push({
                  severity: "error",
                  message: "行内资源未归档：" + url.slice(0, 100),
                });
            }
          }),
        );
      }
    }
    if (!["html", "head", "body"].includes(n.tagName)) {
      let id = attr(n, "data-node-id");
      if (!id || seen.has(id) || !/^[\w-]{1,100}$/.test(id))
        id = "n-" + crypto.randomUUID();
      seen.add(id);
      set(n, "data-node-id", id);
      nodes.push({
        id,
        tag: n.tagName,
        editable: attr(n, "data-readonly") !== "true",
      });
    }
  });
  if (stripped)
    diagnostics.push({
      severity: "warning",
      message: "原始脚本已移除；交互需使用平台支持的声明重建",
    });
  let root;
  try {
    root = postcss.parse(css);
  } catch {
    throw Error("CSS 语法无效，请修正后保存");
  }
  root.walkAtRules((at) => {
    if (["import", "charset"].includes(at.name)) {
      if (at.name === "import")
        diagnostics.push({
          severity: "error",
          message: "外部 CSS @import 未归档",
        });
      at.remove();
    }
  });
  root.walkDecls((decl) => {
    if (/expression\s*\(|javascript:/i.test(decl.value)) {
      decl.remove();
      return;
    }
    valueParser(decl.value).walk((n) => {
      if (n.type === "function" && n.value.toLowerCase() === "url") {
        const u = valueParser.stringify(n.nodes).replace(/^['"]|['"]$/g, "");
        if (!safeUrl(u))
          diagnostics.push({
            severity: "error",
            message: "CSS 资源未归档：" + u.slice(0, 100),
          });
      }
    });
  });
  let body;
  walk(tree, (n) => {
    if (n.tagName === "body") body = n;
  });
  let html = serialize(body);
  const ba = (body.attrs || []).filter((a) =>
    ["class", "style", "id"].includes(a.name),
  );
  if (ba.length)
    html =
      '<div data-node-id="body-' +
      crypto.randomUUID() +
      '" ' +
      ba.map((a) => a.name + '="' + escape(a.value) + '"').join(" ") +
      ">" +
      html +
      "</div>";
  const interactions = (
    Array.isArray(d.interactions) ? d.interactions : []
  ).filter(
    (x) =>
      ["toggle", "tabs", "modal", "anchor"].includes(x.type) &&
      typeof x.trigger === "string" &&
      typeof x.target === "string",
  );
  let scriptBytes = 0;
  const runtimeScripts = [];
  for (const script of (Array.isArray(d.runtimeScripts) ? d.runtimeScripts : [])
    .filter((x) => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 8)) {
    if (scriptBytes + script.length > MAX_RUNTIME_SCRIPT_BYTES) {
      diagnostics.push({
        severity: "warning",
        message: "导入页面的交互脚本过大，已跳过部分脚本",
      });
      continue;
    }
    scriptBytes += script.length;
    runtimeScripts.push(script);
  }
  return {
    schemaVersion: 1,
    html,
    css: root.toString(),
    assets: d.assets || [],
    interactions,
    runtimeScripts,
    layoutMode: d.layoutMode === "fixed" ? "fixed" : "flow",
    sourceSize: d.sourceSize || null,
    editableNodes: nodes,
    sourceReferences: d.sourceReferences || [],
    diagnostics: [
      ...(d.diagnostics || []).filter((x) => x.source === "pptx"),
      ...diagnostics,
    ],
  };
}
export function patchNode(doc, id, patch) {
  const d = normalize(doc);
  const tree = parse(d.html);
  let target;
  walk(tree, (n) => {
    if (attr(n, "data-node-id") === id) target = n;
  });
  if (!target) throw Error("元素已变化，请重新选择");
  if (
    attr(target, "data-readonly") === "true" &&
    Object.keys(patch || {}).some((key) => key !== "href")
  )
    throw Error("此对象为保真图形，不能修改内部元素");
  if (patch.href !== undefined) {
    const href = patchHref(patch.href);
    let anchor = target.tagName === "a" ? target : null;
    for (let n = target.parentNode; !anchor && n; n = n.parentNode) {
      if (n.tagName === "a") anchor = n;
    }
    if (!href) {
      if (anchor) unset(anchor, ["href", "target", "rel"]);
    } else {
      if (!anchor) {
        const parent = target.parentNode;
        if (!parent) throw Error("此元素不能添加链接");
        anchor = {
          nodeName: "a",
          tagName: "a",
          attrs: [],
          namespaceURI: target.namespaceURI,
          childNodes: [target],
          parentNode: parent,
        };
        const index = parent.childNodes.indexOf(target);
        parent.childNodes.splice(index, 1, anchor);
        target.parentNode = anchor;
      }
      set(anchor, "href", href);
      if (/^https?:\/\//i.test(href)) {
        set(anchor, "target", "_blank");
        set(anchor, "rel", "noopener noreferrer");
      } else {
        unset(anchor, ["target", "rel"]);
      }
    }
  }
  if (patch.text !== undefined) {
    if ((target.childNodes || []).some((n) => n.tagName))
      throw Error("请选择具体文字元素");
    target.childNodes = [
      { nodeName: "#text", value: String(patch.text), parentNode: target },
    ];
  }
  if (patch.src !== undefined) {
    if (
      target.tagName !== "img" ||
      !String(patch.src).startsWith("data:image/")
    )
      throw Error("图片格式不支持");
    set(target, "src", patch.src);
    target.attrs = target.attrs.filter((a) => a.name !== "srcset");
  }
  if (patch.styles) {
    let decls = postcss.parse("x{" + (attr(target, "style") || "") + "}").first;
    for (const [k, v] of Object.entries(patch.styles)) {
      if (
        ![
          "color",
          "background-color",
          "font-size",
          "font-family",
          "font-weight",
          "text-align",
          "padding",
          "margin",
          "border-radius",
          "line-height",
          "width",
          "height",
          "display",
          "gap",
        ].includes(k)
      )
        continue;
      decls.walkDecls(k, (n) => n.remove());
      decls.append({ prop: k, value: String(v) });
    }
    set(target, "style", decls.nodes.map((n) => n.toString()).join(";"));
  }
  let body;
  walk(tree, (n) => {
    if (n.tagName === "body") body = n;
  });
  return normalize({ ...d, html: serialize(body) });
}

export function deleteNode(doc, id) {
  const d = normalize(doc);
  const tree = parse(d.html);
  let target;
  walk(tree, (n) => {
    if (attr(n, "data-node-id") === id) target = n;
  });
  if (!target) throw Error("元素已变化，请重新选择");
  if (!target.parentNode || ["html", "head", "body"].includes(target.tagName))
    throw Error("此元素不能删除");
  remove(target);
  let body;
  walk(tree, (n) => {
    if (n.tagName === "body") body = n;
  });
  return normalize({
    ...d,
    html: serialize(body),
    interactions: d.interactions.filter(
      (x) => x.trigger !== id && x.target !== id,
    ),
  });
}
function scoped(doc, instance) {
  const d = normalize(doc),
    scope = `[data-page-instance="${instance}"]`,
    tree = parse(d.html),
    ids = new Map();
  walk(tree, (n) => {
    const id = attr(n, "id");
    if (id) ids.set(id, instance + "-" + id);
  });
  const urlRefs = (v) =>
    v.replace(
      /url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g,
      (_, q, id) => `url(#${ids.get(id) || instance + "-" + id})`,
    );
  const animation = new Map(),
    fonts = new Map();
  const root = postcss.parse(d.css);
  root.walkAtRules((a) => {
    if (/keyframes$/i.test(a.name)) {
      const old = a.params;
      animation.set(old, instance + "-" + old);
      a.params = instance + "-" + old;
    }
    if (a.name === "font-face")
      a.walkDecls("font-family", (x) => {
        const old = x.value.replace(/['"]/g, "");
        fonts.set(old, instance + "-" + old);
        x.value = '"' + instance + "-" + old + '"';
      });
  });
  const rewriteValue = (v, prop) => {
    let out = urlRefs(v);
    if (/animation/.test(prop)) {
      out = valueParser(out)
        .walk((n) => {
          if (n.type === "word" && animation.has(n.value))
            n.value = animation.get(n.value);
        })
        .toString();
    }
    if (prop === "font-family") {
      for (const [f, r] of fonts)
        out = out
          .replaceAll('"' + f + '"', '"' + r + '"')
          .replaceAll("'" + f + "'", '"' + r + '"');
      if (fonts.has(out)) out = '"' + fonts.get(out) + '"';
    }
    return out;
  };
  const rewriteScript = (script) => {
    let out = String(script);
    for (const [oldId, newId] of [...ids.entries()].sort(
      (a, b) => b[0].length - a[0].length,
    )) {
      const id = escapeRegExp(oldId);
      out = out
        .replace(new RegExp(`(["'\`])${id}\\1`, "g"), `$1${newId}$1`)
        .replace(new RegExp(`(["'\`])#${id}\\1`, "g"), `$1#${newId}$1`);
    }
    return out;
  };
  root.walkRules((rule) => {
    if (rule.parent.type === "atrule" && /keyframes$/i.test(rule.parent.name))
      return;
    rule.selector = selectorParser((sel) => {
      sel.each((s) => {
        let hasRoot = false;
        s.walkIds((n) => {
          n.value = ids.get(n.value) || instance + "-" + n.value;
        });
        s.walk((n) => {
          if (
            (n.type === "tag" && ["html", "body"].includes(n.value)) ||
            (n.type === "pseudo" && n.value === ":root")
          ) {
            n.replaceWith(
              selectorParser.attribute({
                attribute: "data-page-instance",
                operator: "=",
                value: instance,
                quoteMark: '"',
              }),
            );
            hasRoot = true;
          }
        });
        if (!hasRoot)
          (s.prepend(selectorParser.combinator({ value: " " })),
            s.prepend(
              selectorParser.attribute({
                attribute: "data-page-instance",
                operator: "=",
                value: instance,
                quoteMark: '"',
              }),
            ));
      });
    }).processSync(rule.selector);
    rule.selector = rule.selector.replace(
      new RegExp(
        scope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
          "\\s+" +
          scope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "g",
      ),
      scope,
    );
  });
  root.walkDecls((x) => {
    x.value = rewriteValue(x.value, x.prop);
    if (
      ["position"].includes(x.prop) &&
      ["fixed", "sticky"].includes(x.value)
    ) {
      x.value = "relative";
    }
  });
  walk(tree, (n) => {
    if (!n.attrs) return;
    for (const a of n.attrs) {
      if (a.name === "id") a.value = ids.get(a.value);
      if (["href", "xlink:href"].includes(a.name) && a.value.startsWith("#"))
        a.value =
          "#" +
          (ids.get(a.value.slice(1)) || instance + "-" + a.value.slice(1));
      if (
        [
          "for",
          "aria-labelledby",
          "aria-describedby",
          "aria-controls",
        ].includes(a.name)
      )
        a.value = a.value
          .split(/\s+/)
          .map((v) => ids.get(v) || instance + "-" + v)
          .join(" ");
      if (a.name === "data-node-id") a.value = instance + "--" + a.value;
      a.value = urlRefs(a.value);
      if (a.name === "style") {
        const r = postcss.parse("x{" + a.value + "}");
        r.walkDecls((x) => {
          x.value = rewriteValue(x.value, x.prop);
          if (x.prop === "position" && ["fixed", "sticky"].includes(x.value))
            x.value = "relative";
        });
        a.value = r.first.nodes.map((x) => x.toString()).join(";");
      }
    }
  });
  let body;
  walk(tree, (n) => {
    if (n.tagName === "body") body = n;
  });
  return {
    html: serialize(body),
    css: root.toString(),
    diagnostics: d.diagnostics,
    interactions: d.interactions.map((x) => ({
      ...x,
      trigger: instance + "--" + x.trigger,
      target: instance + "--" + x.target,
    })),
    runtimeScripts: d.runtimeScripts.map(rewriteScript),
    fixed: d.layoutMode === "fixed",
    size: d.sourceSize,
  };
}
export function compile(
  pages,
  { title = "Quarkmed 方案", draft = false, navigation = true } = {},
) {
  const blocks = [],
    styles = [],
    actions = [],
    diagnostics = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i],
      id = "page-" + i;
    const s = scoped(p.document || p, id);
    styles.push(s.css);
    actions.push(...s.interactions);
    diagnostics.push(...s.diagnostics);
    let html = s.html;
    if (s.fixed && s.size) {
      html = `<div class="qm-fixed-frame" style="aspect-ratio:${Number(s.size.width)}/${Number(s.size.height)}"><div class="qm-fixed" style="width:${Number(s.size.width)}px;height:${Number(s.size.height)}px">${html}</div></div>`;
    }
    const scripts = s.runtimeScripts
      .map((script) => `<script>(()=>{${safeScript(script)}})();</script>`)
      .join("");
    blocks.push(
      `<section id="${id}" data-page-instance="${id}" class="${s.fixed ? "qm-page-fixed" : "qm-page-flow"}" aria-label="${escape(p.title || "第 " + (i + 1) + " 页")}">${html}</section>${scripts}`,
    );
  }
  const links = pages
    .map(
      (p, i) =>
        `<a href="#page-${i}">${i + 1}. ${escape(p.title || "页面")}</a>`,
    )
    .join("");
  const runtime = `const actions=${JSON.stringify(actions).replace(/</g, "\\u003c")};
const targetOf=id=>document.querySelector('[data-node-id="'+CSS.escape(id)+'"]');
document.addEventListener('click',e=>{
 for(const a of actions){const trigger=e.target.closest('[data-node-id="'+CSS.escape(a.trigger)+'"]');if(!trigger)continue;const t=targetOf(a.target);if(!t)continue;e.preventDefault();
 if(a.type==='anchor'){t.scrollIntoView({behavior:'smooth'});}
 else if(a.type==='tabs'){const section=t.closest('[data-page-instance]');for(const other of actions.filter(x=>x.type==='tabs')){const node=targetOf(other.target),button=targetOf(other.trigger);if(node&&node.closest('[data-page-instance]')===section&&node.parentElement===t.parentElement){node.hidden=node!==t;button?.setAttribute('aria-selected',String(node===t));}}}
 else if(a.type==='modal'&&t.tagName==='DIALOG'){t.open?t.close():t.showModal();}
 else {t.hidden=!t.hidden;trigger.setAttribute('aria-expanded',String(!t.hidden));}
 }
});document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('dialog[open]').forEach(d=>d.close())});
document.querySelectorAll('.qm-fixed-frame').forEach(f=>{const c=f.firstElementChild;new ResizeObserver(()=>{c.style.transform='scale('+f.clientWidth/parseFloat(c.style.width)+')'}).observe(f)});`;

  return {
    html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(title)}</title><style>body{margin:0;background:#f4f7fc;font-family:Arial,'Noto Sans CJK SC',sans-serif}.qm-nav{padding:18px 28px;background:white;display:flex;gap:20px;flex-wrap:wrap;border-bottom:1px solid #dde4ef}.qm-nav a{font-size:13px;color:#2563eb;text-decoration:none}.qm-draft{text-align:center;background:#fff3ce;padding:10px;color:#895800}[data-page-instance] [hidden]{display:none!important}main>[data-page-instance]{position:relative;isolation:isolate;background:white;display:flow-root}.qm-page-flow{overflow:visible}.qm-page-fixed{overflow:clip}.qm-fixed-frame{position:relative;width:100%;overflow:hidden}.qm-fixed{position:absolute;left:0;top:0;transform-origin:top left} ${styles.join("\n").replace(/<\/style/gi, "<\\/style")}</style></head><body>${draft ? '<div class="qm-draft">草稿预览 · 未作为审核通过的正式交付</div>' : ""}${navigation ? '<nav class="qm-nav">' + links + "</nav>" : ""}<main>${blocks.join("\n")}</main><script>${runtime}</script></body></html>`,
    diagnostics,
  };
}
export function editablePreview(doc, channel) {
  const d = normalize(doc); // No instance rewriting: editor identity matches source nodes.
  const html = compile([{ document: d }], { navigation: false }).html;
  const selectionStyle =
    '<style id="quark-editor-selection-style">[data-quark-selected="true"]{outline:3px solid #2563eb!important;outline-offset:3px!important;box-shadow:0 0 0 6px rgba(37,99,235,.2),0 0 18px rgba(37,99,235,.28)!important;position:relative!important;z-index:999!important}[data-quark-selected="true"]::after{content:"已选中";position:absolute!important;top:-22px!important;left:-3px!important;padding:3px 7px!important;border-radius:4px!important;background:#2563eb!important;color:#fff!important;font:600 11px/1.2 Arial,"Noto Sans CJK SC",sans-serif!important;white-space:nowrap!important;pointer-events:none!important;z-index:1000!important}</style>';
  const bridge = `(()=>{const channel=${JSON.stringify(channel)};let selected=null;const clear=()=>{if(selected){selected.removeAttribute('data-quark-selected');selected=null;}};const select=n=>{clear();selected=n;n.setAttribute('data-quark-selected','true');};const measure=()=>{const roots=[document.documentElement,document.body,document.querySelector('main'),document.querySelector('[data-page-instance]')].filter(Boolean);let height=0;for(const el of roots){const r=el.getBoundingClientRect();height=Math.max(height,el.scrollHeight||0,el.offsetHeight||0,r.bottom);}document.body?.querySelectorAll('*').forEach(el=>{const r=el.getBoundingClientRect();height=Math.max(height,r.bottom,el.scrollHeight?el.getBoundingClientRect().top+el.scrollHeight:0);});return Math.ceil(height);};const sendHeight=()=>parent.postMessage({type:'quark:height',channel,height:measure()},'*');document.addEventListener('click',e=>{const link=e.target.closest('a[href]');if(link&&(e.metaKey||e.ctrlKey)){return;}e.preventDefault();e.stopImmediatePropagation();const n=e.target.closest('[data-node-id]');if(!n){clear();return;}select(n);const a=n.closest('a[href]');const cs=getComputedStyle(n);parent.postMessage({type:'quark:select',channel,id:n.dataset.nodeId.replace(/^page-0--/,''),tag:n.tagName,text:n.children.length?'':n.textContent,leaf:!n.children.length,readonly:n.dataset.readonly==='true',href:a?.getAttribute('href')||'',styles:{color:cs.color,fontSize:cs.fontSize,textAlign:cs.textAlign,backgroundColor:cs.backgroundColor,padding:cs.padding}},'*');},true);const ro=new ResizeObserver(sendHeight);ro.observe(document.documentElement);if(document.body)ro.observe(document.body);document.querySelectorAll('[data-page-instance],main').forEach(el=>ro.observe(el));addEventListener('load',sendHeight);setTimeout(sendHeight,100);setTimeout(sendHeight,500);sendHeight();})();`;
  return html.replace("</head>", selectionStyle + "</head>").replace("</body>", "<script>" + bridge + "</script></body>");
}
