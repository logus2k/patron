/*
 * agent_nodes.js — the composer authoring vocabulary for Patron (NEW structure).
 *
 * Node types == the composer Block kinds (trigger / file_initiator / web_initiator /
 * stt_initiator / agent / rag / guardrail / transform / composite / whatsapp / tts /
 * bus / file_destination / web_destination). One "flow" wire between blocks; capabilities
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

  const COLOR = "#8ec9a8";   // Blocks (agent/activity) — pastel green
  const INIT = "#d79a9a";    // Initiators (boundary sources) — pastel red
  const DEST = "#8fb3d9";    // Destinations — pastel blue

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
    node._accent = color;   // category accent — small left border stripe (title stays neutral)
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
      this._accent = color;
      syncWidgets(this);          // show loaded values, not constructor defaults
      if (this.size) {
        this.size[0] = Math.min(MAX_W, Math.max(this.size[0], contentWidth(this)));
        this.size[1] = this.computeSize()[1];
      }
    };
    node.size = node.computeSize();
    iconize(node);
    accentize(node);
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

  // Small left-border accent stripe in the category color (title stays neutral),
  // mirroring the Toolbox item accent. Drawn in the foreground over title + body.
  function accentize(node) {
    const prevFg = node.onDrawForeground;
    node.onDrawForeground = function (ctx, canvas) {
      if (prevFg) prevFg.call(this, ctx, canvas);
      if (this.flags && this.flags.collapsed) return;
      const th = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_TITLE_HEIGHT) || 24;
      const h = (this.size && this.size[1]) || 0;
      const r = this.round_radius || 8;
      const W = 4; // stripe width
      ctx.save();
      ctx.fillStyle = this._accent || "#888";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(0, -th, W, th + h, [r, 0, 0, r]);
      else ctx.rect(0, -th, W, th + h);
      ctx.fill();
      ctx.restore();
    };
  }

  // Read-only field renderer: a flat "label ......... value" row — NO box/border/fill, so it
  // reads as a spec sheet, not an editable input (values are edited ONLY in the Properties
  // panel). A hairline divider gives subtle structure. litegraph calls w.draw for unknown
  // widget types (the switch default).
  function drawField(ctx, node, widget_width, y, H) {
    const w = this, margin = 15;
    ctx.save();
    ctx.font = "normal " + ((typeof LiteGraph !== "undefined" && LiteGraph.NODE_SUBTEXT_SIZE) || 12) + "px Arial";
    // hairline divider at the row's baseline (very subtle; no input-like outline)
    ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(margin, y + H - 0.5);
    ctx.lineTo(widget_width - margin, y + H - 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // label (muted, left) … value (emphasis, right). The value is TRUNCATED to the space left
    // after the label (+ a gap) so a long value can never overlap the label.
    const baseline = y + H * 0.7;
    const labelText = String(w.label || w.name);
    ctx.fillStyle = LiteGraph.WIDGET_SECONDARY_TEXT_COLOR;
    ctx.textAlign = "left";
    ctx.fillText(labelText, margin, baseline);
    const gap = 14;
    const rightX = widget_width - margin;
    const availW = rightX - (margin + ctx.measureText(labelText).width + gap);
    let val = String(w.value == null ? "" : w.value);
    if (availW <= 4) {
      val = ""; // no room (very long label) — show nothing rather than overlap
    } else if (ctx.measureText(val).width > availW) {
      while (val.length && ctx.measureText(val + "…").width > availW) val = val.slice(0, -1);
      val += "…";
    }
    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
    ctx.textAlign = "right";
    ctx.fillText(val, rightX, baseline);
    ctx.restore();
  }
  global.PatronDrawField = drawField;

  // Every field renders as a read-only "label  value" row on the canvas (custom drawField —
  // subtle corners, no arrows/dropdown/toggle), because values are edited ONLY in the
  // Properties panel. Each widget carries `editKind` (+ values/min/max) so the panel builds
  // the right control; the canvas widget just shows the value.
  function displayW(node, name, kind, extra) {
    const w = node.addWidget("text", name, node.properties[name], (v) => (node.properties[name] = v));
    w.type = "patron/field";   // unknown type -> litegraph calls w.draw (our drawField)
    w.draw = drawField;
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
      // Generic defaults for a FRESH block. The News Agent's concrete values live only in
      // its fixture (examples/news-agent.graph.json), loaded by loadNewsAgent — NOT baked here.
      this.addProperty("agent_id", "");
      this.addProperty("trigger_type", "schedule");
      this.addProperty("cron", "0 7 * * *");
      this.addProperty("timezone", "");
      textW(this, "agent_id");
      comboW(this, "trigger_type", ["schedule", "channel"]);
      textW(this, "cron");
      textW(this, "timezone");
      apply(this, INIT);
    }
    Trigger.title = "Scheduled Trigger";
    Trigger.desc = "Boundary source: fires the agent on a schedule; holds its id + cron/timezone.";

    // --- File Initiator: fires when a file appears/changes in a watched folder -
    function FileInitiator() {
      this.addOutput("out", TYPES.FLOW);
      this.addProperty("watch_path", "");
      this.addProperty("patterns", "*");
      textW(this, "watch_path");
      textW(this, "patterns");
      apply(this, INIT);
    }
    FileInitiator.title = "File Initiator";
    FileInitiator.desc = "Boundary source: fires the workflow when a new/changed file is detected in a folder.";

    // --- Web Initiator: fires when a request hits a configured route ----------
    function WebInitiator() {
      this.addOutput("out", TYPES.FLOW);
      this.addProperty("route", "");
      textW(this, "route");
      apply(this, INIT);
    }
    WebInitiator.title = "Web Initiator";
    WebInitiator.desc = "Boundary source: fires the workflow on an inbound request to a Web API route.";

    // --- STT Initiator: fires when incoming speech is transcribed to text -----
    function SttInitiator() {
      this.addOutput("out", TYPES.FLOW);
      this.addProperty("source", "");
      textW(this, "source");
      apply(this, INIT);
    }
    SttInitiator.title = "Speech-to-Text";
    SttInitiator.desc = "Boundary source: fires the workflow when incoming speech is transcribed (speech-to-text).";

    // --- Agent: the workhorse; capabilities are CONFIG ------------------------
    function Agent() {
      this.addInput("in", TYPES.FLOW);
      this.addOutput("out", TYPES.FLOW);
      // Generic defaults for a FRESH Agent — NOT the News Agent's values (those live only
      // in the fixture, loaded by loadNewsAgent). A new agent starts blank + sensible.
      this.addProperty("persona", "");
      this.addProperty("temperature", 0.3);
      this.addProperty("max_tokens", 1024);
      this.addProperty("input_template", "");
      this.addProperty("input_vars", "{}");
      this.addProperty("tools_allow", "");
      this.addProperty("tools_max_rounds", 3);
      this.addProperty("memory", "none");
      // Agent-level metadata + optional capabilities: stored as properties (so they
      // serialize + lower), edited in the Properties panel (which renders every field
      // from the block catalog). Only the key fields get a canvas widget below.
      this.addProperty("memory_max_turns", 20);
      this.addProperty("description", "");
      this.addProperty("enabled", true);
      textW(this, "persona");
      numW(this, "temperature", 0, 2, 2);
      numW(this, "max_tokens", 1, null, 0);
      textW(this, "input_template");
      textW(this, "input_vars");
      textW(this, "tools_allow");
      numW(this, "tools_max_rounds", 1, null, 0);
      comboW(this, "memory", ["none", "thread_window"]);
      apply(this, COLOR);
    }
    Agent.title = "Agent";
    Agent.desc = "The workhorse: persona (selects the model), tools/memory as config, runs the tool loop.";

    // --- RAG: pre-inference retrieve-then-inject (wire before an Agent) -------
    function Rag() {
      this.addInput("in", TYPES.FLOW);
      this.addOutput("out", TYPES.FLOW);
      this.addProperty("rewriter", "");
      this.addProperty("domains", "");
      textW(this, "rewriter");
      textW(this, "domains");
      apply(this, COLOR);
    }
    Rag.title = "RAG";
    Rag.desc = "Pre-inference retrieve-then-inject; wire before an Agent to augment its input.";

    // --- Guardrail: input/output checks (wire before/after an Agent) ----------
    function Guardrail() {
      this.addInput("in", TYPES.FLOW);
      this.addOutput("out", TYPES.FLOW);
      this.addProperty("forbidden", "");
      this.addProperty("min_confidence", 0.5);
      textW(this, "forbidden");
      numW(this, "min_confidence", 0, 1);
      apply(this, COLOR);
    }
    Guardrail.title = "Guardrail";
    Guardrail.desc = "Checks (forbidden patterns / min confidence); wire before/after an Agent.";

    // --- Transform: deterministic map (can be LLM-generated) ------------------
    function Transform() {
      this.addInput("in", TYPES.FLOW);
      this.addOutput("out", TYPES.FLOW);
      this.addProperty("script", "");
      textW(this, "script");
      apply(this, COLOR);
    }
    Transform.title = "Data Transform";
    Transform.desc = "Deterministic map in→out; body can be generated from the port schemas.";

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
        this.addProperty("target_name", "");
        this.addProperty("target", defaultTarget);
        // Friendly name FIRST (name before id), then the raw id. Both widget KEYs are the
        // property names so the Properties panel + syncWidgets map them correctly; the labels
        // ("name" / "chat id") are display-only.
        const wn = this.addWidget("text", "target_name", this.properties.target_name, (v) => (this.properties.target_name = v));
        wn.label = "name";
        wn.editKind = "text";
        wn.type = "patron/field";
        wn.draw = global.PatronDrawField;
        const w = this.addWidget("text", "target", this.properties.target, (v) => (this.properties.target = v));
        w.label = targetLabel || "target";
        w.editKind = "text";
        w.type = "patron/field";
        w.draw = global.PatronDrawField;
        // Size from content (like every other block) so BOTH fields fit with proper bottom
        // margin — the old hard-coded height left the 2nd field flush against the border.
        apply(this, DEST);
      }
      Dest.title = channel.charAt(0).toUpperCase() + channel.slice(1);
      Dest.desc = "Destination: deliver via " + channel + ".";
      return Dest;
    }
    // Blank targets on a FRESH block (the concrete target is picked in the panel / lives in
    // the fixture); the label is the placeholder hint.
    const WhatsApp = destination("whatsapp", "", "chat id");
    WhatsApp.title = "WhatsApp";
    const Tts = destination("tts", "", "voice/session");
    Tts.title = "Text-to-Speech";
    const Bus = destination("bus", "", "stream id");
    Bus.title = "Event Bus";
    const FileDestination = destination("file", "", "file path");
    FileDestination.title = "File Destination";
    const WebDestination = destination("web", "", "url");
    WebDestination.title = "Web Destination";

    const REGISTRY = [
      ["trigger", Trigger],
      ["file_initiator", FileInitiator],
      ["web_initiator", WebInitiator],
      ["stt_initiator", SttInitiator],
      ["agent", Agent],
      ["rag", Rag],
      ["guardrail", Guardrail],
      ["transform", Transform],
      ["composite", Composite],
      ["whatsapp", WhatsApp],
      ["tts", Tts],
      ["bus", Bus],
      ["file_destination", FileDestination],
      ["web_destination", WebDestination],
    ];
    REGISTRY.forEach(([path, ctor]) => LiteGraph.registerNodeType(path, ctor));
    return REGISTRY.map(([path]) => path);
  }

  // Palette groups for the toolbox (app.js renders them), matching the roster
  // categories in specs/toolbox_blocks.md: Initiators / Blocks / Destinations.
  const INITIATORS = {
    group: "Initiators",
    color: INIT,
    items: [
      { type: "trigger", label: "Scheduled Trigger" },
      { type: "file_initiator", label: "File Initiator" },
      { type: "web_initiator", label: "Web Initiator" },
      { type: "stt_initiator", label: "Speech-to-Text" },
    ],
  };
  const PALETTE = {
    group: "Blocks",
    color: COLOR,
    items: [
      { type: "agent", label: "Agent" },
      { type: "rag", label: "RAG" },
      { type: "guardrail", label: "Guardrail" },
      { type: "transform", label: "Data Transform" },
      { type: "composite", label: "Workflow" },
    ],
  };
  const DESTINATIONS = {
    group: "Destinations",
    color: DEST,
    items: [
      { type: "whatsapp", label: "WhatsApp" },
      { type: "tts", label: "Text-to-Speech" },
      { type: "bus", label: "Event Bus" },
      { type: "file_destination", label: "File Destination" },
      { type: "web_destination", label: "Web Destination" },
    ],
  };

  global.PatronAgentNodes = { TYPES, INITIATORS, PALETTE, DESTINATIONS, register };
})(window);
