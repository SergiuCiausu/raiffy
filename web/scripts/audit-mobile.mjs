#!/usr/bin/env node
/**
 * Mobile audit: loads every prototype view (and, with --app, the public app routes) on a phone
 * and checks the rules in DESIGN.md §12 (Mobile first).
 *
 * Fails:  horizontal page scroll, touch targets whose hit area is under 44×44px,
 *         text under 11px (3D hero art excepted), text fields under 16px (iOS zooms them).
 * Warns:  sentences (6+ words) under 13px.
 *
 * Phones: 375×812 and 390×844, touch and coarse pointer, reduced motion (so reveals are settled).
 * Output: .mobile-audit/report.md, report.json and one full-page screenshot per view and width.
 *
 * Run:  pnpm audit:mobile                      every prototype view
 *       pnpm audit:mobile --only chat,console  views whose name starts with one of these
 *       pnpm audit:mobile --app http://localhost:3000   also the public app routes
 *       pnpm audit:mobile --no-shots           skip screenshots
 * Exits 1 when any view fails.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROTOTYPES = join(WEB, "..");
const OUT = join(WEB, ".mobile-audit");

/* Prototype views: file plus hash sub-view. Name = what --only matches and what the screenshots are called. */
const PROTOTYPE_VIEWS = [
  ["landing", "raiffy.html"],
  ["login", "login.html"],
  ["signup", "login.html#signup"],
  ["chat", "chat.html"],
  ["swipe", "swipe.html"],
  ["plan", "plan.html"],
  // #raiffy, #apply and #repay reset to home on load, so they're checked by hand (Phase 2)
  ["smart-home", "smart-mobile.html#home"],
  ["smart-accounts", "smart-mobile.html#accounts"],
  ["smart-overdraft", "smart-mobile.html#overdraft"],
  ["smart-offer", "smart-mobile.html#offer"],
  ["smart-products", "smart-mobile.html#products"],
  ["console-reviews", "console.html#reviews"],
  ["console-review", "console.html#reviews/R-1042"],
  ["console-products", "console.html#products"],
  ["console-product", "console.html#products/personal-loan"],
  ["console-parameters", "console.html#parameters"],
  ["console-approvals", "console.html#approvals"],
  ["admin-home", "admin.html#home"],
  ["admin-products", "admin.html#products"],
  ["admin-rules", "admin.html#rules"],
  ["admin-analytics", "admin.html#analytics"],
  ["admin-sentiment", "admin.html#sentiment"],
  ["admin-users", "admin.html#users"],
  ["admin-audit", "admin.html#audit"],
];

/* Public app routes (signed-in routes need a Clerk session and are checked in Playwright e2e instead). */
const APP_ROUTES = [
  ["app-landing", "/"],
  ["app-sign-in", "/sign-in"],
  ["app-sign-up", "/sign-up"],
  ["app-did-you-know", "/did-you-know"],
];

const PHONES = [
  { name: "375", viewport: { width: 375, height: 812 } },
  { name: "390", viewport: { width: 390, height: 844 } },
];

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const only = flag("--only")?.split(",").filter(Boolean);
const appBase = flag("--app");
const shots = !args.includes("--no-shots");

const views = [
  ...PROTOTYPE_VIEWS.map(([name, file]) => ({ name, url: pathToFileURL(join(PROTOTYPES, file.split("#")[0])).href + (file.includes("#") ? "#" + file.split("#")[1] : "") })),
  ...(appBase ? APP_ROUTES.map(([name, path]) => ({ name, url: new URL(path, appBase).href })) : []),
].filter((v) => !only || only.some((o) => v.name.startsWith(o)));

/* ───────────── In-page checks (runs in the browser, must stay self-contained) ───────────── */
function inspectPage() {
  const MIN_TARGET = 44, MIN_TEXT = 11, MIN_SENTENCE = 13, MIN_FIELD = 16;
  const root = document.documentElement;
  const vw = root.clientWidth;

  const label = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    if (el.classList.length) s += "." + [...el.classList].slice(0, 2).join(".");
    const text = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28);
    return text ? `${s} "${text}"` : s;
  };
  const shown = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const ancestors = function* (el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) yield p;
  };
  const clippedX = (el) => [...ancestors(el)].some((p) => getComputedStyle(p).overflowX !== "visible");
  const fixedLayer = (el) => [el, ...ancestors(el)].some((p) => getComputedStyle(p).position === "fixed");
  const in3d = (el) => [el, ...ancestors(el)].some((p) => getComputedStyle(p).transform.startsWith("matrix3d"));
  const srOnly = (el) => {
    const r = el.getBoundingClientRect();
    return r.width <= 1 || r.height <= 1 || getComputedStyle(el).clip.startsWith("rect(0");
  };

  /* 1. Horizontal page scroll, and the outermost elements that cause it */
  const all = [...document.body.querySelectorAll("*")].filter(shown);
  const wide = all.filter((el) => {
    const r = el.getBoundingClientRect();
    return (r.right > vw + 1 || r.left < -1) && !clippedX(el) && !fixedLayer(el);
  });
  const overflow = {
    pageWidth: root.scrollWidth,
    viewport: vw,
    causes: wide.filter((el) => !wide.includes(el.parentElement)).slice(0, 6)
      .map((el) => `${label(el)} right=${Math.round(el.getBoundingClientRect().right)}`),
  };

  /* 2. Touch targets: the real hit area, probed with elementFromPoint, so ::before/::after padding counts */
  const TARGETS = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=switch],[role=checkbox],[tabindex]:not([tabindex="-1"])';
  const seen = new Set();
  const targets = [];
  for (const el of document.querySelectorAll(TARGETS)) {
    if (!shown(el) || el.closest('[inert],[aria-hidden="true"]')) continue;
    // A hidden native checkbox or radio is reached through its label
    const target = el.matches("input[type=checkbox],input[type=radio]") && el.closest("label") ? el.closest("label") : el;
    if (seen.has(target) || srOnly(target)) continue;
    // Skip links sit off screen until focused
    if (target.tagName === "A" && /^skip\b/i.test(target.textContent.trim())) continue;
    // Links inside a sentence are exempt (WCAG 2.5.8 inline exception)
    if (target.tagName === "A" && getComputedStyle(target).display === "inline"
      && target.parentElement && target.parentElement.textContent.trim().length > target.textContent.trim().length + 12) continue;
    seen.add(target);
    targets.push(target);
  }
  const small = [];
  // Probing scrolls the page and inner scrollers; note where they were so the screenshot shows the page as it loaded
  const scrolled = [...document.querySelectorAll("*")].filter((e) => e.scrollTop || e.scrollLeft).map((e) => [e, e.scrollTop, e.scrollLeft]);
  const startY = window.scrollY;
  for (const el of targets) {
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    // 1px inside the edge: hit testing rounds to whole pixels, and hit areas that exactly touch are fine
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, half = MIN_TARGET / 2 - 1;
    let blocker = null;
    const hits = (x, y) => {
      const h = document.elementFromPoint(x, y);
      const ok = !!h && (h === el || el.contains(h) || (el.tagName === "LABEL" && el.control === h));
      if (!ok && h && !blocker) blocker = h;
      return ok;
    };
    const okX = r.width >= MIN_TARGET || (hits(cx - half, cy) && hits(cx + half, cy));
    const okY = r.height >= MIN_TARGET || (hits(cx, cy - half) && hits(cx, cy + half));
    if (!okX || !okY) small.push(`${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}${blocker ? ` (overlapped by ${label(blocker).split(" ")[0]})` : ""}`);
  }
  window.scrollTo(0, startY);
  for (const e of document.querySelectorAll("*")) if (e.scrollTop || e.scrollLeft) { e.scrollTop = 0; e.scrollLeft = 0; }
  for (const [e, top, left] of scrolled) { e.scrollTop = top; e.scrollLeft = left; }

  /* 3. Text size: any text under 11px fails, any sentence under 13px warns */
  const tiny = [], smallSentences = [];
  for (const el of all) {
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").trim().replace(/\s+/g, " ");
    if (text.length < 2 || srOnly(el) || in3d(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < MIN_TEXT) tiny.push(`${label(el)} ${fs}px`);
    else if (fs < MIN_SENTENCE && text.split(" ").length >= 6) smallSentences.push(`${label(el)} ${fs}px`);
  }

  /* 4. Text fields under 16px make iOS Safari zoom on focus */
  const fields = [...document.querySelectorAll('input:not([type]),input[type=text],input[type=email],input[type=search],input[type=number],input[type=tel],input[type=password],input[type=url],textarea,select,[contenteditable="true"]')]
    .filter((el) => shown(el) && parseFloat(getComputedStyle(el).fontSize) < MIN_FIELD)
    .map((el) => `${label(el)} ${getComputedStyle(el).fontSize}`);

  const uniq = (xs) => [...new Set(xs)];
  return {
    overflow,
    targets: { checked: targets.length, small: uniq(small) },
    tiny: uniq(tiny),
    fields: uniq(fields),
    smallSentences: uniq(smallSentences),
  };
}

/* ───────────── Runner ───────────── */
async function launch() {
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch {
    return chromium.launch();
  }
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  // Walk the page once so scroll-triggered content (reveals, lazy vignettes) is in its resting state
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
    await document.fonts.ready;
  });
  await page.waitForTimeout(400);
}

const browser = await launch();
const results = [];
mkdirSync(OUT, { recursive: true });

for (const phone of PHONES) {
  const context = await browser.newContext({
    viewport: phone.viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  for (const view of views) {
    const page = await context.newPage();
    try {
      await page.goto(view.url, { waitUntil: "load", timeout: 30000 });
      await settle(page);
      const r = await page.evaluate(inspectPage);
      const fail = r.overflow.pageWidth > r.overflow.viewport || r.targets.small.length > 0 || r.tiny.length > 0 || r.fields.length > 0;
      results.push({ view: view.name, phone: phone.name, url: view.url, fail, ...r });
      if (shots) await page.screenshot({ path: join(OUT, `${view.name}-${phone.name}.png`), fullPage: true });
    } catch (error) {
      results.push({ view: view.name, phone: phone.name, url: view.url, fail: true, error: String(error.message || error) });
    }
    await page.close();
  }
  await context.close();
}
await browser.close();

/* ───────────── Report ───────────── */
const MAX = 12;
const list = (title, xs) => (xs?.length ? [`- **${title} (${xs.length})**`, ...xs.slice(0, MAX).map((x) => `  - \`${x}\``), ...(xs.length > MAX ? [`  - … ${xs.length - MAX} more`] : [])] : []);
const md = [
  "# Mobile audit",
  "",
  `${new Date().toISOString()} · rules: DESIGN.md §12 · phones: ${PHONES.map((p) => p.name).join(", ")}px`,
  "",
  "| View | Phone | Result | Page width | Small targets | Text < 11px | Fields < 16px | Sentences < 13px |",
  "|---|---|---|---|---|---|---|---|",
  ...results.map((r) => r.error
    ? `| ${r.view} | ${r.phone} | error | | | | | |`
    : `| ${r.view} | ${r.phone} | ${r.fail ? "FAIL" : "pass"} | ${r.overflow.pageWidth}/${r.overflow.viewport} | ${r.targets.small.length}/${r.targets.checked} | ${r.tiny.length} | ${r.fields.length} | ${r.smallSentences.length} |`),
  "",
  ...results.filter((r) => r.phone === PHONES[0].name).flatMap((r) => r.error
    ? [`## ${r.view}`, "", `Error: ${r.error}`, ""]
    : [
      `## ${r.view}`,
      "",
      ...(r.overflow.pageWidth > r.overflow.viewport ? list("Horizontal scroll caused by", r.overflow.causes) : []),
      ...list("Touch targets under 44px", r.targets.small),
      ...list("Text under 11px", r.tiny),
      ...list("Text fields under 16px", r.fields),
      ...list("Sentences under 13px (warning)", r.smallSentences),
      "",
    ]),
].join("\n");

writeFileSync(join(OUT, "report.md"), md);
writeFileSync(join(OUT, "report.json"), JSON.stringify(results, null, 2));

const failed = results.filter((r) => r.fail);
for (const r of results) {
  const detail = r.error ? r.error : `width ${r.overflow.pageWidth}/${r.overflow.viewport} · targets ${r.targets.small.length}/${r.targets.checked} · text<11 ${r.tiny.length} · fields<16 ${r.fields.length} · sentences<13 ${r.smallSentences.length}`;
  console.log(`${r.fail ? "FAIL" : "pass"}  ${r.view.padEnd(20)} ${r.phone}  ${detail}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed · report: ${join(OUT, "report.md")}`);
process.exit(failed.length ? 1 : 0);
