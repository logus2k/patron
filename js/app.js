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

  // ===== Canvas controls: a floating pill (bottom-center) with zoom / fit / center /
  // arrange / find + a pin. All view math rides lgcanvas.ds (screen = (graphPos+offset)*scale).
  // Three modes via the View menu: hidden / auto-hide-when-idle / pinned (always on). =====
  function canvasRect() { return (lgcanvas.canvas || canvasEl).getBoundingClientRect(); }
  const titleH = () => (typeof LiteGraph !== "undefined" && LiteGraph.NODE_TITLE_HEIGHT) || 24;

  function setZoom(target) {
    const ds = lgcanvas.ds; if (!ds) return;
    const rect = canvasRect();
    ds.changeScale(target, [rect.width / 2, rect.height / 2]); // clamps to [min,max] internally
    lgcanvas.setDirty(true, true); scheduleSave();
  }
  // Union bounding box (graph coords, incl. title bar) of a node list, or null if empty.
  function nodesBBox(nodes) {
    if (!nodes || !nodes.length) return null;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    const b = new Float32Array(4);
    for (const n of nodes) {
      if (n.getBounding) n.getBounding(b);
      else { b[0] = n.pos[0]; b[1] = n.pos[1] - titleH(); b[2] = n.size[0]; b[3] = n.size[1] + titleH(); }
      minx = Math.min(minx, b[0]); miny = Math.min(miny, b[1]);
      maxx = Math.max(maxx, b[0] + b[2]); maxy = Math.max(maxy, b[1] + b[3]);
    }
    return [minx, miny, maxx - minx, maxy - miny];
  }
  // Place graph point (cx,cy) at the viewport center at `scale` (clamped).
  function applyView(scale, cx, cy) {
    const ds = lgcanvas.ds, rect = canvasRect();
    scale = Math.max(ds.min_scale || 0.1, Math.min(ds.max_scale || 10, scale));
    ds.scale = scale;
    ds.offset[0] = rect.width / (2 * scale) - cx;
    ds.offset[1] = rect.height / (2 * scale) - cy;
    lgcanvas.setDirty(true, true); scheduleSave();
  }
  function fitTo(nodes, padding) {
    const bb = nodesBBox(nodes); if (!bb || !bb[2] || !bb[3]) return;
    const rect = canvasRect();
    // Cap the fit zoom at 2× so fitting a single small node doesn't slam to max zoom.
    const scale = Math.min(2, Math.min(rect.width / bb[2], rect.height / bb[3]) * (padding || 0.88));
    applyView(scale, bb[0] + bb[2] / 2, bb[1] + bb[3] / 2);
  }
  function fitView() { fitTo(graph._nodes); }                         // best fit (all nodes)
  function centerView() {                                             // recenter, keep zoom
    const bb = nodesBBox(graph._nodes); if (!bb) return;
    applyView(lgcanvas.ds.scale, bb[0] + bb[2] / 2, bb[1] + bb[3] / 2);
  }
  function selectedNodes() {
    const sel = lgcanvas.selected_nodes || {};
    return Object.keys(sel).map((k) => sel[k]).filter(Boolean);
  }
  function fitSelection() { const s = selectedNodes(); fitTo(s.length ? s : graph._nodes); }
  function centerOnNode(node) {
    if (!node) return;
    const b = new Float32Array(4); node.getBounding(b);
    applyView(lgcanvas.ds.scale, b[0] + b[2] / 2, b[1] + b[3] / 2);
    if (lgcanvas.selectNodes) lgcanvas.selectNodes([node]);
  }
  function arrangeGraph() {
    if (graph.arrange) graph.arrange();
    lgcanvas.setDirty(true, true); fitView(); scheduleSave();
  }
  // ---- inline SVG icons (currentColor → theme-aware) ---------------------------
  const svg = (inner) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  const ICONS = {
    minus: svg('<path d="M5 12h14"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    reset: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
    fit: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    center: svg('<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="3.2"/>'),
    fitsel: svg('<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3.5 3"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>'),
    arrange: svg('<rect x="4" y="4" width="7" height="7" rx="1.3"/><rect x="13" y="4" width="7" height="7" rx="1.3"/><rect x="4" y="13" width="7" height="7" rx="1.3"/><rect x="13" y="13" width="7" height="7" rx="1.3"/>'),
    find: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/>'),
    pin: svg('<path d="M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10z"/><circle cx="12" cy="11" r="2.2"/>'),
  };
  function iconBtn(name, title, onClick) {
    const b = document.createElement("button");
    b.className = "cc-btn"; b.title = title; b.type = "button"; b.innerHTML = ICONS[name];
    b.addEventListener("click", (e) => { e.preventDefault(); onClick(); });
    return b;
  }
  const ccSep = () => { const s = document.createElement("span"); s.className = "cc-sep"; return s; };

  // ---- the bar ----------------------------------------------------------------
  const ccBar = document.createElement("div");
  ccBar.id = "canvas-controls";
  const zVal = document.createElement("input");
  zVal.id = "cc-value"; zVal.type = "text"; zVal.spellcheck = false; zVal.title = "Zoom — type a % and press Enter";
  const pinBtn = iconBtn("pin", "Pin (keep visible)", () => setPinned(!controlsPinned));
  ccBar.append(
    iconBtn("minus", "Zoom out", () => setZoom(lgcanvas.ds.scale / 1.1)),
    zVal,
    iconBtn("plus", "Zoom in", () => setZoom(lgcanvas.ds.scale * 1.1)),
    ccSep(),
    iconBtn("reset", "Reset zoom to 100%", () => setZoom(1)),
    iconBtn("fit", "Best fit (fit all to screen)", fitView),
    iconBtn("center", "Center diagram", centerView),
    iconBtn("fitsel", "Fit to selection", fitSelection),
    ccSep(),
    iconBtn("arrange", "Auto-arrange", arrangeGraph),
    iconBtn("find", "Find node", openFind),
    ccSep(),
    pinBtn,
  );
  document.body.appendChild(ccBar);
  zVal.addEventListener("focus", () => zVal.select());
  zVal.addEventListener("keydown", (e) => { if (e.key === "Enter") zVal.blur(); });
  zVal.addEventListener("change", () => { const v = parseFloat(zVal.value); if (isFinite(v) && v > 0) setZoom(v / 100); });

  // ---- find-node popup --------------------------------------------------------
  let findBox = null;
  function openFind() {
    if (findBox) { findBox.focus(); findBox.select(); return; }
    findBox = document.createElement("input");
    findBox.id = "cc-find"; findBox.type = "text"; findBox.placeholder = "Find node…"; findBox.spellcheck = false;
    document.body.appendChild(findBox);
    const close = () => { if (findBox) { findBox.remove(); findBox = null; } };
    const jump = () => {
      const q = findBox.value.trim().toLowerCase(); if (!q) return;
      const hit = (graph._nodes || []).find((n) => {
        const p = n.properties || {};
        return [n.title, n.type, p.agent_id, p.persona, p.target].join(" ").toLowerCase().includes(q);
      });
      if (hit) centerOnNode(hit);
    };
    findBox.addEventListener("input", jump);
    findBox.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { jump(); close(); } else if (e.key === "Escape") close();
    });
    findBox.addEventListener("blur", () => setTimeout(close, 120));
    findBox.focus();
  }

  // ---- visibility: hidden / auto-hide-when-idle / pinned ----------------------
  let controlsVisible = true, controlsPinned = false, ccHover = false, ccHideTimer = null;
  function revealBar() {
    if (!controlsVisible) return;
    ccBar.classList.add("visible");
    if (controlsPinned) return;                        // pinned: never schedule a hide
    clearTimeout(ccHideTimer);
    ccHideTimer = setTimeout(() => {
      if (!ccHover && !controlsPinned) ccBar.classList.remove("visible");
    }, 2500);
  }
  function refreshControlsMode() {
    ccBar.style.display = controlsVisible ? "" : "none";
    ccBar.classList.toggle("pinned", controlsPinned);
    pinBtn.classList.toggle("active", controlsPinned);
    if (!controlsVisible) { clearTimeout(ccHideTimer); return; }
    if (controlsPinned) ccBar.classList.add("visible"); else revealBar();
  }
  function setPinned(v) {
    controlsPinned = v;
    refreshControlsMode(); scheduleSave();
  }
  function toggleControls() {
    controlsVisible = !controlsVisible;
    if (menuBar) { menuBar.setContext("controlsVisible", controlsVisible); if (menuBar.refresh) menuBar.refresh(); }
    refreshControlsMode(); scheduleSave();
  }
  ccBar.addEventListener("mouseenter", () => { ccHover = true; clearTimeout(ccHideTimer); });
  ccBar.addEventListener("mouseleave", () => { ccHover = false; revealBar(); });
  // Canvas mouse activity reveals the bar (when not pinned).
  (document.getElementById("canvas-wrap") || document)
    .addEventListener("mousemove", () => { if (controlsVisible && !controlsPinned) revealBar(); });
  refreshControlsMode();  // initial paint (default: visible + auto-hide); applyWorkspace corrects it

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
        // A palette item may be DISABLED (e.g. Transform/Workflow — kept visible so authors
        // know they're planned, but not yet runnable, so not droppable). Disabled items are
        // greyed, non-draggable, and inert on double-click — never silently dropped at deploy.
        el.className = "palette-item" + (it.disabled ? " disabled" : "");
        el.draggable = !it.disabled;
        el.style.borderLeftColor = grp.color;
        el.dataset.type = it.type;
        const ico = (window.PatronIcons && window.PatronIcons.has(it.type))
          ? '<span class="icon">' + window.PatronIcons.svgString(it.type, 20) + "</span>"
          : '<span class="swatch" style="background:' + grp.color + '"></span>';
        el.innerHTML = ico + it.label;
        if (it.disabled) {
          el.title = "Not yet available — coming soon";
        } else {
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
        }
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
        startConsoleReceive(); // the project's Console (Receive) blocks are live now
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
    refreshStatus(); // a deploy flips the badge → DEPLOYED (in sync) or surfaces the failure
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
      refreshStatus(); // undeploy flips the badge → NOT DEPLOYED
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
        // Persist the open project's IDENTITY (not just its display name) so a reload
        // restores currentProject.uid — otherwise Save can't tell it's an existing project
        // and falls back to Save As. uid null => an unsaved/closed project (correct).
        project: {
          uid: currentProject.uid, name: currentProject.name,
          description: currentProject.description, version: currentProject.version || 0,
        },
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
        // Canvas-controls state: 3 modes = visible × pinned.
        controlsVisible: controlsVisible,
        controlsPinned: controlsPinned,
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
    // Restore the project identity (uid/name/version) when the workspace carried a saved
    // project, so Save writes to it directly. Legacy workspaces (name only) fall back to
    // the display name. A persisted uid of null means "unsaved/closed" — leave the default.
    if (ui.project && ui.project.uid) {
      setCurrentProject(ui.project);
    } else {
      setProjectName(ui.projectName);
      // Legacy / identity-less workspace (name only): recover the saved project by its name
      // so Save targets it directly. Best-effort + async; projectSave also re-checks.
      if (ui.projectName && ui.projectName !== "Untitled Project") {
        findProjectByName(ui.projectName).then(function (p) {
          if (p && !currentProject.uid) setCurrentProject(p);
        });
      }
    }
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
    // Canvas-controls state (defaults: visible, unpinned). Back-compat: an old workspace
    // with only `zoomVisible` maps to controlsVisible.
    controlsVisible = ui.controlsVisible !== undefined ? !!ui.controlsVisible : (ui.zoomVisible !== false);
    controlsPinned = !!ui.controlsPinned;
    if (menuBar) menuBar.setContext("controlsVisible", controlsVisible);
    refreshControlsMode();
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
  // The empty starting state (first run + Close Project): a blank canvas titled
  // "Untitled Project", no example seeded. Kept message-free for the boot path.
  function startEmptyProject() {
    graph.clear();
    setProjectName("Untitled Project");
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
  menuBar.setContext("controlsVisible", true);
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
  // A project is "named" once it has a real title (not the blank default).
  function hasRealName() {
    const n = (currentProject.name || "").trim();
    return !!n && n !== "Untitled Project";
  }
  // Find a stored project by its display name (best-effort; used to recover a lost identity).
  async function findProjectByName(name) {
    if (!name) return null;
    try {
      const list = (((await (await fetch(PROJ_API)).json()) || {}).projects) || [];
      return list.find(function (p) { return (p.name || "") === name; }) || null;
    } catch (e) { return null; }
  }
  async function projectSaveAs() {
    const name = (await window.PatronDialogs.prompt({
      title: "Save Project As", label: "Project name",
      value: currentProject.name || "Untitled Project", okLabel: "Save",
    }) || "").trim();
    if (!name) return;
    const res = await fetch(PROJ_API, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(projDoc({ uid: null, name: name, version: 0 })) });
    const p = await res.json(); setCurrentProject(p);
    scheduleSave(); // flush the new identity into the workspace so a reload keeps it
    inspectOut.textContent = 'Saved as "' + p.name + '".';
  }
  async function projectSave() {
    // Recover a missing identity by name (legacy workspace / post-reload) so a NAMED
    // project saves without ever prompting — only a blank "Untitled Project" is asked.
    if (!currentProject.uid && hasRealName()) {
      const existing = await findProjectByName(currentProject.name);
      if (existing) setCurrentProject(existing);
    }
    if (!currentProject.uid) {
      if (!hasRealName()) return projectSaveAs();     // truly unnamed → ask once
      // Named but not yet a stored project → create it silently under that name.
      const res = await fetch(PROJ_API, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projDoc({ uid: null, name: currentProject.name, version: 0 })) });
      const p = await res.json(); setCurrentProject(p); scheduleSave();
      inspectOut.textContent = 'Saved "' + p.name + '".';
      return;
    }
    const res = await fetch(PROJ_API + "/" + currentProject.uid, { method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(projDoc({ version: (currentProject.version || 0) + 1 })) });
    const p = await res.json(); currentProject.version = p.version;
    scheduleSave(); // keep the workspace's persisted identity/version in sync
    inspectOut.textContent = 'Saved "' + p.name + '" (v' + p.version + ').';
  }
  function projectNew() {
    // A new project is an UNSAVED scratch — do NOT persist a "Untitled Project" record to
    // the store (that spawned orphan duplicates). The record is created only when the user
    // Saves (Save As, or Save on a real name). Only the workspace (current canvas) is saved.
    startEmptyProject();
    setCurrentProject({ uid: null, name: "Untitled Project", description: "", version: 0 });
    scheduleSave();
    inspectOut.textContent = "New project — unsaved. Save (or Save As) to store it.";
  }
  function applyProject(p) {
    applyWorkspace({ graph: p.graph, ui: p.ui });
    setCurrentProject(p);
    scheduleSave(); // persist the opened project as the current workspace identity
    startConsoleReceive(); // (re)open the live SSE for this project's Console (Receive) blocks
    graph.setDirtyCanvas(true, true);
  }
  // Close the current project → empty, unsaved "Untitled Project". Persists the now-empty
  // canvas to the workspace so the next boot also starts empty (no example is re-seeded).
  function projectClose() {
    if (consoleES) { try { consoleES.close(); } catch (e) {} consoleES = null; }
    startEmptyProject();
    setCurrentProject({ uid: null, name: "Untitled Project", description: "", version: 0 });
    scheduleSave();
    inspectOut.textContent = "Project closed. Empty canvas — drag blocks or open a project.";
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
    const name = (await window.PatronDialogs.prompt({
      title: "Rename Project", label: "Project name",
      value: currentProject.name, okLabel: "Rename",
    }) || "").trim();
    if (!name) return;
    currentProject.name = name; setProjectName(name);
    if (currentProject.uid) await projectSave();
  }
  async function projectSettings() {
    const desc = await window.PatronDialogs.prompt({
      title: "Project Settings",
      message: "Name: " + currentProject.name +
        "   ·   UID: " + (currentProject.uid || "(unsaved)") +
        "   ·   v" + (currentProject.version || 0),
      label: "Description", value: currentProject.description || "",
      multiline: true, okLabel: "Save",
    });
    if (desc === null) return;
    currentProject.description = desc;
    if (currentProject.uid) projectSave();
  }
  async function projectDelete() {
    if (!currentProject.uid) { inspectOut.textContent = "This project isn't saved yet."; return; }
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
    if (!(await window.PatronDialogs.confirm({
      title: "Delete Project", message: warn, okLabel: "Delete", danger: true,
    }))) return;
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

  // Console (Send): fire the DEPLOYED workflow with the block's typed `message` as the seed.
  // Called by the ConsoleSend block's Send button (js/agent_nodes.js). Requires the project
  // to be saved AND deployed — /fire targets the live GraphRecord by uid.
  window.PatronConsoleSend = async function (node) {
    if (!currentProject.uid) {
      await window.PatronDialogs.confirm({ title: "Console — Send",
        message: "Save and Deploy this project first.\nSend fires the deployed workflow.", okLabel: "OK" });
      return;
    }
    // Write the text to send (pre-filled with the block's current message), then fire. This
    // keeps typing inside the in-app dialog (Patron has no inline canvas editing).
    const cur = (node && node.properties && node.properties.message) ? String(node.properties.message) : "";
    const msg = await window.PatronDialogs.prompt({
      title: "Console — Send", label: "Message to send", value: cur,
      multiline: true, okLabel: "Send ▶" });
    if (msg === null) return;  // cancelled
    if (node && node.properties) {
      node.properties.message = msg;
      const w = (node.widgets || []).find(function (x) { return x.name === "message"; });
      if (w) w.value = msg;
      if (window.PatronFitNodeWidth) window.PatronFitNodeWidth(node);
      if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
    }
    try {
      const res = await fetch("api/projects/" + currentProject.uid + "/fire", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: msg }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) {
        showOutput(); inspectOut.textContent = 'Sent (cid ' + (j.cid || "?") + '). Seed: ' + JSON.stringify(msg);
      } else {
        const hint = res.status === 404 ? "\n\nIs it deployed? (Build → Deploy)" : "";
        await window.PatronDialogs.confirm({ title: "Console — Send failed",
          message: (j.detail || j.error || ("HTTP " + res.status)) + hint, okLabel: "OK" });
      }
    } catch (e) {
      await window.PatronDialogs.confirm({ title: "Console — Send",
        message: "Could not reach the server: " + e.message, okLabel: "OK" });
    }
  };

  // Console (Receive): one live SSE per open project; route each console.output event to the
  // matching console_receive node by id and show its content. Push-based (no polling).
  let consoleES = null;
  function startConsoleReceive() {
    if (consoleES) { try { consoleES.close(); } catch (e) {} consoleES = null; }
    if (!currentProject.uid || typeof EventSource === "undefined") return;
    const es = new EventSource("api/projects/" + currentProject.uid + "/events");
    es.onmessage = function (e) {
      let d; try { d = JSON.parse(e.data); } catch (_) { return; }
      if (!d) return;
      // Feed EVERY event to the live Trace panel (all event types, grouped by run).
      if (window.PatronTrace && window.PatronTrace.push) window.PatronTrace.push(d);
      // Console (Receive): only console.output events route to a console_receive node.
      if (d.event !== "console.output" || !d.node) return;
      const node = graph.getNodeById(Number(String(d.node).split(":").pop()));
      if (!node || node.type !== "console_receive") return;
      node.properties.received = String(d.output == null ? "" : d.output);
      const w = (node.widgets || []).find(function (x) { return x.name === "received"; });
      if (w) w.value = node.properties.received;
      if (window.PatronFitNodeWidth) window.PatronFitNodeWidth(node);
      if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
      graph.setDirtyCanvas(true, true);
    };
    es.onerror = function () { /* EventSource auto-reconnects; ignore transient drops */ };
    consoleES = es;
  }
  window.PatronStartConsoleReceive = startConsoleReceive;

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
  menuBar.registerCommand("project.close", projectClose);
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
  menuBar.registerCommand("view.controls", toggleControls);
  menuBar.registerCommand("view.output", toggleOutput);
  menuBar.registerCommand("view.trace", () => { if (window.PatronTrace) window.PatronTrace.toggle(); });
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
   "help.docs", "help.shortcuts"]
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
  // The Toolbox sits below the project title (which is at top:45 + ~22px tall). Start the
  // panel below that so it never overlaps the title.
  const TOOLBOX_TOP = 78;

  // Resize a jsPanel so its content fits WITHOUT a scrollbar (clamped to the viewport height).
  // Measure p.content.scrollHeight (NOT the inner palette div): it already includes the content
  // padding AND any trailing child margins (e.g. the last palette-group's margin-bottom), which
  // the palette div's own height omits due to margin-collapse — that undercount left a scrollbar.
  function fitPanelToContent(p, topOffset) {
    if (!p || !p.content || typeof p.resize !== "function") return;
    const hdr = p.querySelector ? p.querySelector(".jsPanel-titlebar") : null;
    const headerH = hdr ? hdr.offsetHeight : 30;
    const want = headerH + p.content.scrollHeight + 2; // +2 = panel border
    const maxH = Math.max(200, window.innerHeight - (topOffset || 0) - 16); // leave a bottom margin
    const w = parseInt(p.style.width, 10) || 252;
    try { p.resize({ width: w, height: Math.round(Math.min(want, maxH)) }); } catch (e) { /* ignore */ }
  }

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
      position: { my: "left-top", at: "left-top", offsetX: 14, offsetY: TOOLBOX_TOP }, // left, below the project title
      boxShadow: 3,
      headerControls: { size: "xs", minimize: "remove", smallify: "remove", normalize: "remove", maximize: "remove" },
      addCloseControl: 0,
      callback: (p) => {
        p.content.style.cssText = "padding:10px;overflow-y:auto;background:var(--panel);color:var(--text)";
        const host = document.createElement("div");
        host.id = "palette";
        p.content.appendChild(host);
        buildPalette(host);
        // Fit the height to the palette so no scrollbar shows by default. Content settles in
        // stages (fonts, then the block-icon <img>s), so re-fit on each: rAF, fonts.ready, and
        // a ResizeObserver on the palette that catches late reflows (icons loading). No loop —
        // resizing the panel height doesn't change the palette's own content height.
        // A saved workspace rect (if any) still overrides this later via applyPanelRect.
        const fit = () => fitPanelToContent(p, TOOLBOX_TOP);
        requestAnimationFrame(fit);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
        if (typeof ResizeObserver !== "undefined") new ResizeObserver(fit).observe(host);
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

  // Deploy status badge: mount it and wire a click to reveal the reason in the Output panel
  // (this is the ONE place the badge opens Output — it never pops open on its own).
  if (window.PatronStatus) {
    window.PatronStatus.mount(document.getElementById("deploy-badge"));
    window.PatronStatus.onClick((state, detail) => {
      inspectOut.textContent = detail || "No details.";
      showOutput();
    });
  }

  // Auto-persistence (server-side): load the saved workspace on start and save
  // automatically as things change — so the explicit 💾 Save is optional. The
  // `appReady` guard keeps the initial load from triggering a save over itself.
  let appReady = false;
  let saveTimer = 0;
  // Auto-save DISMISSED (fully-explicit model): the canvas is a scratch that is never
  // persisted automatically. Work is saved only when the user explicitly Saves it as a
  // project (Save / Save As) and reloaded only via Open Project. scheduleSave is kept as a
  // no-op so its many call sites stay harmless without churn; the interaction triggers and
  // the beforeunload writer are removed.
  // Auto-save is a no-op, but every mutation still routes through here — so it's the natural
  // pulse for the deploy-status badge: each edit (debounced) re-checks deploy-readiness.
  function scheduleSave() { scheduleStatus(); }

  // --- Deploy status badge (bottom-left) --------------------------------------
  // Near-real-time deploy-readiness of the CURRENT graph: lower it with the SAME compiler as
  // Deploy via a dry run (POST /api/projects/<uid>/status, no persistence) on start and,
  // debounced, on every edit. status-badge.js paints it; a click opens Output with the reason.
  function statusCtx() {
    const proj = window.PatronProjects && window.PatronProjects.current();
    return {
      saved: !!(proj && proj.uid),
      uid: proj && proj.uid,
      name: proj && proj.name,
      graph: graph.serialize(),
    };
  }
  function refreshStatus() { if (window.PatronStatus) window.PatronStatus.check(statusCtx()); }
  function scheduleStatus() {
    if (appReady && window.PatronStatus) window.PatronStatus.scheduleCheck(statusCtx);
  }

  (async function boot() {
    // Always start on a blank, unsaved scratch — no workspace is loaded (nothing is
    // auto-saved). Use Project → Open Project to resume saved work.
    startEmptyProject();
    graph.setDirtyCanvas(true, true);
    appReady = true;
    refreshStatus(); // recompile-on-start: paint the badge from the initial graph
  })();

  // Expose for console tinkering + the Properties panel (js/props-panel.js).
  global.PatronApp.graph = graph;
  global.PatronApp.canvas = lgcanvas;
  global.PatronApp.scheduleSave = scheduleSave;
  global.PatronApp.menuBar = menuBar;
})(window);
