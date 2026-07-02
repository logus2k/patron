# Phase 02 — Patron authoring core

## Goal
The composition UX: **per-block-type dedicated panels** (double-click), **CRUD/select** against each
asset's source service, **many-to-many** IN/OUT sockets, and **panel↔block selection linking**.

## Spec refs
§3 (dedicated per-block-type panels, selection linking), §4 (CRUD/select + confirmation),
§5 (decoupled assets, from the UI side), §7.2 (many-to-many sockets), §8 (per-block-type behavior).

## Depends on
Phase 01 (Project entity + block UIDs + bindings).

## Scope
- **In:** double-click opens a dedicated panel **instance per block**, keyed by block uid; one
  panel implementation **per block type**; CRUD/select against services that **already exist**
  today (agent_server profiles, current scheduler `/jobs`, WhatsApp/TTS/Bus targets, MCP tools);
  destructive-op confirmation; many-to-many sockets; selecting a panel selects its canvas block.
- **Out:** the Schedule/Bindings reshape (Phase 03), Deploy (Phase 05), new blocks (Phase 08),
  skills/loop panels (Phases 06/07 add their fields to the Agent panel).

## Work by component
- **patron (js)**
  - Replace the single Properties panel with **`openBlockPanel(node)`** — dedicated jsPanel per
    block uid; multiple open at once; position persisted per block in the Project `ui`.
  - **Per-block-type panel modules**: Trigger, Agent, WhatsApp, TTS, Bus (each its own render +
    CRUD verbs). Panels read the block's `ConfigField` schema (from `composer` catalog) to render.
  - **Selection linking**: activating a panel calls `graph.selectNode(block)` (reuse
    `panel-active.js`).
  - **Many-to-many sockets**: allow multiple links on every IN and OUT (litegraph patch in
    `litegraph-patches.js` / `node-resize.js`).
  - **Confirmation** modal for delete/destructive verbs.
- **agent_runtime (resource layer)** — extend `resource/registry.py` + `sources.py` +
  `resources_api.py` so each panel has a grounded source: `preset` (agent_server), `mcp-tool`,
  `wa-target`, and `schedule` (still the `/jobs` model until Phase 03). `serve.py` proxies these.

## Data & API changes
- Resource descriptors for every Phase-02 block type (list/pick/create/update/delete capabilities).
- No runtime record changes.

## Tests & exit criteria
- **Playwright e2e (required):** drag each block type → double-click → dedicated panel opens; two
  panels open simultaneously bind to their own blocks; selecting a panel highlights its block;
  create/select/edit/delete an asset from the panel; delete asks for confirmation; a socket accepts
  multiple connections.
- **pytest (resources):** each descriptor's list/create/update/delete round-trips.
- **Exit:** a user can compose a Trigger→Agent→WhatsApp graph, define/select each block's asset via
  its own panel, and save it as a Project — all against today's backends.

## Risks / notes
- Reuse the hard-won litegraph learnings (DOM-level dblclick hit-test; suppress the native
  title-edit/search-box/context-menu) already in `litegraph-patches.js`.
- Keep panels schema-driven (one renderer over `ConfigField`) to stay maintainable as blocks grow.
