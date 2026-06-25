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

  // Register the pattern nodes and grab the type paths back.
  global.PatronPatterns.register(LiteGraph);
  const COLORS = global.PatronPatterns.CATEGORY_COLORS;

  // Palette definition: display metadata for the toolbox (order matters).
  const PALETTE = [
    { group: "Utility", color: COLORS.Utility, items: [
      { type: "patron/task_source", label: "Task Source" },
      { type: "patron/inspector", label: "Inspector" },
    ]},
    { group: "Creational", color: COLORS.Creational, items: [
      { type: "patron/builder", label: "Builder Agent" },
      { type: "patron/factory", label: "Factory Agent" },
    ]},
    { group: "Structural", color: COLORS.Structural, items: [
      { type: "patron/proxy", label: "Proxy Agent" },
    ]},
    { group: "Behavioral", color: COLORS.Behavioral, items: [
      { type: "patron/chain_of_responsibility", label: "Chain of Responsibility" },
    ]},
  ];

  // --- graph + canvas -------------------------------------------------------
  const graph = new LGraph();
  const canvasEl = document.getElementById("graph-canvas");
  const lgcanvas = new LGraphCanvas(canvasEl, graph);

  function resizeCanvas() {
    const wrap = document.getElementById("canvas-wrap");
    canvasEl.width = wrap.clientWidth;
    canvasEl.height = wrap.clientHeight;
    lgcanvas.resize();
  }
  global.addEventListener("resize", resizeCanvas);

  // --- inspector side panel hook -------------------------------------------
  const inspectOut = document.getElementById("inspect-out");
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
  function buildPalette() {
    const root = document.getElementById("palette");
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

  // --- controls -------------------------------------------------------------
  document.getElementById("btn-run").addEventListener("click", runOnce);
  document.getElementById("btn-reset").addEventListener("click", () => {
    loadDemo();
    runOnce();
  });
  document.getElementById("btn-clear").addEventListener("click", () => {
    graph.clear();
    for (const k in inspectState) delete inspectState[k];
    inspectOut.textContent = "Canvas cleared. Drag patterns from the toolbox.";
  });

  // --- boot -----------------------------------------------------------------
  buildPalette();
  resizeCanvas();
  loadDemo();
  // LGraphCanvas renders on its own loop; we do NOT call graph.start() so
  // execution only happens on demand (Run / Reset). Show data immediately.
  runOnce();

  // Expose for console tinkering.
  global.PatronApp.graph = graph;
  global.PatronApp.canvas = lgcanvas;
})(window);
