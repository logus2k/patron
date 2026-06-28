/*
 * compile.js — Patron's draft "lower a graph to the runtime DSL" step.
 *
 * ⚠️ PROVISIONAL. The runtime DSL is being defined by `agent_runtime` (its
 * News-Agent vertical slice). This file targets the *current* v0 sketch in
 * agent_runtime/documents/runtime_dsl_specification.md and WILL be re-pointed
 * when the canonical DSL lands. Treat the lowering table below as the only part
 * expected to change; the source side (the serialized graph it reads) is stable.
 *
 * Pure & dependency-free: it operates on a plain serialized-graph object
 * (litegraph's `serialize()` output), so it runs in the browser (window.PatronCompile)
 * AND in node (module.exports) for testing — no litegraph/DOM needed.
 *
 * v0 scope: lowers a LINEAR agent (one trigger/brain/delivery, optional
 * rag/tools/guardrail) to the flat-record DSL. Graph/branching lowering comes
 * with the graph form, once the DSL is hardened.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PatronCompile = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Agent node type ids (must match js/agent_nodes.js).
  const NODE = {
    TRIGGER: "patron/agent/trigger",
    RAG: "patron/agent/rag",
    BRAIN: "patron/agent/brain",
    TOOLS: "patron/agent/tools",
    GUARDRAIL: "patron/agent/guardrail",
    DELIVER: "patron/agent/deliver", // optional structural stage
  };

  // Channel destination blocks -> the `channel` they lower to. Add a channel by
  // adding an entry here + a node (palette ≠ DSL 1:1: friendly block -> one field).
  const DEST_CHANNEL = {
    "patron/dest/whatsapp": "whatsapp",
    "patron/dest/tts": "tts",
    "patron/dest/bus": "bus",
  };

  const DSL_VERSION = "0.1";

  // Authoring-time validators — kept in sync with agent_runtime/src/agent_runtime/dsl.py.
  // The runtime loads with extra="forbid" + strict field validators, so a graph that
  // lowers to a malformed record is REJECTED at load. Mirroring the rules here keeps
  // Patron's expressible space ⊆ the runtime's executable space (errors aimed at the human).
  const ID_RE = /^[A-Za-z0-9._:-]+$/; // AgentRecord.id
  const TOOL_RE = /^[A-Za-z0-9]+__[A-Za-z0-9_]+$/; // Tools.allow entries: <server>__<tool>

  function csv(s) {
    return String(s || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  /**
   * compile(serializedGraph) -> { ok, dsl } | { ok:false, errors:[...] }
   * `serializedGraph` is `LGraph.serialize()` output: { nodes:[{type,properties,...}], links, ... }.
   */
  function compile(graph) {
    const errors = [];
    const nodes = (graph && graph.nodes) || [];
    const byType = {};
    for (const n of nodes) (byType[n.type] || (byType[n.type] = [])).push(n);

    const one = (type, label, required) => {
      const list = byType[type] || [];
      if (list.length > 1) errors.push(`expected at most one ${label} node, found ${list.length}`);
      if (required && list.length === 0) errors.push(`missing required ${label} node`);
      return list[0] || null;
    };

    const trigger = one(NODE.TRIGGER, "Trigger", true);
    const brain = one(NODE.BRAIN, "Brain", true);
    const rag = one(NODE.RAG, "RAG", false);
    const tools = one(NODE.TOOLS, "Tools", false);
    const guardrail = one(NODE.GUARDRAIL, "Guardrail", false);

    // Delivery destination: exactly one channel block (Deliver stage is optional).
    const dests = nodes.filter((n) => DEST_CHANNEL[n.type]);
    if (dests.length === 0) errors.push("missing a destination block (WhatsApp / TTS / Bus)");
    if (dests.length > 1) errors.push(`expected one destination block, found ${dests.length}`);
    const dest = dests[0] || null;

    const p = (node) => (node && node.properties) || {};

    // input.vars is authored as a JSON string on the Brain node.
    let vars = {};
    if (brain && p(brain).input_vars) {
      try {
        vars = JSON.parse(p(brain).input_vars);
      } catch (e) {
        errors.push(`Brain input_vars is not valid JSON: ${e.message}`);
      }
    }

    // --- value validation (mirrors dsl.py; reject un-lowerable graphs early) -
    if (trigger) {
      const id = String(p(trigger).agent_id || "").trim();
      if (!id) errors.push("Trigger agent_id must not be empty");
      else if (!ID_RE.test(id))
        errors.push(`Trigger agent_id '${id}' must match ^[A-Za-z0-9._:-]+$ (no spaces/special chars)`);
    }
    if (brain && !String(p(brain).persona || "").trim())
      errors.push("Brain persona must be a non-empty preset name");
    if (tools) {
      const bad = csv(p(tools).allow).filter((name) => !TOOL_RE.test(name));
      if (bad.length)
        errors.push(`Tools allow-list entries must match <server>__<tool> (e.g. mcp__web_search); offending: ${bad.join(", ")}`);
      if (Number(p(tools).max_rounds ?? 3) < 1) errors.push("Tools max_rounds must be >= 1");
    }
    if (dest && !String(p(dest).target || "").trim())
      errors.push("Destination target must be non-empty");

    if (errors.length) return { ok: false, errors };

    // --- the (provisional) lowering table -----------------------------------
    const dsl = {
      version: DSL_VERSION,
      id: p(trigger).agent_id || "untitled-agent",
      trigger: { type: p(trigger).trigger_type || "schedule" },
      brain: {
        persona: p(brain).persona || "",
        llm: {
          temperature: Number(p(brain).temperature ?? 0.3),
          max_tokens: Number(p(brain).max_tokens ?? 1024),
        },
      },
    };
    if (rag) {
      dsl.rag = {
        rewriter: p(rag).rewriter || null,
        domains: csv(p(rag).domains),
        use_graph: !!p(rag).use_graph,
      };
    }
    if (tools) {
      dsl.tools = {
        server: p(tools).server || "",
        allow: csv(p(tools).allow),
        max_rounds: Number(p(tools).max_rounds ?? 3),
      };
    }
    if (guardrail) {
      dsl.guardrails = {
        forbidden: csv(p(guardrail).forbidden),
        min_confidence: Number(p(guardrail).min_confidence ?? 0.5),
      };
    }
    dsl.input = { template: p(brain).input_template || "", vars };
    dsl.delivery = { channel: DEST_CHANNEL[dest.type], target: p(dest).target || "" };

    return { ok: true, dsl };
  }

  return { compile, NODE, DSL_VERSION };
});
