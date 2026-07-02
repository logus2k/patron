# Top menu-bar revision (proposal)

A full revision of Patron's pull-down menus to match the composer model in
[`block_management.md`](block_management.md). Menus are defined in `js/menu.js` and wired to app
functions in `js/app.js` (`registerCommand`). This doc is the **target**, reflecting the **decided**
choices (see §Decided): top-level **Project**, keep a **Build** menu (holds the Deploy lifecycle),
**add Insert**, and a flattened **Edge context menu**.

Menu-bar order: **Project · Edit · Insert · Build · View · Help**.

## Why change

- **"Workspace" → "Project".** The model now has first-class **Projects** (uid + name + optional
  description, many saved). The old single "Workspace" doc becomes Project save/load. (§9.1)
- **"Build" → "Deploy".** Deploy has a real **lifecycle** now — validate / deploy / undeploy /
  delete — not just "compile + deploy". (§9.3–§9.4)
- **Add "Edit".** Canvas editing (undo/redo, delete, duplicate, select-all) has no home today.
- **No "Manage"/"Resources" menu.** Management is **per-block** (double-click a block); the old
  central `view.resources` command is retired. (§3)
- **"Load News Agent" → an Examples submenu** — it's a demo fixture, not a top-level action.

## Current menus (grounded, `js/menu.js`)

- **File:** New/Clear Canvas · Load News Agent · Save Workspace (Ctrl+S) · Load Workspace
- **Build:** Compile → DSL · Deploy to Runtime
- **View:** Toolbox · Output Panel · Zoom Control · Dark/White Theme
- **Help:** About Patron

Wired-but-unused commands in `app.js`: `build.run`, `view.resources` (retire both).

## Proposed menu bar

Legend — **Status:** *existing* (works today) · *reuse* (existing command, relabeled/rehomed) ·
*new* (needs implementation).

### Project  *(was File)*
| Item | Shortcut | Command id | Status |
|---|---|---|---|
| New Project | Ctrl+N | `project.new` | new |
| Open Project… | Ctrl+O | `project.open` | reuse `file.load` |
| Recent Projects ▸ | | `project.recent` | new |
| Open Example ▸ (News Agent) | | `project.example.news` | reuse `file.news` |
| *(separator)* | | | |
| Save | Ctrl+S | `project.save` | reuse `file.save` |
| Save As… | Ctrl+Shift+S | `project.saveAs` | new |
| Rename… | | `project.rename` | new |
| Project Settings… (name / description / uid) | | `project.settings` | new |
| *(separator)* | | | |
| Delete Project… *(confirm)* | | `project.delete` | new |
| Import… / Export… (JSON) | | `project.import` / `project.export` | new |

### Edit  *(new)*
| Item | Shortcut | Command id | Status |
|---|---|---|---|
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z | `edit.undo` / `edit.redo` | new |
| Cut / Copy / Paste / Duplicate | Ctrl+X/C/V/D | `edit.cut`/`copy`/`paste`/`duplicate` | new |
| Delete Selection | Del | `edit.delete` | new |
| Select All | Ctrl+A | `edit.selectAll` | new |
| *(separator)* | | | |
| Clear Canvas | | `edit.clear` | reuse `file.clear` |

### Insert  *(new)*
Add a block to the canvas by category — mirrors the Toolbox groups
([`toolbox_blocks.md`](toolbox_blocks.md)). Each item drops the block at canvas center. Command ids
`insert.<type>` (e.g. `insert.trigger`, `insert.rag`). Status: **new**.

| Submenu | Items |
|---|---|
| Initiators ▸ | Scheduled Trigger · File Initiator · Web Initiator · Speech-to-Text |
| Blocks ▸ | Agent · RAG · Guardrail · Data Transform · Workflow |
| Destinations ▸ | WhatsApp · Text-to-Speech · Event Bus · File Destination · Web Destination |

### Build  *(kept; now holds the Deploy lifecycle)*
| Item | Shortcut | Command id | Status |
|---|---|---|---|
| Validate *(advisory — warn, don't block)* | | `deploy.validate` | new |
| *(separator)* | | | |
| Deploy | Ctrl+Enter | `deploy.run` | reuse `build.deploy` |
| Undeploy | | `deploy.undeploy` | new |
| Delete Deployment… *(confirm)* | | `deploy.delete` | new |
| *(separator)* | | | |
| Deployment Status… (current version) | | `deploy.status` | new |
| Compile → DSL (preview) | | `deploy.compile` | reuse `build.compile` |

### View  *(kept, extended)*
| Item | Command id | Status |
|---|---|---|
| Toolbox *(checkbox)* | `view.toolbox` | existing |
| Output / Console *(checkbox)* | `view.output` | existing |
| Zoom Control *(checkbox)* | `view.zoom` | existing |
| *(separator)* | | |
| Fit to Screen · Reset Zoom · Zoom In / Out | `view.fit`/`resetZoom`/`zoomIn`/`zoomOut` | new |
| *(separator)* | | |
| Dark / Light Theme *(toggle)* | `view.theme` | existing |

### Help  *(kept, extended)*
| Item | Command id | Status |
|---|---|---|
| About Patron | `help.about` | existing |
| Documentation… | `help.docs` | new |
| Keyboard Shortcuts… | `help.shortcuts` | new |

## Edge context menu (right-click / dot on a connection)

**Today** (`js/link-menu.js`) it's a two-level drill: `Insert node ▸` → a submenu with `‹ Back` →
then `Delete link`. Cumbersome.

**Revised — one flat list, Delete last:**

- The **insertable block types listed directly** (no submenu, no "Back"). Clicking one drops it on
  the **edge midpoint** and rewires `left → block → right`.
- A **separator**, then **"Delete Edge"** as the **last** item (danger-styled) — removes the
  connection.

```
┌─────────────────────┐
│  Agent              │
│  RAG                │   ← insertable (pass-through) blocks, flat
│  Guardrail          │
│  Data Transform     │
│  Workflow           │
│ ─────────────────── │
│  Delete Edge        │   ← last item, after the separator
└─────────────────────┘
```

Notes: only **pass-through** blocks (both **in** and **out**) can be inserted mid-edge — pure
Initiators (out-only) and Destinations (in-only) are excluded, since there's nothing to rewire on
one side. Rename **"link" → "Edge"** throughout (the model's term).

## Removed / relocated

- **`view.resources`** (central Resource Manager) — removed; management is per-block (§3).
- **`build.run`** (demo run pass) — removed (the GoF demo it drove is gone).
- **Load News Agent** — relocated under **Project ▸ Open Example**.
- **Save/Load Workspace** — become **Project ▸ Save / Open Project**.

## Dependencies

Items marked *new* under **Project** and **Build** depend on the **Project entity** (Phase 01) and
the **Deploy lifecycle** (Phase 05) in [`implementation_plan/`](implementation_plan/). Until those
land they are menu stubs; the *existing*/*reuse* items work now. **Edit** and **View** additions are
mostly local (litegraph) and can land independently.

## Decided (2026-07-02)

1. **Top-level name:** **Project** (not "File").
2. **Actions menu:** keep a single **Build** menu holding the Deploy lifecycle (no separate "Deploy"
   menu).
3. **Insert menu:** **included** (add blocks by category, mirroring the Toolbox).
4. **Edge context menu:** flattened to one list with **"Delete Edge"** last (see §Edge context menu).
