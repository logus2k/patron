/*
 * trace-panel.js — a live Trace/Debug panel. Subscribes (via app.js's per-project EventSource,
 * which calls window.PatronTrace.push for every run event) and renders each workflow STEP with
 * the PAYLOAD flowing between blocks. Grouped by run (cid), ordered by arrival. Foundation for
 * Debug / Step-by-Step. Toggled from the View menu ("Trace Panel").
 */
(function (global) {
  "use strict";

  let panel = null, body = null;
  const runs = {};          // cid -> { rows: [ {event, loc, payload} ] }
  const order = [];         // cids in arrival order
  const MAX_RUNS = 25, MAX_ROWS = 400;

  // Per-event-type accent (falls back to text colour).
  const COLORS = {
    "edge.traversed": "var(--muted)",
    "agent.result": "var(--run)",
    "console.output": "var(--accent)",
    "agent.thought": "var(--code)",
    "tool.exec": "#d29",
    "tool.result": "#2a9",
    "rag.retrieved": "#a6d",
    "db.queried": "#a6d",
    "workflow.terminated": "var(--muted)",
  };

  function ensurePanel() {
    if (panel || typeof jsPanel === "undefined") return;
    panel = jsPanel.create({
      // Icon markup mirrors app.js panelImg() (not importable here) so all panel headers match.
      headerTitle: '<img src="icons/trace.svg" width="16" height="16" style="vertical-align:bottom;margin-left:3px;margin-right:7px;margin-top:1px;position:relative" alt=""><span class="pttxt">Trace</span>',
      theme: "none", borderRadius: "8px", border: "1px solid var(--panel-border)",
      panelSize: { width: 460, height: 400 },
      position: { my: "right-bottom", at: "right-bottom", offsetX: -14, offsetY: -14 },
      boxShadow: 3,
      headerControls: { size: "xs", minimize: "remove", smallify: "remove", normalize: "remove", maximize: "remove" },
      onclosed: function () { panel = null; body = null; if (global.PatronApp && global.PatronApp.menuBar) global.PatronApp.menuBar.setContext("traceVisible", false); },
      callback: function (p) {
        p.content.style.cssText =
          "padding:0;overflow:auto;background:var(--panel);color:var(--text);" +
          "font:12px 'Roboto', ui-monospace, monospace";
        body = p.content;
        render();
      },
    });
  }

  function rowEl(r) {
    const div = document.createElement("div");
    div.style.cssText = "padding:2px 8px;display:flex;gap:8px;align-items:baseline;border-top:1px solid var(--panel-border)";
    const ev = document.createElement("span");
    ev.textContent = r.event;
    ev.style.cssText = "flex:0 0 120px;color:" + (COLORS[r.event] || "var(--text)");
    const loc = document.createElement("span");
    loc.textContent = r.loc;
    loc.style.cssText = "flex:0 0 160px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    const pl = document.createElement("span");
    pl.textContent = r.payload;
    pl.style.cssText = "flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.95";
    pl.title = r.payload;   // full payload on hover
    div.appendChild(ev); div.appendChild(loc); div.appendChild(pl);
    return div;
  }

  function render() {
    if (!body) return;
    body.innerHTML = "";
    if (!order.length) {
      const m = document.createElement("div");
      m.style.cssText = "padding:12px;opacity:.6";
      m.textContent = "No runs yet. Deploy a project and fire it (Console Send, schedule, file…) to see each step + payload.";
      body.appendChild(m);
      return;
    }
    for (const cid of order.slice(-MAX_RUNS)) {
      const run = runs[cid]; if (!run) continue;
      const hd = document.createElement("div");
      hd.textContent = "run " + String(cid).slice(0, 8) + "  ·  " + run.rows.length + " steps";
      hd.style.cssText = "padding:5px 8px;font-weight:600;background:var(--item-bg);position:sticky;top:0";
      body.appendChild(hd);
      for (const r of run.rows) body.appendChild(rowEl(r));
    }
    body.scrollTop = body.scrollHeight;   // follow the tail
  }

  function push(d) {
    if (!d || !d.event) return;
    const cid = d.cid || "?";
    if (!runs[cid]) {
      runs[cid] = { rows: [] };
      order.push(cid);
      if (order.length > MAX_RUNS) { const drop = order.shift(); delete runs[drop]; }
    }
    const loc = d.node || (d.src ? (d.src + " → " + d.dst) : "");
    const payload = String(d.payload != null ? d.payload : (d.output != null ? d.output : ""));
    const rows = runs[cid].rows;
    rows.push({ event: d.event, loc: loc, payload: payload });
    if (rows.length > MAX_ROWS) rows.shift();
    if (panel && body) render();   // only touch the DOM when the panel is open
  }

  global.PatronTrace = {
    push: push,
    open: function () { ensurePanel(); if (panel) { panel.style.display = ""; if (panel.front) panel.front(); render(); if (global.PatronApp && global.PatronApp.menuBar) global.PatronApp.menuBar.setContext("traceVisible", true); } },
    close: function () { if (panel) panel.close(); },
    toggle: function () { if (panel) this.close(); else this.open(); },
    isOpen: function () { return !!panel; },
    clear: function () { for (const k in runs) delete runs[k]; order.length = 0; render(); },
  };
})(window);
