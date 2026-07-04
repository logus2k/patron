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
  const INIT = "#f28b7d";    // Initiators (boundary sources) — salmon
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
  // below the size the user manually set (shrinking-to-content on every edit is the bug
  // where a widened/heightened block snaps back to minimum). Both dimensions grow to fit
  // content but keep a user-set larger width OR height.
  function refitNode(node) {
    if (!node || !node.widgets) return;
    const want = node.computeSize();
    if (!node.size) node.size = want;
    else { node.size[0] = Math.max(node.size[0], want[0]); node.size[1] = Math.max(node.size[1], want[1]); }
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
      size[1] = Math.max(size[1], this.computeSize()[1]); // allow taller than content; never shorter
    };
    node.configure = function (info) {
      baseConfigure.call(this, info);
      this._accent = color;
      syncWidgets(this);          // show loaded values, not constructor defaults
      if (this.size) {
        this.size[0] = Math.min(MAX_W, Math.max(this.size[0], contentWidth(this)));
        this.size[1] = Math.max(this.size[1], this.computeSize()[1]); // keep a saved taller height
      }
    };
    node.size = node.computeSize();
    iconize(node);
    accentize(node);
  }

  function iconize(node) {
    node.onDrawTitleBox = function (ctx, title_height) {
      if (global.PatronIcons && global.PatronIcons.has(this.type)) {
        // Icon colour = the title-text colour for this state. Selected → the orange selection
        // bar (both themes) reads best with a WHITE icon; unselected → theme base (#1d1d1d on
        // the light node title, #fff on the dark one).
        const light = document.documentElement.dataset.theme === "light";
        const col = (light && !this.is_selected) ? "#1d1d1d" : "#ffffff";
        global.PatronIcons.drawTitleBox(ctx, this.type, title_height, col);
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
      if (this.is_selected) return;   // no accent stripe while the block is selected
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

  // A themed ACTION button (e.g. Console Send) — a filled accent pill with a centered label,
  // instead of litegraph's default (black) button. type "patron/button" routes the draw here
  // (litegraph's default widget case) and the click to its callback (see inline-edit.js).
  function drawButton(ctx, node, widget_width, y, H) {
    const w = this, margin = 15;
    const x = margin, bw = Math.max(40, widget_width - margin * 2), bh = H - 6, by = y + 3;
    const accent = node._accent || "#4a90d9";
    ctx.save();
    ctx.fillStyle = accent;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, by, bw, bh, 6); else ctx.rect(x, by, bw, bh);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 " + ((typeof LiteGraph !== "undefined" && LiteGraph.NODE_SUBTEXT_SIZE) || 12) + "px 'Roboto', Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(w.label || w.name || "Send"), x + bw / 2, by + bh / 2);
    ctx.restore();
  }
  global.PatronDrawButton = drawButton;

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

  // One-line human summary of a Scheduled Trigger's schedule (shown on the canvas node and
  // as the panel header preview). Reads the raw block properties. Kept here so the node and
  // the dedicated scheduler panel (props-panel.js) render the SAME text.
  function scheduleSummary(p) {
    p = p || {};
    const mode = p.schedule_mode || "cron";
    if (mode === "interval") {
      const v = p.interval_value == null ? 0 : p.interval_value;
      let unit = p.interval_unit || "minutes";
      if (String(v) === "1" && unit.endsWith("s")) unit = unit.slice(0, -1); // "every 1 minute"
      return "every " + v + " " + unit;
    }
    if (mode === "date") {
      return p.run_date ? ("once at " + p.run_date) : "one-off (unset)";
    }
    return "cron " + (p.cron || "0 7 * * *") + (p.timezone ? " · " + p.timezone : "");
  }
  global.PatronScheduleSummary = scheduleSummary;

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
      // The schedule is edited in the DEDICATED Scheduled-Trigger panel (double-click); the
      // canvas shows only a one-line schedule summary. schedule_mode selects which scheduler
      // trigger kind (cron / interval / date) the fields below drive.
      this.addProperty("schedule_mode", "cron");   // cron | interval | date
      this.addProperty("cron", "0 7 * * *");
      this.addProperty("timezone", "");
      this.addProperty("interval_value", 30);
      this.addProperty("interval_unit", "minutes");
      this.addProperty("run_date", "");
      this.addProperty("task", "");
      this.addProperty("schedule_summary", scheduleSummary(this.properties));
      const sw = textW(this, "schedule_summary"); sw.label = "schedule";
      apply(this, INIT);
      // Recompute the summary when a graph is LOADED (configure restores raw properties but
      // a saved graph may predate schedule_summary / carry edited fields).
      const appliedConfigure = this.configure;
      this.configure = function (info) {
        appliedConfigure.call(this, info);
        this.properties.schedule_summary = scheduleSummary(this.properties);
        const w = (this.widgets || []).find((x) => x.name === "schedule_summary");
        if (w) w.value = this.properties.schedule_summary;
        if (global.PatronFitNodeWidth) global.PatronFitNodeWidth(this);
      };
    }
    Trigger.title = "Scheduled Trigger";
    Trigger.desc = "Boundary source: fires the agent on a schedule (cron / interval / one-off date).";

    // --- File Initiator: fires when a file appears/changes in a watched folder -
    function FileInitiator() {
      this.addOutput("out", TYPES.FLOW);
      this.addProperty("watch_path", "/watched/in");
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

    // Console (Send): a MANUAL initiator for testing/debugging. Type a message and click
    // Send to fire the DEPLOYED workflow with it as the seed (POST …/fire). The fetch +
    // project-uid lookup lives in app.js (window.PatronConsoleSend); the button just calls it.
    function ConsoleSend() {
      this.addOutput("out", TYPES.FLOW);
      this.addProperty("message", "");
      textW(this, "message");
      const send = this.addWidget("button", "Send ▶", null, () => {
        if (window.PatronConsoleSend) window.PatronConsoleSend(this);
      });
      send.type = "patron/button";   // themed draw (drawButton) + click routed to callback
      send.draw = drawButton;
      apply(this, INIT);
    }
    ConsoleSend.title = "Console (Send)";
    ConsoleSend.desc = "Fire the deployed workflow with a typed message (testing/debug).";

    // Console (Receive): a display sink. Shows the content that reaches it, pushed live over
    // SSE (window.PatronConsoleReceive in app.js routes each event to the node by id). The
    // `received` field holds the latest content; `out` lets it also pass the value onward.
    function ConsoleReceive() {
      this.addInput("in", TYPES.FLOW);
      this.addOutput("out", TYPES.FLOW);
      this.addProperty("label", "");
      this.addProperty("received", "");
      textW(this, "received");
      apply(this, DEST);
    }
    ConsoleReceive.title = "Console (Receive)";
    ConsoleReceive.desc = "Shows the content that reaches it, live (testing/debug).";
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
      // Skills (block_management.md §8.3): a multi-select from Agent Runtime's skill
      // registry, rendered by the Properties panel's generic resource-ref checklist
      // (kind "skill", bound to /resources/skill) — exactly like tools_allow. The
      // optional context conditions drive which priority-1 skills auto-inject.
      this.addProperty("skills_allow", "");
      this.addProperty("skills_context", "");
      this.addProperty("memory", "none");
      // Loop (block_management.md §8.4): the OUTER repeat loop around the whole agent
      // action — distinct from tools_max_rounds (the Brain's INNER tool loop). Types are
      // SEPARATE: off / counter / expression / judge. Per-type fields below are rendered by
      // the Properties panel from the /composer/catalog metadata (loop section).
      this.addProperty("loop_type", "off");
      this.addProperty("loop_n", 1);
      this.addProperty("loop_expression", "");
      this.addProperty("loop_max_iter", 10);
      this.addProperty("loop_iteration_input", "same");
      // judge sub-config (only for loop type "judge"):
      this.addProperty("loop_judge_persona", "");
      this.addProperty("loop_verdict_read", "expression");
      this.addProperty("loop_verdict_expression", "");
      this.addProperty("loop_verdict_field", "");
      this.addProperty("loop_judge_template", "");
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

    // NOTE: RAG-pre and Guardrails are NOT standalone blocks — they are CONFIG on the Agent
    // (rag_rewriter/rag_domains/rag_use_graph and guard_forbidden/guard_min_confidence). Deploy
    // decomposes an Agent's rag/guardrail config into rag/guardrail runtime nodes
    // (…→[rag]→agent→[guardrail]→…). There is therefore no draggable RAG/Guardrail block.

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

    // --- Vector Database: standalone dense-corpus query (outputs results) -----
    function VectorDatabase() {
      this.addInput("in", TYPES.FLOW);
      this.addOutput("out", TYPES.FLOW);
      this.addProperty("domain", "");
      this.addProperty("top_k", 5);
      this.addProperty("query", "");
      textW(this, "domain");
      numW(this, "top_k", 1, 100);
      textW(this, "query");
      apply(this, COLOR);
    }
    VectorDatabase.title = "Vector Database";
    VectorDatabase.desc = "Query a dense vector corpus (noted-rag); outputs the ranked passages. Not agent-coupled.";

    // --- Graph Database: standalone knowledge-graph query (outputs results) ---
    function GraphDatabase() {
      this.addInput("in", TYPES.FLOW);
      this.addOutput("out", TYPES.FLOW);
      this.addProperty("domain", "");
      this.addProperty("query", "");
      textW(this, "domain");
      textW(this, "query");
      apply(this, COLOR);
    }
    GraphDatabase.title = "Graph Database";
    GraphDatabase.desc = "Query a knowledge graph (noted-graph); outputs entities/relationships. Not agent-coupled.";

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
    function destination(channel, defaultTarget, targetLabel, withOutput) {
      function Dest() {
        this.addInput("in", TYPES.FLOW);
        // Optional pass-through OUT: a destination that ALSO hands its delivered content
        // onward (e.g. File Destination — persist the file AND forward its content to any
        // block(s) wired here; the runtime broadcasts to every successor). Sink when unwired.
        if (withOutput) this.addOutput("out", TYPES.FLOW);
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
    const FileDestination = destination("file", "/watched/out/result.txt", "file path", true);
    FileDestination.title = "File Destination";
    const WebDestination = destination("web", "", "url");
    WebDestination.title = "Web Destination";

    const REGISTRY = [
      ["trigger", Trigger],
      ["file_initiator", FileInitiator],
      ["web_initiator", WebInitiator],
      ["stt_initiator", SttInitiator],
      ["console_send", ConsoleSend],
      ["console_receive", ConsoleReceive],
      ["agent", Agent],
      // RAG-pre and Guardrails are CONFIG on the Agent (rag_domains / guard_* fields); Deploy
      // decomposes them into rag/guardrail runtime nodes. There is no standalone RAG/Guardrail
      // block (they never lowered — no Python composer block), so they are not registered.
      ["transform", Transform],
      ["vector_query", VectorDatabase],
      ["graph_query", GraphDatabase],
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
      { type: "console_send", label: "Console (Send)" },
    ],
  };
  const PALETTE = {
    group: "Blocks",
    color: COLOR,
    items: [
      { type: "agent", label: "Agent" },
      { type: "vector_query", label: "Vector Database" },
      { type: "graph_query", label: "Graph Database" },
      { type: "transform", label: "Data Transform", disabled: true },
      { type: "composite", label: "Workflow", disabled: true },
    ],
  };
  const DESTINATIONS = {
    group: "Destinations",
    color: DEST,
    items: [
      { type: "whatsapp", label: "WhatsApp" },
      { type: "tts", label: "Text-to-Speech" },
      { type: "bus", label: "Event Bus" },
      { type: "console_receive", label: "Console (Receive)" },
      { type: "file_destination", label: "File Destination" },
      { type: "web_destination", label: "Web Destination" },
    ],
  };

  global.PatronAgentNodes = { TYPES, INITIATORS, PALETTE, DESTINATIONS, register };
})(window);
