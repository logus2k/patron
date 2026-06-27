# Patron — Source Format (the authored graph)

What Patron *produces*: the serialized node-graph a human authors on the canvas. This is the **durable,
DSL-independent side** of Patron. The compiler (`js/compile.js`) *reads* this format and lowers it to the
runtime DSL — but the runtime DSL is still being hardened by `agent_runtime`, so:

> **This document describes the source side, which is stable. The lowering (which DSL fields each node
> becomes) is PROVISIONAL and lives in `js/compile.js` — it will be re-pointed when the canonical DSL
> lands. When the two disagree, the *node catalog* below is authoritative for authoring; the lowering
> table in `compile.js` is authoritative for the current DSL target.**

See `session_guide.md` for *why* the two sides are separate (the two-audience principle). This doc is the
*what*: the concrete shape of a Patron graph.

---

## 1. The container: a litegraph `serialize()` object

A Patron document **is** a [litegraph](https://github.com/jagenjo/litegraph.js) graph, serialized with
`LGraph.serialize()`. The compiler consumes this plain object directly (no DOM, no litegraph runtime —
that is why `compile()` is pure and node-testable). The fields the compiler reads:

```jsonc
{
  "version": 0.4,            // litegraph serialize version — visual cruft, ignored by compile
  "last_node_id": 5,         //   "
  "last_link_id": 4,         //   "
  "nodes": [ /* see §3 */ ], // ← the only semantically load-bearing array
  "links": [ /* see §4 */ ], // edges; the compiler reads them only to resolve structure
  "groups": [], "config": {}, "extra": {}   // visual/editor state — stripped, never reach the DSL
}
```

**Everything visual is cruft and is stripped at lowering time**: `pos`, `size`, node colors, widget render
state, `groups`, `last_*_id`, `version`. The runtime DSL is semantic-only. The canonical hand-authored
example is [`examples/news-agent.graph.json`](../examples/news-agent.graph.json), which doubles as the
compiler test fixture.

---

## 2. Typed slots — the data that flows between nodes

Edges are typed; the editor only lets you connect matching slot types (defined in
[`js/agent_nodes.js`](../js/agent_nodes.js) `TYPES`). The compiler does not yet *trace* links to derive
order (the v0 shape is linear and inferred by node presence), but the slot types are the contract for what
*can* connect, and they will be how branching graphs are lowered later.

| Slot type     | Carries                                   | Produced by        | Consumed by         |
|---------------|-------------------------------------------|--------------------|---------------------|
| `task`        | the work request                          | Trigger            | RAG, Brain          |
| `context`     | assembled prompt bundle (retrieve→inject) | RAG                | Brain               |
| `tools`       | an MCP tool allow-list                    | Tools              | Brain               |
| `result`      | an execution output                       | Brain, Guardrail   | Guardrail, Deliver  |
| `destination` | "deliver this result via a channel"       | Deliver            | a destination block |

---

## 3. Node catalog

Nine node types in two families. **Node `type` ids are the stable identity** — they must match between
`agent_nodes.js` (registration), `compile.js` (`NODE` / `DEST_CHANNEL`), and any hand-authored graph.
Each node's `properties` object holds the authored config (the only part of a node the compiler reads).

### 3a. Agent nodes — `patron/agent/*`

The runtime-aligned vocabulary. The parenthetical names a conceptual GoF role (inspiration only).

| `type`                   | Role        | Slots (in → out)            | `properties`                                                          |
|--------------------------|-------------|-----------------------------|----------------------------------------------------------------------|
| `patron/agent/trigger`   | Observer    | — → `task`                  | `agent_id`, `trigger_type` (`schedule`\|`channel`)                    |
| `patron/agent/rag`       | Builder     | `task` → `context`          | `rewriter`, `domains` (CSV), `use_graph` (bool)                       |
| `patron/agent/brain`     | Factory     | `task`+`tools` → `result`   | `persona`, `temperature`, `max_tokens`, `input_template`, `input_vars` (JSON string) |
| `patron/agent/tools`     | Decorator   | — → `tools`                 | `server`, `allow` (CSV of `srv__tool`), `max_rounds`                  |
| `patron/agent/guardrail` | Proxy       | `result` → `result`         | `forbidden` (CSV), `min_confidence`                                   |
| `patron/agent/deliver`   | —           | `result` → `destination`    | *(none in v0 — a structural stage; output-formatting lands here later)* |

Notes that are easy to get wrong:
- **`Brain.input_vars` is a JSON *string***, e.g. `"{\"n\": 5, \"topic\": \"AI agents\"}"`. The compiler
  `JSON.parse`s it and reports a clear authoring error if it is malformed. It pairs with `input_template`
  (`"Curate the {n} best ... about {topic}."`).
- **CSV properties** (`domains`, `allow`, `forbidden`) are comma-separated in the UI and become arrays at
  lowering (trimmed, blanks dropped).
- **`Trigger` carries the agent-level `agent_id`** — it is the identity of the whole agent, not just the
  trigger.
- **`Deliver` is intentionally config-less in v0.** It separates *"deliver the result"* from *"to which
  channel"* (the next family). Keeping it generic means new output options don't multiply destination blocks.

### 3b. Destination blocks — `patron/dest/*`

Friendly **macro-blocks**: the "where". Each is one channel, with a single `target` property. This is the
clearest case of *palette ≠ DSL 1:1* — three blocks collapse to one DSL field pair.

| `type`                  | Channel    | `target` means      | default                  |
|-------------------------|------------|---------------------|--------------------------|
| `patron/dest/whatsapp`  | `whatsapp` | chat id             | `351961050313@c.us`      |
| `patron/dest/tts`       | `tts`      | voice/session       | `default`                |
| `patron/dest/bus`       | `bus`      | stream id           | `ops-dashboard`          |

**Adding a channel = add a `patron/dest/*` node + one row in `compile.js`'s `DEST_CHANNEL` — no runtime DSL
change, no new Deliver variant.** That is the whole point of the Deliver-stage / destination-block split.

### 3c. GoF demo nodes — `patron/{task_source,builder,factory,proxy,chain_of_responsibility,inspector}`

Present in the editor (`js/patterns.js`) as **conceptual inspiration only**. They are *not* part of the
agent source format and the compiler ignores them. Don't author real agents with them.

---

## 4. Links

`links` is litegraph's edge array; each entry is
`[link_id, origin_node_id, origin_slot, target_node_id, target_slot, type]`:

```jsonc
"links": [
  [1, 1, 0, 3, 0, "task"],        // Trigger.task   -> Brain.in
  [2, 2, 0, 3, 1, "tools"],       // Tools.tools     -> Brain.tools
  [3, 3, 0, 4, 0, "result"],      // Brain.result    -> Deliver.result
  [4, 4, 0, 5, 0, "destination"]  // Deliver.to      -> WhatsApp.to
]
```

In the **v0 linear shape** the compiler derives structure from *node presence*, not by walking links
(a graph has at most one of each agent node + exactly one destination block). Links still matter: they are
what the editor validates against the typed slots, they document intent in a hand-authored fixture, and
they become load-bearing the moment Patron supports branching graphs.

---

## 5. The v0 well-formed graph

What the current compiler accepts as a single linear agent:

- **Required:** exactly one `Trigger`, exactly one `Brain`, exactly one destination block.
- **Optional, at most one each:** `RAG`, `Tools`, `Guardrail`, `Deliver`.
- **`Deliver` is optional** — a destination block alone is enough to lower `delivery`. Deliver becomes
  meaningful when it carries formatting config.
- The compiler rejects un-lowerable graphs **at authoring time** with human-aimed errors (missing Brain,
  >1 destination, malformed `input_vars`, …) — Patron's expressible space stays ⊆ the runtime's executable
  space.

This is *one slice* of the eventual format. Branching/multi-stage graphs, and any node added demand-driven
(the user has floated **Memory**, **Router/escalation**, a separate **STT-in** block), extend §3 the same
way: a new `patron/*` type with `properties`, registered in `agent_nodes.js`, lowered in `compile.js`.

---

## 6. What is stable vs what moves

| Stable (this document)                              | Provisional (`compile.js`, re-pointed when DSL hardens) |
|-----------------------------------------------------|---------------------------------------------------------|
| The container is a litegraph `serialize()` object   | Which DSL `version` string is emitted (`"0.1"`)         |
| Visual fields are cruft and get stripped            | The exact lowering table (node `properties` → DSL keys) |
| Node `type` ids and their `properties`              | DSL nesting (`brain.llm.{…}`, `delivery.{channel,target}`) |
| Typed slots and what connects to what               | Whether order is inferred vs link-traced                |
| Deliver-stage / destination-block split             | The set of recognized channels in `DEST_CHANNEL`        |

Keep the compiler thin. When `agent_runtime` locks the DSL, only the right-hand column changes; everything
a human authors (the left column) should survive.
