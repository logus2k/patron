# Phase 03 — Agent Scheduler: Schedule + Bindings

## Goal
Reshape Agent Scheduler so a **Schedule** is a first-class, reusable entity (cron/timezone only) and
**Bindings** attach it to actions — one schedule can fire **many** actions; a schedule with **zero**
bindings is inconsequent.

## Spec refs
§6 (Trigger→pure Schedule; Schedule + Bindings; fan-out), §9.5 (source tier), §9.3.1 (firing).

## Depends on
Phase 01 (parallel with 02/04).

## Scope
- **In:** new Schedule model + Bindings; emit loop resolves a schedule's bindings at fire time and
  emits one event **per binding**; CRUD API; migration of existing welded `/jobs`.
- **Out:** what consumes the events (that's the farm, Phase 04/05); Patron Trigger panel rebinds to
  the new Schedule resource here.

## Work by component
- **agent_scheduler**
  - `models.py`: add **`Schedule`** (`schedule_id`, `trigger_type`, `trigger_args` cron/tz) and
    **`Binding`** (`binding_id`, `schedule_id`, `target_stream_id`, `event_type`, `event_data`,
    `room`). Keep `JobCreate` as a **compat façade** during migration.
  - `registry.py`: store schedules and bindings; index bindings by `schedule_id`.
  - `tasks.py` (`emit_trigger`): on fire, **look up all bindings** for the schedule and emit one
    envelope each (today it emits a single welded event).
  - `api.py`: `/schedules` CRUD (+ pause/resume), `/schedules/{id}/bindings` CRUD; a schedule with
    no bindings validates fine but emits nothing.
  - **Migration:** convert each existing welded job → one Schedule + one Binding (idempotent script;
    loud on anything it can't map).
- **agent_runtime (resource layer):** point the `schedule` resource `source` at `/schedules`
  (replacing the `/jobs` shim from Phase 02).

## Data & API changes
- New `Schedule` + `Binding` models; `/schedules` and `/schedules/{id}/bindings` endpoints.
- `emit_trigger` fan-out (1 schedule → N bindings → N events).
- Compat: `/jobs` kept read-only during transition, then retired.

## Tests & exit criteria
- **pytest (agent_scheduler):** a Schedule with 0 bindings fires nothing; with N bindings emits N
  distinct events; cron/timezone still DST-correct; bindings CRUD; migration maps a sample welded
  job faithfully; pause/resume honored.
- **Exit:** one Schedule drives multiple actions; the Trigger panel in Patron creates/selects a
  Schedule and sees its bindings.

## Risks / notes
- Preserve the Taskiq schedule mapping already fixed for the WSL2 monotonic-clock bug — don't
  regress it during the reshape.
- Keep the migration reversible (write new alongside old; retire `/jobs` only after Phase 05 green).
