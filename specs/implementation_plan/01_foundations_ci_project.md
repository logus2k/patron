# Phase 01 — Foundations, CI & the Project entity

## Goal
Stand up the CI/Jenkins pipeline across repos and introduce the **Project** entity
(uid / name / description + blocks-with-UIDs + bindings + edges) with **save/load** — authoring
persistence only, **no Deploy yet**.

## Spec refs
§1, §2 (typed unbound blocks), §9.1 (Project identity), §9.2 (block UID + asset-id binding),
§13 (testing/CI harness).

## Depends on
None (first phase).

## Scope
- **In:** Project data model + persistence; block UID assignment on drop; binding = asset-id
  pointer saved with the Project; CI pipeline skeleton; test harnesses per repo.
- **Out:** panels/CRUD (Phase 02), Deploy (Phase 05), any runtime/scheduler change.

## Work by component
- **patron**
  - Define the **Project** document: `{ uid, name, description?, blocks[], edges[], ui }`; each
    block `{ uid, type, binding: {resource, asset_id}|null, config, pos }`. Extend the existing
    workspace collect/apply (`app.js`) to this shape; assign a stable block `uid` on drop.
  - **Project store**: named save/load (list / open / save-as / rename / delete-project) — a
    Patron-owned store (file-based to start; see overview open decision). New `serve.py` routes
    `/projects` (GET list, POST create, GET/PUT/DELETE `{uid}`).
  - Visible **build stamp** already exists — reuse for smoke assertions.
- **CI (all repos)**
  - `Jenkinsfile` per repo (patron, agent_runtime, agent_scheduler) running that repo's suite
    non-interactively; one **umbrella pipeline** invoking all (green = all pass).
  - **patron/test/**: Playwright harness (fixed runner file + stable command, headless) + a first
    smoke test (app loads, toolbox present, build stamp visible).
  - **agent_runtime/tests/**: already green pytest — wire into CI unchanged.

## Data & API changes
- New Patron store + `/projects` CRUD (Patron-owned; not agent_runtime).
- Project JSON schema (uid/name/description/blocks/edges/ui) documented alongside the store.

## Tests & exit criteria
- **patron (pytest for serve.py + Playwright e2e):** `/projects` CRUD round-trips; a Project with
  blocks+edges saves and reloads byte-faithfully; block UIDs are stable across save/load; rename
  keeps the uid.
- **CI:** umbrella Jenkins pipeline runs all repo suites and reports green.
- **Exit:** you can create, name, describe, save, reload, and rename a Project (no deploy), and the
  pipeline is green end-to-end.

## Risks / notes
- Keep the Project store trivial (files) first; a DB is an easy later swap behind `/projects`.
- Don't let the open Patron browser tab clobber saved Projects — Save writes the store explicitly.
