# Phase 05 — Deploy / Undeploy / Delete

## Goal
Wire the lifecycle: a Patron **Project deploys 1:1 to one runtime graph record** (idempotent, by
`uid`, version-bumped), an initiator's source is bound to fire it, and **Undeploy/Delete** manage
the live record with **advisory validation** and **cross-project asset-usage** protection.

## Spec refs
§9.3 (Deploy 1:1, idempotent, versioning, **advisory validation — warn, don't block**),
§9.3.1 (firing: initiator→bus→farm→run; Deploy binds schedule→Project), §9.4 (undeploy/delete +
cross-project asset-usage tracking + confirmations), §9.5 (two tiers).

## Depends on
Phase 02 (authoring), Phase 03 (Schedule+Bindings), Phase 04 (graph record + executor).

## Scope
- **In:** Deploy (lower Project → one graph record via `composer/lower.py` + upsert), bind the
  initiator source (schedule binding → this Project's record), version bump, advisory validation,
  Undeploy, Delete (with asset decisions), cross-project asset-usage index.
- **Out:** File/Web initiators (Phase 08 — here we wire **Trigger** as the initiator); skills/loop.

## Work by component
- **patron**
  - **Deploy** button: POST the Project to a Deploy endpoint; show **advisory warnings** (no
    initiator, type-incompatible edges, missing required config, unbound blocks) but let the user
    proceed anyway.
  - **Undeploy** / **Delete Project**: Delete asks *what to do with each asset*; before deleting a
    shared asset, warn + confirm (uses the usage index).
- **agent_runtime**
  - **Deploy endpoint**: `lower()` the Project composition → one **graph record**; **upsert by
    Project `uid`** (create or update-in-place), bump `version`. Establish the **firing binding**:
    for a schedule-type Trigger initiator, create/point the Agent-Scheduler **binding →** this
    record; firing path = event → farm → run the graph.
  - **Validation** (advisory): return warnings, never refuse.
  - **Undeploy**: remove the runtime record (+ its firing binding); leave source assets intact.
  - **Delete**: undeploy, then per user's choice delete/keep source assets.
  - **Cross-project asset-usage index**: which Projects reference which asset ids (drives the
    shared-asset delete warning).

## Data & API changes
- `POST /deploy` (Project → record, returns warnings + version), `POST /undeploy/{project_uid}`,
  delete flows; asset-usage query endpoint.
- Scheduler binding created/removed as part of Deploy/Undeploy.

## Tests & exit criteria
- **Integration (agent_runtime + agent_scheduler):** Deploy a Project → exactly one record; the
  schedule fires it end-to-end (event→farm→run→delivery); re-Deploy after an edit **updates** the
  same record and bumps version (no duplicate); Undeploy removes the record but keeps assets;
  Deleting a Project offers asset choices and blocks/confirms deletion of an asset another Project
  uses; deploying an invalid composition **warns but still deploys**.
- **Playwright e2e:** the Deploy/Undeploy/Delete flows + warning dialogs.
- **Exit:** the **vertical slice is live** — compose Trigger→Agent→WhatsApp in Patron, Deploy, and
  it fires on schedule.

## Risks / notes
- This is the first true cross-service integration — get the firing binding + idempotent upsert
  rock-solid before Phases 06–08 pile on.
