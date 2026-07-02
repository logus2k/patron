# Phase 06 — Skills subsystem

## Goal
Agent Runtime **owns and serves** a skill registry (its own folder, reusing noted's `SKILL.md`
model); the **Agent block selects skills** via a multi-select; the **Brain node injects** them.

## Spec refs
§8.3 (skills: reuse noted's model, Agent-Runtime-owned, served, Brain-node injection), §8.1 (skills
bundled on the Agent block for dynamic system-prompt assembly).

## Depends on
Phase 05 (a working Deploy + graph execution to inject into).

## Scope
- **In:** skill registry in agent_runtime (own dedicated folder); `SKILL.md` parse (frontmatter
  `name`/`description`/`triggers`/`priority`/`max_tokens` + body; `references/`); a **resource
  endpoint** listing skills for the picker; **Brain-node injection** (advertise registry +
  auto-inject priority-1 on trigger match within a token budget + a `get_skill` tool); Agent panel
  skills multi-select.
- **Out:** loop type (Phase 07); authoring new skills in Patron (registry is file-backed to start).

## Work by component
- **agent_runtime**
  - **`skills/` registry module** (port `noted/backend/app/managers/llm_skills.py`): scan a
    dedicated skills folder, parse `SKILL.md`, hot-reload; **its own data, distinct from noted**.
  - **Resource source** `skill` (multi-select) in `resource/` → `/resources/skill` lists
    name+description for the picker.
  - **Brain-node injection** (`nodes/brain.py`, which already advertises MCP tools to the preset):
    (1) advertise selected skills' registry text in the system prompt; (2) auto-inject bodies of
    **priority-1** skills whose **triggers** match, within a token budget; (3) expose a **`get_skill`**
    tool in the loop for on-demand fetch (don't re-fetch an already-injected one).
- **patron**
  - Agent panel: **skills** multi-select (same control as the tools picker), bound to
    `/resources/skill`.

## Data & API changes
- `/resources/skill` (list). Agent node config gains a `skills` allow-list.
- Brain node request assembly extended with skills (registry text + auto-injected bodies + get_skill
  tool spec).

## Tests & exit criteria
- **pytest (agent_runtime):** registry parses a sample `SKILL.md` (incl. triggers/priority/
  max_tokens); `get_static_skills` returns priority-1 skills on matching context and respects the
  token budget (raises if exceeded); `get_skill` returns a body / errors on unknown; injection
  advertises the registry and includes the tool.
- **Playwright e2e:** Agent panel skills multi-select lists real skills and persists the selection.
- **Exit:** an Agent deployed with selected skills has them advertised, auto-injects the priority-1
  ones on trigger, and can fetch others via `get_skill`.

## Risks / notes
- Decide `active_domains` scoping (keep or drop) — see overview open decisions.
- Enforce the token budget loudly (noted uses ~32k for static skills).
