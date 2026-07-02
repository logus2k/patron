# Implementation Plan — Overview

Phased plan to build the model agreed in [`../block_management.md`](../block_management.md).
**One file per phase**, all in this folder. Read this overview first, then the phases in order.

## How to read this plan

Every phase file uses the **same template**, so it stays easy to digest and maintain:

- **Goal** — one sentence.
- **Spec refs** — the `block_management.md` sections it delivers.
- **Depends on** — prior phases required first.
- **Scope** — in / out (what this phase does *not* do).
- **Work by component** — concrete repos/files to change.
- **Data & API changes** — new/changed models and endpoints.
- **Tests & exit criteria** — what must pass (§13: tests live per-repo, E2E required, Jenkins).
- **Risks / notes.**

## Principles

- **Vertical slices over big-bang.** Get a thin end-to-end path working, then broaden.
- **Test-per-feature + CI from day one** (§13). No feature is "done" without its test.
- **Bridge what exists.** The composer layer already has graph pieces (`composer/ir.py`,
  `executor.py`, `edge.py`, `management.py`, composite + tests); reuse them rather than reinvent.
- **The user (António) performs all git operations.** The plan never commits/pushes.

## Current state (grounded, 2026-07-02)

| Repo | Today | Gap to the spec |
|------|-------|-----------------|
| **agent_runtime** | Runtime record `dsl.AgentRecord` is **flat single-agent** (one Brain, one Delivery); `farm.py`/`runner.py` run it **linearly**. `composer/` already has **graph** pieces (`ir`, `executor`, `edge`, `management`, composite) + tests. `resource/` model + `resources_api.py` exist. `nodes/` = brain, delivery, guardrail. **No skills.** | Promote the *runtime* record to the graph form + graph executor; decompose `AgentRecord`; add skills; add loop-type execution. |
| **agent_scheduler** | Welded `/jobs` model (`JobCreate` = schedule **+** payload **+** target; agent id inside `event_data`); pause/resume/run. | First-class **Schedule** + **Bindings** (§6); one schedule → many actions. |
| **patron** | litegraph JS (`props-panel.js`, `resource-manager.js`, `app.js`, …), `serve.py` proxy. `test/` **empty**. | Per-block-type panels, Project entity, Deploy/Undeploy/Delete, many-to-many sockets, E2E tests. |
| **agent_server** | Agent **profiles** via `/admin/api/agents` (prompt + sampling + memory). | (Reused as-is — the Agent block binds these.) |
| **noted** | Skills model (`backend/app/managers/llm_skills.py`). | Port the model into agent_runtime (own folder). |
| **CI** | **No Jenkinsfile anywhere.** | Per-repo suites aggregated into one Jenkins pipeline. |

## Phase map

| # | Phase | Goal | Primary repos |
|---|-------|------|---------------|
| **01** | [Foundations, CI & Project entity](01_foundations_ci_project.md) | CI pipeline + the Project entity (uid/name/description, save/load) | patron, all (CI) |
| **02** | [Patron authoring core](02_patron_authoring_core.md) | Per-block-type panels, CRUD/select, many-to-many canvas, selection linking | patron |
| **03** | [Scheduler: Schedule + Bindings](03_scheduler_schedule_bindings.md) | Reshape scheduler; one schedule → many actions | agent_scheduler |
| **04** | [Runtime graph record + executor](04_runtime_graph_record_executor.md) | Graph/workflow record + graph executor; `AgentRecord` decomposition | agent_runtime |
| **05** | [Deploy / Undeploy / Delete](05_deploy_lifecycle.md) | Project→1 record; idempotent; firing; advisory validation; asset-usage tracking | patron, agent_runtime, agent_scheduler |
| **06** | [Skills subsystem](06_skills_subsystem.md) | Skill registry in agent_runtime + Brain injection + Agent picker | agent_runtime, patron |
| **07** | [Loop type](07_loop_type.md) | Outer repeat loop: off/counter/expression/judge | agent_runtime, patron |
| **08** | [Blocks & backing services](08_blocks_and_services.md) | File/Web initiators (+services), File/Web destinations, RAG/Guardrail/Workflow/taps | agent_runtime, new services, patron |
| **09** | [Migration, hardening, full E2E](09_migration_hardening_e2e.md) | Migrate News Agent; cross-service E2E; pipeline all-green | all |

## Dependency graph

```
01 ─┬─▶ 02 ─┐
    │       ├─▶ 05 ─┬─▶ 06
    ├─▶ 03 ─┤       ├─▶ 07
    └─▶ 04 ─┘       └─▶ 08 ─▶ 09
```
01 first. 02/03/04 can proceed in parallel after 01. 05 needs 02+03+04. 06/07/08 need 05. 09 last.

## Coverage matrix (every spec section → phase)

| block_management.md | Phase |
|---------------------|-------|
| §1 Goal, §2 Toolbox→canvas typed unbound blocks | 01, 02 |
| §3 Double-click per-block-type panels + selection linking | 02 |
| §4 Panel CRUD/select + confirmation | 02 |
| §5 Decoupled assets (+intrinsic vs glue) | 02, 04 |
| §6 Trigger→Schedule; Schedule+Bindings; fan-out | 03 |
| §7 Typed Edges; §7.1 inline taps; §7.2 many-to-many | 02 (canvas), 08 (tap blocks) |
| §8 Per-block-type behavior | 02, 08 |
| §8.1 Agent block = profile+tools+skills+loop; RAG/guardrail separate | 02 (profile/tools), 06 (skills), 07 (loop), 08 (RAG/guardrail) |
| §8.2 Agent vs Workflow (Composite) | 08 |
| §8.3 Skills | 06 |
| §8.4 Loop type | 07 |
| §9.1 Project (uid/name/description) + §9.2 identity/bindings | 01 |
| §9.3 Deploy 1:1 record, idempotent, versioning, advisory validation | 04 (record), 05 (deploy) |
| §9.3.1 Firing (initiator→bus→farm) | 05 (Trigger), 08 (File/Web) |
| §9.3.2 Per-message fan-in | 04 |
| §9.4 Undeploy/Delete + cross-project asset-usage tracking | 05 |
| §9.5 Two tiers | 03, 04, 05 |
| §13 Testing & CI (per-repo, E2E, Jenkins) | 01 (harness) + **every** phase |

## Cross-cutting

- **Testing/CI (§13):** Phase 01 stands up the Jenkins pipeline; **every** later phase adds its own
  tests in its own repo and must keep the pipeline green. E2E (Playwright) required for Patron.
- **Migration:** the existing flat News-Agent record migrates to the graph form in Phase 09
  (kept working via a compatibility path until then — see Phase 04).
- **Open implementation-time decisions** (do not block design; settle when building):
  - Where Projects are persisted (Patron-owned store: file vs small DB).
  - `expression` loop match semantics (regex vs substring) — Phase 07.
  - Whether agent_runtime skills keep noted's `active_domains` scoping — Phase 06.
