# Block Management — Patron composition & per-block admin panels

**Status:** agreed design (captured from the 2026-07-02 working session). Supersedes the
ad-hoc "Properties panel" and the single central "Resource Manager" console.

This document is the canonical agreement on **what each block on the Patron canvas is, how it
is managed, and how a composition becomes a live agent**. It is written to be read on its own.

---

## 1. Goal

Patron's goal is to let a user **compose a workflow that creates or involves one or several
agents**. The canvas is the composition surface; the blocks are the participants; the wiring is
what makes them act together.

---

## 2. Toolbox → canvas: blocks are typed but initially unbound

- The **Toolbox** holds reusable components (Trigger, Agent, WhatsApp, TTS, Bus, …).
- Dragging a component onto the canvas **creates a block of that type**.
- At that initial moment the block has a **type** (e.g. `Trigger`) but is **not related to any
  existing asset yet**. It is an empty, typed placeholder waiting to be bound.

---

## 3. Double-click → the block's dedicated management panel

Double-clicking a block opens its **dedicated management panel**. Key rules:

- **One panel per block type** — *not* per category. WhatsApp has its own panel, TTS its own,
  Bus its own, Agent its own, Trigger its own. There is **no single central Resource Manager**.
  Each block type has its own specificity and behavior, so consolidating everything into one
  console buys nothing and hides the specificity.
- **One dedicated panel instance per block on the canvas** — if several Agent blocks exist and
  the user opens all their panels, each panel manages exactly one block. Panels are independent
  and can be open simultaneously.
- **Selection is linked (avoids confusion with many open panels):** when a management panel
  becomes the active/selected panel, **its corresponding block on the canvas is selected
  (highlighted) too**. This is how the user knows *which* asset a given panel is managing when
  many blocks and many panels are open.

---

## 4. What a management panel does (CRUD against the asset's source service)

A management panel is an **authoring/management surface for the asset the block represents**.
It operates **immediately against the asset's source service** (not deferred to Deploy). Its
capabilities:

- **Select** an existing asset (bind this block to it).
- **Create** a new asset (persisted at its source service; the block binds to it).
- **Edit** the configuration of the selected/just-created asset.
- **Delete** the asset.

**Destructive operations (delete, and similar) require at least a second confirmation** before
they execute.

The **exact set** of these capabilities is **per block type** (see §8) — some assets are fully
CRUD-able from Patron, others are select/bind-only because they are owned by an external system.

---

## 5. Assets are decoupled and self-ignorant

The foundational principle. Each asset lives in its own service, is **reusable**, and **knows
nothing about the others**:

| Asset            | Source service   | Knows about…                     |
|------------------|------------------|----------------------------------|
| **Schedule**     | Agent Scheduler  | only its cron/timezone           |
| **Agent profile (persona)** | agent_server (`/admin/api/agents`) | only its system prompt + sampling + memory policy |
| **Destination**  | its own channel (e.g. WhatsApp) | only itself       |

- A **Schedule** does not know what it fires.
- An **Agent profile** does not know what triggers it, what it delivers to, or what workflow uses it.
- A **Destination** does not know who sends to it.

An **agent profile is genuinely just a record** — in agent_server it is a system prompt + sampling
params + memory policy; it **instantiates nothing** (every preset runs on the same active model),
so creating one is cheap, it **exists and is selectable the moment it is created**, and it stays
inconsequent until a composition uses it. There is **no dormant "profile store"** to build —
agent_server already is that store.

Because assets are self-ignorant, the **connections between them cannot live inside any asset**.
That is the role of the glue (§7).

### 5.1 Intrinsic references vs. extrinsic glue

Two different kinds of "reference" must not be confused:

- **Intrinsic references** — stored *inside* an asset/block's own config and travelling with it.
  Example: the **Agent block** binds a **persona** (an agent_server profile) and configures the
  **tools** and **skills** the agent needs (§8.1). These are part of what makes that agent that
  agent; they are **not** canvas glue.
- **Extrinsic glue** — connections *between* blocks (Schedule→Agent, RAG→Agent, Agent→Guardrail→
  Destination) that no asset stores about itself. This is the composition (§7).

---

## 6. The Trigger becomes a pure Schedule (reshapes Agent Scheduler)

Consequence of §5: a Trigger is **purely a schedule** (cron/timezone/type). It carries **no
`agent_id`**. It becomes consequential only when connected to an action.

This enables **one schedule → many actions**: the same schedule definition can fire several
actions that should run at the same time.

### 6.1 Why Agent Scheduler must change

Today's Agent Scheduler does **not** model a pure schedule. A stored job (`JobCreate` in
`agent_scheduler/models.py`) **welds** the schedule to its payload and destination in one record:

- schedule: `trigger_type` + `trigger_args` (cron / timezone), **plus**
- `target_stream_id`, `event_type`, `event_data`, `room` — and the **agent identity lives inside
  `event_data`**.

When a job fires, `emit_trigger` emits **one event to one stream**. There is no first-class
"schedule" entity and no schedule that fans out to many actions.

### 6.2 Target model (agreed): first-class Schedule + Bindings

Agent Scheduler is reshaped to:

- a first-class **Schedule** entity — cron/timezone/type **only**;
- separate **Bindings** — (schedule → action) links;
- a schedule with **zero bindings is inconsequent** (it fires nothing);
- one schedule can carry **many bindings** (fan-out to many actions);
- the emit loop resolves a schedule's bindings **at fire time** and emits per binding.

> This is real work in Agent Scheduler (new resource, API, and emit loop). It is part of this
> agreement, not optional. A Deploy-time "expand one trigger into N welded jobs" shortcut was
> considered and **rejected** as the model (it duplicates the schedule and can't represent an
> inconsequent, unconnected schedule cleanly).

---

## 7. The glue = typed Edge entities

The connections between blocks are **first-class Edge entities**, not merely drawn lines.

- An **Edge** connects two blocks (e.g. Schedule→Agent, Agent→Destination).
- An Edge carries the **agent_bus envelope contract**: a **header** (correlation id, session id,
  sender, UTC timestamp) plus a **typed payload**. So an edge defines not just "these two are
  linked" but **what flows** between them and **in what shape**.
- Edges are the **glue** that §5 says cannot live inside any asset.

So a composition is: **decoupled Assets (nodes) + typed Edges (glue)**.

### 7.1 Edges have no panel; behavior on the wire is always a block

Edges are **dumb and typed** — they are **auto-typed from the ports they connect** and get **no
management panel**. Anything you'd want to *do* to data as it flows is expressed as an **explicit,
visible block** you insert on the path, never as hidden edge configuration:

- **Transform** block → data/protocol transformation from one block's output to the next's input.
- **Bus** block → also publish the passing data to a stream.
- **File Destination** block → also write the passing data to a file.
- **Web Destination** block → also call a Web API with the passing data.

Nuance: a **Destination** (Bus / File Destination / Web Destination) used **inline** is a *tap* (has
**in and out**, forwards while it publishes/writes/calls), which differs from a terminal **sink** (in
only). Today `Bus` is modeled as an in-only Destination; **File Destination** and **Web Destination**
are new (§8); the inline-tap variants are a small addition, noted here and not yet built.

### 7.2 Every IN/OUT socket is many-to-many (fan-in and fan-out)

**Every block's IN and OUT sockets support multiple connections** — fan-**out** (one OUT feeds many
targets) *and* fan-**in** (one IN receives from many sources) — on **every** block, not only the
initiator/destination ends. This is **mandatory**: without it, expressing a different wiring would
force **duplicating whole workflows** just to vary their IN/OUT, causing a combinatorial explosion
and a maintenance nightmare.

Consequences:

- A Project may have **multiple initiators** (several ways to fire the same workflow) and **multiple
  destinations** (fan-out delivery) — these are just the entry/exit cases of the general rule.
- Edges are **many-to-many**; the runtime record is definitively the **graph form** with a
  graph-capable executor (§9.3), never a linear chain.
- **Fan-in semantics:** several sources feeding one IN → the block **runs once per incoming
  message** (no barrier/merge). See §9.3.2.

---

## 8. Per-block-type behavior

Each block type's panel encodes that type's real semantics:

| Block type | Asset & source        | Panel capabilities                                        |
|------------|-----------------------|-----------------------------------------------------------|
| **Trigger** *(initiator)* | Schedule @ Agent Scheduler | full CRUD: select / create / edit / delete (confirm) |
| **File Initiator** *(initiator)* | watch config @ a **new folder-watch service** | full CRUD: watched path + match patterns. Fires on new/changed file (e.g. PDF → vector-DB ingestion) (§9.3.1) |
| **Web Initiator** *(initiator)* | route/spec @ a **new HTTP-ingress service** | full CRUD: the endpoint route. Fires on an inbound request (expose a workflow to web clients/services) (§9.3.1) |
| **Agent**  | agent_server profile @ `/admin/api/agents` (**+** tools, skills, loop type — see §8.1) | full CRUD on the profile: select / create / edit / delete (confirm); plus configure tools/skills/loop on the block |
| **RAG**    | retrieval config       | pre-inference retrieve-then-inject block wired **before** an Agent (§8.1) |
| **Guardrail** | guard policy        | check block wired **before/after/both** an Agent (§8.1)   |
| **Workflow** | agent_runtime record (= `Composite`) | a deployed composition dropped in as one participant, with its own IN/OUT (§8.2) |
| **WhatsApp** *(destination)* | WhatsApp group/contact | **select/bind-only**: discover + select an existing target, set a friendly name. No create/delete of the group itself (it is owned by WhatsApp). |
| **TTS** *(destination)* | TTS target            | per that channel's real capabilities                      |
| **Bus** *(destination)* | Bus stream/target     | per that channel's real capabilities                      |
| **File Destination** *(destination)* | file path/config | full CRUD: write the outcome to a file. Distinct from **File Initiator** (which *watches* a folder to fire a Project) |
| **Web Destination** *(destination)* | outbound Web API route/config | full CRUD: end/continue the workflow by **calling** a Web API. Distinct from **Web Initiator** (which *receives* a request to fire a Project) |
| **Transform** | — (inline behavior) | on-the-wire transformation block (§7.1)                |

The asymmetry is deliberate and is the reason panels are **per block type**: Patron can truly
create/edit/delete a Schedule or an agent_server profile, but it can only **discover and select** a
WhatsApp group because that group is not Patron's to create.

### 8.1 The Agent block ≠ the bare profile: profile + tools + skills + loop

The Patron **Agent block is a richer authoring unit than the agent_server profile it binds**. It
configures, together on one block:

- the **agent profile (persona)** — bound from agent_server (`/admin/api/agents`);
- the **tools** the agent needs (MCP tools, incl. RAG-**as-a-tool**);
- the **skills** the agent needs — a multi-select from Agent Runtime's skill registry (§8.3);
- the **loop type** the agent runs — off / counter / expression / judge (§8.4).

**Why these are joined and not separate wired blocks:** an agent may **assemble its system prompt
dynamically** and **insert tools and skills into it at runtime**. Profile + tools + skills are one
cohesive thing the agent composes for itself, so they belong on the Agent block, not on the wire.

**What is NOT on the Agent block** (these are separate, wired blocks — "behavior on the wire is a
block", §7.1):

- **RAG (pre-inference)** — a **RAG block wired before** the Agent, feeding its IN (retrieve-then-
  inject). *(RAG used the other way — during inference — is just a tool on the Agent, above.)*
- **Guardrails** — separate **Guardrail block(s) wired before, after, or both** around the Agent
  (input-side and/or output-side checks). Never a field on the Agent.

> This decomposes today's monolithic runtime `AgentRecord` (which hangs tools/rag/guardrails/
> trigger/delivery off one agent): tools/skills stay with the Agent block; RAG-pre and guardrails
> become their own blocks; trigger and delivery are the Schedule and Destination assets joined by
> Edges. The `AgentRecord` shape must be revisited to match (see §12).

### 8.2 Agent block vs Workflow block (two record layers)

There are **two distinct record layers**, and each is its own block:

- **Agent block** → binds an **agent_server profile** (§8.1). The pure agent.
- **Workflow block** → an **agent_runtime record** — a whole composed workflow referenced as **one
  participant**, with its **own IN/OUT** so it is **composable/nestable like any other block**.
  This is exactly the existing `Composite` block in `composer/blocks.py`.

Because a **Project deploys 1:1 to one runtime record** (§9.3), **a Project *is* a Workflow**, and
the Workflow block is how you drop an already-built Project into a larger composition. Nesting falls
out of this for free.

### 8.3 Skills (reuse noted's model; owned + served by Agent Runtime)

**Skills** are reusable, focused knowledge units injected into an agent's context. We **reuse
noted's proven model** (`noted/backend/app/managers/llm_skills.py`) — but **Agent Runtime owns and
serves them itself**, in its **own dedicated folder structure, distinct from noted**.

**A skill = a folder with a `SKILL.md`** — YAML frontmatter + markdown body:

- `name`, `description`, `triggers: [condition…]`, `priority` (default 3), `max_tokens`
  (default 500); optional `references/`, `scripts/`, `assets/` subfolders.
- The body is the instruction text injected into context.

**Ownership & serving — inside Agent Runtime:**

- Agent Runtime maintains a **skill registry** (its own folder structure; noted's `SKILL.md`
  format/parser reused), hot-reloadable.
- It **serves** the registry two ways: (1) a **resource endpoint** for the Agent block's picker
  (list available skills — like `/resources/mcp-tool` lists tools); (2) the **runtime injection**
  path used by the Brain node.

**Selection — on the Agent block:** the block's `skills` field is a **multi-select from the served
registry**, exactly like the Tools picker. The user selects the skills the agent should have.

**Injection — in the Brain node** (`nodes/brain.py`, the server-side function-calling loop that
already advertises tools to the agent_server preset). Beside tools, it:

1. **Advertises** the selected skills' registry (name + description) in the system prompt, so the
   agent knows what exists;
2. **Auto-injects** the bodies of **priority-1** skills whose **triggers** match the current
   context conditions, within a **token budget** (noted uses ~32k for static skills);
3. Exposes a **`get_skill`** tool in the loop for **on-demand** fetch of a non-active skill's body
   (must not re-fetch an already auto-injected one).

This is the **dynamic system-prompt assembly** that justifies skills (and tools) living **on** the
Agent block rather than as wired nodes (§8.1).

### 8.4 Loop type (how the agent repeats its action)

The **loop type** is bundled on the Agent block and controls **whether/how the agent repeats its
whole action**. It is the **outer** loop and must not be confused with the Brain node's **inner**
`max_rounds` tool-calling loop (§8.1) — that inner loop runs *within a single* invocation; the loop
type repeats the *whole* invocation.

**Typology (four types):**

| Type | Repeats until… | Config |
|------|----------------|--------|
| **off** | (never — single execution) | — |
| **counter** | a fixed count is reached | `n` |
| **expression** | a configured expression matches the outcome | the expression **+** max-iter cap |
| **judge** | an embedded Judge validates the outcome | the Judge (see below) **+** max-iter cap |

**The Judge (for `judge`):** a Judge is **just an agent profile** (its own prompt, skills, tools)
**configured *inside* this Agent block's loop config** — **not** a separate canvas block and **not**
a separate Agent block. It evaluates *this* block's outcome each iteration. Because a Judge is an
agent, its output is text; **how the loop turns that text into a stop/continue decision is itself a
configurable loop option** (e.g. an expression match on the Judge's output, or reading a structured
verdict field) — not a hard-coded mechanism.

**Options common to the repeating types (`counter`/`expression`/`judge`), configurable:**

- **iteration input** — either **same original input** every iteration (pure retry) or **reinsert
  the previous outcome** (iterative refinement).
- **max-iterations safety cap** — a hard ceiling that force-exits. **Required** for `expression`
  and `judge` (open-ended; "never trust the model to stop"). `counter` is inherently bounded by
  `n`; `off` is a single shot.

---

## 9. Project, Deploy, and the two tiers of state

### 9.1 Project = a named, saved composition (desired state)

- A **Project** is a **named saved configuration**: the whole composition — blocks, their
  **bindings** to concrete assets, and the **Edges** between them.
- **Project identity:** a Project has a **stable `uid`** (its identity — used for idempotent Deploy
  §9.3, cross-project asset-usage tracking §9.4, and Save/Load), an **editable display name**, and
  an **optional description** the user may add. Renaming a Project must **not** orphan its deployed
  record (the uid, not the name, is the key).
- Save/Load operates on Projects.
- The Project persists the glue as **design intent** (the drawing). Without this, Save/Load
  would lose which blocks were wired together and a composition could not be reopened to edit.

### 9.2 Identity & binding persistence

- **Every block carries its own stable UID**, assigned when it is dropped on the canvas and saved
  in the Project. Blocks are identified by this UID.
- A block's **binding is a pointer to an asset id** (the schedule id, the agent-profile id). It is
  saved with the Project and survives Save/Load. Reopening the block's panel shows that asset's
  config for editing.
- **The same asset id may be pointed to by several blocks** (many blocks → one asset). Block UID
  and asset id are therefore distinct: the block UID identifies the *slot*; the asset id
  identifies *what fills it*. A block with no binding is simply empty (still has its UID).

### 9.3 Deploy = materialize into Agent Runtime (live state)

Configurations are **eventually consequent**:

- **Assets exist independently and are inconsequent on their own.** A created Schedule connected
  to nothing does nothing. A new Agent profile that is unused is just a dormant config record.
- **Deploy runs on a composition of pre-existing assets** — each block bound to an asset that was
  either **created during this composition** or **already existed and was selected**. Deploy does
  **not** create the source assets.
- **A Project deploys 1:1 to a single Runtime record.** One Project = **one graph/workflow
  record** in Agent Runtime that holds the composition's **agents as nodes** and the **typed Edges
  as glue** between them. This record **is the materialized glue** binding schedule(s), agent
  profile(s), and destination(s) into one live workflow.
- **Re-deploy is idempotent:** the Project owns that one record and **updates** it in place (keyed
  by the Project's **`uid`** §9.1), never duplicating it. Each Deploy **increments the record's
  version**.
- **Deploy validation is advisory (warn, don't block).** Deploy checks the composition and **warns**
  about problems — e.g. **no initiator** (it can never fire), **type-incompatible edges**, **missing
  required config**, or **unbound blocks** — but **does not refuse**. Patron surfaces what's missing;
  the **user may still choose to Deploy anyway**. The decision is the user's, not a hard gate.

> **Requires new Agent Runtime support.** Today a runtime record (`AgentRecord`, `dsl.py`) is
> **flat single-agent** (one Brain, one Delivery) and the registry is `dict[uid → record]` with
> **no project/workflow grouping**; `dsl.py:17` states the graph form is deferred. Realizing
> "one Project = one record" means promoting the record to the **graph/workflow form** (multiple
> agent nodes + typed Edges inside one record) **and** giving the runtime a **graph-capable
> executor** (today's runner is linear brain→delivery). This is real runtime work, parallel to
> the Agent Scheduler reshape (§6).

### 9.3.1 What fires a deployed Project

A Project's firing is **whatever its *initiator* block dictates** — the entry block of the
composition. The common mechanism is uniform: **when the initiator's condition occurs it emits a
bus event → the farm resolves it → runs the Project**; only the *condition* differs per initiator
type. There are several **independent** initiator block types (no "family" abstraction is intended):

- **Trigger (schedule type)** — bound to a **Schedule** asset; **that schedule's firing *is* the
  Project's firing**. At **Deploy**, the Trigger-initiator edge establishes the scheduler
  **binding = schedule → this Project's runtime record**.
- **Trigger (channel type)** — event-driven; the Project fires on the channel event, not a schedule.
- **File Initiator** — bound to a watch config on a **new folder-watch service**; fires when a new
  or changed file is detected in the watched folder (e.g. PDF → vector-DB ingestion).
- **Web Initiator** — bound to a route on a **new HTTP-ingress service**; fires when a request hits
  the specified Web API route (expose a workflow to web clients/services). "Web" does **not** imply
  public: a route may be a **local/server-side** address reachable only inside the network. **Public
  exposure and authorization are handled at the nginx / OAuth2Proxy edge** — out of scope for this
  spec and *not* baked into the block.
- **Nested Workflow** — a Project used as a `Workflow` block inside a parent (§8.2) fires when the
  **parent** invokes it, not from an initiator of its own.

So **establishing the initiator's source → Project binding is part of Deploy**, derived from the
initiator block — whatever its type; a source (schedule / watch / route) with no such binding
remains inconsequent (§6). The **File Initiator** and **Web Initiator** each require a **new backing
service** (a folder watcher; an HTTP ingress) that emits the bus event, analogous to what Agent
Scheduler is for Trigger. (Their **destination** counterparts — File Destination, Web Destination —
are outbound sinks and need no such emitter service; see §8, §7.1.)

### 9.3.2 Fan-in semantics: run per incoming message

When several sources feed **one IN** (§7.2), the block **runs once per incoming message** — each
arrival independently triggers a run. There is **no barrier and no merge**: the block never waits
for all sources, and inputs are not synchronized/combined. This is the natural bus/event semantics
(every edge is a bus envelope) and keeps the graph executor simple.

A synchronized join/merge is deliberately **out of scope for now**; if ever needed it would be an
**explicit merge/Transform block**, never implicit socket behavior.

### 9.4 Undeploy & delete

- **Undeploy** removes **only the live Runtime record** (the glue). All **source assets** —
  schedules, agent profiles, destinations — stay **intact and reusable**.
- **Delete a Project** first undeploys, then **asks the user what to do with the assets it used**
  (keep them, or delete them too — they are reusable, so keeping is the safe default).
- **Cross-project protection:** before deleting any asset, Patron must **detect whether other
  Projects reference it**; if so, it **warns and requires explicit confirmation**, because
  deleting a shared asset would **break those other Projects**. This requires Patron to maintain
  **cross-project asset-usage tracking** (which Projects reference which asset ids).

### 9.5 Two tiers of state — summary

| Tier              | Where            | Created by            | Consequential? |
|-------------------|------------------|-----------------------|----------------|
| **Source assets** | Agent Scheduler / profile store / channel | panel actions (immediate) | No, on their own |
| **Runtime assets**| Agent Runtime    | **Deploy**            | Yes — live/activated |

And the **glue** lives in **two roles**:

- in the **Project** as a *drawing* (design intent), and
- in **Agent Runtime** as the *running reality* (deployed, live) after Deploy.

Same glue, two roles.

---

## 10. Summary of the model

1. Toolbox components → dragged onto canvas as **typed, initially-unbound blocks**.
2. Double-click → a **dedicated, per-block-type** management panel; selecting a panel selects its
   block on the canvas.
3. Panels do **type-specific CRUD/select** against each asset's **source service, immediately**;
   destructive actions require confirmation.
4. **Assets are decoupled and self-ignorant.** A Trigger is a **pure Schedule** (no agent_id);
   this reshapes **Agent Scheduler** into first-class **Schedule + Bindings** (one schedule →
   many actions).
5. The connections are **typed Edge entities** carrying the agent_bus envelope contract — the
   **glue** that no asset stores about itself.
6. A **Project** is a named saved composition (assets' bindings + edges) — the **desired state**.
7. **Deploy** materializes the composition into **Agent Runtime** as **live Runtime assets** —
   the glue made real and consequential.

---

## 11. Resolved decisions (2026-07-02 continuation)

The four items previously open are now decided (details folded into §7.1, §9.2, §9.3, §9.5):

- **Identity model** — every block has its **own stable UID** (assigned on drop, saved in the
  Project); its **binding is a pointer to an asset id**, which several blocks may share. §9.2.
- **Deploy idempotency** — **Project 1:1 with one Runtime record**; re-deploy **updates** that
  record (keyed by Project identity) and **increments its version**. Needs the runtime record's
  **graph/workflow form** + a **graph-capable executor**. §9.3.
- **Undeploy / delete** — undeploy removes only the live record, assets untouched; deleting a
  Project asks what to do with its assets and **blocks/confirms deletion of assets other Projects
  use** (needs cross-project usage tracking). §9.5.
- **Edge management UX** — **no edge panel**; edges are auto-typed from ports, and any on-the-wire
  behavior is an explicit **Transform / Bus / File** block inserted on the path. §7.1.

## 12. Net new work implied by this agreement

For implementers — the agreement requires building/reshaping, beyond Patron's panels:

1. **Agent Scheduler** — first-class **Schedule** entity + **Bindings** (one schedule → many
   actions); a schedule with zero bindings is inconsequent. (§6)
2. **Agent Runtime** — promote the record to the **graph/workflow form** (agents as nodes + typed
   Edges) so **one Project = one record**, plus a **graph-capable executor** (today's is linear).
   And **decompose the monolithic `AgentRecord`**: tools/skills stay with the Agent, but RAG-pre
   and guardrails become their own graph nodes, and trigger/delivery become Schedule/Destination
   assets joined by Edges. (§8.1, §9.3)
3. **Patron** — Project entity (named save/load of composition + bindings + edges); per-block-type
   panels with type-specific CRUD/select; block UIDs + asset-id bindings; Deploy/Undeploy/Delete
   flows; **cross-project asset-usage tracking** for safe deletes. (§3, §4, §9)
4. **New blocks** — **RAG** block (pre-inference), **Guardrail** block (before/after), **Workflow**
   block (= `Composite`, with IN/OUT); two new **initiators**: **File Initiator** (folder watch) and
   **Web Initiator** (HTTP inbound); two new **destinations**: **File Destination** (write to file)
   and **Web Destination** (call an outbound Web API); and inline **tap** variants of Bus / File
   Destination / Web Destination (in+out) distinct from terminal sinks. (§7.1, §8, §8.1, §8.2, §9.3.1)
4a. **New backing services (initiator emitters only)** — a **folder-watch service** (for the File
   Initiator) and an **HTTP-ingress service** (for the Web Initiator), each emitting a bus event to
   fire the Project, analogous to Agent Scheduler for Trigger. The **destination** counterparts are
   outbound sinks (write a file / call a Web API) and need no emitter service. (§9.3.1)
5. **Skills subsystem — inside Agent Runtime** — a **skill registry** in its own dedicated folder
   structure (reusing noted's `SKILL.md` format/parser), a **resource endpoint** to list skills for
   the Agent block picker, and **Brain-node injection** (advertise registry + auto-inject priority-1
   on trigger match within a token budget + a `get_skill` tool for on-demand fetch). (§8.3)
6. **Loop-type execution — in Agent Runtime** — an **outer repeat loop** around the agent action
   (distinct from the Brain node's inner `max_rounds`): the four types (off / counter / expression /
   judge), the **embedded Judge** (an agent profile run in the judging role, its verdict read per a
   configurable option), the **iteration-input** option (same vs reinsert previous outcome), and the
   **max-iter safety cap** on the open-ended types. (§8.4)

These should be resolved before implementing the Deploy path end-to-end.

## 13. Testing & CI requirement (mandatory, per feature)

**Every feature in this spec must ship with written tests** — a feature is not "done" without them.
Tests **live in each component's own repo** (per-component placement, not a central test project)
and must run **non-interactively** so they can be wired into **CI/CD as a Jenkins task**.

- **Patron** → `patron/test/` (currently **empty**). Covers the per-block-type panels + CRUD/select
  (§3–§4, §8), the resource pickers, Project save/load + bindings (§9.1–§9.2), and the
  Deploy/Undeploy/Delete flows (§9.3–§9.4). **End-to-end (E2E) coverage is required** — the UI
  flows are exercised via **Playwright** (already used in this repo), in addition to unit tests for
  the `serve.py` proxy and pure logic.
- **Agent Runtime** → `agent_runtime/tests/` (existing **pytest** suite). Covers the graph/workflow
  record + graph executor and the `AgentRecord` decomposition (§9.3), the **skills subsystem**
  (§8.3), **loop-type execution** (§8.4), per-message **fan-in** (§9.3.2), and the resources API.
- **Agent Scheduler** → its own test suite. Covers the **Schedule + Bindings** reshape and fan-out
  (§6).
- **New backing services** (folder-watch, HTTP-ingress) → each its own test suite (§9.3.1 / §12·4a).

All suites are aggregated into a **single Jenkins pipeline** (one task per component, green = all
pass). No feature merges without its test; this is the completion gate for everything above.
