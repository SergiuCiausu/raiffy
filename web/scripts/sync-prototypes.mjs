#!/usr/bin/env node
/**
 * Sync the HTML prototypes (../*.html) into the Next.js app.
 *
 * The prototypes stay the design source of truth. This script copies what is static:
 *   - each page's <style> → styles/generated/<page>.css, scoped under one wrapper class so pages never collide,
 *   - selected static markup → components/generated/<Name>.tsx, with Lucide icons as lucide-react components.
 * Interactive parts are written by hand in React and plugged into the generated markup as "slots".
 *
 * Generated files are overwritten on every run: never edit them, edit the prototype or the slot component.
 * Run: pnpm sync:prototypes
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "parse5";
import postcss from "postcss";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROTOTYPES = join(WEB, "..");

/* Prototype file → app route. Hashes on login.html pick the flow. */
const ROUTES = {
  "raiffy.html": "/",
  "login.html#signup": "/sign-up",
  "login.html#login": "/sign-in",
  "login.html": "/sign-in",
  "chat.html": "/chat",
  "swipe.html": "/did-you-know",
  "admin.html": "/admin/users",
  "console.html": "/console/reviews",
};

const PAGES = [
  {
    file: "raiffy.html",
    scope: "pg-landing",
    markup: [
      {
        name: "LandingBody",
        select: "body",
        slots: [{ select: "div.card.simulator", component: "Simulator", from: "@/components/landing/Simulator" }],
      },
    ],
    strokeWidth: 1.6,
    // Nothing in the prototypes links to swipe.html yet: add it to the footer's "Raiffy" column
    patches: [[
      '<li><a href="#safeguards">Principles</a></li></ul></div>\n      <div><h5>For the bank</h5>',
      '<li><a href="#safeguards">Principles</a></li><li><a href="swipe.html">Did you know</a></li></ul></div>\n      <div><h5>For the bank</h5>',
    ]],
  },
  { file: "login.html", scope: "pg-auth", markup: [{ name: "AuthBrand", select: "aside.brand" }] },
  { file: "chat.html", scope: "pg-chat", markup: [{ name: "ChatStarters", select: "div.starters" }] },
  { file: "swipe.html", scope: "pg-swipe", markup: [{ name: "SwipeNav", select: "header.nav" }], strokeWidth: 1.6 },
  // Staff pages: styles only, the shell and views are React (components/staff) over real Clerk and Convex data
  { file: "admin.html", scope: "pg-staff-admin", markup: [] },
  { file: "console.html", scope: "pg-console", markup: [] },
];

/* ───────────── CSS: scope every rule under the page wrapper ───────────── */

function scopeSelector(sel, scope) {
  const s = sel.trim();
  if (s.startsWith(":root")) return `.${scope}${s.slice(5)}`;
  if (/^(html|body)\b/.test(s)) return `.${scope}${s.replace(/^(html|body)/, "")}`;
  if (s.startsWith(".js ")) return `.${scope}.js ${s.slice(4)}`;
  // Attribute-first selectors ([data-mode], [data-flow]) must also match the wrapper itself, which plays <body>
  if (s.startsWith("[")) {
    const first = s.match(/^(\[[^\]]+\])+/)[0];
    return `.${scope}${first}${s.slice(first.length)}, .${scope} ${s}`;
  }
  return `.${scope} ${s}`;
}

function convertCss(css, scope) {
  const root = postcss.parse(css);
  const frames = new Set();
  root.walkAtRules(/keyframes$/i, (at) => {
    frames.add(at.params);
    at.params = `${scope}-${at.params}`;
  });
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
    const wasBody = rule.selectors.some((x) => /^(html|body)\b/.test(x.trim()));
    rule.selector = rule.selectors.map((x) => scopeSelector(x, scope)).join(", ");
    // The wrapper isn't the scroll root, and overflow-x: hidden would break position: sticky inside it
    if (wasBody) rule.walkDecls("overflow-x", (d) => { if (d.value === "hidden") d.value = "clip"; });
  });
  root.walkDecls((d) => {
    if (/^animation(-name)?$/.test(d.prop)) {
      d.value = d.value.replace(/[\w-]+/g, (w) => (frames.has(w) ? `${scope}-${w}` : w));
    }
    // Fonts come from next/font, which renames the families
    d.value = d.value.replace(/"Geist Mono"/g, "var(--font-geist-mono)").replace(/"Geist"/g, "var(--font-geist)");
  });
  return root.toString();
}

/* ───────────── Markup: parse5 tree → JSX source ───────────── */

const ATTR = {
  class: "className", for: "htmlFor", tabindex: "tabIndex", readonly: "readOnly", maxlength: "maxLength",
  minlength: "minLength", autocomplete: "autoComplete", autocapitalize: "autoCapitalize", spellcheck: "spellCheck",
  enterkeyhint: "enterKeyHint", novalidate: "noValidate", crossorigin: "crossOrigin", colspan: "colSpan",
  rowspan: "rowSpan", autofocus: "autoFocus", checked: "defaultChecked", "xlink:href": "xlinkHref",
  "xmlns:xlink": "xmlnsXlink", "xml:space": "xmlSpace",
};
const NUMERIC = new Set(["tabIndex", "rows", "cols", "colSpan", "rowSpan", "maxLength", "minLength", "size", "start"]);
const BOOLEAN = new Set(["hidden", "disabled", "defaultChecked", "required", "inert", "open", "noValidate", "readOnly", "autoFocus", "multiple"]);
const VOID = new Set(["area", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const pascal = (s) => camel(`-${s}`).replace(/-(\d)/g, "$1");
const str = (v) => (/["\\{}]/.test(v) ? `{${JSON.stringify(v)}}` : `"${v}"`);

function styleObject(css) {
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of css) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === ";" && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  const entries = parts.map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf(":");
    let k = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    if (!k.startsWith("--")) k = k.startsWith("-webkit-") ? `Webkit${pascal(k.slice(8))}` : camel(k);
    return `${/^[a-zA-Z]+$/.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(v)}`;
  });
  return `{{ ${entries.join(", ")} } as CSSProperties}`;
}

function matches(node, sel) {
  if (!node.tagName) return false;
  const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const [, tag, rest] = m;
  if (tag && node.tagName !== tag) return false;
  const attrs = Object.fromEntries(node.attrs.map((a) => [a.name, a.value]));
  const classes = (attrs.class || "").split(/\s+/);
  for (const [, kind, name] of rest.matchAll(/([.#])([\w-]+)/g)) {
    if (kind === "." && !classes.includes(name)) return false;
    if (kind === "#" && attrs.id !== name) return false;
  }
  return true;
}
function find(node, sel) {
  if (matches(node, sel)) return node;
  for (const c of node.childNodes || []) { const f = find(c, sel); if (f) return f; }
  return null;
}

function mapHref(v) {
  if (ROUTES[v]) return { route: ROUTES[v] };
  const [file, hash] = v.split("#");
  if (ROUTES[file]) return { route: `${ROUTES[file]}#${hash}` };
  return null;
}

function toJsx(rootNode, { slots = [], strokeWidth }, ctx) {
  const pad = (n) => "  ".repeat(n);

  function attrs(node) {
    const out = [];
    for (const { name, value } of node.attrs) {
      if (name === "data-lucide") continue;
      let k = ATTR[name] || name;
      if (k === "value" && ["input", "textarea", "select"].includes(node.tagName)) k = "defaultValue";
      if (!k.startsWith("data-") && !k.startsWith("aria-") && k.includes("-")) k = camel(k);
      if (k === "style") { ctx.css = true; out.push(`style=${styleObject(value)}`); continue; }
      if (BOOLEAN.has(k)) { out.push(k); continue; }
      if (NUMERIC.has(k) && /^-?\d+$/.test(value)) { out.push(`${k}={${value}}`); continue; }
      out.push(`${k}=${str(value)}`);
    }
    return out;
  }

  function children(node, depth) {
    const kids = (node.childNodes || []).filter((c) => !(c.tagName === "script" || c.tagName === "style"));
    const lines = [];
    kids.forEach((c, i) => {
      if (c.nodeName === "#text") {
        const t = node.tagName === "textarea" || node.tagName === "pre" ? c.value : c.value.replace(/\s+/g, " ");
        if (t === " " && (i === 0 || i === kids.length - 1)) return;
        if (!t) return;
        if (t === " ") { lines.push(`${pad(depth)}{" "}`); return; }
        lines.push(pad(depth) + (/^\s|\s$|[{}<>&]/.test(t) ? `{${JSON.stringify(t)}}` : t));
      } else if (c.nodeName === "#comment") {
        lines.push(`${pad(depth)}{/* ${c.data.trim().replace(/\*\//g, "* /").replace(/\s*\n\s*/g, " ")} */}`);
      } else if (c.tagName) {
        lines.push(element(c, depth));
      }
    });
    return lines;
  }

  function element(node, depth) {
    const slot = slots.find((s) => matches(node, s.select));
    if (slot) { ctx.imports.add(`import { ${slot.component} } from "${slot.from}";`); return `${pad(depth)}<${slot.component} />`; }

    const icon = node.attrs.find((a) => a.name === "data-lucide");
    if (icon) {
      const C = `${pascal(icon.value)}Icon`;
      ctx.icons.add(C);
      const a = attrs(node);
      if (strokeWidth) a.push(`strokeWidth={${strokeWidth}}`);
      return `${pad(depth)}<${C}${a.length ? " " + a.join(" ") : ""} />`;
    }

    let tag = node.tagName;
    const a = attrs(node);
    if (tag === "a") {
      const href = node.attrs.find((x) => x.name === "href");
      const mapped = href && mapHref(href.value);
      if (mapped) {
        tag = "Link";
        ctx.link = true;
        const i = a.findIndex((x) => x.startsWith("href="));
        a[i] = `href="${mapped.route}"`;
      }
    }
    const open = `${pad(depth)}<${tag}${a.length ? " " + a.join(" ") : ""}`;
    const kids = children(node, depth + 1);
    if (!kids.length) return `${open}${VOID.has(tag) || tag !== "textarea" ? " />" : `></${tag}>`}`;
    return `${open}>\n${kids.join("\n")}\n${pad(depth)}</${tag}>`;
  }

  // For <body>, emit only its children: the page component provides the wrapper
  return rootNode.tagName === "body" ? `<>\n${children(rootNode, 3).join("\n")}\n    </>` : element(rootNode, 2).trimStart();
}

function convertMarkup(doc, spec, page) {
  const node = find(doc, spec.select);
  if (!node) throw new Error(`${page.file}: nothing matches "${spec.select}"`);
  const ctx = { imports: new Set(), icons: new Set(), link: false, css: false };
  const jsx = toJsx(node, { slots: spec.slots, strokeWidth: page.strokeWidth }, ctx);
  const head = [
    `// Generated by scripts/sync-prototypes.mjs from ../${page.file} (${spec.select}). Do not edit: change the prototype and re-run.`,
    ctx.css && `import type { CSSProperties } from "react";`,
    ctx.link && `import Link from "next/link";`,
    ctx.icons.size && `import { ${[...ctx.icons].sort().join(", ")} } from "lucide-react";`,
    ...ctx.imports,
  ].filter(Boolean);
  return `${head.join("\n")}\n\nexport function ${spec.name}() {\n  return (\n    ${jsx}\n  );\n}\n`;
}

/* ───────────── Run ───────────── */

const write = (rel, text) => {
  const p = join(WEB, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  console.log(`  wrote ${rel}`);
};

for (const page of PAGES) {
  // A Windows checkout with core.autocrlf has CRLF endings; the patches and the generated files use LF.
  let html = readFileSync(join(PROTOTYPES, page.file), "utf8").replace(/\r\n/g, "\n");
  for (const [find, replace] of page.patches || []) {
    if (!html.includes(find)) throw new Error(`${page.file}: patch target not found, update the patch in sync-prototypes.mjs:\n${find}`);
    html = html.replace(find, replace);
  }
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const name = page.scope.replace(/^pg-/, "");
  console.log(page.file);
  write(`styles/generated/${name}.css`,
    `/* Generated by scripts/sync-prototypes.mjs from ../${page.file}, scoped under .${page.scope}. Do not edit. */\n${convertCss(css, page.scope)}`);
  const doc = parse(html);
  for (const spec of page.markup) write(`components/generated/${spec.name}.tsx`, convertMarkup(doc, spec, page));
}
