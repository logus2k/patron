/*
 * panels.spec.mjs — real-browser regression test for View-panel close/toggle behavior.
 *
 * Guards the 2026-07-05 bugs (see memory jspanel-close-behavior.md):
 *   - Toolbox/Output ×-close must HIDE (onbeforeclose→false) + uncheck the View menu, and the
 *     menu toggle must reshow them (a `click`-interceptor is useless — real clicks destroy the
 *     panel on pointerup before `click` fires).
 *   - Debug ×-close destroys + must uncheck; reopen recreates.
 *   - CRUCIAL: assert the RENDERED `.check` span (✓), NOT just menuBar.getContext() — the bug was
 *     a stale checkmark because onclosed set the context but skipped menuBar.refresh().
 *
 * Runs against a STATIC server (no composer catalog needed for panels). See run.sh.
 *   BASE_URL  — default http://127.0.0.1:9099
 *   PW_PATH   — path to the playwright module (default: this env's npx cache)
 */
const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:9099/";
const PW_PATH = process.env.PW_PATH || "/home/logus/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js";
const { chromium } = (await import(PW_PATH)).default;

const results = [];
const check = (name, ok) => results.push({ name, ok: !!ok });

const PANELS = [
  { label: "Toolbox",      ctx: "toolboxVisible", cmd: "view.toolbox", sel: ".patron-toolbox", startsVisible: true,  destroys: false },
  { label: "Output Panel", ctx: "outputVisible",  cmd: "view.output",  pttxt: "Output",        startsVisible: false, destroys: false },
  { label: "Debug",        ctx: "traceVisible",   cmd: "view.trace",   pttxt: "Debug",         startsVisible: false, destroys: true  },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.route("**/api/me", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: "T", email: "t@e.st" }) }));
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.PatronApp && window.PatronApp.menuBar && document.querySelector(".patron-toolbox"), { timeout: 20000 });
const wait = (ms) => page.waitForTimeout(ms);

// ---- helpers (run in page) ----
const findEl = (p) => p.sel
  ? { by: "sel", v: p.sel }
  : { by: "pttxt", v: p.pttxt };

async function panelState(p) {
  return page.evaluate(({ by, v, ctxKey, label }) => {
    const el = by === "sel"
      ? document.querySelector(v)
      : [...document.querySelectorAll(".jsPanel")].find(x => { const s = x.querySelector(".pttxt"); return s && s.textContent.trim() === v; }) || null;
    const visible = !!el && document.body.contains(el) && el.style.display !== "none";
    // rendered checkmark for the View-menu item whose label == `label`
    const item = [...document.querySelectorAll(".menu-item")].find(mi => {
      const c = mi.querySelector(".check");
      const lbl = mi.textContent.replace(c ? c.textContent : "", "").trim();
      return lbl === label;
    });
    const mark = item ? (item.querySelector(".check") || {}).textContent : "__no-item__";
    return { present: !!el, visible, ctx: window.PatronApp.menuBar.getContext(ctxKey), mark };
  }, { ...findEl(p), ctxKey: p.ctx, label: p.label });
}

async function realCloseX(p) {
  const box = await page.evaluate(({ by, v }) => {
    const el = by === "sel"
      ? document.querySelector(v)
      : [...document.querySelectorAll(".jsPanel")].find(x => { const s = x.querySelector(".pttxt"); return s && s.textContent.trim() === v; });
    if (!el) return null;
    if (el.front) el.front();
    const b = el.querySelector(".jsPanel-btn-close");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, findEl(p));
  if (!box) return false;
  await page.mouse.move(box.x, box.y); await wait(200);         // hover reveals the ×; pointer-events:auto
  await page.mouse.down(); await wait(30); await page.mouse.up();// real pointer events (jsPanel closes on pointerup)
  return true;
}
const cmd = (id) => page.evaluate((c) => window.PatronApp.menuBar.executeCommand(c), id);

for (const p of PANELS) {
  const tag = p.label;
  if (!p.startsVisible) { await cmd(p.cmd); await wait(400); }
  let s = await panelState(p);
  check(`${tag}: open → visible+checked+✓`, s.visible && s.ctx === true && s.mark === "✓");

  await realCloseX(p); await wait(600);
  s = await panelState(p);
  const closedOk = p.destroys ? (s.present === false) : (s.visible === false);
  check(`${tag}: × → ${p.destroys ? "gone" : "hidden"}+unchecked+empty✓`, closedOk && s.ctx === false && s.mark === "");

  await cmd(p.cmd); await wait(400);
  s = await panelState(p);
  check(`${tag}: reopen → visible+checked+✓`, s.visible && s.ctx === true && s.mark === "✓");
}

await browser.close();
let all = true;
for (const r of results) { console.log((r.ok ? "PASS" : "FAIL") + " — " + r.name); if (!r.ok) all = false; }
console.log(all ? "\nALL PASSED" : "\nSOME FAILED");
process.exit(all ? 0 : 1);
