import Fastify from "fastify";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { interactionAudit } from "./interaction-audit.js";
import { importStyles } from "./import-styles.js";
import { normalize, compile, MAX_HTML_BYTES } from "@quark/html-engine";
import { distance } from "../../../third_party/calque/dist/src/core/colour.js";
const app = Fastify({ bodyLimit: 35 * 1024 * 1024 });
app.addHook("onRequest", async (req, reply) => {
  if (
    req.headers["x-tool-secret"] !==
    (process.env.TOOL_SECRET || "quark-local-tools-change-me")
  )
    return reply.code(403).send({ error: "内部工具鉴权失败" });
});
app.setErrorHandler((e, req, reply) =>
  reply.code(400).send({ error: e.message }),
);
let browser;
async function getBrowser() {
  if (!browser?.isConnected())
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
      args: process.env.CONTAINER === "true" ? ["--no-sandbox"] : [],
    });
  return browser;
}
app.post("/internal/normalize", async (req) => ({
  document: normalize(req.body.document),
}));
app.post("/internal/import-styles", async (req) => importStyles(req.body.html));
app.post("/internal/compile", async (req) =>
  compile(req.body.pages, req.body.options || {}),
);
app.post("/internal/render", async (req) => {
  const { document: doc, width = 1280, height = 900, actions = [] } = req.body;
  if (width < 320 || width > 2560 || height < 200 || height > 10000)
    throw Error("渲染尺寸超出范围");
  if ((doc.html || "").length > MAX_HTML_BYTES) throw Error("文档超过 20 MB");
  const b = await getBrowser();
  const ctx = await b.newContext({
    viewport: { width: Math.round(width), height: Math.round(height) },
    deviceScaleFactor: 1,
  });
  try {
    await ctx.route("**/*", (route) =>
      route.request().url().startsWith("data:")
        ? route.continue()
        : route.abort(),
    );
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setContent(
      compile([{ document: doc }], { navigation: false }).html,
      { waitUntil: "load", timeout: 20000 },
    );
    await page.addStyleTag({
      content:
        "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
    });
    await page.evaluate(() => document.fonts.ready);
    for (const action of actions.slice(0, 10)) {
      if (!["click", "hover", "focus"].includes(action.type)) continue;
      await page
        .locator(action.selector)
        .first()
        [action.type]({ timeout: 3000 });
    }
    const metrics = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      missingImages: [...document.images].filter(
        (i) => !i.complete || !i.naturalWidth,
      ).length,
      controls: document.querySelectorAll("button,a[href],input,select").length,
      overflow: document.documentElement.scrollWidth > innerWidth + 2,
    }));
    if (metrics.height > 18000) throw Error("页面过长，超过单次渲染上限");
    const interactionReport = await page.evaluate(interactionAudit);
    const png = await page.screenshot({
      fullPage: true,
      animations: "disabled",
    });
    return { png: png.toString("base64"), metrics, errors, interactionReport };
  } finally {
    await ctx.close();
  }
});
app.post("/internal/compare", async (req) => {
  const a = Buffer.from(req.body.target, "base64"),
    b = Buffer.from(req.body.actual, "base64");
  const ma = await sharp(a).metadata(),
    mb = await sharp(b).metadata();
  const w = Math.max(ma.width, mb.width),
    h = Math.max(ma.height, mb.height);
  if (w * h > 24_000_000) throw Error("比较图像过大");
  const raster = async (buf, m) =>
    sharp(buf)
      .flatten({ background: "#ffffff" })
      .removeAlpha()
      .extend({
        right: w - m.width,
        bottom: h - m.height,
        background: "#ff00ff",
      })
      .raw()
      .toBuffer();
  const [aa, bb] = await Promise.all([raster(a, ma), raster(b, mb)]);
  let bad = 0,
    total = 0,
    sum = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 500000)));
  const marked = Buffer.alloc(w * h * 3, 255);
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 3;
      const delta = distance(
        { r: aa[i], g: aa[i + 1], b: aa[i + 2] },
        { r: bb[i], g: bb[i + 1], b: bb[i + 2] },
      );
      total++;
      sum += delta;
      if (delta > 8) {
        bad++;
        marked[i] = 255;
        marked[i + 1] = 40;
        marked[i + 2] = 90;
      }
    }
  const diff = await sharp(marked, {
    raw: { width: w, height: h, channels: 3 },
  })
    .png()
    .toBuffer();
  return {
    score: 1 - bad / total,
    meanDelta: sum / total,
    dimensionMismatch: ma.width !== mb.width || ma.height !== mb.height,
    targetSize: [ma.width, ma.height],
    actualSize: [mb.width, mb.height],
    diff: diff.toString("base64"),
  };
});
app.post("/internal/analyze", async (req) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "quark-calque-"));
  try {
    const file = join(dir, "input.png");
    await writeFile(file, Buffer.from(req.body.image, "base64"));
    const { extract } =
      await import("../../../third_party/calque/dist/src/spec/assemble.js");
    return {
      spec: await extract(file, {
        language: req.body.language || "chi_sim+eng",
        cachePath: process.env.TESSERACT_CACHE,
      }),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
app.get("/health", async () => ({ ok: true }));
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 8012) });
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, async () => {
    await app.close();
    await browser?.close();
    process.exit(0);
  });
