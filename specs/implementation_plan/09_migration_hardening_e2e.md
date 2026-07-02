# Phase 09 — Migration, hardening & full E2E

## Goal
Migrate the existing flat **News Agent** to the new graph form, retire the compatibility paths, and
land full cross-service **E2E** with the whole **Jenkins pipeline green**.

## Spec refs
§9.5 (two tiers, steady state), §13 (testing/CI — aggregate all suites), plus the compat shim from
Phase 04 and the `/jobs` retirement from Phase 03.

## Depends on
Phases 01–08 (everything).

## Scope
- **In:** migrate the live News Agent record → graph form; retire the Phase-04 legacy compat shim
  and the Phase-03 `/jobs` compat façade; full cross-service E2E; performance/robustness pass;
  aggregate CI green; docs refresh.
- **Out:** new features (all delivered by Phase 08).

## Work by component
- **agent_runtime**
  - **Migrate** the News Agent: express it as a graph record (Trigger/Schedule → Agent(persona,
    tools, skills) → WhatsApp Destination), deploy it as a Project, verify identical behavior, then
    **remove the flat-record compat shim**.
  - Robustness pass: bounded-task guarantees, loud failures, version/upsert edge cases.
- **agent_scheduler**
  - **Retire `/jobs`** once all schedules are migrated to Schedule+Bindings.
- **all repos**
  - **Full E2E** across the bus: schedule-fire and File/Web-initiated Projects run end-to-end to
    real destinations in a test environment.
  - **Umbrella Jenkins pipeline** aggregates every repo + service suite; green is the release gate.
- **docs**
  - Update `block_management.md` status; note the plan is executed; refresh project memory.

## Data & API changes
- Removal of compat surfaces (`/jobs`, flat-record shim). No new models.

## Tests & exit criteria
- **E2E (required):** the migrated News Agent fires on schedule and delivers to WhatsApp, identical
  to pre-migration; a File-initiated ingestion slice and a Web-initiated request/response slice both
  pass end-to-end.
- **Regression:** all prior phase suites still green after compat removal.
- **CI:** the aggregate Jenkins pipeline is green across every component.
- **Exit:** the whole `block_management.md` model is live, the News Agent runs on the new stack, and
  no compatibility scaffolding remains.

## Risks / notes
- Do the News-Agent migration as a **parallel deploy + compare** before removing the shim, so there
  is no delivery gap.
- Retire compat surfaces only after the aggregate pipeline is green.
