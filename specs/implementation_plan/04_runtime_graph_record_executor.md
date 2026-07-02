# Phase 04 — Agent Runtime: graph record + graph executor + AgentRecord decomposition

## Goal
Promote the runtime record from **flat single-agent** to the **graph/workflow form** (agents as
nodes + typed Edges), executed by a **graph-capable executor** with **per-message fan-in**, and
**decompose** the monolithic `AgentRecord`.

## Spec refs
§9.3 (graph/workflow record, one Project = one record, versioning), §9.3.2 (per-message fan-in),
§8.1 (decomposition: tools/skills stay on Agent; RAG-pre + guardrails become nodes; trigger/delivery
become assets+edges), §5.1 (intrinsic vs glue), §7.2 (many-to-many).

## Depends on
Phase 01 (parallel with 02/03).

## Scope
- **In:** a graph-form runtime record (`uid` + `version` + nodes + typed edges); a graph executor;
  per-message fan-in; decomposed node types (Agent, RAG, Guardrail, Destination, Initiator boundary);
  a compatibility path so the existing flat News-Agent keeps running until Phase 09.
- **Out:** the Deploy wiring from Patron (Phase 05); skills injection (Phase 06); loop (Phase 07);
  File/Web blocks + their services (Phase 08).

## Work by component
- **agent_runtime**
  - **Reconcile composer↔runtime.** The composer already has `ir.py`, `executor.py`, `edge.py`,
    `management.py`, composite + tests. Make the **runtime** consume this graph form: define the
    persisted **graph record** (extend `dsl.py` or add `dsl_graph.py`) = `{ uid, version, nodes[],
    edges[] }`, where a node references its bound asset (persona id, destination target, schedule
    binding) per §9.2.
  - **Graph executor in the farm/runner.** Today `runner.py`/`farm.py` run a linear brain→delivery.
    Add a graph executor that walks nodes along typed edges; **fan-in = run once per incoming
    message** (§9.3.2), fan-out = deliver to all successors.
  - **Decompose `AgentRecord`:** Agent node keeps persona/tools/(skills, Phase 06)/(loop, Phase 07);
    **RAG-pre** and **guardrails** become their own nodes (reuse `nodes/guardrail.py`); trigger and
    delivery leave the record and become the **Schedule binding** (Phase 03) and **Destination**
    nodes joined by edges.
  - **Registry:** key records by `uid`; support `version`; idempotent upsert (used by Phase 05).
  - **Compat shim:** load a legacy flat record as a degenerate 3-node graph (Initiator→Agent→
    Delivery) so nothing breaks before migration.

## Data & API changes
- New graph record schema (`uid`, `version`, `nodes`, `edges`); registry keyed by `uid` with
  versioning + upsert.
- Executor contract for multi-node graphs with per-message fan-in.

## Tests & exit criteria
- **pytest (agent_runtime):** a 3-node linear graph runs like today; a fan-out node delivers to all
  successors; a fan-in node runs once per incoming message (no barrier); decomposed RAG/guardrail
  nodes execute in order; idempotent upsert updates in place + bumps version; a legacy flat record
  loads via the compat shim and runs unchanged.
- **Exit:** the runtime can execute an arbitrary multi-node graph record end-to-end (fed by a test
  event), with the News Agent still working via the shim.

## Risks / notes
- Biggest phase — land the **graph record + executor** first (thin: linear, then fan-out/fan-in),
  then the decomposition, then the compat shim.
- Keep `dsl.py`'s strict validation ethos (loud on malformed records).
