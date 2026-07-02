/*
 * app.js — boots the LiteGraph canvas, builds the toolbox palette, wires the
 * reference demo composition (see data spec §4), and runs execution passes.
 */
(function (global) {
  "use strict";

  if (typeof LiteGraph === "undefined") {
    document.body.innerHTML = "<p style='color:#e66;padding:20px'>LiteGraph failed to load.</p>";
    return;
  }

  // Register the runtime-aligned agent vocabulary (the real authoring target).
  global.PatronAgentNodes.register(LiteGraph);

  // Palette definition: display metadata for the toolbox.
  const PALETTE = [
    global.PatronAgentNodes.INITIATORS,
    global.PatronAgentNodes.PALETTE,
    global.PatronAgentNodes.DESTINATIONS,
  ];

  // --- graph + canvas -------------------------------------------------------
  const graph = new LGraph();
  const canvasEl = document.getElementById("graph-canvas");

  // --- HiDPI fix (PATRON) ---------------------------------------------------
  // LiteGraph sizes its canvas bitmap in CSS pixels and lets CSS stretch it to
  // fill the element. On a HiDPI / scaled display (devicePixelRatio > 1 — the
  // norm on Windows/WSL with display scaling) that upscaling blurs the whole
  // graph surface, while the DOM chrome (toolbar/panels) stays crisp because
  // it isn't a bitmap. Fix it WITHOUT editing the vendored library:
  //   1) make the backing store devicePixelRatio× larger (real device pixels)
  //      while keeping the element's CSS layout size unchanged, and
  //   2) prepend a matching dpr scale to the per-frame draw transform.
  // Mouse mapping is unaffected: hit-testing goes through convertCanvasToOffset
  // (`pos/scale - offset`), which works purely in CSS pixels and never sees dpr.
  // Installed on the prototypes BEFORE constructing the canvas so even the
  // first frame is sharp. Re-apply if litegraph is re-vendored.
  const DPR = Math.max(1, global.devicePixelRatio || 1);

  const _toCanvasContext = LiteGraph.DragAndScale.prototype.toCanvasContext;
  LiteGraph.DragAndScale.prototype.toCanvasContext = function (ctx) {
    ctx.scale(DPR, DPR);               // CSS px -> device px (outermost)
    _toCanvasContext.call(this, ctx);  // then litegraph's own pan/zoom
  };

  LGraphCanvas.prototype.resize = function (width, height) {
    if (!width && !height) {
      const parent = this.canvas.parentNode;
      width = parent.offsetWidth;
      height = parent.offsetHeight;
    }
    const bw = Math.round(width * DPR);
    const bh = Math.round(height * DPR);
    if (this.canvas.width === bw && this.canvas.height === bh) return;
    this.canvas.width = bw;                       // backing store in device px
    this.canvas.height = bh;
    this.canvas.style.width = width + "px";       // layout size stays in CSS px
    this.canvas.style.height = height + "px";
    this.bgcanvas.width = bw;
    this.bgcanvas.height = bh;
    this.setDirty(true, true);
  };

  const lgcanvas = new LGraphCanvas(canvasEl, graph);
  // litegraph strokes a #235 rectangle around the whole canvas (visible as a
  // frame when panning the diagram); the full-screen surface looks cleaner
  // without it.
  lgcanvas.render_canvas_border = false;
  // Many-to-many UX: dragging from a CONNECTED input dot should spawn a NEW fan-in wire
  // (mirror of the output dot, which already fans out), NOT grab the existing wire to
  // re-target it. With allow_reconnect_links=false, a plain drag starts a fresh
  // connection from the input; SHIFT+drag still re-targets the existing link (litegraph
  // keeps the shiftKey path). See litegraph processMouse input-slot handling.
  lgcanvas.allow_reconnect_links = false;
  // Hide litegraph's bottom-left debug overlay (T/I/N/V/FPS counters) — dev noise here.
  lgcanvas.show_info = false;
  // Kill litegraph's built-in double-click search box (add-node finder) — we don't use it,
  // and it hijacks double-click. Double-click is reserved for opening a block's own panel.
  lgcanvas.allow_searchbox = false;
  lgcanvas.showSearchBox = function () { return false; };
  // Thinner connection links (litegraph default 3 → 2).
  lgcanvas.connections_width = 2;

  // Use the vendored Roboto for canvas node text too (litegraph defaults to Arial). The
  // canvas paints before the @font-face TTF finishes loading, so repaint once it's ready.
  lgcanvas.title_text_font = "13px 'Roboto', sans-serif"; // = panel title (13px); exact match at 100% zoom
  lgcanvas.inner_text_font = "normal " + LiteGraph.NODE_SUBTEXT_SIZE + "px 'Roboto', sans-serif";
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => lgcanvas.setDirty(true, true));
  }

  // Zoom control (bottom-left): [−] [editable %] [+]. Zooms around the viewport center;
  // visibility toggles from the View menu and persists in the server workspace (no localStorage).
  function setZoom(target) {
    const ds = lgcanvas.ds;
    if (!ds) return;
    const rect = (lgcanvas.canvas || canvasEl).getBoundingClientRect();
    ds.changeScale(target, [rect.width / 2, rect.height / 2]); // clamps to [min,max] internally
    lgcanvas.setDirty(true, true);
    scheduleSave();
  }
  const zoomCtl = document.createElement("div");
  zoomCtl.id = "zoom-control";
  const zMinus = document.createElement("button"); zMinus.className = "zc-btn"; zMinus.textContent = "−"; zMinus.title = "Zoom out";
  const zVal = document.createElement("input"); zVal.id = "zc-value"; zVal.type = "text"; zVal.spellcheck = false; zVal.title = "Zoom — type a % and press Enter";
  const zPlus = document.createElement("button"); zPlus.className = "zc-btn"; zPlus.textContent = "+"; zPlus.title = "Zoom in";
  zoomCtl.append(zMinus, zVal, zPlus);
  document.body.appendChild(zoomCtl);
  zMinus.addEventListener("click", () => setZoom(lgcanvas.ds.scale / 1.1));
  zPlus.addEventListener("click", () => setZoom(lgcanvas.ds.scale * 1.1));
  zVal.addEventListener("focus", () => zVal.select());
  zVal.addEventListener("keydown", (e) => { if (e.key === "Enter") zVal.blur(); });
  zVal.addEventListener("change", () => { const v = parseFloat(zVal.value); if (isFinite(v) && v > 0) setZoom(v / 100); });
  function toggleZoomControl() {
    const vis = zoomCtl.style.display === "none";
    zoomCtl.style.display = vis ? "" : "none";
    if (menuBar) { menuBar.setContext("zoomVisible", vis); if (menuBar.refresh) menuBar.refresh(); }
    scheduleSave();
  }
  let _lastZoom = null;
  (function tickZoom() {
    const z = Math.round(((lgcanvas.ds && lgcanvas.ds.scale) || 1) * 100);
    if (z !== _lastZoom && document.activeElement !== zVal) { _lastZoom = z; zVal.value = z + "%"; }
    requestAnimationFrame(tickZoom);
  })();

  // Sizing: let litegraph's own resize() own the canvas bitmap — it reads the
  // parent size, resizes BOTH the fg + bg canvases, and no-ops when unchanged.
  // (Pre-setting canvas.width ourselves cleared the bitmap → a flash → and made
  // resize() think nothing changed, so it skipped the repaint → blank canvas.)
  // Batch with rAF (resize fires in bursts) and repaint in the same frame so the
  // cleared bitmap is never shown.
  let resizePending = false;
  function resizeCanvas() {
    resizePending = false;
    lgcanvas.resize();           // sizes fg+bg to the parent; dirties on change
    lgcanvas.draw(true, true);   // repaint now — no blank frame
  }
  function scheduleResize() {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(resizeCanvas);
  }
  global.addEventListener("resize", scheduleResize);
  // Track the canvas pane itself (catches layout changes, not just window resize).
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(scheduleResize).observe(document.getElementById("canvas-wrap"));
  }

  // --- output hook ----------------------------------------------------------
  // The Output is a floating jsPanel (created at boot). We build its <pre> here
  // so the reference is stable regardless of when/whether the panel is created.
  const inspectOut = document.createElement("pre");
  inspectOut.id = "inspect-out";
  inspectOut.textContent = "Press ⚙ Compile → DSL to lower the graph to the runtime DSL.";
  const inspectState = {};
  global.PatronApp = {
    onInspect(nodeId, value) {
      inspectState["node#" + nodeId] = value;
      inspectOut.textContent = Object.keys(inspectState)
        .map((k) => k + " →\n" + JSON.stringify(value, null, 2))
        .join("\n\n");
    },
  };

  // Current open-project name shown top-right (persisted as ui.projectName; the Phase-01
  // Project entity will drive this). Minimal placeholder for now.
  let projectName = "Untitled Project";
  function setProjectName(name) {
    projectName = (name && String(name).trim()) || "Untitled Project";
    const el = document.getElementById("project-name");
    if (el) el.textContent = projectName;
  }
  global.PatronApp.setProjectName = setProjectName;

  // --- palette UI + drag-to-canvas -----------------------------------------
  function buildPalette(root) {
    root = root || document.getElementById("palette");
    if (!root) return;
    root.innerHTML = "";
    PALETTE.forEach((grp) => {
      const g = document.createElement("div");
      g.className = "palette-group";
      const label = document.createElement("div");
      label.className = "group-label";
      label.textContent = grp.group.toUpperCase();
      g.appendChild(label);

      grp.items.forEach((it) => {
        const el = document.createElement("div");
        el.className = "palette-item";
        el.draggable = true;
        el.style.borderLeftColor = grp.color;
        el.dataset.type = it.type;
        const ico = (window.PatronIcons && window.PatronIcons.has(it.type))
          ? '<span class="icon">' + window.PatronIcons.svgString(it.type, 20) + "</span>"
          : '<span class="swatch" style="background:' + grp.color + '"></span>';
        el.innerHTML = ico + it.label;
        el.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/plain", it.type);
        });
        // double-click also drops it near the view center
        el.addEventListener("dblclick", () => {
          const r = lgcanvas.ds; // DragAndScale
          spawnNode(it.type, [
            (-r.offset[0]) + 200 / r.scale,
            (-r.offset[1]) + 150 / r.scale,
          ]);
        });
        g.appendChild(el);
      });
      root.appendChild(g);
    });
  }

  function spawnNode(type, pos) {
    const node = LiteGraph.createNode(type);
    if (!node) return null;
    node.pos = pos;
    graph.add(node);
    scheduleSave();
    return node;
  }

  // canvas drop target
  canvasEl.addEventListener("dragover", (e) => e.preventDefault());
  canvasEl.addEventListener("drop", (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("text/plain");
    if (!type) return;
    const pos = lgcanvas.convertEventToCanvasOffset(e);
    spawnNode(type, pos);
  });


  // --- execution ------------------------------------------------------------
  function runOnce() {
    // LiteGraph runs nodes in topological order, so a single pass fully
    // propagates data from sources to sinks. We drive execution manually
    // (no graph.start() loop) to keep ids stable per Run.
    graph.updateExecutionOrder();
    graph.runStep(1);
    graph.setDirtyCanvas(true, true);
  }

  // --- agent authoring: load / compile / persist ---------------------------
  // Server-side workspace store (serve.py). RELATIVE on purpose so it works both at
  // the root (http://host:8088/ → /api/workspace) and behind the reverse proxy's
  // path prefix (https://logus2k.com/patron/ → /patron/api/workspace, which the
  // proxy strips back to /api/workspace). An absolute "/api/..." would escape /patron/.
  const API = "api/workspace";

  // Build the News Agent from the runtime-aligned nodes (their defaults already
  // hold the News Agent config — see js/agent_nodes.js).
  // Load the News Agent from its source-of-truth graph file (examples/news-agent.graph.json),
  // not reconstructed from node defaults — so the demo always matches the real fixture the
  // runtime lowers. NEW vocabulary: Trigger → Agent (tools as config) → WhatsApp.
  async function loadNewsAgent() {
    try {
      const res = await fetch("examples/news-agent.graph.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const g = await res.json();
      graph.clear();
      for (const k in inspectState) delete inspectState[k];
      graph.configure(g);
      setProjectName("News Agent");
      graph.setDirtyCanvas(true, true);
      inspectOut.textContent = "News Agent loaded (Trigger → Agent → WhatsApp). Build → Compile → DSL.";
    } catch (e) {
      inspectOut.textContent = "Could not load examples/news-agent.graph.json: " + e.message;
      showOutput();
    }
  }

  // Lower the current graph via the AUTHORITATIVE server contract: agent_runtime's
  // /composer/compile (the one Block model), proxied same-origin by serve.py. There is
  // no in-browser compiler — the backend OWNS the contract (no legacy, no duplication).
  // Returns { ok, dsl, schedule } | { ok:false, errors } | { ok:false, unreachable:true }.
  async function compileGraph() {
    try {
      const res = await fetch("composer/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(graph.serialize()),
      });
      if (res.ok) return await res.json();
      return { ok: false, errors: ["/composer/compile HTTP " + res.status] };
    } catch (e) {
      return { ok: false, unreachable: true, errors: ["cannot reach agent_runtime (/composer/compile) — is the runtime up?"] };
    }
  }

  // Lower the current graph to the runtime record + scheduler-job spec and show both.
  async function compileToDsl() {
    const out = await compileGraph();
    if (out.ok) {
      inspectOut.textContent =
        "// agent record + schedule (what Deploy writes to runtime + scheduler)\n" +
        JSON.stringify({ record: out.dsl, schedule: out.schedule }, null, 2);
    } else {
      inspectOut.textContent = "// compile errors:\n- " + out.errors.join("\n- ");
    }
    showOutput(); // always surface the result
  }

  // Deploy: compile, then push BOTH records via serve.py's bridge — the agent record to
  // agent_runtime and (if scheduled) the cron job to agent_scheduler, linked by uid.
  async function deployToRuntime() {
    const out = await compileGraph();
    if (!out.ok) {
      inspectOut.textContent = "// cannot deploy — fix the compile errors first:\n- " + out.errors.join("\n- ");
      showOutput();
      return;
    }
    inspectOut.textContent = "Deploying '" + out.dsl.id + "' (agent + schedule)…";
    showOutput();
    try {
      const res = await fetch("api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record: out.dsl, schedule: out.schedule }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) {
        inspectOut.textContent =
          "✅ Deployed '" + j.id + "'" + (j.uid ? " (uid " + String(j.uid).slice(0, 8) + ")" : "") + " to agent_runtime.\n" +
          "Schedule job: " + (j.scheduled || "?") +
          (j.scheduler_detail ? " — " + j.scheduler_detail : "") + "\n\n" +
          JSON.stringify({ record: out.dsl, schedule: out.schedule }, null, 2);
      } else {
        inspectOut.textContent =
          "❌ Deploy failed: " + (j.error || ("HTTP " + res.status)) +
          (j.detail ? "\n\n" + j.detail : "");
      }
    } catch (e) {
      inspectOut.textContent = "❌ Deploy failed — no Patron server. Run `python3 serve.py`.";
    }
  }

  // --- Phase 05: Project deploy lifecycle (§9.3–§9.4) -----------------------
  // Deploy the CURRENT Project 1:1 to one runtime graph record (idempotent by uid,
  // version-bumped). We send the litegraph serialize() graph as the composition; the
  // runtime lowers it, upserts the record, and binds the schedule. Advisory warnings
  // (no initiator, unbound blocks, type-mismatch) come back in `warnings[]` — we SHOW
  // them in Output but never block (warn, don't refuse: §9.3).
  async function deployProject() {
    if (!window.PatronProjects || !window.PatronProjects.current().uid) {
      // Deploy needs a stable Project uid (the idempotency key); save first.
      showOutput();
      inspectOut.textContent = "Save the project first (File ▸ Save) — Deploy needs a Project uid.";
      const saved = window.PatronProjects && (await window.PatronProjects.ensureSaved());
      if (!saved || !saved.uid) return;
    }
    const proj = window.PatronProjects.current();
    const composition = graph.serialize(); // { nodes[], links[] } — the runtime lowers this
    showOutput();
    inspectOut.textContent = 'Deploying project "' + proj.name + '" (uid ' + String(proj.uid).slice(0, 8) + ')…';
    try {
      const res = await fetch("api/projects/" + proj.uid + "/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: proj.name, composition: composition }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) {
        const warns = (j.warnings || []);
        const firing = j.firing || {};
        let msg = '✅ Deployed "' + proj.name + '" — version ' + j.version +
          " (uid " + String(j.uid).slice(0, 8) + ").\n";
        msg += firing.bound
          ? "Firing: bound" + (firing.cron ? " (cron " + firing.cron + ")" : "") +
            (firing.schedule_id ? " schedule " + String(firing.schedule_id).slice(0, 8) : "") + ".\n"
          : "Firing: NOT bound — " + (firing.reason || "no initiator") + ".\n";
        msg += warns.length
          ? "\n⚠️ " + warns.length + " advisory warning(s) (deployed anyway):\n- " + warns.join("\n- ")
          : "\nNo warnings.";
        inspectOut.textContent = msg;
      } else if (res.status === 422) {
        inspectOut.textContent = "❌ Deploy refused (422): " + (j.detail || j.error || "invalid composition");
      } else {
        inspectOut.textContent = "❌ Deploy failed: " + (j.error || ("HTTP " + res.status)) +
          (j.detail ? "\n\n" + j.detail : "");
      }
    } catch (e) {
      inspectOut.textContent = "❌ Deploy failed — no Patron server. Run `python3 serve.py`.";
    }
  }

  // Undeploy: remove the live runtime record + firing binding. Source assets stay intact
  // (§9.4). Idempotent — a not-deployed uid returns removed:false + a warning, not an error.
  async function undeployProject(opts) {
    const silent = !!(opts && opts.silent);
    const proj = window.PatronProjects && window.PatronProjects.current();
    if (!proj || !proj.uid) {
      if (!silent) { showOutput(); inspectOut.textContent = "This project isn't saved yet — nothing to undeploy."; }
      return { ok: false, removed: false };
    }
    try {
      const res = await fetch("api/undeploy/" + proj.uid, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!silent) {
        showOutput();
        inspectOut.textContent = res.ok && j.ok
          ? (j.removed ? '🗑️ Undeployed "' + proj.name + '" (record + firing binding removed).'
                       : 'ℹ️ "' + proj.name + '" was not deployed.') +
            ((j.warnings || []).length ? "\n- " + j.warnings.join("\n- ") : "")
          : "❌ Undeploy failed: " + (j.error || ("HTTP " + res.status)) + (j.detail ? "\n\n" + j.detail : "");
      }
      return j;
    } catch (e) {
      if (!silent) { showOutput(); inspectOut.textContent = "❌ Undeploy failed — no Patron server."; }
      return { ok: false, removed: false };
    }
  }

  // The workspace document we persist to the server: the graph (which already
  // carries each node's pos/size) + a separate `ui` metadata block holding panel
  // rects, the canvas pan/zoom, and the theme. UI metadata never touches the graph.
  function panelRect(p) {
    if (!p) return null;
    const cs = getComputedStyle(p);
    return {
      left: p.style.left || cs.left,
      top: p.style.top || cs.top,
      width: p.style.width || cs.width,
      height: p.style.height || cs.height,
      hidden: p.style.display === "none",
    };
  }
  function applyPanelRect(p, r) {
    if (!p || !r) return;
    if (r.left) p.style.left = r.left;
    if (r.top) p.style.top = r.top;
    if (r.width && r.height && typeof p.resize === "function") {
      try { p.resize({ width: parseInt(r.width, 10), height: parseInt(r.height, 10) }); }
      catch (e) { p.style.width = r.width; p.style.height = r.height; }
    }
    p.style.display = r.hidden ? "none" : "";
  }
  function collectWorkspace() {
    return {
      version: 1,
      graph: graph.serialize(), // includes every node's pos/size (canvas components)
      ui: {
        projectName: projectName,
        theme: document.documentElement.dataset.theme,
        view: { offset: lgcanvas.ds.offset.slice(), scale: lgcanvas.ds.scale },
        panels: {
          toolbox: panelRect(toolboxPanel),
          output: panelRect(outputPanel),
          props: panelRect(window.PatronProps && window.PatronProps.panel ? window.PatronProps.panel() : null),
          mcp: window.PatronProps && window.PatronProps.mcpRect ? window.PatronProps.mcpRect() : null,
          tpl: window.PatronProps && window.PatronProps.tplRect ? window.PatronProps.tplRect() : null,
        },
        blockRects: window.PatronApp.blockRects || {}, // per-block dedicated-panel positions
        selected: Object.keys(lgcanvas.selected_nodes || {}), // node ids of the current selection
        zoomVisible: zoomCtl.style.display !== "none",
      },
    };
  }
  // A saved graph is only loadable if EVERY node type is still registered. An old-vocabulary
  // workspace (from a previous node set) would otherwise render as red "undefined" placeholders
  // AND get re-saved on the next autosave — so we discard it and load the default instead.
  function graphCompatible(g) {
    const nodes = (g && g.nodes) || [];
    const reg = (typeof LiteGraph !== "undefined" && LiteGraph.registered_node_types) || {};
    return nodes.every((n) => !!reg[n.type]);
  }

  function applyWorkspace(ws) {
    const g = ws && ws.graph;
    if (g && g.nodes && g.nodes.length && !graphCompatible(g)) {
      console.warn("Patron: saved workspace has unknown node types — discarding it and loading the default News Agent.");
      loadNewsAgent(); // self-heal (async); the next autosave overwrites the stale workspace
    } else {
      graph.clear();
      graph.configure(g || {});
    }
    const ui = ws.ui || {};
    setProjectName(ui.projectName);
    if (ui.theme) applyTheme(ui.theme);
    if (window.PatronApp) window.PatronApp.blockRects = ui.blockRects || {}; // per-block panel positions
    if (ui.view) {
      if (Array.isArray(ui.view.offset)) lgcanvas.ds.offset = ui.view.offset.slice();
      if (ui.view.scale) lgcanvas.ds.scale = ui.view.scale;
    }
    const panels = ui.panels || {};
    applyPanelRect(toolboxPanel, panels.toolbox);
    // Output is a transient results panel (opened on demand via 📄 Output / Compile): restore
    // its position/size but keep it HIDDEN by default, regardless of last-saved visibility.
    applyPanelRect(outputPanel, panels.output);
    if (outputPanel) outputPanel.style.display = "none";
    if (menuBar) menuBar.setContext("outputVisible", false);
    // Properties panel is created lazily by props-panel.js — stash its saved rect so it can
    // position itself from it (and apply now if it already exists).
    if (window.PatronApp) window.PatronApp.propsRect = panels.props || null;
    const propsEl = window.PatronProps && window.PatronProps.panel ? window.PatronProps.panel() : null;
    if (propsEl) applyPanelRect(propsEl, panels.props);
    // MCP Tools panel is created on demand (props-panel.js ensureMcpPanel reads this rect to
    // position/size itself). Stash it; apply now if it happens to be open.
    if (window.PatronApp) window.PatronApp.mcpRect = panels.mcp || null;
    const mcpEl = window.PatronProps && window.PatronProps.mcpPanel ? window.PatronProps.mcpPanel() : null;
    if (mcpEl) applyPanelRect(mcpEl, panels.mcp);
    // Template Studio panel — same lazy pattern (ensureTemplateStudio reads this rect).
    if (window.PatronApp) window.PatronApp.tplRect = panels.tpl || null;
    const tplEl = window.PatronProps && window.PatronProps.tplPanel ? window.PatronProps.tplPanel() : null;
    if (tplEl) applyPanelRect(tplEl, panels.tpl);
    if (window.PatronProps && window.PatronProps.restore) window.PatronProps.restore(); // open it if it was visible
    // Zoom control visibility (default visible).
    const zv = ui.zoomVisible !== false;
    zoomCtl.style.display = zv ? "" : "none";
    if (menuBar) menuBar.setContext("zoomVisible", zv);
    graph.setDirtyCanvas(true, true);
    // Restore the previous selection (auto-save captures it on pointerup).
    if (Array.isArray(ui.selected) && ui.selected.length && lgcanvas.selectNodes) {
      const nodes = ui.selected.map((id) => graph.getNodeById(Number(id))).filter(Boolean);
      if (nodes.length) lgcanvas.selectNodes(nodes);
    }
  }

  async function saveWorkspace(opts) {
    const silent = !!(opts && opts.silent); // background auto-saves don't touch the Output panel
    try {
      const res = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectWorkspace()),
      });
      const j = await res.json().catch(() => ({}));
      if (!silent) {
        inspectOut.textContent = res.ok && j.ok
          ? "Saved to the server (graph + panel positions + view + theme)."
          : "Save failed: " + (j.error || ("HTTP " + res.status));
        showOutput();
      }
    } catch (e) {
      if (!silent) {
        inspectOut.textContent = "Save failed — no server. Run `python3 serve.py` to enable saving.";
        showOutput();
      }
    }
  }
  async function loadWorkspace() {
    try {
      const res = await fetch(API, { cache: "no-store" });
      const ws = await res.json().catch(() => ({}));
      if (!ws || !ws.graph) { inspectOut.textContent = "No saved workspace on the server yet."; showOutput(); return; }
      applyWorkspace(ws);
      inspectOut.textContent = "Loaded the workspace from the server.";
    } catch (e) {
      inspectOut.textContent = "Load failed — no server. Run `python3 serve.py` to enable loading.";
    }
    showOutput();
  }

  // --- canvas "millimetric paper" theming ----------------------------------
  // litegraph paints its own background canvas — a solid fill (clear_background_color)
  // plus a repeating grid PNG (background_image) — both independent of our CSS. We
  // regenerate both from the theme's CSS vars so the graph paper follows light/dark.
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  // A 100px graph-paper tile: minor lines every 20px + a heavier line on the tile
  // edge (→ a major line every 100px when repeated). Drawn in the theme's colors.
  function makeGridImage(base, minor, major) {
    const G = 100, step = 20, c = document.createElement("canvas");
    c.width = c.height = G;
    const x = c.getContext("2d");
    x.fillStyle = base; x.fillRect(0, 0, G, G);
    x.lineWidth = 1; x.strokeStyle = minor;
    for (let i = step; i < G; i += step) {
      x.beginPath(); x.moveTo(i + 0.5, 0); x.lineTo(i + 0.5, G); x.stroke();
      x.beginPath(); x.moveTo(0, i + 0.5); x.lineTo(G, i + 0.5); x.stroke();
    }
    x.strokeStyle = major;
    x.beginPath(); x.moveTo(0.5, 0); x.lineTo(0.5, G); x.stroke();
    x.beginPath(); x.moveTo(0, 0.5); x.lineTo(G, 0.5); x.stroke();
    return c.toDataURL("image/png");
  }
  function themeCanvas() {
    lgcanvas.clear_background_color = cssVar("--canvas-bg", "#1b1c20");
    lgcanvas.background_image = makeGridImage(
      cssVar("--canvas-bg", "#1b1c20"),
      cssVar("--canvas-grid-minor", "#26282d"),
      cssVar("--canvas-grid-major", "#31333a"),
    );
    lgcanvas._bg_img = null;  // force the bg image to reload…
    lgcanvas._pattern = null; // …and the repeat-pattern to rebuild
  }

  // The node boxes litegraph draws on the canvas read their colors live from
  // LiteGraph.* globals (body bg, text, widgets, links) — so theming = swapping
  // those globals. Node *title bars* keep their per-node category accent (node.color).
  function themeNodes() {
    LiteGraph.NODE_DEFAULT_BGCOLOR = cssVar("--node-bg", "#353535");
    LiteGraph.NODE_DEFAULT_BOXCOLOR = cssVar("--node-box", "#666");
    LiteGraph.NODE_TEXT_COLOR = cssVar("--node-text", "#aaa");
    LiteGraph.NODE_TITLE_COLOR = cssVar("--node-title-text", "#ccc");
    LiteGraph.WIDGET_BGCOLOR = cssVar("--widget-bg", "#222");
    LiteGraph.WIDGET_OUTLINE_COLOR = cssVar("--widget-outline", "#666");
    LiteGraph.WIDGET_TEXT_COLOR = cssVar("--widget-text", "#ddd");
    LiteGraph.WIDGET_SECONDARY_TEXT_COLOR = cssVar("--widget-text2", "#999");
    LiteGraph.LINK_COLOR = cssVar("--link", "#9aa9a9");
    // selection outline around a node — same color as the node's selected (lit-up) edges
    // so the border and links read as one. (litegraph hardcodes #FFF → invisible on white.)
    LiteGraph.NODE_BOX_OUTLINE_COLOR = cssVar("--link-highlight", "#ffb02e");
    // 1px node border matching the panels' border (litegraph doesn't stroke one by default).
    LiteGraph.NODE_BORDER_COLOR = cssVar("--panel-border", "#d8dee6");
    // Selected-node title text — theme-aware for contrast against the selection bar
    // (light theme: strong orange bar → white text; dark theme: amber bar → dark text).
    LiteGraph.NODE_SELECTED_TITLE_COLOR = cssVar("--node-selected-title", "#233040");
    // highlight color for edges of a selected node (litegraph hardcodes #FFF →
    // invisible on light paper; vendor patched to honor this global).
    LiteGraph.LINK_HIGHLIGHT_COLOR = cssVar("--link-highlight", "#ffffff");
    // these two are snapshotted onto the canvas instance at construction:
    lgcanvas.node_title_color = LiteGraph.NODE_TITLE_COLOR;
    lgcanvas.default_link_color = LiteGraph.LINK_COLOR;
    // Edges get a hardcoded rgba(0,0,0,0.5) halo (litegraph) — good contrast on
    // dark paper, but a heavy black outline on light paper. Keep it dark-only;
    // on light the themed link color carries the edge on its own.
    lgcanvas.render_connections_border = document.documentElement.dataset.theme !== "light";
  }

  // Recolor the whole graph surface (paper + nodes) for the active theme.
  function themeGraph() {
    themeCanvas();
    themeNodes();
    graph.setDirtyCanvas(true, true);
  }

  // --- theme toggle (persisted; light is default) --------------------------
  // Declared up here so applyTheme() (called before the menu is built) can sync
  // the "Dark Theme" checkmark via the guard once the menu exists.
  let menuBar = null;
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    if (menuBar) {
      menuBar.setContext("isDark", theme === "dark");
      menuBar.setContext("isLight", theme !== "dark");
      menuBar.refresh();
    }
    themeGraph(); // recolor the graph paper + the nodes drawn on it
  }
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next);
    scheduleSave();
  }
  applyTheme("light"); // default; the chosen theme persists as workspace metadata (Save), not localStorage

  // --- menu bar (replaces the old toolbar buttons) -------------------------
  function clearCanvas() {
    graph.clear();
    for (const k in inspectState) delete inspectState[k];
    setProjectName("Untitled Project");
    inspectOut.textContent = "Canvas cleared. Drag blocks from the toolbox.";
  }
  function showAbout() {
    const id = "patron-about-overlay";
    const existing = document.getElementById(id);
    if (existing) { existing.remove(); return; }
    const overlay = document.createElement("div");
    overlay.id = id;
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(0,0,0,0.45)";
    const card = document.createElement("div");
    card.style.cssText =
      "max-width:420px;background:var(--panel);color:var(--text);border:1px solid var(--panel-border);" +
      "border-radius:10px;padding:22px 26px;box-shadow:0 8px 32px rgba(0,0,0,0.4);font-family:inherit";
    card.innerHTML =
      "<h2 style='margin:0 0 8px'>Patron</h2>" +
      "<p style='margin:0 0 6px;color:var(--muted)'>Visual authoring front-end for agents.</p>" +
      "<p style='margin:0;font-size:13px'>Compose a node graph, compile it to the runtime DSL, " +
      "and deploy to agent_runtime.</p>";
    overlay.appendChild(card);
    overlay.addEventListener("click", () => overlay.remove());
    const onKey = (e) => { if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onKey); } };
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
  }

  menuBar = new MenuBar("#menubar");
  menuBar.setContext("isDark", document.documentElement.dataset.theme === "dark");
  menuBar.setContext("isLight", document.documentElement.dataset.theme !== "dark");
  menuBar.setContext("toolboxVisible", true);
  menuBar.setContext("zoomVisible", true);
  menuBar.setContext("outputVisible", false);
  menuBar.model = global.PATRON_MENU;
  menuBar.render();

  // --- Projects (Phase 01): named compositions via /api/projects ---------------
  const PROJ_API = "api/projects";
  let currentProject = { uid: null, name: "Untitled Project", description: "", version: 0 };
  function setCurrentProject(p) {
    currentProject = { uid: p.uid, name: p.name, description: p.description || "", version: p.version || 0 };
    setProjectName(p.name);
  }
  function projDoc(overrides) {
    const ws = collectWorkspace();
    return Object.assign({
      uid: currentProject.uid, name: currentProject.name,
      description: currentProject.description, version: currentProject.version || 0,
      graph: ws.graph, ui: ws.ui,
    }, overrides || {});
  }
  async function projectSaveAs() {
    const name = (prompt("Save project as:", currentProject.name || "Untitled Project") || "").trim();
    if (!name) return;
    const res = await fetch(PROJ_API, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(projDoc({ uid: null, name: name, version: 0 })) });
    const p = await res.json(); setCurrentProject(p);
    showOutput(); inspectOut.textContent = 'Saved as "' + p.name + '".';
  }
  async function projectSave() {
    if (!currentProject.uid) return projectSaveAs();
    const res = await fetch(PROJ_API + "/" + currentProject.uid, { method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(projDoc({ version: (currentProject.version || 0) + 1 })) });
    const p = await res.json(); currentProject.version = p.version;
    showOutput(); inspectOut.textContent = 'Saved "' + p.name + '" (v' + p.version + ').';
  }
  async function projectNew() {
    clearCanvas();
    const res = await fetch(PROJ_API, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Untitled Project", graph: graph.serialize(), ui: {} }) });
    const p = await res.json(); setCurrentProject(p);
    inspectOut.textContent = 'New project "' + p.name + '".';
  }
  function applyProject(p) {
    applyWorkspace({ graph: p.graph, ui: p.ui });
    setCurrentProject(p);
    graph.setDirtyCanvas(true, true);
  }
  let projOpenPanel = null;
  async function projectOpen() {
    const list = (((await (await fetch(PROJ_API)).json()) || {}).projects) || [];
    if (projOpenPanel) { try { projOpenPanel.close(); } catch (e) {} projOpenPanel = null; }
    const rows = list.length
      ? list.map(function (p) {
          return '<div class="proj-row" data-uid="' + p.uid + '" style="padding:7px 10px;border-radius:6px;cursor:pointer;display:flex;justify-content:space-between;gap:12px">' +
                 '<span>' + (p.name || "(unnamed)") + '</span><span style="opacity:.5;font-size:11px">v' + (p.version || 0) + '</span></div>';
        }).join("")
      : '<div style="padding:10px;opacity:.6">No saved projects yet.</div>';
    projOpenPanel = jsPanel.create({
      headerTitle: '<span class="pttxt">Open Project</span>', theme: "none",
      borderRadius: "8px", border: "1px solid var(--panel-border)",
      panelSize: { width: 320, height: Math.min(440, 96 + list.length * 38) },
      position: { my: "center", at: "center" },
      headerControls: { size: "xs", minimize: "remove", smallify: "remove", normalize: "remove", maximize: "remove" },
      content: '<div style="padding:6px">' + rows + '</div>',
      callback: function (panel) {
        panel.content.querySelectorAll(".proj-row").forEach(function (r) {
          r.addEventListener("mouseenter", function () { r.style.background = "var(--bg,#f0f3f7)"; });
          r.addEventListener("mouseleave", function () { r.style.background = "transparent"; });
          r.addEventListener("click", async function () {
            const pr = await (await fetch(PROJ_API + "/" + r.getAttribute("data-uid"))).json();
            applyProject(pr);
            try { panel.close(); } catch (e) {} projOpenPanel = null;
          });
        });
      },
    });
  }
  async function projectRename() {
    const name = (prompt("Rename project:", currentProject.name) || "").trim();
    if (!name) return;
    currentProject.name = name; setProjectName(name);
    if (currentProject.uid) await projectSave();
  }
  function projectSettings() {
    const desc = prompt("Project settings\n\nName: " + currentProject.name +
      "\nUID: " + (currentProject.uid || "(unsaved)") + "\nVersion: " + (currentProject.version || 0) +
      "\n\nEdit the description:", currentProject.description || "");
    if (desc === null) return;
    currentProject.description = desc;
    if (currentProject.uid) projectSave();
  }
  async function projectDelete() {
    if (!currentProject.uid) { showOutput(); inspectOut.textContent = "This project isn't saved yet."; return; }
    // §9.4: deleting a Project undeploys it, then checks cross-project asset usage. Warn
    // (and require a second confirm) before removing assets other Projects still reference.
    const shared = await sharedAssetsForCurrentProject();
    let warn = 'Delete project "' + currentProject.name + '"?\n\nThis undeploys the live record and removes the project.';
    if (shared.length) {
      warn += "\n\n⚠️ This project uses " + shared.length + " asset(s) also used by OTHER projects:\n" +
        shared.map(function (s) {
          return "  • " + s.asset_id + " — also in: " + s.used_by.map(function (u) { return u.name; }).join(", ");
        }).join("\n") +
        "\n\nDeleting the project keeps those shared assets intact (they are reusable).";
    }
    if (!confirm(warn)) return;
    await undeployProject({ silent: true }); // remove the live record + firing binding first
    await fetch(PROJ_API + "/" + currentProject.uid, { method: "DELETE" });
    projectNew();
  }

  // §9.4 cross-project asset-usage: which assets THIS project binds that OTHER projects
  // also reference. Drives the shared-asset delete warning. Returns
  // [{asset_id, used_by:[{uid,name}]}].
  async function collectProjectAssetIds() {
    const ids = new Set();
    const KEYS = ["persona", "target", "schedule_id", "agent_id", "preset", "rag_id"];
    (graph.serialize().nodes || []).forEach(function (n) {
      const props = n.properties || {};
      KEYS.forEach(function (k) {
        const v = props[k];
        if (typeof v === "string" && v.trim()) ids.add(v.trim());
      });
    });
    return Array.from(ids);
  }
  async function sharedAssetsForCurrentProject() {
    if (!currentProject.uid) return [];
    const ids = await collectProjectAssetIds();
    const out = [];
    for (const aid of ids) {
      try {
        const r = await fetch("api/asset-usage/" + encodeURIComponent(aid) + "?exclude=" + currentProject.uid);
        const j = await r.json().catch(function () { return {}; });
        if (j.shared && (j.used_by || []).length) out.push(j);
      } catch (e) { /* server down → skip the check (delete still proceeds after confirm) */ }
    }
    return out;
  }

  // Expose the current Project + a save-if-needed helper so the deploy lifecycle
  // (defined earlier) can reach the project closure state.
  window.PatronProjects = {
    current: function () { return currentProject; },
    ensureSaved: async function () {
      if (!currentProject.uid) await projectSaveAs();
      return currentProject;
    },
  };

  // Insert a block at the current view center (Insert menu / edge menu share the idea).
  function insertBlock(type) {
    const ds = lgcanvas.ds;
    const rect = (lgcanvas.canvas || canvasEl).getBoundingClientRect();
    const gx = (rect.width / 2) / ds.scale - ds.offset[0];
    const gy = (rect.height / 2) / ds.scale - ds.offset[1];
    const n = spawnNode(type, [gx - 90, gy - 30]);
    if (n) { if (lgcanvas.selectNode) lgcanvas.selectNode(n); lgcanvas.setDirty(true, true); }
  }
  // Planned-but-unimplemented menu items: announce, never crash.
  function stub(id) {
    const m = id + " — planned (not implemented yet).";
    if (inspectOut) inspectOut.textContent = m;
    console.log("[Patron] " + m);
  }

  // --- Project ---
  menuBar.registerCommand("project.new", projectNew);
  menuBar.registerCommand("project.open", projectOpen);
  menuBar.registerCommand("project.save", projectSave);
  menuBar.registerCommand("project.saveAs", projectSaveAs);
  menuBar.registerCommand("project.rename", projectRename);
  menuBar.registerCommand("project.settings", projectSettings);
  menuBar.registerCommand("project.delete", projectDelete);
  // --- Edit ---
  menuBar.registerCommand("edit.clear", clearCanvas);
  menuBar.registerCommand("edit.delete", () => { if (lgcanvas.deleteSelectedNodes) lgcanvas.deleteSelectedNodes(); lgcanvas.setDirty(true, true); scheduleSave(); });
  menuBar.registerCommand("edit.selectAll", () => { if (lgcanvas.selectNodes) lgcanvas.selectNodes(graph._nodes); lgcanvas.setDirty(true, true); });
  menuBar.registerCommand("edit.copy", () => { if (lgcanvas.copyToClipboard) lgcanvas.copyToClipboard(); });
  menuBar.registerCommand("edit.paste", () => { if (lgcanvas.pasteFromClipboard) lgcanvas.pasteFromClipboard(); scheduleSave(); });
  menuBar.registerCommand("edit.cut", () => { if (lgcanvas.copyToClipboard) lgcanvas.copyToClipboard(); if (lgcanvas.deleteSelectedNodes) lgcanvas.deleteSelectedNodes(); scheduleSave(); });
  menuBar.registerCommand("edit.duplicate", () => { if (lgcanvas.copyToClipboard) { lgcanvas.copyToClipboard(); lgcanvas.pasteFromClipboard(); scheduleSave(); } });
  // --- Insert (one command per block type → drops at view center) ---
  ["trigger", "file_initiator", "web_initiator", "stt_initiator", "agent", "rag", "guardrail",
   "transform", "composite", "whatsapp", "tts", "bus", "file_destination", "web_destination"]
    .forEach((t) => menuBar.registerCommand("insert." + t, () => insertBlock(t)));
  // --- Build ---
  // Phase 05: Deploy/Undeploy now operate on the whole PROJECT (1:1 → one runtime graph
  // record, §9.3), replacing the old single-agent deployToRuntime (kept for reference).
  menuBar.registerCommand("build.deploy", deployProject);
  menuBar.registerCommand("build.undeploy", undeployProject);
  menuBar.registerCommand("build.deleteDeployment", projectDelete);
  menuBar.registerCommand("build.compile", compileToDsl);
  // --- View ---
  menuBar.registerCommand("view.toolbox", toggleToolbox);
  menuBar.registerCommand("view.zoom", toggleZoomControl);
  menuBar.registerCommand("view.output", toggleOutput);
  menuBar.registerCommand("theme.dark", () => { applyTheme("dark"); scheduleSave(); });
  menuBar.registerCommand("theme.white", () => { applyTheme("light"); scheduleSave(); });
  menuBar.registerCommand("view.zoomIn", () => setZoom((lgcanvas.ds.scale || 1) * 1.1));
  menuBar.registerCommand("view.zoomOut", () => setZoom((lgcanvas.ds.scale || 1) / 1.1));
  menuBar.registerCommand("view.resetZoom", () => setZoom(1));
  // --- Help ---
  menuBar.registerCommand("help.about", showAbout);
  // --- Planned (stubs — announce, don't crash) ---
  ["project.import", "project.export",
   "edit.undo", "edit.redo",
   "build.validate", "build.status",
   "view.fit", "help.docs", "help.shortcuts"]
    .forEach((id) => menuBar.registerCommand(id, () => stub(id)));

  // jsPanel's default close icon is a heavy FILLED "✕"; swap it for a thin stroked X so it
  // reads lighter. Set globally before any panel is created (covers all panels).
  if (typeof jsPanel !== "undefined" && jsPanel.icons) {
    jsPanel.icons.close =
      '<svg focusable="false" class="jsPanel-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21">' +
      '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="m7.5 7.5l6 6m0-6l-6 6"></path></svg>';
  }

  // Colored file icon (icons/*.svg) for a panel header.
  const panelImg = (src, size) =>
    '<img src="' + src + '" width="' + (size || 16) + '" height="' + (size || 16) +
    '" style="vertical-align:middle;margin-left:3px;margin-right:7px;position:relative;top:-1px" alt="">';

  // --- floating Toolbox (jsPanel): the LEGO blocks --------------------------
  let toolboxPanel = null;
  function createToolbox() {
    if (typeof jsPanel === "undefined") {
      buildPalette(document.getElementById("palette")); // sidebar fallback
      return;
    }
    toolboxPanel = jsPanel.create({
      headerTitle: panelImg("icons/tool-box.svg", 20) + '<span class="pttxt">Toolbox</span>',
      theme: "none",
      borderRadius: "8px", /* match the litegraph node corner radius (round_radius = 8) */
      border: "1px solid var(--panel-border)",
      panelSize: { width: 252, height: 500 },
      position: { my: "left-top", at: "left-top", offsetX: 14, offsetY: 58 },
      boxShadow: 3,
      headerControls: { size: "xs", minimize: "remove", smallify: "remove", normalize: "remove", maximize: "remove" },
      addCloseControl: 0,
      callback: (p) => {
        p.content.style.cssText = "padding:10px;overflow-y:auto;background:var(--panel);color:var(--text)";
        const host = document.createElement("div");
        host.id = "palette";
        p.content.appendChild(host);
        buildPalette(host);
      },
    });
  }

  // --- floating Output panel (jsPanel): compile DSL / status / inspector ----
  let outputPanel = null;
  function createOutputPanel() {
    if (typeof jsPanel === "undefined") {
      // fallback: pin the <pre> to the corner so output is still visible
      inspectOut.style.cssText =
        "position:fixed;right:10px;top:54px;width:340px;max-height:70vh;overflow:auto;z-index:9;display:none;" +
        "background:var(--panel);border:1px solid var(--panel-border);border-radius:6px;padding:10px";
      document.body.appendChild(inspectOut);
      return;
    }
    outputPanel = jsPanel.create({
      headerTitle: panelImg("icons/json.svg") + '<span class="pttxt">Output</span>',
      theme: "none",
      borderRadius: "8px", /* match the litegraph node corner radius (round_radius = 8) */
      border: "1px solid var(--panel-border)",
      panelSize: { width: 360, height: 460 },
      position: { my: "right-top", at: "right-top", offsetX: -14, offsetY: 58 },
      boxShadow: 3,
      headerControls: { size: "xs", minimize: "remove", smallify: "remove", normalize: "remove", maximize: "remove" },
      addCloseControl: 0,
      callback: (p) => {
        p.content.style.cssText = "padding:10px;overflow:auto;background:var(--panel);color:var(--text)";
        p.content.appendChild(inspectOut);
      },
    });
    outputPanel.style.display = "none"; // hidden by default — opened via 📄 Output / Compile
  }
  // The Output panel is a DOM node (jsPanel) — toggle by display; show on demand.
  function outputEl() { return outputPanel || inspectOut; }
  function syncOutputMenu(visible) {
    if (menuBar) { menuBar.setContext("outputVisible", visible); menuBar.refresh(); }
  }
  function showOutput() {
    outputEl().style.display = "";
    if (outputPanel) outputPanel.front && outputPanel.front();
    syncOutputMenu(true);
  }
  function toggleOutput() {
    const el = outputEl();
    el.style.display = el.style.display === "none" ? "" : "none";
    syncOutputMenu(el.style.display !== "none");
  }
  // Toolbox toggle (mirrors Output) — the jsPanel, or the #palette sidebar fallback.
  function toolboxEl() { return toolboxPanel || document.getElementById("palette"); }
  function toggleToolbox() {
    const el = toolboxEl();
    if (!el) return;
    el.style.display = el.style.display === "none" ? "" : "none";
    if (menuBar) { menuBar.setContext("toolboxVisible", el.style.display !== "none"); menuBar.refresh(); }
  }

  // --- boot -----------------------------------------------------------------
  createToolbox();
  createOutputPanel();
  resizeCanvas();

  // Auto-persistence (server-side): load the saved workspace on start and save
  // automatically as things change — so the explicit 💾 Save is optional. The
  // `appReady` guard keeps the initial load from triggering a save over itself.
  let appReady = false;
  let saveTimer = 0;
  function scheduleSave() {
    if (!appReady) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWorkspace({ silent: true }), 700);
  }
  lgcanvas.onNodeMoved = scheduleSave;                 // dragging a node
  document.addEventListener("pointerup", scheduleSave); // end of a panel drag/resize, link, etc.
  // Capture the very latest state right before a reload/close (keepalive lets the
  // request finish during unload) — so a hard refresh keeps your positions.
  global.addEventListener("beforeunload", () => {
    try {
      fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectWorkspace()),
        keepalive: true,
      });
    } catch (e) { /* ignore */ }
  });

  (async function boot() {
    let loaded = false;
    try {
      const res = await fetch(API, { cache: "no-store" });
      const ws = await res.json().catch(() => ({}));
      if (ws && ws.graph) { applyWorkspace(ws); loaded = true; }
    } catch (e) { /* no server → start fresh */ }
    // First run (no saved workspace): boot the runtime-aligned News Agent.
    if (!loaded) loadNewsAgent();
    graph.setDirtyCanvas(true, true);
    appReady = true;
  })();

  // Expose for console tinkering + the Properties panel (js/props-panel.js).
  global.PatronApp.graph = graph;
  global.PatronApp.canvas = lgcanvas;
  global.PatronApp.scheduleSave = scheduleSave;
  global.PatronApp.menuBar = menuBar;
})(window);
