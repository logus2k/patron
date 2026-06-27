# Patron — Session Guide & Role in the Platform

Orientation for a Claude Code session working on **patron**. It captures where patron fits in the
larger self-hosted agentic platform and the boundaries that constrain its design, settled in a prior
design session (run from the `agent_bus` project, 2026-06-27).

> **The current `documents/` (`agentic_gof_design_patterns.md`, `patterns_data_specification.md`) are
> inspiration / a PoC, not a spec to implement literally.** They're a thinking aid for the node
> vocabulary, not the runtime contract.

---

## What patron is (and is not)

- **Patron is the authoring front-end — for humans.** A visual node-graph editor (litegraph) where you
  compose an agent from pattern-nodes. It is the *user-facing abstraction layer*.
- **Patron is NOT a runtime.** It does not execute agents. Execution is **`agent_runtime`** (a separate
  project — the "agent farm").
- **Patron is NOT the contract.** The contract is the **runtime DSL** (defined in
  `~/env/assets/agent_runtime/documents/runtime_dsl_specification.md`).

## Where patron sits

```
patron (authoring, for humans)  ─►  COMPILER (lower + verify)  ─►  runtime DSL (for the machine)  ─►  agent_runtime (execute)
```

Patron serializes a graph → a **compiler lowers** it to the runtime DSL → `agent_runtime` interprets the
DSL. A simple/linear agent is just what a small graph serializes to (the "flat record").

## The core design principle: two audiences

- **Patron's abstractions are designed for the user** — recognizability, low cognitive load, good
  defaults, progressive disclosure.
- **The runtime DSL's abstractions are designed for the executor** — explicitness, zero ambiguity,
  validatable, versioned.
- A **compiler reconciles them.** Three consequences that constrain patron:
  1. **Patron's native format never leaks into the runtime.** litegraph cruft (positions, widget state,
     colors) is stripped by the compile/lower step; the runtime DSL is semantic-only.
  2. **The palettes need not be 1:1.** A friendly patron *macro-node* can lower to several runtime-DSL
     nodes — so patron can add UX without new runtime primitives, and the runtime can refactor without
     touching patron's palette.
  3. **Patron's expressible space must stay ⊆ the runtime's executable space.** The compiler rejects
     un-lowerable graphs **at authoring time**, with errors aimed at the human. The runtime DSL *defines*
     the space of valid agents; patron is an ergonomic surface over it; the compiler keeps the surface
     inside the space.

## Current state

- A litegraph **PoC**: 4 GoF pattern-nodes (Builder, Factory, Proxy, Chain) + 2 utility (Task Source,
  Inspector), a tiny typed slot system (`task`/`context`/`agentref`/`result`), and **mock synchronous
  execution** (`graph.runStep()`) — no real model calls, not wired to anything.
- Not yet connected to the runtime DSL, a compiler, or the farm.

## Sequencing: runtime-first, editor-last

The platform is being built **runtime-first**: the runtime DSL + `agent_runtime` executor come first
(starting with a News-Agent vertical slice). **Patron — the visual editor + the compiler — is the last
layer.** Patron's real work (lowering patron graphs → runtime DSL, then wiring to live execution) depends
on the runtime DSL being defined and stable.

> **Avoid the trap patron is currently in** — a pretty editor that executes nothing. The value is the IR
> (runtime DSL) + the compiler, not the canvas. Keep the editor thin; invest in lowering + validation.

## What patron should eventually do

- Author agents as graphs (and offer a flat/linear form for simple agents).
- **Serialize → compile/lower to the runtime DSL**: strip visual metadata, validate, resolve references
  (does the preset/tool exist? are the edges type-compatible?), emit canonical, versioned runtime DSL.
- Grow its node palette **demand-driven**, aligned with (not necessarily identical to) the runtime DSL
  node catalog.

## What patron should NOT do

- Execute agents (that's `agent_runtime`).
- Encode **cognition** (prompts live in `agent_server` presets) or **tool logic** (lives in MCP). Patron
  wires **structure + parameters + references** only.
- Let its litegraph format reach the runtime.

## Pointers

- **The contract patron compiles to:** `~/env/assets/agent_runtime/documents/runtime_dsl_specification.md`
- **How the runtime executes what patron authors:** `~/env/assets/agent_runtime/documents/technical_architecture.md`
- **The runtime build + worked example:** `~/env/assets/agent_runtime/documents/{implementation_plan,use_cases}.md`
- **Patron's own conceptual docs (inspiration):** `documents/agentic_gof_design_patterns.md`,
  `documents/patterns_data_specification.md`

## Working style (the user, António)

Concrete and grounded over theoretical; verify load-bearing facts in code before asserting; prefer
vertical slices over up-front abstraction; honest assessment (tradeoffs/failure modes), not cheerleading.
The user performs **all git operations** — never commit/push/rebase.

---

## Next docs (deferred until the runtime DSL is stable)

These are intentionally **not written yet** — they depend on the runtime DSL being locked (after the
`agent_runtime` News-Agent vertical slice). Writing them now would be speculative.

- **Compiler / lowering spec** — how a serialized patron graph is stripped, validated, reference-resolved,
  and lowered to canonical runtime DSL.
- **Palette ↔ DSL node-mapping** — which patron pattern-nodes (incl. friendly macro-nodes) map to which
  runtime DSL nodes; the rule is they need not be 1:1.
