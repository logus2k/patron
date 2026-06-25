# Patterns Data Specification

**Companion to:** `agentic_gof_design_patterns.md`
**Status:** Draft v0.1 — initial toolbox (4 patterns + 2 utility nodes)
**Purpose:** Define the data that flows *between* agentic-pattern nodes on the LiteGraph canvas, so patterns can be composed and executed. This file is the contract that `js/patterns.js` implements; keep them in sync.

---

## 1. Modeling approach

Each pattern is a **node** with typed **input slots** (data it consumes), typed **output slots** (data it produces), and **properties** (static configuration set on the node itself, rendered as widgets).

A connection is only valid when the output slot type matches the input slot type. A small, deliberately tiny type system keeps the graph legible:

| Type id     | Conceptual payload         | Produced by                       | Consumed by                         |
|-------------|----------------------------|-----------------------------------|-------------------------------------|
| `task`      | A unit of work to perform  | Task Source                       | Builder, Factory                    |
| `context`   | An assembled prompt bundle | Builder                           | Chain of Responsibility             |
| `agentref`  | A chosen model/persona     | Factory                           | Chain of Responsibility             |
| `result`    | An inference output        | Chain of Responsibility, Proxy    | Proxy, Inspector                    |
| `*`         | Wildcard (any of the above)| —                                 | Inspector                           |

> Types are matched by string id at the slot level (LiteGraph convention). `*` / `""` is a wildcard input that accepts anything — used only by the Inspector.

---

## 2. Data type schemas

These are the runtime object shapes passed across connections. All fields are JSON-serializable.

### 2.1 `task` — TaskEnvelope
The work request entering the system.

| Field         | Type                          | Req | Description                                           |
|---------------|-------------------------------|-----|-------------------------------------------------------|
| `id`          | string                        | ✓   | Stable id for tracing across nodes.                   |
| `instruction` | string                        | ✓   | Natural-language description of the work.             |
| `complexity`  | `"low" \| "medium" \| "high"` | ✓   | Drives model selection downstream.                    |
| `tags`        | string[]                      |     | Optional routing/labeling hints.                      |

### 2.2 `context` — ContextBundle
A fully assembled prompt, ready to hand to an executor.

| Field          | Type     | Req | Description                                             |
|----------------|----------|-----|--------------------------------------------------------|
| `taskId`       | string   | ✓   | Originating `task.id`.                                  |
| `prompt`       | string   | ✓   | The concatenated, ready-to-run prompt.                 |
| `sections`     | string[] | ✓   | Ordered names of the assembled sections (audit trail). |
| `estTokens`    | number   | ✓   | Rough token estimate for budgeting.                    |

### 2.3 `agentref` — AgentRef
A reference to the model/persona selected to do the work. The reference, not the cognition (see §3.1 of the patterns doc — agents stay stateless).

| Field        | Type                   | Req | Description                                      |
|--------------|------------------------|-----|--------------------------------------------------|
| `taskId`     | string                 | ✓   | Originating `task.id`.                            |
| `model`      | string                 | ✓   | Model identifier (e.g. `gemma-4-local`).         |
| `tier`       | `"local" \| "cloud"`   | ✓   | Where it runs — drives cost/latency assumptions. |
| `maxTokens`  | number                 | ✓   | Output budget granted to this agent.             |

### 2.4 `result` — ResultEnvelope
The output of an execution, carrying enough metadata for guardrails and escalation to make routing decisions.

| Field        | Type     | Req | Description                                              |
|--------------|----------|-----|---------------------------------------------------------|
| `taskId`     | string   | ✓   | Originating `task.id`.                                   |
| `output`     | string   | ✓   | The produced artifact (text/code).                      |
| `confidence` | number   | ✓   | Self-reported confidence, `0.0`–`1.0`.                  |
| `ok`         | boolean  | ✓   | `false` once a guardrail rejects it.                    |
| `trace`      | string[] | ✓   | Append-only log of which nodes touched this result.     |

---

## 3. Node catalog

Legend: **In** = input slots, **Out** = output slots, **Props** = configurable widgets.

### 3.0 Utility · Task Source  *(category: Utility)*
Seeds a graph with a `task`. Not a GoF pattern — an entry point for testing.
- **In:** _(none)_
- **Out:** `task : task`
- **Props:** `instruction` (string), `complexity` (combo: low/medium/high), `tags` (string, comma-separated)

### 3.1 Builder Agent — Context Assembler  *(category: Creational · §3.3)*
Assembles a `context` from a `task` in inspectable stages.
- **In:** `task : task` *(required)*, `fragment : context` *(optional — prepend an upstream bundle)*
- **Out:** `context : context`
- **Props:** `includeCodebase` (toggle), `includeHistory` (toggle), `constraints` (string)
- **Behavior:** Emits a `context` whose `sections` reflects the toggles in fixed order — `[fragment?, codebase?, instruction, history?, constraints?]` — and whose `estTokens` grows with each included section.

### 3.2 Factory Agent — Dynamic Dispatcher  *(category: Creational · §3.2)*
Selects an `agentref` by matching model tier to task complexity.
- **In:** `task : task` *(required)*
- **Out:** `agentref : agentref`
- **Props:** `localCeiling` (combo: low/medium/high — tasks at or below this run local, above go cloud), `localModel` (string, default `gemma-4-local`), `cloudModel` (string, default `reasoning-cloud`)
- **Behavior:** Compares `task.complexity` against `localCeiling` to pick tier + model; sets `maxTokens` per tier.

### 3.3 Proxy Agent — Guardrail  *(category: Structural · §4.2)*
Intercepts a `result` and either approves it or rejects it. (The same surrogate pattern can guard a command before execution; here it guards the produced artifact.)
- **In:** `result : result` *(required)*
- **Out:** `approved : result`, `rejected : result`
- **Props:** `forbidden` (string, comma-separated patterns, e.g. `rm -rf,DROP TABLE`), `minConfidence` (number, default `0.5`)
- **Behavior:** Routes to `rejected` (with `ok=false`) if `output` contains a forbidden pattern **or** `confidence < minConfidence`; otherwise routes to `approved`. Exactly one output fires per run; the trace records the verdict.

### 3.4 Chain of Responsibility Agent — Escalation  *(category: Behavioral · §5.2)*
Runs a primary handler; escalates the *unchanged* context to a stronger handler when confidence drops.
- **In:** `context : context` *(required)*, `agentref : agentref` *(required — the primary handler)*
- **Out:** `resolved : result`, `escalated : result`
- **Props:** `confidenceThreshold` (number, default `0.7`), `escalateModel` (string, default `reasoning-cloud`)
- **Behavior:** Simulates the primary handler producing a `result`. If `confidence >= confidenceThreshold` it fires `resolved`; otherwise it re-runs against `escalateModel` (higher simulated confidence) and fires `escalated`. Exactly one output fires per run.

### 3.5 Utility · Inspector  *(category: Utility)*
Terminal sink for testing — pretty-prints whatever it receives, both on the node and in the side panel.
- **In:** `value : *` *(wildcard)*
- **Out:** _(none)_
- **Props:** _(none)_

---

## 4. Reference composition (the demo wired in `index.html`)

```
                 ┌─────────────┐
                 │ Task Source │
                 └──┬───────┬──┘
              task  │       │  task
            ┌───────┘       └────────┐
            ▼                        ▼
     ┌─────────────┐          ┌─────────────┐
     │   Builder   │          │   Factory   │
     └──────┬──────┘          └──────┬──────┘
    context │                        │ agentref
            └───────────┬────────────┘
                        ▼
            ┌───────────────────────┐
            │ Chain of Responsibility│
            └───┬───────────────┬───┘
       resolved │               │ escalated
                ▼               ▼
            ┌─────────┐   (also → Proxy/Inspector
            │  Proxy  │    in extended graphs)
            └────┬────┘
        approved │  (rejected → Inspector)
                 ▼
            ┌───────────┐
            │ Inspector │
            └───────────┘
```

This exercises one node from each GoF family (Creational ×2, Structural, Behavioral) plus both utility endpoints, and proves the type system end-to-end: `task → context/agentref → result → result`.

---

## 5. Execution semantics

- Execution is a single **topological pass** triggered by the **Run** button (LiteGraph `graph.runStep()`), not a live feedback loop.
- A node reads inputs with `getInputData(slot)`, computes synchronously, and publishes via `setOutputData(slot)`. Processing here is **mock/simulated** — the point of this iteration is to validate the data contracts and composition, not to call real models.
- Conditional patterns (Proxy, Chain of Responsibility) fire **exactly one** output per pass; the unused output is left `undefined` so downstream nodes simply produce nothing.
- Every node appends to `result.trace`, giving a visible audit path in the Inspector.

## 6. Open questions / next iterations
- Real async execution (await model calls) vs. the current synchronous mock pass.
- Persisting/loading graphs (LiteGraph `serialize()` / `configure()`).
- Adding the remaining patterns: Singleton/Repository, Facade/Supervisor, Decorator, Strategy, Observer.
- Typed validation on connection (reject mismatched payloads at runtime, not just slot-type).
