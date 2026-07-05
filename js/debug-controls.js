/*
 * debug-controls.js — window.PatronDebug: the step-by-step DEBUG control surface (documents/
 * debug_specification.md). Mirrors a VS Code debugger:
 *   • a "Run" menu (wired in app.js) drives start / run-without / stop / restart / continue / step
 *     and breakpoint commands here;
 *   • a floating top-center toolbar (mirrors the bottom-center #canvas-controls) shows while a run
 *     is active with Continue / Step / Stop / Restart + status;
 *   • BREAKPOINTS toggle on the selected canvas node (red marker); in Continue the run pauses only
 *     at enabled breakpoints. The Debug panel (js/trace-panel.js) shows the stack trace.
 *
 * Backend: POST api/projects/<uid>/{fire|step|continue|stop|breakpoints}. Events (node.paused,
 * workflow.terminated) arrive via app.js's EventSource → onEvent().
 */
(function (global) {
  "use strict";

  const breakpoints = new Set();   // compiled node ids ("<type>:<id>", e.g. "agent:2")
  let bpEnabled = true;
  let debugUid = null, debugCid = null, lastTask = "";
  let paused = false, pausedNode = null;
  let bar = null, statusEl = null;

  // --- helpers --------------------------------------------------------------
  function uid() {
    return (global.PatronProjects && global.PatronProjects.current
      && global.PatronProjects.current().uid) || null;
  }
  function canvas() { return global.PatronApp && global.PatronApp.canvas; }
  function menuBar() { return global.PatronApp && global.PatronApp.menuBar; }
  function bpId(node) { return node ? (node.type + ":" + node.id) : null; }
  function redraw() { const c = canvas(); if (c) c.setDirty(true, true); }
  function setCtx() {
    const mb = menuBar();
    if (!mb) return;
    mb.setContext("debugging", !!debugCid);
    mb.setContext("paused", !!paused);
    mb.setContext("bpEnabled", bpEnabled);
    mb.refresh();
  }
  async function post(path, bodyObj) {
    let res, j = {};
    try {
      res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj || {}) });
      try { j = await res.json(); } catch (_) { j = {}; }
    } catch (e) { return { ok: false, status: 0, body: { error: "server unreachable" } }; }
    return { ok: res.ok, status: res.status, body: j };
  }
  function selectedNodes() {
    const c = canvas();
    const sel = (c && c.selected_nodes) || {};
    return Object.keys(sel).map(function (k) { return sel[k]; });
  }
  async function dialog(msg) {
    if (global.PatronDialogs) await global.PatronDialogs.confirm({ title: "Debug", message: msg, okLabel: "OK" });
    else alert(msg);
  }

  // --- floating toolbar (top-center, IDE-style) -----------------------------
  function mkBtn(label, title, onclick) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "tp-btn"; b.textContent = label; b.title = title || "";
    b.addEventListener("click", onclick);
    return b;
  }
  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "debug-bar";
    const dot = document.createElement("span"); dot.className = "db-dot";
    statusEl = document.createElement("span"); statusEl.className = "db-status"; statusEl.textContent = "debug";
    const sep = document.createElement("span"); sep.className = "db-sep";
    bar.append(dot, statusEl, sep,
      mkBtn("Continue", "Resume to the next breakpoint (F5)", function () { PD.cont(); }),
      mkBtn("Step", "Run the next node, then pause (F10)", function () { PD.step(); }),
      mkBtn("Stop", "Stop debugging (Shift+F5)", function () { PD.stop(); }),
      mkBtn("Restart", "Restart debugging (Ctrl+Shift+F5)", function () { PD.restart(); }));
    document.body.appendChild(bar);
    return bar;
  }
  function showBar() { ensureBar().classList.add("visible"); }
  function hideBar() { if (bar) bar.classList.remove("visible"); }
  function status(text, running) {
    ensureBar();
    statusEl.textContent = text;
    bar.classList.toggle("running", !!running);
  }
  function setBusy(b) { if (bar) bar.querySelectorAll("button").forEach(function (x) { x.disabled = b; }); }

  // --- breakpoint + paused markers (wrap LGraphCanvas.drawNode) --------------
  function installMarkers() {
    if (typeof LGraphCanvas === "undefined" || LGraphCanvas.prototype.__patronDebugMarkers) return;
    LGraphCanvas.prototype.__patronDebugMarkers = true;
    const _drawNode = LGraphCanvas.prototype.drawNode;
    LGraphCanvas.prototype.drawNode = function (node, ctx) {
      const r = _drawNode.call(this, node, ctx);
      if (!node) return r;
      const th = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_TITLE_HEIGHT) || 30;
      const id = bpId(node);
      // Breakpoint dot — in a "gutter" just LEFT of the title (VS Code style), so it never clashes
      // with the block icon/title text and reads on any title colour. Red; grey when disabled.
      if (breakpoints.has(id)) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(-12, -th * 0.5, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = bpEnabled ? "#e51400" : "#8a8a8a";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.stroke();
        ctx.restore();
      }
      // Paused-here highlight — a yellow arrow/outline around the whole node while paused on it.
      if (id === pausedNode) {
        ctx.save();
        ctx.strokeStyle = "#ffcc00";
        ctx.lineWidth = 2;
        ctx.strokeRect(-1, -th - 1, node.size[0] + 2, node.size[1] + th + 2);
        ctx.restore();
      }
      return r;
    };
  }

  function pushBreakpoints() {
    // If a run is active, update its breakpoints live (Continue then respects the new set).
    if (debugCid && debugUid) post("api/projects/" + debugUid + "/breakpoints",
      { cid: debugCid, breakpoints: [...breakpoints], bp_enabled: bpEnabled });
  }

  // --- run lifecycle --------------------------------------------------------
  async function fire(task, debug) {
    return post("api/projects/" + debugUid + "/fire",
      { task: task || "", debug: !!debug, breakpoints: [...breakpoints], bp_enabled: bpEnabled });
  }
  async function begin(debug) {
    const u = uid();
    if (!u) { await dialog("Save + Deploy the project first — Debug fires the deployed graph."); return; }
    let task = "";
    if (global.PatronDialogs) {
      task = await global.PatronDialogs.prompt({
        title: debug ? "Start Debugging" : "Run Without Debugging",
        label: "Seed task (optional):", okLabel: debug ? "Start" : "Run",
      });
      if (task === null) return;  // cancelled
    }
    lastTask = task;
    debugUid = u;
    if (global.PatronTrace) global.PatronTrace.open();   // show the stack trace
    if (debug) { paused = false; showBar(); status("starting…", true); setBusy(true); setCtx(); }
    const r = await fire(task, debug);
    if (!r.ok) {
      // 404 = the farm has no deployed record for this uid → the project isn't deployed.
      const msg = r.status === 404
        ? "Not deployed — run Build ▸ Deploy first (Debug runs the deployed graph)."
        : (r.body.detail || r.body.error || ("HTTP " + r.status));
      if (debug) { status("⚠ " + msg, false); setBusy(true); }
      else await dialog(msg);
      debugCid = null; setCtx(); return;
    }
    debugCid = debug ? r.body.cid : null;
    if (debug) { status("run " + String(debugCid).slice(0, 8) + " starting…", true); setCtx(); }
  }
  async function drive(verb) {
    if (!debugCid || !debugUid) return;
    setBusy(true);
    const r = await post("api/projects/" + debugUid + "/" + verb, { cid: debugCid });
    if (!r.ok) { status(verb + " failed: " + (r.body.error || ("HTTP " + r.status))); setBusy(false); }
  }

  // --- events (fed by app.js's EventSource) ---------------------------------
  function onEvent(d) {
    if (!d || !d.event || d.cid !== debugCid) return;
    if (d.event === "node.paused") {
      paused = true; pausedNode = d.node || null;
      showBar();
      status("⏸ before " + (d.node || "?") + (d.kind ? " (" + d.kind + ")" : "")
        + (d.at_breakpoint ? "  ●" : ""), false);
      setBusy(false); setCtx(); redraw();
    } else if (d.event === "workflow.terminated") {
      paused = false; pausedNode = null; debugCid = null;
      status("■ ended (" + (d.reason || "done") + ")", false);
      setBusy(true); setCtx(); redraw();
      setTimeout(hideBar, 3000);
    }
  }

  // --- public API (Run menu commands) ---------------------------------------
  const PD = {
    start: function () { begin(true); },
    runNoDebug: function () { begin(false); },
    stop: function () { if (debugCid) { drive("stop"); status("stopping…", false); } },
    restart: function () {
      const t = lastTask;
      const doStart = function () { debugUid = uid(); if (!debugUid) return; showBar(); status("restarting…", true); setBusy(true); paused = false; fire(t, true).then(function (r) { if (r.ok) { debugCid = r.body.cid; setCtx(); } }); };
      if (debugCid) { drive("stop"); setTimeout(doStart, 250); } else doStart();
    },
    cont: function () { if (paused) { drive("continue"); status("running…", true); paused = false; setCtx(); } },
    step: function () { if (paused) { drive("step"); setBusy(true); } },
    toggleBreakpoint: function () {
      const nodes = selectedNodes();
      if (!nodes.length) { dialog("Select a block on the canvas first, then Toggle Breakpoint."); return; }
      nodes.forEach(function (n) { const id = bpId(n); if (breakpoints.has(id)) breakpoints.delete(id); else breakpoints.add(id); });
      redraw(); pushBreakpoints();
    },
    enableAllBreakpoints: function () { bpEnabled = true; redraw(); pushBreakpoints(); setCtx(); },
    disableAllBreakpoints: function () { bpEnabled = false; redraw(); pushBreakpoints(); setCtx(); },
    removeAllBreakpoints: function () { breakpoints.clear(); redraw(); pushBreakpoints(); },
    onEvent: onEvent,
    activeCid: function () { return debugCid; },
    isDebugging: function () { return !!debugCid; },
    breakpoints: function () { return [...breakpoints]; },
  };
  global.PatronDebug = PD;

  // Patch the canvas draw as soon as litegraph is present (this script loads after it).
  installMarkers();
})(window);
