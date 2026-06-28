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
  const lgcanvas = new LGraphCanvas(canvasEl, graph);

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
      label.textContent = grp.group;
      g.appendChild(label);

      grp.items.forEach((it) => {
        const el = document.createElement("div");
        el.className = "palette-item";
        el.draggable = true;
        el.style.borderLeftColor = grp.color;
        el.dataset.type = it.type;
        el.innerHTML =
          '<span class="swatch" style="background:' + grp.color + '"></span>' + it.label;
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
  function loadNewsAgent() {
    graph.clear();
    for (const k in inspectState) delete inspectState[k];
    const trig = spawnNode("patron/agent/trigger", [40, 200]);
    const tools = spawnNode("patron/agent/tools", [40, 360]);
    const brain = spawnNode("patron/agent/brain", [340, 210]);
    const deliv = spawnNode("patron/agent/deliver", [640, 240]);
    const wa = spawnNode("patron/dest/whatsapp", [860, 240]);
    trig.connect(0, brain, 0);   // task   -> brain.in
    tools.connect(0, brain, 1);  // tools  -> brain.tools
    brain.connect(0, deliv, 0);  // result -> deliver
    deliv.connect(0, wa, 0);     // deliver -> WhatsApp destination
    graph.setDirtyCanvas(true, true);
    inspectOut.textContent = "News Agent loaded (Trigger → Brain(+Tools) → Deliver → WhatsApp). Press ⚙ Compile → DSL.";
  }

  // Lower the current graph to the (draft) runtime DSL and show it.
  function compileToDsl() {
    const out = global.PatronCompile.compile(graph.serialize());
    if (out.ok) {
      inspectOut.textContent =
        "// runtime DSL (draft — provisional until agent_runtime hardens it)\n" +
        JSON.stringify(out.dsl, null, 2);
    } else {
      inspectOut.textContent = "// compile errors:\n- " + out.errors.join("\n- ");
    }
    showOutput(); // always surface the result
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
        panels: { toolbox: panelRect(toolboxPanel), output: panelRect(outputPanel) },
      },
    };
  }
  function applyWorkspace(ws) {
    graph.clear();
    graph.configure(ws.graph || {});
    const ui = ws.ui || {};
    if (ui.theme) applyTheme(ui.theme);
    if (ui.view) {
      if (Array.isArray(ui.view.offset)) lgcanvas.ds.offset = ui.view.offset.slice();
      if (ui.view.scale) lgcanvas.ds.scale = ui.view.scale;
    }
    const panels = ui.panels || {};
    applyPanelRect(toolboxPanel, panels.toolbox);
    applyPanelRect(outputPanel, panels.output);
    graph.setDirtyCanvas(true, true);
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
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    // button shows the theme it switches TO
    document.getElementById("btn-theme").textContent = theme === "light" ? "🌙 dark" : "☀ light";
    themeGraph(); // recolor the graph paper + the nodes drawn on it
  }
  applyTheme("light"); // default; the chosen theme persists as workspace metadata (Save), not localStorage
  document.getElementById("btn-theme").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next);
    scheduleSave();
  });

  // --- controls -------------------------------------------------------------
  document.getElementById("btn-news").addEventListener("click", loadNewsAgent);
  document.getElementById("btn-compile").addEventListener("click", compileToDsl);
  document.getElementById("btn-save").addEventListener("click", saveWorkspace);
  document.getElementById("btn-load").addEventListener("click", loadWorkspace);
  document.getElementById("btn-run").addEventListener("click", runOnce);
  document.getElementById("btn-reset").addEventListener("click", () => {
    loadDemo();
    runOnce();
  });
  document.getElementById("btn-clear").addEventListener("click", () => {
    graph.clear();
    for (const k in inspectState) delete inspectState[k];
    inspectOut.textContent = "Canvas cleared. Drag blocks from the toolbox.";
  });

  // --- floating Toolbox (jsPanel): the LEGO blocks --------------------------
  let toolboxPanel = null;
  function createToolbox() {
    if (typeof jsPanel === "undefined") {
      buildPalette(document.getElementById("palette")); // sidebar fallback
      return;
    }
    toolboxPanel = jsPanel.create({
      headerTitle: "🧱 Toolbox",
      theme: "none",
      borderRadius: "6px",
      border: "1px solid var(--panel-border)",
      panelSize: { width: 252, height: 500 },
      position: { my: "left-top", at: "left-top", offsetX: 14, offsetY: 58 },
      boxShadow: 3,
      headerControls: { minimize: "remove", smallify: "remove", normalize: "remove", maximize: "remove" },
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
      headerTitle: "📄 Output",
      theme: "none",
      borderRadius: "6px",
      border: "1px solid var(--panel-border)",
      panelSize: { width: 360, height: 460 },
      position: { my: "right-top", at: "right-top", offsetX: -14, offsetY: 58 },
      boxShadow: 3,
      headerControls: { minimize: "remove", smallify: "remove", normalize: "remove", maximize: "remove" },
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
  function showOutput() { outputEl().style.display = ""; if (outputPanel) outputPanel.front && outputPanel.front(); }
  function toggleOutput() {
    const el = outputEl();
    el.style.display = el.style.display === "none" ? "" : "none";
  }

  // --- boot -----------------------------------------------------------------
  createToolbox();
  createOutputPanel();
  document.getElementById("btn-output").addEventListener("click", toggleOutput);
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

  // Expose for console tinkering.
  global.PatronApp.graph = graph;
  global.PatronApp.canvas = lgcanvas;
})(window);
