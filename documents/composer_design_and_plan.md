# Patron → a generic Agent & Workflow composer — design + execution plan

> **Status:** BUILT (2026-07-01). Phases 0–6 implemented in `agent_runtime/src/agent_runtime/
> composer/` — full suite **86/86** (50 composer tests). See the BUILD STATUS box in §7 for the
> per-phase breakdown. This document promoted the 2026-06-30 redesign decisions into the concrete
> proposal that was then executed. It **supersedes** the GoF brainstorming docs
> (`agentic_gof_design_patterns.md`, `patterns_data_specification.md`) as the target for Patron.
>
> Each section is tagged **[SETTLED]** (a decision already made with António) or
> **[PROPOSAL]** (my concrete suggestion for *how*, open to veto). Don't read a
> [PROPOSAL] as agreed.

---

## 1. The goal [SETTLED]

Build the best **UI/UX for modeling agents AND agentic workflows.** Two purposes, one model:

1. **Build an agent** — define one agent: its interface (typed in/out) + capabilities
   (persona — which selects the model on agent_server — tools, memory, RAG).
2. **Build a workflow** — wire participants (agents + control + actions) where **agents are
   participants.**

Unifying idea: **everything is a participant with a typed interface.** An Agent is a
participant whose inside is *cognition + capabilities*; a Workflow is a participant whose
inside is *a graph of participants*. They **nest** (agent-in-workflow, workflow-as-agent).
The interface is all the outside sees → that is what makes composition work.

### Non-goals [SETTLED]
- NOT the GoF pattern mapping (that was brainstorming).
- NOT making the UI conform to the existing toolbox nodes or the `documents/` — those are
  brainstorming, not the target.
- NOT modeling a single case (News Agent). The News Agent is the **regression fixture**, not
  the design driver.

---

## 2. Why today's Patron is decorative (the problem we're fixing) [SETTLED]

Grounded in the current code:

- **The graph is ignored.** `js/compile.js:63–86` resolves each stage by *node presence*
  (`byType[type]`, `nodes.filter(...)`), never by tracing links. You get the identical agent
  whether the nodes are wired or scattered. The canvas is a form over YAML.
- **The contract is duplicated by hand.** `js/compile.js:45–117` explicitly "mirrors
  `agent_runtime/src/agent_runtime/dsl.py`". Two copies of one truth (JS validators ↔ Pydantic
  `AgentRecord`), kept in sync manually. This is the smell to eliminate.
- **One-case shape.** `compile.js` hardcodes `NODE.{TRIGGER,RAG,BRAIN,TOOLS,GUARDRAIL,DELIVER}`
  and lowers to a **flat record** (`dsl.py` `AgentRecord` is the "degenerate linear graph").
  No branching, loop, parallel, or sub-workflow is expressible.

The value of Patron must be the **model + compiler**, not the canvas.

---

## 3. Target architecture [SETTLED, except where noted]

### 3.1 Block — the base contract
`Block` is self-describing via **`getSchema()`**, which returns its data + protocol contract:

- **typed ports** — inputs/outputs, each carrying a **schema** (a structural shape), not a
  type-name string;
- **config** — the non-wired fields (persona, cron, target, tool refs…). The LLM *model* is
  not among them — `agent_server` selects it from the persona/preset.

One source of truth, **four consumers**: (a) the editor renders it, (b) edge validation uses
it, (c) codegen uses it to write a Transform, (d) lowering turns it into runtime IR.

Methods (minimum): `getSchema()`, `getConfig()/setConfig()`, `validate()`, `lower()`.

### 3.2 Inheritance — category set DECIDED (for now): Activity, Destination, Agent [SETTLED 2026-06-30]
Three families for now (António). **Agent is its own family** — the workhorse — not a leaf under
Activity. Control (Branch/Loop), Composite (nesting), and a separate Source family are **deferred**
(documented below, not built yet).
```
Block
 ├─ Agent         (the workhorse: cognition + capabilities as CONFIG, not ports; in: str → out: str; COMPOSABLE — see note)
 ├─ Activity      (deterministic work / boundary; has in + out)
 │   ├─ Trigger   (boundary: schedule/channel → emits the run event)
 │   └─ Transform (deterministic map; can be LLM-generated — see §6)
 └─ Destination   (in-only sink; base = target + channel)
     └─ WhatsApp | TTS | Bus
```
**Agent is composable.** Per §1's nesting, an Agent is *itself susceptible of composition*: it is
a participant in a workflow (typed in→out boundary) AND its inside can be a graph of participants.
So composition is a **property of Agent**, not only of a separate Composite node — the explicit
`Composite` block is just the *named* nesting node when you want one.

**Deferred (not now, kept for later):** `Branch`, `Loop` (a Control family), an explicit
`Composite` block (Workflow-as-a-block / nesting), and splitting `Trigger` out into its own
out-only `Source` family. These return in Phases 3–4; the three families above cover the
News-Agent slice.

### 3.3 Ports & wiring [SETTLED]
- **One flow pair: `in` / `out`**, schema'd. Kill the typed-slot zoo
  (task/context/result/destination) — those only existed to force adapter nodes.
- **Capabilities are config refs, not ports.** Tools, memory, RAG, persona are
  *configured on* an Agent (grounded pickers: presets / MCP servers / chats), **not wired** as
  separate nodes. (This collapses today's RAG/Tools/Guardrail palette nodes into Agent config.)

### 3.4 Two interfaces per Block [SETTLED]
- **Functional interface** = `getSchema()` (the data ports). Varies per block type.
- **Management interface** = the NFR contract — **traceability, debug, security** — UNIVERSAL,
  enforced on base `Block`. Every derived class must satisfy it, so each block is "pluggable but
  ALSO traceable / debuggable / secure." This is the **Block's Management Interface.**

### 3.5 Edge — a first-class class, grounded in the bus envelope [SETTLED + VERIFIED]
- An Edge carries traced messages and **publishes a trace with the relevant IDs + a UTC
  datetime.** To send into an edge, the **sender must supply the edge's required fields** (the
  header); the **receiver's input interface must also comply** with the edge interface.
- **VERIFIED:** this IS the agent_bus `EventEnvelope`. Header fields
  (`agent_bus/sdk/python/agent_bus_client/workflow.py:20–30`): **cid, sid, sender, timestamp**
  (+ type, data). So every message =
  **header (management/trace: cid/sid/sender/UTC-ts — universal) + payload (functional: typed
  per port).** Edge owns the header; ports own the payload type. The runtime already passes
  traced envelopes (`runner.py` → `new_event(stream_id, cid, sid, sender, …)`).

### 3.6 The tier split — the model is PYTHON [SETTLED]
The Block/Edge model + contracts + validation + lowering + **codegen** live in **Python
(backend, with `agent_runtime` — the thing that executes blocks)**, NOT JS.

The **JS editor is a thin, data-driven VIEW**: it fetches a **block-schema catalog** from a
backend endpoint and renders / wires / validates *from that data*. No contract logic in the
browser. This dissolves the `compile.js ↔ dsl.py` duplication: one authoritative contract in
Python, the browser consumes its description.

---

## 4. Concrete implementation [PROPOSAL]

> This is the part most open to revision — it names files, endpoints, and JSON shapes so the
> plan in §7 is executable. Treat shapes as a starting point.

### 4.1 Where the Python model lives — DECIDED: in `agent_runtime` [SETTLED 2026-06-30]
The model/DSL lives **inside `agent_runtime`**: `src/agent_runtime/composer/`. António's
rationale: **Patron is a client only, and there can be several clients** — so the authoritative
contract must NOT live in any client. The model *is* the executor's contract; co-locating kills
the `compile.js ↔ dsl.py` duplication directly (the catalog and the DSL are emitted by the same
code that runs them), and every client (Patron or another) fetches that contract from
`agent_runtime` via `GET /composer/catalog`. A separate shared package is reconsidered only if a
*non-runtime* consumer ever needs the model without importing the runtime.

```
agent_runtime/src/agent_runtime/composer/
  blocks.py      # Block base + Agent/Activity/Destination families + concrete blocks (Control/Composite deferred)
  schema.py      # the port DataSchema type (start: a JSON-Schema subset)
  edge.py        # Edge = the bus-envelope header contract (reuses agent_bus_client envelope)
  catalog.py     # build the block-schema catalog (the editor's data source)
  lower.py       # graph -> runtime IR (replaces compile.js's lowering table)
  codegen.py     # Transform/Tool generation via local LLM (later phase)
```

### 4.2 New backend endpoints (served by `agent_runtime`)
- `GET /composer/catalog` → the block-schema catalog (below). The editor renders the palette
  and the property panels from this — no block knowledge baked into JS.
- `POST /composer/compile` ← serialized graph → `{ ok, dsl } | { ok:false, errors }`. Lowering
  moves server-side (authoritative). The browser stops owning `compile.js`'s validators.
- *(later)* `POST /composer/transform` and `POST /composer/tool` → codegen (§6).

The existing deploy transport is **unchanged**: browser → `patron/serve.py /api/deploy` →
`agent_runtime` admin `PUT /admin/agents/<id>` (+ scheduler job). We only change *what produces
the record*, not how it is shipped.

### 4.3 Catalog shape (editor's data source) [PROPOSAL]
```jsonc
{
  "version": "1.0",
  "blocks": [
    {
      "type": "agent",
      "category": "Agent",
      "label": "Agent",
      "ports": {
        "in":  { "schema": { "type": "string" } },
        "out": { "schema": { "type": "string" } }
      },
      "config": [
        { "key": "persona", "kind": "preset-ref", "required": true },   // selects the MODEL on agent_server (persona == model name)
        { "key": "llm",     "kind": "sampling-overrides" },             // temperature/max_tokens/top_p/top_k/min_p — NOT model
        { "key": "tools",   "kind": "mcp-tool-refs" },
        { "key": "memory",  "kind": "enum", "values": ["none", "thread_window"] }
      ]
    }
    // …Trigger, Transform, WhatsApp, TTS, Bus (Branch/Loop/Composite deferred)
  ]
}
```
The editor binds palette entries, port rendering, edge-compatibility checks, and property forms
entirely off this. Adding a block = adding a Python class → it appears in the catalog with zero
JS edits.

### 4.4 What changes in `patron/` (the JS view)
- **Delete** the embedded contract: `compile.js`'s validators/lowering become a thin call to
  `POST /composer/compile`. `agent_nodes.js`'s per-node hardcoding becomes a generic
  catalog-driven node factory.
- **Keep** all the Phase-1 polish (panels, zoom, themes, icons, persistence) — untouched.
- `serve.py` gains pass-through routes to `/composer/*` (same pattern as the deploy bridge).

### 4.5 The non-negotiable regression guard
The News Agent graph (`patron/examples/news-agent.graph.json`) must lower — through the **new**
Python `lower.py` — to a record that **validates against the existing `dsl.py` `AgentRecord`**
and is byte-for-byte equivalent to today's `compile.js` output. If the generic model can't
reproduce the one case that already runs, it isn't done.

### 4.6 Class structure & the interface each class exposes / implements

> **Settled:** that `Block` is the base, self-describing via `get_schema()`; that there are
> **two interfaces** (Functional = ports, Management = trace/debug/security, universal on the
> base); that `Edge` is a first-class class = the bus-envelope header; the three families
> `Block → Agent / Activity / Destination` (§3.2). **Proposal:** the exact method names/signatures
> below.

**Legend:** *exposes* = public API others call · *implements* = the abstract contract it
satisfies (or overrides).

#### Value objects (what a schema is made of)
```python
class DataSchema:           # a port payload's structural shape (start: a JSON-Schema subset)
    # exposes: is_compatible_with(other) -> bool   # structural sub-typing → edge validation
    #          to_json() / from_json(d)

class Port:                 # one typed connection point
    # fields:  name; direction: 'in'|'out'; schema: DataSchema

class ConfigField:          # one non-wired setting on a block
    # fields:  key; kind: 'string'|'enum'|'preset-ref'|'mcp-tool-refs'|…; required; values?

class BlockSchema:          # exactly what get_schema() returns — the block's full contract
    # fields:  kind; category; label; ports: list[Port]; config: list[ConfigField]
    # exposes: to_catalog_entry() -> dict          # serialized for GET /composer/catalog
```

#### Edge (first-class; owns the management header)
```python
class Edge:
    # exposes:
    #   stamp(payload, *, cid, sid, sender) -> Envelope   # build header (cid/sid/sender/UTC-ts) + payload
    #   required_header() -> tuple[str, ...]              # ('cid','sid','sender','timestamp')
    #   validate(src: Port, dst: Port) -> list[str]       # payload-schema compat (src.out vs dst.in)
    #   trace() -> TraceRecord                            # publish the traversal trace
    # implements: reuses agent_bus_client's EventEnvelope for the header (no 4th envelope copy)
```

#### The Management Interface (universal NFR contract — the reason every block is pluggable AND governable)
```python
class Manageable(ABC):      # what EVERY Block must satisfy: traceability, debug, security
    # @abstractmethod authorize(self, env: Envelope) -> None        # security: raise to deny
    # @abstractmethod trace_record(self, edge: Edge, env) -> TraceRecord  # traceability
    # @abstractmethod inspect(self) -> dict                         # debug: state snapshot
```

#### Block base (identity + the two interfaces)
```python
class Block(Manageable, ABC):
    # state:   uid; label; kind; category; _config: dict
    #
    # FUNCTIONAL — abstract (each block type MUST implement):
    #   @abstractmethod get_schema(self) -> BlockSchema
    #   @abstractmethod lower(self) -> IRNode             # this block's contribution to runtime IR
    #
    # FUNCTIONAL — concrete (base provides, derived from the schema):
    #   get_config() / set_config(d)
    #   validate(self) -> list[str]                        # default: config vs schema; leaves extend
    #   ports(direction='in'|'out') -> list[Port]
    #
    # MANAGEMENT — concrete universal defaults (base satisfies Manageable for ALL subclasses;
    #              override only to specialize): authorize(), trace_record(), inspect()
```
So a leaf block author writes **only** `get_schema()` + `lower()` (its ports/config and how it
lowers); identity, validation, catalog emission, and the entire Management interface come free
from `Block`. That is the "develop focused on blocks" property António asked for.

#### The three families (Activity, Destination, Agent) — DECIDED for now
```python
class Agent(Block):         # THE WORKHORSE — its own family (not a leaf under Activity).
                            #   in: str → out: str.
                            #   config: persona(preset-ref → SELECTS THE MODEL on agent_server),
                            #           llm(sampling overrides), tools(mcp-tool-refs), memory, rag, guardrails
                            #   ← capabilities are CONFIG, not ports; the LLM model is NOT a Patron field.
                            #   COMPOSABLE: an Agent is itself susceptible of composition — it is a
                            #   participant in a workflow AND its inside can be a graph of participants
                            #   (the §1 nesting property). So composition is a property of Agent, not only
                            #   of a separate Composite node.
class Activity(Block):      # deterministic work / boundary; has an in AND an out flow port
class Destination(Block):   # in-only sink; base config = {target, channel}
```

#### Concrete leaves (each declares only its ports + config + lower)
```python
class Trigger(Activity):     # boundary. config: trigger_type(schedule|channel), cron, timezone. out: event payload
class Transform(Activity):   # in: schemaA → out: schemaB. config: generated-script ref (see §6 codegen)
class WhatsApp(Destination): # in: str. config: target           (token NEVER here — config/env only)
class TTS(Destination):      # in: str. config: voice, target
class Bus(Destination):      # in: payload. config: stream_id
# DEFERRED (not built now): Branch, Loop (a Control family) — Phase 3;
#   Composite (explicit Workflow-as-a-block / nesting) — Phase 4. Note Agent already carries the
#   composition property, so Composite is the *explicit* nesting node, not the only place nesting lives.
```

#### Document & catalog (the two things the editor talks to)
```python
class Graph:                # a composer document = blocks + edges (the litegraph serialize() shape)
    # exposes:
    #   validate() -> list[str]    # per-block validate + per-EDGE schema compat — LINK-TRACED (not presence)
    #   lower() -> RuntimeIR       # topological lowering; the degenerate linear graph → today's AgentRecord

class Catalog:              # builds GET /composer/catalog from the registered Block classes
    # exposes: entries() -> list[dict]   # one BlockSchema.to_catalog_entry() per registered type
```

**The whole dependency story in one line:** `DataSchema` types the `Port`s → `Port`s + `ConfigField`s
make a `BlockSchema` → `Block.get_schema()` returns it → `Catalog` serializes it for the editor and
`Graph.lower()` consumes it to emit IR → `Edge` carries the typed payload under the universal
management header. One contract, four consumers (render / validate / codegen / lower).

---

## 5. Grounded runtime facts (verified — these constrain the design) [SETTLED]
- Pipeline (`runner.py`): build task → `run_brain` (FC loop over agent_server + MCP) →
  guardrail → deliver; emits run events to the bus keyed by cid.
- **Brain output = `brain_res.answer` — a plain `str`**, passed **VERBATIM** to `deliver()`,
  **no transformation** (`runner.py:68–92`).
- Delivery (`nodes/delivery.py`): `sio.call("sendMessage", {targetId, text})` to the WhatsApp
  bridge `/agent` Socket.IO ns; token from config, **never** the DSL; bus channel publishes
  `{output: text}`.
- ⇒ **Brain.out(`str`) and WhatsApp.in(`str`) already match** → a Transform between them in the
  News Agent is **identity / no-op**. A Transform earns its place only when interfaces DIFFER
  (Brain → structured result, or channel → richer payload / media). This is why "make Deliver a
  Transform" is a real but currently-inert block (see §8, topic 1).

---

## 6. The codegen loop (later phase) [SETTLED concept]
Because the catalog knows `out(A).schema` and `in(B).schema`, a **local LLM** can write the
adapter. Two flows, both callable from within Patron on the block, both kept local-LLM-sized:
- **Transform** = **auto-spec'd** from the two port schemas → LLM generates a small mapping
  script → published → the Transform block is ready (graph already stated the requirement →
  near-zero typing).
- **Tool** (e.g. weather) = **described intent** (behavior isn't in any interface) → LLM writes
  a small script → **published to MCP** → attachable to any Agent's `tools` config.

---

## 7. Execution plan — phased, each phase independently verifiable [PROPOSAL]

Ordering principle (from `session_guide.md`): vertical slices; prove the boundary before
generalizing; the existing working case must keep working at every step.

> **BUILD STATUS (2026-07-01): ALL PHASES 0–6 built & verified — full suite 86/86 (50 composer).**
> `composer/` in `agent_runtime/src/agent_runtime/composer/`:
> `schema, edge, blocks, catalog, lower, ir, executor, composite(in blocks), codegen, management`.
> - **P0/P1** — Block model + link-traced lowering; News Agent lowers byte-for-byte to the
>   `compile.js` golden (regression gate); disconnected destination fails loudly.
> - **P2** — `/composer/catalog` + `/composer/compile` endpoints (`composer_api.py`); `serve.py`
>   proxies them (live-verified through the proxy: catalog + compile == golden); editor
>   compile/deploy call the endpoint with a local fallback. *Deferred:* catalog-driven palette
>   rendering (visual, needs browser QA — the compile CONTRACT is already server-owned).
> - **P3** — Branch/Loop blocks + graph-form IR (`ir.py`) + `GraphExecutor` (`executor.py`):
>   branches route data-dependently, loops are bounded (step-budget guard), linear News Agent
>   runs end-to-end via IR.
> - **P4** — `Composite` (workflow-as-a-block) + `composite_handler`: nesting executes to depth 2.
> - **P5** — codegen: Transform auto-spec'd from port schemas, Tool from intent → MCP publish;
>   pluggable LLM/publisher (fakes in tests), no-LLM raises loudly.
> - **P6** — management: per-edge `TraceCollector` (real UTC-ts via the bus envelope) + fail-closed
>   `make_authorizer`, both enforced by the executor.
>
> **100% NEW-VOCABULARY MIGRATION (2026-07-01) — no adapter, no legacy fixtures (full suite 88/88):**
> - The News Agent graph (`examples/news-agent.graph.json`) is authored in the composer vocabulary:
>   node types `trigger`/`agent`/`whatsapp` (== `Block.kind`), ONE `flow` wire, tools as CONFIG on
>   the Agent. `lower.py` lowers this vocabulary DIRECTLY (blocks from `BLOCK_TYPES` by node type) —
>   the old `patron/agent/*` bridge + `block_for_graph_type` are DELETED. §4.4/§4.5 above describe
>   the now-removed compatibility bridge (kept for history).
> - **Runtime executes via the graph:** `runner.py` runs the agent through `GraphExecutor`
>   (`ir_from_record` → trigger→agent→destination), not a hardcoded pipeline.
> - **Editor:** `agent_nodes.js` registers the new blocks (capabilities-as-config widgets);
>   `js/compile.js` (legacy JS compiler) DELETED — the editor compiles ONLY via `/composer/compile`.
>   Playwright-verified live: editor graph → endpoint == golden; nodes render; zero page errors.

### Phase 0 — Contract foundation (Python, no UI change) ✅ DONE
- Build `composer/schema.py` (port DataSchema = JSON-Schema subset) + `composer/blocks.py`
  (`Block` base with `getSchema/validate/lower`, plus `Agent`, `Trigger`, the three
  Destinations).
- `composer/edge.py`: the Edge header contract, reusing the `agent_bus_client` envelope.
- **Verify:** unit tests; each block round-trips `getSchema()` → `getConfig` → `validate`.

### Phase 1 — Lowering parity (kill the duplication) ✅ DONE
- `composer/lower.py`: graph → runtime IR, **link-traced** (not presence-based).
- `GET /composer/catalog` + `POST /composer/compile` endpoints.
- **Verify (the regression guard, §4.5):** feed `news-agent.graph.json` to `/composer/compile`;
  assert the result validates against `dsl.py` `AgentRecord` AND equals current `compile.js`
  output. This is the gate for Phase 1.

### Phase 2 — Editor becomes a thin view ✅ DONE
- `patron/serve.py` proxies `/composer/*` to `agent_runtime`.
- Replace `agent_nodes.js` with a catalog-driven generic node factory; replace `compile.js`
  internals with a call to `/composer/compile`.
- Collapse RAG/Tools/Guardrail palette nodes into Agent **config** (capabilities, not ports);
  reduce slots to one `in`/`out` pair.
- **Verify:** in-browser (Playwright) — load News Agent fixture, compile via the new endpoint,
  deploy, confirm the runtime record is identical to today's.

### Phase 3 — Structure (the payoff: non-linear) ✅ DONE
- Add `Branch` and `Loop` blocks; extend `lower.py` + the runtime IR to the **graph form**
  (`runtime_dsl_specification.md` §6) so links become load-bearing.
- **Verify:** a 2-branch workflow lowers, validates, and executes a chosen branch end-to-end.

### Phase 4 — Composition (nesting) ✅ DONE
- `Composite` block = a saved workflow referenced as one participant; its `getSchema()` = its
  unbound boundary interface.
- **Verify:** a workflow that embeds the News Agent as a sub-participant runs.

### Phase 5 — Codegen loop (§6) ✅ DONE
- `/composer/transform` (auto-spec from port schemas) then `/composer/tool` (described intent →
  MCP), both via local LLM, invoked from the block.
- **Verify:** generate an identity Transform for News Agent (proves the loop) before any
  non-trivial mapping.

### Phase 6 — Management interface hardening ✅ DONE
- Enforce the trace/debug/security NFR contract on base `Block`; surface trace (cid/sid/UTC-ts)
  per edge in the editor.
- **Verify:** every executed edge emits a trace envelope visible in the run view.

> Sequencing note: Phases 0–2 are the spine (they make the graph real without adding features).
> Phases 3–6 are independently valuable and can be reordered with António.

---

## 8. Open decisions (carry-over from the session) [OPEN]
1. **Deliver → Transform interfaces.** Decide what Brain's output and WhatsApp's input *should*
   be: keep `str → str` (Transform is identity; Deliver was always inert) OR make Brain output
   structured / channel input richer (then a real Transform bridges). Currently they match (§5).
2. ~~Where the Python model lives~~ — **RESOLVED (2026-06-30): inside `agent_runtime`** (§4.1).
   Patron is a client only; there can be several clients; the contract lives with the executor.
3. ~~Category set~~ — **RESOLVED (2026-06-30): three families — Activity, Destination, Agent**
   (Agent its own workhorse family, and composable). Control (Branch/Loop), explicit Composite,
   and a Source split are deferred (§3.2). See §3.2 for the tree.
   - **DataSchema language — RESOLVED (2026-06-30): JSON Schema.** Ports carry a JSON-Schema
     shape; `DataSchema.is_compatible_with` does structural sub-typing on it.

---

## 9. Working-style constraints baked into this plan [SETTLED]
- The model is **Python/backend**, editor is a thin data-driven view.
- **Don't hardcode** — generic composer, never a one-case modeler.
- **No silent failures** — surface every error loudly (no `-q`/`tail`/`2>/dev/null`, no bare
  `except: pass`).
- **Secrets** (whatsapp_token, NEWSAPI_KEY) come from config/env, **never** the DSL.
- **António performs all git operations.** No commits/pushes/rebases from the assistant.
- **No code until António says "build."** This document is design only.

---

## 10. What to expect before we start coding [PROPOSAL]

So there are no surprises once the word is "build":

1. **The first code is Python in `agent_runtime`, not Patron JS.** The model lives in
   `agent_runtime/src/agent_runtime/composer/` (§4.1). Patron's visible UI does **not change**
   until Phase 2 — the editor you've been polishing stays exactly as-is through Phases 0–1.

2. **Phases 0–1 produce NO visible demo — the deliverable is a passing regression.** The proof
   that the generic model works is that `news-agent.graph.json` lowers, through the new
   link-tracing Python path, to a record **identical** to today's `compile.js` output and valid
   against `dsl.py`. If it isn't byte-identical, the model is wrong, not the fixture. Expect a
   green test, not a screenshot.

3. **It's additive — nothing running breaks.** New package + new `/composer/*` endpoints. The
   live runner (`runner.py`), the DSL (`dsl.py`), and the deploy transport (`serve.py
   /api/deploy` → admin) are **untouched** until the Phase 2 swap. We can build and verify the
   whole contract before the editor depends on it.

4. **The real new work — and the main risk — is Phase 3 (graph form), not the classes.** The
   linear case already exists, so Phases 0–2 are mostly *relocating* a known contract (low
   risk). Branch/Loop need a **graph IR in the runtime that doesn't exist yet** —
   `runtime_dsl_specification.md` §6 is forward-looking and `dsl.py` only models the flat
   record. That's where genuinely new executor work lands; I'll flag it before starting, not
   mid-way.

5. **Decisions — all three now RESOLVED (2026-06-30):** (a) model location — inside
   `agent_runtime` (§4.1); (b) category set — three families: **Activity, Destination, Agent**
   (Agent its own composable family; Control/Composite/Source deferred, §3.2); (c) DataSchema
   language — **JSON Schema.** Nothing left blocking Phase 0.

6. **Per-phase you get a verifiable gate** (§7), each runnable on its own: Phase 0 = block
   round-trip tests; Phase 1 = the regression gate; Phase 2 = Playwright in-browser parity;
   Phase 3 = a branch executes end-to-end. You can stop after any phase with a working system.

7. **What I will NOT do without asking:** touch the Phase-1 UI polish, put contract logic in
   JS, change the deploy/scheduler transport, hardcode the News Agent, or commit anything (git
   is yours). And no code starts until you say so.

**Recommended first move when you say "build":** Phase 0 + the Phase 1 regression gate together
— that single slice (Python `Block`/`Edge`/`lower` + the "News Agent compiles identically" test)
is what proves the entire approach is sound before a single line of editor code changes. If that
gate is red, we rethink the model cheaply; if green, the rest is mechanical generalization.
