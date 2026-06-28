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

  const COLOR = "#2f7d52"; // agent-node title color (distinct from the GoF demo)

  function apply(node, h) {
    node.color = COLOR;
    node.size = [240, h];
  }
  function textW(node, name) {
    node.addWidget("text", name, node.properties[name], (v) => (node.properties[name] = v));
  }
  function numW(node, name, min, max) {
    node.addWidget("number", name, node.properties[name], (v) => {
      let n = Number(v);
      if (min != null) n = Math.max(min, n);
      if (max != null) n = Math.min(max, n);
      node.properties[name] = n;
    });
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
      textW(this, "agent_id");
      comboW(this, "trigger_type", ["schedule", "channel"]);
      apply(this, 90);
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
      numW(this, "temperature", 0, 2);
      numW(this, "max_tokens", 1, null);
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
      numW(this, "max_rounds", 1, null);
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
      numW(this, "min_confidence", 0, 1);
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
    function node_apply(n, h) { n.color = "#5a6f8c"; n.size = [200, h]; } // destination tint

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
    color: "#5a6f8c",
    items: [
      { type: "patron/dest/whatsapp", label: "WhatsApp" },
      { type: "patron/dest/tts", label: "TTS" },
      { type: "patron/dest/bus", label: "Bus" },
    ],
  };

  global.PatronAgentNodes = { TYPES, PALETTE, DESTINATIONS, register };
})(window);
