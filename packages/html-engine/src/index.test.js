import test from "node:test";
import assert from "node:assert/strict";
import { normalize, patchNode, deleteNode, compile } from "./index.js";
test("duplicate text edits exactly one persistent node and survives reparse", () => {
  const d = normalize(
    '<p data-node-id="one">同名</p><p data-node-id="two">同名</p>',
  );
  const changed = patchNode(d, "two", { text: "<修改>" });
  assert.match(changed.html, /one">同名/);
  assert.match(changed.html, /two">&lt;修改&gt;/);
});

test("delete removes exactly one selected node and related interactions", () => {
  const d = normalize({
    html: '<button data-node-id="trigger">开关</button><section data-node-id="panel">内容</section><section data-node-id="keep">内容</section>',
    interactions: [{ type: "toggle", trigger: "trigger", target: "panel" }],
  });
  const changed = deleteNode(d, "panel");
  assert.doesNotMatch(changed.html, /data-node-id="panel"/);
  assert.match(changed.html, /data-node-id="trigger"/);
  assert.match(changed.html, /data-node-id="keep"/);
  assert.equal(changed.interactions.length, 0);
});

test("link patch adds edits and clears safe links", () => {
  const d = normalize('<p data-node-id="target">官网</p>');
  const linked = patchNode(d, "target", { href: "www.qmcro.com" });
  assert.match(linked.html, /<a href="https:\/\/www\.qmcro\.com"/);
  assert.match(linked.html, /target="_blank"/);
  assert.match(linked.html, /data-node-id="target"/);
  const edited = patchNode(linked, "target", { href: "mailto:test@example.com" });
  assert.match(edited.html, /href="mailto:test@example\.com"/);
  assert.doesNotMatch(edited.html, /target="_blank"/);
  const cleared = patchNode(edited, "target", { href: "" });
  assert.doesNotMatch(cleared.html, /href=/);
});

test("readonly elements can receive a link but not internal text edits", () => {
  const d = normalize('<img data-node-id="img" data-readonly="true" src="">');
  const linked = patchNode(d, "img", { href: "https://www.qmcro.com" });
  assert.match(linked.html, /href="https:\/\/www\.qmcro\.com"/);
  assert.throws(() => patchNode(d, "img", { text: "wrong" }));
  assert.throws(() => patchNode(d, "img", { href: "javascript:alert(1)" }));
});
test("scripts/events/foreign embedded pages removed; missing assets diagnosed", () => {
  const d = normalize(
    '<script>alert(1)</script><img src="https://x/a.png" onerror="alert(1)"><iframe srcdoc="bad"></iframe>',
  );
  assert.doesNotMatch(d.html, /script|onerror|iframe/);
  assert.ok(d.diagnostics.some((x) => x.severity === "error"));
});
test("composed pages isolate selectors, ids, anchor references and animation names", () => {
  const d = normalize({
    html: '<div id="box"><label for="input">X</label><input id="input"><a href="#box">Go</a></div>',
    css: "body{color:red}#box{animation:pulse 1s}@keyframes pulse{to{opacity:0}}",
  });
  const r = compile([{ document: d }, { document: d }]);
  assert.match(r.html, /id="page-0-box"/);
  assert.match(r.html, /id="page-1-box"/);
  assert.match(r.html, /for="page-1-input"/);
  assert.match(r.html, /@keyframes page-0-pulse/);
  assert.match(r.html, /@keyframes page-1-pulse/);
  assert.doesNotMatch(r.html, /<iframe/);
});

test("flow pages are not clipped like fixed slide pages", () => {
  const flow = compile([{ document: { html: "<div>long html</div>" } }], {
    navigation: false,
  }).html;
  assert.match(flow, /class="qm-page-flow"/);
  assert.match(flow, /\.qm-page-flow\{overflow:visible\}/);
  assert.doesNotMatch(flow, /qm-page-flow\{overflow:clip\}/);
  const fixed = compile([
    {
      document: {
        html: "<div>slide</div>",
        layoutMode: "fixed",
        sourceSize: { width: 1600, height: 900 },
      },
    },
  ]).html;
  assert.match(fixed, /class="qm-page-fixed"/);
  assert.match(fixed, /\.qm-page-fixed\{overflow:clip\}/);
});
test("untrusted style imports rejected and readonly groups cannot be patched", () => {
  const d = normalize({
    html: '<div data-node-id="n" data-readonly="true">固定图形</div>',
    css: '@import "https://x/a.css";',
  });
  assert.ok(d.diagnostics.some((x) => x.severity === "error"));
  assert.throws(() => patchNode(d, "n", { text: "wrong" }));
});

test("telephone and email links are allowed in imported pages", () => {
  const d = normalize({
    html: '<a href="tel:010-86469979">电话</a><a href="mailto:test@example.com">邮箱</a><a href="">占位</a><img src="">',
  });
  assert.equal(d.diagnostics.length, 0);
  assert.match(d.html, /tel:010-86469979/);
  assert.match(d.html, /mailto:test@example.com/);
});

test("imported runtime scripts are scoped to rewritten element ids", () => {
  const d = normalize({
    html: '<div id="target"></div><button id="next">下一位</button>',
    runtimeScripts: [
      'document.getElementById("target").textContent = "ok"; document.querySelector("#next")?.addEventListener("click",()=>{});',
    ],
  });
  const result = compile([{ document: d }], { navigation: false }).html;
  assert.match(result, /id="page-0-target"/);
  assert.match(result, /getElementById\("page-0-target"\)/);
  assert.match(result, /querySelector\("#page-0-next"\)/);
  assert.match(result, /textContent = "ok"/);
});

test("runtime script text cannot break out of the injected script tag", () => {
  const d = normalize({
    html: "<div>safe</div>",
    runtimeScripts: ['console.log("</script><script>alert(1)</script>")'],
  });
  const result = compile([{ document: d }], { navigation: false }).html;
  assert.doesNotMatch(result, /<\/script><script>alert\(1\)<\/script>/);
  assert.match(result, /<\\\/script><script>alert\(1\)<\\\/script>/);
});

test("CSS cannot close style context and inject markup in an export", () => {
  const doc = {
    html: "<h1>safe</h1>",
    css: 'h1{font-family:"</style><script>alert(1)</script>"}',
  };
  const result = compile([{ document: doc }], { navigation: false }).html;
  assert.ok(!result.includes("</style><script>alert(1)"));
});

test("inline relative CSS resources block incomplete exports", () => {
  const d = normalize(
    '<div style="background:url(images/missing.png)">x</div>',
  );
  assert.ok(
    d.diagnostics.some(
      (x) => x.severity === "error" && x.message.includes("行内资源"),
    ),
  );
});
