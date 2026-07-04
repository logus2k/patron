# Spec — Data (JSON) Block + Agent `vars` Port

**Status:** DRAFT · PROPOSAL (nothing implemented) · 2026-07-04
**Scope:** Patron (authoring) + `agent_runtime/composer` (schema + lowering) + `agent_runtime` runner (Phase 2 only)
**Owner decision required before any code** — see §9.

---

## 1. Problem (grounded)

An Agent's prompt (`input_template`) can reference named variables — `{topic}`, `{date}` — and
those names are declared in **`input_vars`** (a JSON object on the Agent). At run time the runner
resolves each name from ([runner.py:531](../../agent_runtime/src/agent_runtime/runner.py#L531)):

```python
merged = { **record.input.vars, "input": incoming, **overrides }
task   = template.format(**merged)
#          defaults          payload         event.payload.data.vars
```

So `input_vars` are **defaults**, meant to be overridden per-run by the **triggering event's
`payload.data.vars`**. The problem, verified across the stack:

- **No initiator block in Patron can author that `vars` payload.** Trigger has only `task`; Web
  Initiator has `route`; File Initiator has `watch_path`. None carries `vars`.
- Therefore, for anything triggered from Patron's own initiators, `vars` is **always the static
  default** — nothing overrides it. The feature reads as redundant with inlining the value.
- The whole override mechanism (`event.payload.data.vars`) is **invisible and un-authorable** in
  the UI — a user cannot discover or use it.

**Goal:** give the author a *visual, wire-able* way to supply an Agent's variables/config, so
`input_vars` becomes meaningful, and cover the case where those values arrive dynamically (e.g. a
file picked up by a File Initiator).

---

## 2. Current state — verified facts (constraints the design must respect)

- **The Agent IN is a single `STRING` flow port** → it becomes `{input}` (the task), NOT the vars.
  `Port("in","in",STRING)` ([blocks.py:187](../../agent_runtime/src/agent_runtime/composer/blocks.py#L187)).
- **`vars` come only from `event.payload.data.vars`** — never from a wired edge today.
- **Blocks emit a single flow `value`**; e.g. Vector/Graph Database output their result as the flow
  value, taking their query from config or the incoming value ([runner.py:317](../../agent_runtime/src/agent_runtime/runner.py#L317)).
- **Patron's model is deliberately "ONE flow wire between blocks"** — the typed-slot system was
  removed on purpose ([agent_nodes.js:19](../js/agent_nodes.js#L19)). Capabilities (tools/rag/
  guardrails) are **config, not ports**.
- **There is no `vars`/`context` input port** on the Agent.
- **Patron no longer compiles locally** — it serializes the graph and the server lowers it via
  `POST /composer/compile`. So lowering logic lives in `agent_runtime/composer`, not Patron.

---

## 3. Proposal — overview

Two additions plus a lowering rule:

1. **A "Data (JSON)" block** — a source/transform block that produces a JSON **object** as its
   output, from either **pasted content** or a **runtime file path**, and optionally shapes an
   **incoming** value (so a File Initiator's file can feed it).
2. **A dedicated `vars` input port on the Agent** — separate from the task `in` port. A Data block
   wires into it.
3. **Lowering:** the JSON arriving on the Agent's `vars` port is merged into the Agent's
   `input.vars` (with a defined precedence, §6).

Delivered in two phases (§8): **Phase 1 (static, no runtime change)** and **Phase 2 (dynamic,
runtime change)**. The `{input}` task channel is unchanged and orthogonal.

---

## 4. The Data (JSON) block

### 4.1 Composer block (`agent_runtime/composer/blocks.py`)
```
kind  = "data"                       # or "json" — name TBD (§9)
label = "Data (JSON)"
ports = [ Port("in", "in", ANY, optional=True),   # optional upstream value
          Port("out", "out", JSON) ]              # emits a JSON object
config = [
  ConfigField("source", "enum", values=["inline","file"], default="inline",
              label="source"),
  ConfigField("content", "json", control="json", label="JSON content",
              placeholder='{ "topic": "AI agents", "n": 5 }'),   # when source=inline
  ConfigField("path", "string", control="text", label="file path",
              placeholder="/watched/in/params.json"),           # when source=file (runtime fs)
  ConfigField("merge_input", "enum", values=["ignore","under","over"], default="ignore",
              label="merge incoming input"),  # how {in} combines with content (§4.3)
]
```

Validation (authoring-time, mirrors `input_vars`): `content` must parse to a **JSON object**
(not array/scalar). `path` (source=file) must be non-empty.

### 4.2 Patron node (`js/agent_nodes.js`)
A block in the **Blocks** palette group + **Insert** menu + an icon. Type id `data`.
`this.addInput("in", TYPES.FLOW)` (optional) and `this.addOutput("out", …)`. Properties:
`source`, `content` (reuse the inline Template/JSON editor), `path`, `merge_input`.

### 4.3 Semantics
- **source=inline:** output = the parsed `content` object.
- **source=file:** output = JSON parsed from the file at `path` **on the runtime's filesystem**
  (same trust model as File Initiator's `watch_path` — NOT the browser's disk). Re-read per run.
- **incoming input (`in`):** if connected, the upstream flow value (e.g. a File Initiator's file
  body) is available. `merge_input` decides how it combines with `content`:
  `ignore` (content only), `under` (incoming JSON as base, content overrides), `over` (content as
  base, incoming overrides). Incoming must itself be a JSON object to merge.

---

## 5. The Agent `vars` port

Add a **second input** to the Agent, distinct from the task `in`:

- **Patron:** `this.addInput("vars", TYPES.JSON)` (a new slot type — see §9 decision).
- **Composer:** `Port("vars", "in", JSON)` alongside `Port("in","in",STRING)`.
- The canvas already supports fan-in; multiple Data blocks may feed `vars` (merge order = §6).

> This is the crux departure from "one flow wire." It introduces a **second, typed wire semantic**
> (a config/vars channel). That is a deliberate model change and the main thing to approve (§9).

---

## 6. Precedence & merge model

For one Agent, the variable namespace used by `template.format(...)` becomes (lowest → highest):

```
1. input_vars           (static defaults on the Agent field)
2. vars-port JSON        (wired Data block(s); fan-in merged left→right by edge order)
3. event.payload.data.vars   (runtime override from the trigger — unchanged)
```
plus `{input}` = the task payload (the `in` port), which is **separate** and never part of `vars`.

Rationale: field defaults are the fallback; a wired Data block is an explicit authored override of
those; a live event still wins (per-invocation). This keeps today's event-override behavior intact
and layers the new authored channel beneath it.

---

## 7. Lowering

Patron serializes the graph; `agent_runtime/composer` lowers it. Two cases:

### 7.1 Static (Phase 1) — INLINE Data block on the `vars` port → compile-time merge
When the `vars` port is fed **only** by Data blocks with `source=inline` and no `in` edge, the
values are known at compile time. `Graph.lower()` parses each `content`, merges per §6 (below the
event layer), and folds the result into the Agent's `input.vars`. **No runtime change** — the
existing `record.input.vars` already carries it. Removes the wired Data nodes from the flat record
(they contributed config, not a runtime step) — same pattern as capability config today.

### 7.2 Dynamic (Phase 2) — file / incoming-fed Data block → runtime merge
When the Data block's value is only known at run time (`source=file`, or it has an `in` edge from a
File Initiator/upstream), the value must be merged **at run time**, like `overrides`:

- The IR must become **port-aware** so the executor knows which in-edge is the `vars` edge vs the
  task edge.
- `GraphWorkflowExecutor` evaluates the `vars` predecessor, expects a dict, and passes it to
  `_build_agent_task` as `node_vars`:
  `merged = { **record.input.vars, **node_vars, "input": incoming, **overrides }`.
- This is a **new edge/port semantic in the runtime** and the runner — the substantive Phase 2 work.

---

## 8. Phasing

- **Phase 0 — this spec + decisions (§9).**
- **Phase 1 — static, Patron + composer only, NO runtime change:**
  Data (JSON) block (inline), Agent `vars` port, compile-time merge into `input.vars`. This alone
  solves the original complaint: you author config visually and it fills the named variables.
- **Phase 2 — dynamic, runtime change:** `source=file` + File-Initiator-fed Data → port-aware IR +
  runtime `vars`-edge merge. Enables the "inject file params at run time" case.

Ship Phase 1 first; it's self-contained and low-risk. Phase 2 only if dynamic per-run vars are
actually needed.

---

## 9. Open decisions (need your call before code)

1. **Second wire semantic — approve or reject.** A `vars` port breaks the "one flow wire" model.
   Alternative: keep one wire and instead special-case "a Data block wired to the Agent's single
   `in`" as vars (ambiguous with the task — not recommended). **Recommendation: approve a typed
   `vars` port; keep it the ONLY exception.**
2. **Slot typing in Patron.** Introduce a `TYPES.JSON` slot so a Data block's `out` only connects to
   `vars`/JSON ins (prevents wiring JSON into a task `in`). Cheap, worth it.
3. **Block name/id:** `data` vs `json`. (`data` reads better if it later loads CSV/YAML.)
4. **Precedence** (§6) confirmation — is wired-vars-below-event correct? (I think yes.)
5. **Should the Data block also be usable as a plain flow source** (→ `{input}`) or vars-only?
6. **`source=file` scope/security:** runtime-fs path only; no browser upload in v1. OK?
7. **Phase 2 now or later** (port-aware IR + runtime merge is the bulk of the effort).

---

## 10. Effort / files touched

- **Patron:** `js/agent_nodes.js` (Data block + Agent `vars` port + `TYPES.JSON`), `js/menu.js` +
  `js/app.js` (Insert entry), `js/block-icons.js` (icon), Properties rendering for the JSON editor
  (reuse the inline Template Studio). ~½ day (Phase 1).
- **agent_runtime/composer:** new `Data` block class (`blocks.py`), Agent gets the `vars` port,
  `lower.py` static merge into `input.vars`, catalog exposes it. ~1 day (Phase 1).
- **agent_runtime runner (Phase 2 only):** port-aware IR, executor `vars`-edge evaluation,
  `_build_agent_task` `node_vars` param. ~1–2 days.

Contract note: `input.vars` already exists and is consumed — Phase 1 needs **no** `dsl.py` change.
