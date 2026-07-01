/*
 * agent_nodes.js — the composer authoring vocabulary for Patron (NEW structure).
 *
 * Node types == the composer Block kinds (trigger / agent / transform / branch / loop /
 * composite / whatsapp / tts / bus). One "flow" wire between blocks; capabilities
 * (tools/rag/guardrails) are CONFIG on the Agent, not separate nodes. There is NO legacy
 * vocabulary and NO adapter — a graph of these lowers directly via agent_runtime's
 * /composer/compile.
 *
 * Authoring nodes carry config (the shell), not execution — agent_runtime is the executor.
 * Node type ids + property names must match the composer catalog (GET /composer/catalog).
 *
 * Exposes window.PatronAgentNodes = { TYPES, PALETTE, DESTINATIONS, register(LiteGraph) }.
 */
(function (global) {
  "use strict";

  // One flow wire between blocks (the typed-slot zoo is gone).
  const TYPES = { FLOW: "flow" };

  const COLOR = "#8ec9a8";   // agent/activity — soft pastel green
  const CTRL = "#c9b58e";    // control (branch/loop) — warm sand
  const DEST = "#8193ad";    // destination — slate

  const MIN_W = 180, MAX_W = 560;
  const VAL_SLOT = 48;

  function contentWidth(node) {
    const ctx = contentWidth._ctx ||
      (contentWidth._ctx = document.createElement("canvas").getContext("2d"));
    const size = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_TEXT_SIZE) || 14;
    ctx.font = size + "px 'Roboto', Arial, sans-serif";
    let w = MIN_W;
    for (const wd of node.widgets || []) {
      const label = String(wd.label || wd.name || "");
      const arrows = (wd.type === "number" || wd.type === "combo") ? 40 : 0;
      const need = ctx.measureText(label).width + VAL_SLOT + 44 + arrows;
      if (need > w) w = need;
    }
    return Math.round(Math.max(MIN_W, Math.min(MAX_W, w)));
  }

  // Re-fit after a value changes: GROW the node to fit a longer value, but never SHRINK
  // below the width the user manually set (shrinking-to-content on every edit is the bug
  // where a widened block snaps back to minimum). Height always tracks content.
  function refitNode(node) {
    if (!node || !node.widgets) return;
    const want = node.computeSize();
    if (!node.size) node.size = want;
    else { node.size[0] = Math.max(node.size[0], want[0]); node.size[1] = want[1]; }
    if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
  }
  global.PatronFitNodeWidth = refitNode;

  // Apply the block look + content-aware width; color is re-applied on load (configure).
  function apply(node, color) {
    node.color = color;
    const baseCompute = node.computeSize;
    const baseConfigure = node.configure;
    node.computeSize = function (out) {
      const s = baseCompute.call(this, out);
      s[0] = Math.min(MAX_W, Math.max(s[0], contentWidth(this)));
      if (this.widgets && this.widgets.length) s[1] += 5;
      return s;
    };
    node.onResize = function (size) {
      size[0] = Math.max(contentWidth(this), Math.min(size[0], MAX_W));
      size[1] = this.computeSize()[1];
    };
    node.configure = function (info) {
      baseConfigure.call(this, info);
      this.color = color;
      syncWidgets(this);          // show loaded values, not constructor defaults
      if (this.size) {
        this.size[0] = Math.min(MAX_W, Math.max(this.size[0], contentWidth(this)));
        this.size[1] = this.computeSize()[1];
      }
    };
    node.size = node.computeSize();
    iconize(node);
  }

  function iconize(node) {
    node.onDrawTitleBox = function (ctx, title_height) {
      if (global.PatronIcons && global.PatronIcons.has(this.type)) {
        global.PatronIcons.drawTitleBox(ctx, this.type, title_height);
      }
    };
    node.onDrawTitleBar = function (ctx, title_height, size, scale, fgcolor) {
      if (!this.is_selected) return;
      // Uniform selection highlight for ALL blocks — the same colour as the selection
      // border (LiteGraph.NODE_BOX_OUTLINE_COLOR = the theme's --link-highlight), not the
      // per-family node colour, so selection looks consistent across block types.
      ctx.fillStyle =
        (typeof LiteGraph !== "undefined" && LiteGraph.NODE_BOX_OUTLINE_COLOR) || this.color || fgcolor;
      ctx.beginPath();
      const r = this.round_radius || 8;
      if (ctx.roundRect) ctx.roundRect(0, -title_height, size[0] + 1, title_height, [r, r, 0, 0]);
      else ctx.rect(0, -title_height, size[0] + 1, title_height);
      ctx.fill();
    };
  }

  // Every field renders as a read-only "label  value" row on the canvas (litegraph's TEXT
  // widget style — no arrows, no dropdown chevron, no toggle), because values are edited
  // ONLY in the Properties panel. Each widget carries `editKind` (+ values/min/max) so the
  // panel builds the right control (select / number / text); the canvas widget just shows.
  function displayW(node, name, kind, extra) {
    const w = node.addWidget("text", name, node.properties[name], (v) => (node.properties[name] = v));
    w.editKind = kind;
    if (extra && extra.values) w.editValues = extra.values;
    if (extra && extra.min != null) w.editMin = extra.min;
    if (extra && extra.max != null) w.editMax = extra.max;
    return w;
  }
  function textW(node, name) { return displayW(node, name, "text"); }
  function numW(node, name, min, max) { return displayW(node, name, "number", { min, max }); }
  function comboW(node, name, values) { return displayW(node, name, "combo", { values }); }

  // litegraph's configure() restores node.properties but NOT each widget's displayed
  // .value (widgets keep their constructor value). Re-sync so a LOADED graph shows its
  // saved values, not the node defaults. Called from every configure override below.
  function syncWidgets(node) {
    for (const w of node.widgets || []) {
      if (w.name != null && node.properties && w.name in node.properties) {
        w.value = node.properties[w.name];
      }
    }
  }

  function register(LiteGraph) {
    // --- Trigger: boundary source; carries the agent id + schedule ------------
    function Trigger() {
      this.addOutput("out", TYPES.FLOW);
      this.addProperty("agent_id", "news-morning-ai");
      this.addProperty("trigger_type", "schedule");
      this.addProperty("cron", "0 7 * * *");
      this.addProperty("timezone", "");
      textW(this, "agent_id");
      comboW(this, "trigger_type", ["schedule", "channel"]);
      textW(this, "cron");
      textW(this, "timezone");
      apply(this, COLOR);
    }
    Trigger.title = "Trigger";
    Trigger.desc = "Boundary source: fires the agent; holds its id + schedule.";

    // --- Agent: the workhorse; capabilities are CONFIG ------------------------
    function Agent() {
      this.addInput("in", TYPES.FLOW);
      this.addOutput("out", TYPES.FLOW);
      this.addProperty("persona", "news_curator");
      this.addProperty("temperature", 0.3);
      this.addProperty("max_tokens", 1024);
      this.addProperty("input_template", "Curate the {n} best morning headlines about {topic}.");
      this.addProperty("input_vars", '{"n": 5, "topic": "AI agents"}');
      this.addProperty("tools_server", "mcp");
      this.addProperty("tools_allow", "mcp__newsapi_search, mcp__fetch_url");
      this.addProperty("tools_max_rounds", 3);
      this.addProperty("memory", "none");
      textW(this, "persona");
      numW(this, "temperature", 0, 2, 2);
      numW(this, "max_tokens", 1, null, 0);
      textW(this, "input_template");
      textW(this, "input_vars");
      textW(this, "tools_server");
      textW(this, "tools_allow");
      numW(this, "tools_max_rounds", 1, null, 0);
      comboW(this, "memory", ["none", "thread_window"]);
      apply(this, COLOR);
    }
    Agent.title = "Agent";
    Agent.desc = "The workhorse: persona (selects the model), tools/memory as config, runs the tool loop.";

    // --- Transform: deterministic map (can be LLM-generated) ------------------
    function Transform() {
      this.addInput("in", TYPES.FLOW);
      this.addOutput("out", TYPES.FLOW);
      this.addProperty("script", "");
      textW(this, "script");
      apply(this, COLOR);
    }
    Transform.title = "Transform";
    Transform.desc = "Deterministic map in→out; body can be generated from the port schemas.";

    // --- Branch: conditional routing (Control) --------------------------------
    function Branch() {
      this.addInput("in", TYPES.FLOW);
      this.addOutput("then", TYPES.FLOW);
      this.addOutput("else", TYPES.FLOW);
      this.addProperty("predicate", "");
      textW(this, "predicate");
      apply(this, CTRL);
    }
    Branch.title = "Branch";
    Branch.desc = "Control: route in → one of several guarded outs at run time.";

    // --- Loop: bounded repetition (Control) -----------------------------------
    function Loop() {
      this.addInput("in", TYPES.FLOW);
      this.addOutput("body", TYPES.FLOW);
      this.addOutput("exit", TYPES.FLOW);
      this.addProperty("condition", "");
      this.addProperty("max_iter", 10);
      textW(this, "condition");
      numW(this, "max_iter", 1, null, 0);
      apply(this, CTRL);
    }
    Loop.title = "Loop";
    Loop.desc = "Control: repeat the body until a condition holds or max_iter is hit.";

    // --- Composite: a workflow-as-a-block (nesting) ---------------------------
    function Composite() {
      this.addInput("in", TYPES.FLOW);
      this.addOutput("out", TYPES.FLOW);
      this.addProperty("workflow_ref", "");
      textW(this, "workflow_ref");
      apply(this, COLOR);
    }
    Composite.title = "Workflow";
    Composite.desc = "A saved workflow referenced as one participant (nesting).";

    // --- Destinations: in-only sinks; the "where" -----------------------------
    function destination(channel, defaultTarget, targetLabel) {
      function Dest() {
        this.addInput("in", TYPES.FLOW);
        this.addProperty("target", defaultTarget);
        // The widget KEY is the property name ("target") so the Properties panel + syncWidgets
        // map it correctly; the friendly hint ("chat id"/…) is a display-only label.
        const w = this.addWidget("text", "target", this.properties.target, (v) => (this.properties.target = v));
        w.label = targetLabel || "target";
        w.editKind = "text";
        this.color = DEST;
        this.size = [200, 60];
        iconize(this);
        const base = this.configure;
        this.configure = function (info) { base.call(this, info); this.color = DEST; syncWidgets(this); };
      }
      Dest.title = channel.charAt(0).toUpperCase() + channel.slice(1);
      Dest.desc = "Destination: deliver via " + channel + ".";
      return Dest;
    }
    const WhatsApp = destination("whatsapp", "351961050313@c.us", "chat id");
    WhatsApp.title = "WhatsApp";
    const Tts = destination("tts", "default", "voice/session");
    Tts.title = "TTS";
    const Bus = destination("bus", "ops-dashboard", "stream id");
    Bus.title = "Bus";

    const REGISTRY = [
      ["trigger", Trigger],
      ["agent", Agent],
      ["transform", Transform],
      ["branch", Branch],
      ["loop", Loop],
      ["composite", Composite],
      ["whatsapp", WhatsApp],
      ["tts", Tts],
      ["bus", Bus],
    ];
    REGISTRY.forEach(([path, ctor]) => LiteGraph.registerNodeType(path, ctor));
    return REGISTRY.map(([path]) => path);
  }

  // Palette groups for the toolbox (app.js renders them).
  const PALETTE = {
    group: "Blocks",
    color: COLOR,
    items: [
      { type: "trigger", label: "Trigger" },
      { type: "agent", label: "Agent" },
      { type: "transform", label: "Transform" },
      { type: "branch", label: "Branch" },
      { type: "loop", label: "Loop" },
      { type: "composite", label: "Workflow" },
    ],
  };
  const DESTINATIONS = {
    group: "Destinations",
    color: DEST,
    items: [
      { type: "whatsapp", label: "WhatsApp" },
      { type: "tts", label: "TTS" },
      { type: "bus", label: "Bus" },
    ],
  };

  global.PatronAgentNodes = { TYPES, PALETTE, DESTINATIONS, register };
})(window);
