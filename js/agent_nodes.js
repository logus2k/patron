/*
 * agent_nodes.js — the runtime-aligned agent vocabulary for Patron.
 *
 * These are the nodes that actually correspond to the agent_runtime DSL
 * (trigger / rag / brain / tools / guardrail / delivery), as opposed to the
 * conceptual GoF nodes in patterns.js (which stay as inspiration). A graph of
 * these is what js/compile.js lowers to the runtime DSL.
 *
 * Authoring nodes: they carry config (the shell), not real execution — the farm
 * (agent_runtime) is the executor. Node type ids must match js/compile.js.
 *
 * Exposes window.PatronAgentNodes = { TYPES, PALETTE, register(LiteGraph) }.
 */
(function (global) {
  "use strict";

  // Typed slots — the data that flows between agent nodes.
  const TYPES = {
    TASK: "task",            // the work request (from the trigger)
    CONTEXT: "context",      // assembled prompt bundle (from rag)
    TOOLS: "tools",          // a tool allow-list attached to the brain
    RESULT: "result",        // an execution output
    DESTINATION: "destination", // Deliver -> a channel block (whatsapp/tts/bus)
  };

  const COLOR = "#5aa17c"; // agent-node title color — softer/pastel green (was #2f7d52)

  const MIN_W = 240, MAX_W = 560; // width has a usable range; height is locked to content

  // Width to fit the widest widget's [label … value], clamped to [MIN_W, MAX_W] so the
  // label and value never overlap (and the node never gets absurdly wide).
  function contentWidth(node) {
    const ctx = contentWidth._ctx ||
      (contentWidth._ctx = document.createElement("canvas").getContext("2d"));
    const size = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_TEXT_SIZE) || 14;
    ctx.font = size + "px 'Roboto', Arial, sans-serif";
    let w = MIN_W;
    for (const wd of node.widgets || []) {
      const label = String(wd.label || wd.name || "");
      const val = wd.value == null ? "" : String(wd.value);
      const arrows = (wd.type === "number" || wd.type === "combo") ? 40 : 0; // ◀ ▶ chrome
      const need = ctx.measureText(label).width + ctx.measureText(val).width + 56 + arrows;
      if (need > w) w = need;
    }
    return Math.round(Math.max(MIN_W, Math.min(MAX_W, w)));
  }

  // Re-fit a node after a value changes (inline edit / properties panel).
  function refitNode(node) {
    if (node && node.widgets) {
      node.size = node.computeSize();
      if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
    }
  }
  global.PatronFitNodeWidth = refitNode;

  // Apply the agent-node look + enforce a content-aware MIN width (no overlap) and a MAX
  // width/height — across create, load, and manual resize. We override computeSize (used
  // by litegraph on create and as the resize floor), onResize (manual resize clamp), and
  // configure (so narrow SAVED sizes are widened on load). Height comes from computeSize
  // (widget count), so the `h` arg is now ignored.
  function apply(node, _h) {
    node.color = COLOR;
    const baseCompute = node.computeSize;
    const baseConfigure = node.configure;
    node.computeSize = function (out) {
      const s = baseCompute.call(this, out);
      s[0] = Math.min(MAX_W, Math.max(s[0], contentWidth(this))); // width range
      return s; // s[1] stays the natural content height (widget count)
    };
    node.onResize = function (size) {
      size[0] = Math.max(contentWidth(this), Math.min(size[0], MAX_W)); // resize width…
      size[1] = this.computeSize()[1]; // …but height is fixed to content (no taller)
    };
    node.configure = function (info) {
      baseConfigure.call(this, info);          // restore saved size + (stale) color…
      this.color = COLOR;                      // …but always use the current palette color
      if (this.size) {
        this.size[0] = Math.min(MAX_W, Math.max(this.size[0], contentWidth(this)));
        this.size[1] = this.computeSize()[1]; // …snap height to content on load
      }
    };
    node.size = node.computeSize();
    iconize(node);
  }
  // Draw the block's filled/colored SVG icon in place of litegraph's default title box.
  function iconize(node) {
    node.onDrawTitleBox = function (ctx, title_height) {
      if (global.PatronIcons && global.PatronIcons.has(this.type)) {
        global.PatronIcons.drawTitleBox(ctx, this.type, title_height);
      }
    };
  }
  function textW(node, name) {
    node.addWidget("text", name, node.properties[name], (v) => (node.properties[name] = v));
  }
  // precision = decimal places shown (litegraph defaults to 3 → "1024.000"); pass 0 for
  // integers, 2 for fractions. min/max are also handed to litegraph so drag-edits clamp.
  function numW(node, name, min, max, precision) {
    node.addWidget("number", name, node.properties[name], (v) => {
      let n = Number(v);
      if (min != null) n = Math.max(min, n);
      if (max != null) n = Math.min(max, n);
      node.properties[name] = n;
    }, { min: min == null ? undefined : min, max: max == null ? undefined : max, precision: precision == null ? 2 : precision });
  }
  function toggleW(node, name) {
    node.addWidget("toggle", name, node.properties[name], (v) => (node.properties[name] = v));
  }
  function comboW(node, name, values) {
    node.addWidget("combo", name, node.properties[name], (v) => (node.properties[name] = v), { values });
  }

  function register(LiteGraph) {
    // --- Trigger (Observer): the entry point; carries agent-level id ----------
    function Trigger() {
      this.addOutput("task", TYPES.TASK);
      this.addProperty("agent_id", "news-morning-ai");
      this.addProperty("trigger_type", "schedule");
      // Schedule fields — used only when trigger_type === "schedule"; they drive the
      // agent_scheduler job that fires this agent (cron + IANA timezone).
      this.addProperty("cron", "0 7 * * *");
      this.addProperty("timezone", "Europe/Lisbon");
      textW(this, "agent_id");
      comboW(this, "trigger_type", ["schedule", "channel"]);
      textW(this, "cron");
      textW(this, "timezone");
      apply(this, 150);
    }
    Trigger.title = "Trigger";
    Trigger.desc = "Entry point (Observer). Fires the agent; holds its id.";

    // --- RAG (Builder): optional retrieve-then-inject -------------------------
    function Rag() {
      this.addInput("task", TYPES.TASK);
      this.addOutput("context", TYPES.CONTEXT);
      this.addProperty("rewriter", "cv_query_rewriter");
      this.addProperty("domains", "");
      this.addProperty("use_graph", true);
      textW(this, "rewriter");
      textW(this, "domains");
      toggleW(this, "use_graph");
      apply(this, 110);
    }
    Rag.title = "RAG";
    Rag.desc = "Builder: retrieve-then-inject (rewriter + domains + graph).";

    // --- Brain (Factory/Strategy): the agent_server preset + input -----------
    function Brain() {
      this.addInput("in", TYPES.TASK);       // task or context
      this.addInput("tools", TYPES.TOOLS);    // optional tool attachment
      this.addOutput("result", TYPES.RESULT);
      this.addProperty("persona", "news_curator");
      this.addProperty("temperature", 0.3);
      this.addProperty("max_tokens", 1024);
      this.addProperty("input_template", "Curate the {n} best morning headlines about {topic}.");
      this.addProperty("input_vars", '{"n": 5, "topic": "AI agents"}');
      textW(this, "persona");
      numW(this, "temperature", 0, 2, 2);
      numW(this, "max_tokens", 1, null, 0);
      textW(this, "input_template");
      textW(this, "input_vars");
      apply(this, 170);
    }
    Brain.title = "Brain";
    Brain.desc = "Factory/Strategy: agent_server preset + input (runs the tool loop).";

    // --- Tools (Decorator): MCP allow-list attached to the brain --------------
    function Tools() {
      this.addOutput("tools", TYPES.TOOLS);
      this.addProperty("server", "mcp");
      this.addProperty("allow", "mcp__newsapi_search, mcp__fetch_url");
      this.addProperty("max_rounds", 3);
      textW(this, "server");
      textW(this, "allow");
      numW(this, "max_rounds", 1, null, 0);
      apply(this, 110);
    }
    Tools.title = "Tools";
    Tools.desc = "Decorator: MCP server + tool allow-list + loop cap.";

    // --- Guardrail (Proxy): optional output check -----------------------------
    function Guardrail() {
      this.addInput("result", TYPES.RESULT);
      this.addOutput("result", TYPES.RESULT);
      this.addProperty("forbidden", "");
      this.addProperty("min_confidence", 0.5);
      textW(this, "forbidden");
      numW(this, "min_confidence", 0, 1, 2);
      apply(this, 90);
    }
    Guardrail.title = "Guardrail";
    Guardrail.desc = "Proxy: reject forbidden patterns / low-confidence output.";

    // --- Deliver: the delivery stage; routes a result to a destination block --
    // Generic on purpose — it separates "deliver the result" from "to which
    // channel". v0 carries no config; output-formatting options land here when
    // the DSL adds them. Lowers (with its destination) to delivery:{channel,target}.
    function Deliver() {
      this.addInput("result", TYPES.RESULT);
      this.addOutput("to", TYPES.DESTINATION);
      apply(this, 60);
    }
    Deliver.title = "Deliver";
    Deliver.desc = "Delivery stage → connect a destination block (WhatsApp/TTS/Bus).";

    // --- Channel destination blocks: the "where" (one per channel) ------------
    // Each is a friendly macro-block that lowers to delivery.channel = <its channel>
    // + delivery.target = <target>. Add a channel ⇒ add a block, no DSL change.
    function destination(channel, defaultTarget, targetLabel) {
      function Dest() {
        this.addInput("to", TYPES.DESTINATION);
        this.addProperty("target", defaultTarget);
        this.addWidget("text", targetLabel || "target", this.properties.target, (v) => (this.properties.target = v));
        node_apply(this, 60);
      }
      Dest.title = channel.charAt(0).toUpperCase() + channel.slice(1);
      Dest.desc = "Destination: deliver via " + channel + ".";
      Dest._channel = channel;
      return Dest;
    }
    function node_apply(n, h) { // destination tint — softer slate
      n.color = "#8193ad"; n.size = [200, h]; iconize(n);
      const base = n.configure;
      n.configure = function (info) { base.call(this, info); this.color = "#8193ad"; }; // ignore stale serialized color
    }

    const WhatsApp = destination("whatsapp", "351961050313@c.us", "chat id");
    WhatsApp.title = "WhatsApp";
    const Tts = destination("tts", "default", "voice/session");
    Tts.title = "TTS";
    const Bus = destination("bus", "ops-dashboard", "stream id");
    Bus.title = "Bus";

    const REGISTRY = [
      ["patron/agent/trigger", Trigger],
      ["patron/agent/rag", Rag],
      ["patron/agent/brain", Brain],
      ["patron/agent/tools", Tools],
      ["patron/agent/guardrail", Guardrail],
      ["patron/agent/deliver", Deliver],
      ["patron/dest/whatsapp", WhatsApp],
      ["patron/dest/tts", Tts],
      ["patron/dest/bus", Bus],
    ];
    REGISTRY.forEach(([path, ctor]) => LiteGraph.registerNodeType(path, ctor));
    return REGISTRY.map(([path]) => path);
  }

  // Palette group for the toolbox (app.js renders it).
  const PALETTE = {
    group: "Agent (runtime DSL)",
    color: COLOR,
    items: [
      { type: "patron/agent/trigger", label: "Trigger" },
      { type: "patron/agent/rag", label: "RAG" },
      { type: "patron/agent/brain", label: "Brain" },
      { type: "patron/agent/tools", label: "Tools" },
      { type: "patron/agent/guardrail", label: "Guardrail" },
      { type: "patron/agent/deliver", label: "Deliver" },
    ],
  };

  // Destination (channel) blocks — a separate palette group.
  const DESTINATIONS = {
    group: "Destinations",
    color: "#8193ad",
    items: [
      { type: "patron/dest/whatsapp", label: "WhatsApp" },
      { type: "patron/dest/tts", label: "TTS" },
      { type: "patron/dest/bus", label: "Bus" },
    ],
  };

  global.PatronAgentNodes = { TYPES, PALETTE, DESTINATIONS, register };
})(window);
