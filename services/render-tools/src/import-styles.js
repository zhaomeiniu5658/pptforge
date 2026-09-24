import { parse as parseJs } from "acorn";
import { parse as parseHtml } from "parse5";
import postcss from "postcss";
import tailwind from "tailwindcss";
import forms from "@tailwindcss/forms";
import containerQueries from "@tailwindcss/container-queries";

// Read literal configuration only. Never evaluate uploaded JavaScript or load plugins from it.
function literal(node) {
  if (node.type === "Literal" && !node.regex && typeof node.value !== "bigint")
    return node.value;
  if (node.type === "ArrayExpression") return node.elements.map(literal);
  if (node.type === "ObjectExpression") {
    const result = Object.create(null);
    for (const property of node.properties) {
      if (
        property.type !== "Property" ||
        property.computed ||
        property.method ||
        property.kind !== "init"
      )
        throw Error("Tailwind 配置仅支持静态属性");
      const key = property.key.name ?? property.key.value;
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw Error("Tailwind 配置属性不支持");
      result[key] = literal(property.value);
    }
    return result;
  }
  throw Error("Tailwind 配置包含动态代码，请导出编译后的 CSS");
}

export async function importStyles(html) {
  if (typeof html !== "string" || html.length > 20 * 1024 * 1024)
    throw Error("HTML 大小超过 20 MB");
  const scripts = [];
  function walk(node) {
    if (node.tagName === "script") scripts.push(node);
    for (const child of node.childNodes || []) walk(child);
  }
  walk(parseHtml(html));
  const hasTailwind = scripts.some((node) =>
    node.attrs.some(
      (a) =>
        a.name === "src" &&
        /^https:\/\/(cdn\.tailwindcss\.com|cdn\.jsdelivr\.net\/npm\/@tailwindcss\/browser)/.test(
          a.value,
        ),
    ),
  );
  if (!hasTailwind) return { css: "" };
  if (
    scripts.some((node) =>
      node.attrs.some(
        (a) => a.name === "src" && a.value.includes("@tailwindcss/browser"),
      ),
    )
  )
    throw Error("当前支持 Tailwind v3 导出，请为 v4 页面附带编译后的 CSS");
  let config = {};
  for (const node of scripts) {
    const text = (node.childNodes || []).map((x) => x.value || "").join("");
    if (!text.includes("tailwind.config")) continue;
    const ast = parseJs(text, { ecmaVersion: 2022 });
    const assignments = ast.body.filter(
      (statement) =>
        statement.type === "ExpressionStatement" &&
        statement.expression.type === "AssignmentExpression" &&
        statement.expression.operator === "=" &&
        statement.expression.left.type === "MemberExpression" &&
        !statement.expression.left.computed &&
        statement.expression.left.object.name === "tailwind" &&
        statement.expression.left.property.name === "config",
    );
    if (assignments.length !== ast.body.length)
      throw Error("Tailwind 配置包含动态代码，请导出编译后的 CSS");
    for (const statement of assignments)
      config = literal(statement.expression.right);
  }
  const css = await postcss([
    tailwind({
      theme: config.theme || {},
      darkMode: config.darkMode || "media",
      prefix: typeof config.prefix === "string" ? config.prefix : "",
      content: [{ raw: html, extension: "html" }],
      plugins: [forms, containerQueries],
    }),
  ]).process("@tailwind base; @tailwind components; @tailwind utilities;", {
    from: undefined,
  });
  return { css: css.css };
}
