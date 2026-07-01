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

  // Register both node sets: the runtime-aligned agent vocabulary (the real
  // authoring target) and the GoF demo nodes (conceptual inspiration).
  global.PatronAgentNodes.register(LiteGraph);
  global.PatronPatterns.register(LiteGraph);
  const COLORS = global.PatronPatterns.CATEGORY_COLORS;

  // Palette definition: display metadata for the toolbox. Agent vocabulary first.
  const PALETTE = [
    global.PatronAgentNodes.PALETTE,
    global.PatronAgentNodes.DESTINATIONS,
    { group: "GoF demo · Utility", color: COLORS.Utility, items: [
      { type: "patron/task_source", label: "Task Source" },
      { type: "patron/inspector", label: "Inspector" },
    ]},
    { group: "GoF demo · Creational", color: COLORS.Creational, items: [
      { type: "patron/builder", label: "Builder Agent" },
      { type: "patron/factory", label: "Factory Agent" },
    ]},
    { group: "GoF demo · Structural", color: COLORS.Structural, items: [
      { type: "patron/proxy", label: "Proxy Agent" },
    ]},
    { group: "GoF demo · Behavioral", color: COLORS.Behavioral, items: [
      { type: "patron/chain_of_responsibility", label: "Chain of Responsibility" },
    ]},
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
  // Hide litegraph's bottom-left debug overlay (T/I/N/V/FPS counters) — dev noise here.
  lgcanvas.show_info = false;
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
      // Drop the "GoF demo ·" prefix; all section titles are UPPERCASE.
      label.textContent = grp.group.replace(/^GoF demo\s*[·-]\s*/, "").toUpperCase();
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

  // Set both the property and its widget so the change is visible on the node.
  function setWidget(node, name, value) {
    node.properties[name] = value;
    const w = (node.widgets || []).find((w) => w.name === name);
    if (w) w.value = value;
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

  // --- demo composition (data spec §4) -------------------------------------
  function loadDemo() {
    graph.clear();
    for (const k in inspectState) delete inspectState[k];
    inspectOut.textContent = "Run the graph to see data flow…";

    const source = spawnNode("patron/task_source", [40, 200]);
    // Curate the demo for a clean first impression: "high" complexity routes
    // cloud → high confidence → resolves → approved, lighting the full main
    // pipeline. Lower it to low/medium to watch the Chain escalate instead.
    setWidget(source, "complexity", "high");
    const builder = spawnNode("patron/builder", [340, 90]);
    const factory = spawnNode("patron/factory", [340, 320]);
    const chain = spawnNode("patron/chain_of_responsibility", [660, 200]);
    const proxy = spawnNode("patron/proxy", [980, 150]);
    const okSink = spawnNode("patron/inspector", [1260, 60]);
    const rejectSink = spawnNode("patron/inspector", [1260, 260]);
    const escSink = spawnNode("patron/inspector", [980, 360]);

    // task → builder.task ; task → factory.task
    source.connect(0, builder, 0);
    source.connect(0, factory, 0);
    // builder.context → chain.context ; factory.agentref → chain.agentref
    builder.connect(0, chain, 0);
    factory.connect(0, chain, 1);
    // chain.resolved → proxy.result ; chain.escalated → escSink
    chain.connect(0, proxy, 0);
    chain.connect(1, escSink, 0);
    // proxy.approved → okSink ; proxy.rejected → rejectSink
    proxy.connect(0, okSink, 0);
    proxy.connect(1, rejectSink, 0);

    graph.setDirtyCanvas(true, true);
  }

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
        theme: document.documentElement.dataset.theme,
        view: { offset: lgcanvas.ds.offset.slice(), scale: lgcanvas.ds.scale },
        panels: {
          toolbox: panelRect(toolboxPanel),
          output: panelRect(outputPanel),
          props: panelRect(window.PatronProps && window.PatronProps.panel ? window.PatronProps.panel() : null),
        },
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
    if (ui.theme) applyTheme(ui.theme);
    if (ui.view) {
      if (Array.isArray(ui.view.offset)) lgcanvas.ds.offset = ui.view.offset.slice();
      if (ui.view.scale) lgcanvas.ds.scale = ui.view.scale;
    }
    const panels = ui.panels || {};
    applyPanelRect(toolboxPanel, panels.toolbox);
    applyPanelRect(outputPanel, panels.output);
    // Properties panel is created lazily by props-panel.js — stash its saved rect so it can
    // position itself from it (and apply now if it already exists).
    if (window.PatronApp) window.PatronApp.propsRect = panels.props || null;
    const propsEl = window.PatronProps && window.PatronProps.panel ? window.PatronProps.panel() : null;
    if (propsEl) applyPanelRect(propsEl, panels.props);
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
  menuBar.registerCommand("file.clear", clearCanvas);
  menuBar.registerCommand("file.news", loadNewsAgent);
  menuBar.registerCommand("file.demo", () => { loadDemo(); runOnce(); });
  menuBar.registerCommand("file.save", () => saveWorkspace());
  menuBar.registerCommand("file.load", loadWorkspace);
  menuBar.registerCommand("build.run", runOnce);
  menuBar.registerCommand("build.compile", compileToDsl);
  menuBar.registerCommand("build.deploy", deployToRuntime);
  menuBar.registerCommand("view.toolbox", toggleToolbox);
  menuBar.registerCommand("view.zoom", toggleZoomControl);
  menuBar.registerCommand("view.output", toggleOutput);
  menuBar.registerCommand("view.theme", toggleTheme);
  menuBar.registerCommand("help.about", showAbout);

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
    '" style="vertical-align:middle;margin-right:7px;position:relative;top:-1px" alt="">';

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
