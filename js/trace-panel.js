/*
 * trace-panel.js — a live Trace/Debug panel. Subscribes (via app.js's per-project EventSource,
 * which calls window.PatronTrace.push for every run event) and renders each workflow STEP with
 * the PAYLOAD flowing between blocks. Grouped by run (cid), ordered by arrival. Toggled from the
 * View menu ("Trace Panel").
 *
 * Debug (documents/debug_specification.md): a toolbar fires a step-by-step run
 * (POST api/projects/<uid>/fire {task, debug:true}); when the run pauses before a node
 * (`node.paused` event for our cid), a pause bar shows Step / Continue / Stop, each POSTing
 * api/projects/<uid>/{step|continue|stop} {cid}.
 */
(function (global) {
  "use strict";

  let panel = null, body = null, bar = null, pauseBar = null;
  let debugUid = null, debugCid = null;     // the active debug run (project uid + run cid)
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
    "node.paused": "var(--link-highlight)",
    "workflow.terminated": "var(--muted)",
  };

  // --- debug helpers --------------------------------------------------------
  function currentUid() {
    return (global.PatronProjects && global.PatronProjects.current
      && global.PatronProjects.current().uid) || null;
  }
  async function api(path, bodyObj) {
    let res, j = {};
    try {
      res = await fetch(path, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj || {}),
      });
      try { j = await res.json(); } catch (_) { j = {}; }
    } catch (e) {
      return { ok: false, status: 0, body: { error: "server unreachable" } };
    }
    return { ok: res.ok, status: res.status, body: j };
  }
  function mkBtn(label, title) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label; b.title = title || "";
    b.className = "tp-btn";   // flat/borderless, matches the canvas controls bar (.cc-btn)
    return b;
  }
  function showPause() { if (pauseBar) pauseBar.style.display = "flex"; }
  function hidePause() { if (pauseBar) pauseBar.style.display = "none"; }
  function pauseMsg(t) { const el = pauseBar && pauseBar.querySelector(".tp-msg"); if (el) el.textContent = t; }
  function setBusy(b) { if (pauseBar) pauseBar.querySelectorAll("button").forEach(function (x) { x.disabled = b; }); }

  async function fireDebug(task) {
    const uid = currentUid();
    if (!uid) { showPause(); pauseMsg("Save + Deploy the project first (Debug fires the deployed graph)."); return; }
    debugUid = uid;
    showPause(); pauseMsg("starting debug run…"); setBusy(true);
    const r = await api("api/projects/" + uid + "/fire", { task: task || "", debug: true });
    if (!r.ok) { debugCid = null; pauseMsg("Fire failed: " + (r.body.error || ("HTTP " + r.status))); return; }
    debugCid = r.body.cid;
    pauseMsg("run " + String(debugCid).slice(0, 8) + " starting…");   // first node.paused will update this
  }
  async function drive(verb) {
    if (!debugCid || !debugUid) return;
    setBusy(true);
    const r = await api("api/projects/" + debugUid + "/" + verb, { cid: debugCid });
    if (!r.ok) { pauseMsg(verb + " failed: " + (r.body.error || ("HTTP " + r.status))); setBusy(false); }
    // On success we wait for the next node.paused / workflow.terminated to re-enable + relabel.
  }

  function buildToolbar(host) {
    bar = document.createElement("div");
    bar.className = "tp-bar";
    bar.style.cssText = "flex:0 0 auto;border-bottom:1px solid var(--panel-border)";
    // fire row
    const fireRow = document.createElement("div");
    fireRow.style.cssText = "display:flex;gap:4px;align-items:center;padding:4px 6px";
    const input = document.createElement("input");
    input.type = "text"; input.placeholder = "seed task (optional)";
    input.className = "tp-input";
    const dbg = mkBtn("▶ Debug", "Fire a step-by-step debug run of the deployed project");
    dbg.addEventListener("click", function () { fireDebug(input.value); });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") fireDebug(input.value); });
    fireRow.appendChild(input); fireRow.appendChild(dbg);
    // pause row (hidden until paused)
    pauseBar = document.createElement("div");
    pauseBar.style.cssText = "display:none;gap:4px;align-items:center;padding:4px 6px;" +
      "border-top:1px solid var(--panel-border);background:color-mix(in srgb, var(--link-highlight) 14%, var(--item-bg))";
    const msg = document.createElement("span");
    msg.className = "tp-msg";
    msg.style.cssText = "flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600";
    const stepB = mkBtn("Step", "Run the next node, then pause again");
    const contB = mkBtn("Continue", "Run to completion (stop pausing)");
    const stopB = mkBtn("Stop", "Abort the run");
    stepB.addEventListener("click", function () { drive("step"); });
    contB.addEventListener("click", function () { drive("continue"); pauseMsg("continuing…"); });
    stopB.addEventListener("click", function () { drive("stop"); pauseMsg("stopping…"); });
    pauseBar.appendChild(msg); pauseBar.appendChild(stepB); pauseBar.appendChild(contB); pauseBar.appendChild(stopB);
    bar.appendChild(fireRow); bar.appendChild(pauseBar);
    host.appendChild(bar);
  }

  // --- panel ----------------------------------------------------------------
  function ensurePanel() {
    if (panel || typeof jsPanel === "undefined") return;
    panel = jsPanel.create({
      // Icon markup mirrors app.js panelImg() (not importable here) so all panel headers match.
      headerTitle: '<img src="icons/trace.svg" width="16" height="16" style="vertical-align:bottom;margin-left:3px;margin-right:7px;margin-top:1px;position:relative" alt=""><span class="pttxt">Trace</span>',
      theme: "none", borderRadius: "8px", border: "1px solid var(--panel-border)",
      panelSize: { width: 460, height: 420 },
      position: { my: "right-bottom", at: "right-bottom", offsetX: -14, offsetY: -14 },
      boxShadow: 3,
      headerControls: { size: "xs", minimize: "remove", smallify: "remove", normalize: "remove", maximize: "remove" },
      onclosed: function () {
        panel = null; body = null; bar = null; pauseBar = null;
        if (global.PatronApp && global.PatronApp.menuBar) global.PatronApp.menuBar.setContext("traceVisible", false);
      },
      callback: function (p) {
        p.content.style.cssText =
          "padding:0;overflow:hidden;background:var(--panel);color:var(--text);" +
          "font:12px 'Roboto', ui-monospace, monospace;display:flex;flex-direction:column";
        buildToolbar(p.content);
        const rows = document.createElement("div");
        rows.style.cssText = "flex:1;overflow:auto";
        p.content.appendChild(rows);
        body = rows;
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
      m.textContent = "No runs yet. Fire the deployed project (▶ Debug above, or Console Send / schedule / file) to see each step + payload.";
      body.appendChild(m);
      return;
    }
    for (const cid of order.slice(-MAX_RUNS)) {
      const run = runs[cid]; if (!run) continue;
      const hd = document.createElement("div");
      const isDebug = cid === debugCid ? "  · debugging" : "";
      hd.textContent = "run " + String(cid).slice(0, 8) + "  ·  " + run.rows.length + " steps" + isDebug;
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
    const payload = String(d.payload != null ? d.payload
      : (d.output != null ? d.output : (d.incoming != null ? d.incoming : "")));
    const rows = runs[cid].rows;
    rows.push({ event: d.event, loc: loc, payload: payload });
    if (rows.length > MAX_ROWS) rows.shift();

    // Debug: react to the active run's pause / terminate.
    if (cid === debugCid && pauseBar) {
      if (d.event === "node.paused") {
        showPause();
        pauseMsg("⏸ before " + (d.node || "?") + (d.kind ? " (" + d.kind + ")" : ""));
        setBusy(false);
      } else if (d.event === "workflow.terminated") {
        pauseMsg("■ ended (" + (d.reason || "done") + ")");
        setBusy(true);          // nothing left to step
        debugCid = null;
      }
    }
    if (panel && body) render();   // only touch the DOM when the panel is open
  }

  global.PatronTrace = {
    push: push,
    open: function () { ensurePanel(); if (panel) { panel.style.display = ""; if (panel.front) panel.front(); if (global.PatronApp && global.PatronApp.ensureOnScreen) global.PatronApp.ensureOnScreen(panel); render(); if (global.PatronApp && global.PatronApp.menuBar) global.PatronApp.menuBar.setContext("traceVisible", true); } },
    close: function () { if (panel) panel.close(); },
    toggle: function () { if (panel) this.close(); else this.open(); },
    isOpen: function () { return !!panel; },
    clear: function () { for (const k in runs) delete runs[k]; order.length = 0; render(); },
  };
})(window);
