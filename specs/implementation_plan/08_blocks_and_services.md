# Phase 08 — Remaining blocks & backing services

## Goal
Complete the block roster: **File / Web initiators** (with their backing services), **File / Web
destinations**, **RAG** and **Guardrail** blocks, the **Workflow (Composite)** block, and the inline
**tap** variants.

## Spec refs
§8 (per-block-type behavior), §8.1 (RAG-pre + Guardrail as separate blocks), §8.2 (Workflow =
Composite, IN/OUT, nesting), §7.1 (inline taps: Bus / File Destination / Web Destination),
§9.3.1 (File/Web initiators + their emitter services).

## Depends on
Phase 05 (deploy/firing/graph execution). RAG/Guardrail also lean on Phase 04 nodes.

## Scope
- **In:** two initiators + two backing services; two destinations; RAG + Guardrail blocks wired in
  the graph; Workflow block (nesting); inline taps. Each with its own panel + tests.
- **Out:** nothing new after this — the roster is complete.

## Work by component
- **New service — folder-watch** (own repo/container): watch a folder (path + match patterns); on a
  new/changed file, **emit a bus event** → farm → run the Project. CRUD for watch configs; joins the
  bus network. Backs the **File Initiator**.
- **New service — HTTP-ingress** (own repo/container): expose configurable routes; on an inbound
  request, **emit a bus event** → farm → run. Backs the **Web Initiator**. ("Web" may be
  local/server-side; **public exposure + auth is handled at nginx/OAuth2Proxy**, not here.)
- **agent_runtime**
  - **Destinations**: `File Destination` (write outcome to a file), `Web Destination` (call an
    outbound Web API) — new `Destination` subclasses beside WhatsApp/TTS/Bus; plus **inline tap**
    (in+out) variants of Bus / File Destination / Web Destination.
  - **RAG block** (pre-inference retrieve-then-inject, wired before an Agent) and **Guardrail block**
    (before/after) as graph nodes (guardrail reuses `nodes/guardrail.py`).
  - **Workflow block** = the composer `Composite` with IN/OUT — reference a deployed Project's
    record as one participant; executor runs the nested graph.
- **patron**
  - Per-block-type panels for File Initiator, Web Initiator, File Destination, Web Destination, RAG,
    Guardrail, Workflow (CRUD/select against each source); disambiguate File Initiator vs File
    Destination vs File-tap in the toolbox.

## Data & API changes
- Two new services with their own CRUD APIs + bus emitters.
- New destination/initiator/RAG/guardrail/workflow node types + their resource descriptors.

## Tests & exit criteria
- **Per-service suites:** folder-watch fires on a new file; HTTP-ingress fires on a request; each
  emits the correct bus event.
- **pytest (agent_runtime):** File/Web destinations write/call correctly; inline taps forward while
  they publish; RAG-pre injects before the agent; guardrail blocks before/after; Workflow block runs
  a nested Project graph.
- **Playwright e2e:** each new block's panel; a File-initiated PDF→(agent)→vector-DB slice; a
  Web-initiated request→(agent)→Web-Destination response slice.
- **Exit:** every block in `block_management.md` §8 exists, is authorable, deployable, and fires.

## Risks / notes
- Keep each backing service small and single-purpose (emit-a-bus-event), mirroring Agent Scheduler.
- Name discipline: **File Initiator** (watch) vs **File Destination** (write) vs **File-tap**
  (inline); same for Web.
