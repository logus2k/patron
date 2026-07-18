# Ingestion Agent + Ingestion Block — Specification

**Status:** DRAFT — owner decisions in §12 required before code.

## Deliverables — four, in dependency order

| # | Deliverable | Repo | What it is |
|---|---|---|---|
| **1** | **The Ingestion Agent** | `ingestion_server` (new) | A container running the agent: the pipeline engine, the layers, the judge. It owns docling, embedding and extraction. **It is complete and useful on its own** — nothing about it knows Patron exists. |
| **2** | **The SDK** | `ingestion_server/sdk/` | The documented, supported way to consume the Agent: an OpenAPI contract, a Python client (`sdk/python/ingestion_client`, mirroring the existing `agent_bus/sdk/python/agent_bus_client`), reference docs, and **runnable examples** for each integration path — one-shot run, streaming progress, resuming a suspended run, authoring a pipeline. Any application, script, agent or CI job integrates through this. |
| **3** | **Runtime support** | `agent_runtime` | What makes the Agent executable *from a workflow*: a new `ingestion` node kind (block class, lowering, `NodeKind`, handler) plus a per-node `timeout_s` (§6) — without which a 143s run is killed at 120s. The handler is a **client of the SDK (2)**; it holds no ingestion logic. |
| **4** | **The Patron block** | `patron` | The authoring surface: an `ingestion` block with a config panel, so the Agent is composable on the canvas like any other block. Plus two new fields on the existing File Initiator (§9.2). It compiles to (3), which calls (2), which drives (1). |

Each layer is a client of the one below it, and each is independently useful:
**(1) runs standalone · (2) integrates it anywhere · (3) executes it in a workflow · (4) authors it visually.**

CV's broken CI can be fixed at layer 2 (a `curl`) long before layers 3 and 4 exist.

---

## 1. Problem

Every RAG app in the fleet needs the same thing — turn a document into searchable chunks
plus a knowledge graph — and each has solved it privately, or not at all:

- **CV** — `scripts/reingest.py` uploaded a PDF to noted and let noted do the work. noted is
  stopped, so the CI stage fails and the chat knowledge base silently never updates.
- **bulário** — ingestion still writes to the dead Chroma/noted-graph stores.
- **job2cool** — its corpus was migrated by hand with one-off harness scripts.

The work is identical in shape; only the *configuration* differs — what to extract, from what
kind of document, into which database. That is a configurable service with a block in front of
it, not a script per app.

---

## 2. Verified current state

Established by reading code. Where docs conflict with code, code wins.

| Claim | Reality | Evidence |
|---|---|---|
| `job_timeout_s` is per-block | **No — global**, wrapping the whole graph run | `config.py:72` (default 120), `farm.py:337-338` |
| A block can declare a timeout | **No** — no timeout field on any block | grep `blocks.py`/`dsl_graph.py`: empty |
| `task`/`context`/`result` are types | **No.** Only `STRING`/`ANY` exist | `schema.py:80-81` |
| `DataSchema` can express a list | **No `array` type** | `schema.py:26-27` |
| A field can hold a list of structured objects | **No.** Only `Branch.branches`, a raw JSON textarea | `schema.py:108`, `blocks.py:822` |
| Presets can be created from the editor | **No.** `preset` = `{LIST, PICK}`; no POST route | `registry.py:75-83`, `resources_api.py:8` |
| Composite is usable | **No.** ~20% built, wired to the wrong executor | `blocks.py:956` returns `{}`; absent from `NodeKind` |
| "Adding a block is Python-only" | **False.** Palette, ports, icons, insert menu hardcoded in JS | `catalog.py:1-7` vs `agent_nodes.js:594-628` |
| The File Initiator seeds file **content** | **Yes — and a PDF becomes a marker string** | `folder_watch/src/folder_watch/emitter.py:34-48`, `:125` |

**Measured** (prototype `~/env/assets/cv/ingest`, ran green end-to-end 2026-07-16):

- 6-page PDF → **71 chunks**, dense+sparse+cite_hex complete.
- Extraction **1.02s/chunk sustained**. `llama-vision` runs `--parallel 2`; 4 concurrent shows a
  clean two-wave queue and no gain. **2 is the ceiling.**
- Disabling the model's `<think>` block: extraction **163s → 64s** (65% of generated tokens were
  discarded reasoning).
- **Full run 143s** — which is why the global 120s cap must become per-node.
- Four entity types (`organization`/`role`/`technology`/`domain`) are held cleanly by the model in
  **one** prompt; four separate per-type prompts cost 2× and found *less*. A `term`/`concept`
  split was undecidable and produced 100% overlap — dropped.

---

## 3. Architecture

**The Agent is the product. Everything above it is a client.**

```
  ┌─ 4 ── patron ─────────────────────────────────────────┐
  │  [File Initiator] → [Ingestion block] → [Event Bus]   │   authoring
  │  config panel: pipeline · judge · timeout             │
  └───────────────────────┬───────────────────────────────┘
                          │ compiles to
  ┌─ 3 ── agent_runtime ──┴───────────────────────────────┐
  │  ingestion node kind + handler + per-node timeout_s   │   execution
  └───────────────────────┬───────────────────────────────┘
                          │ calls
  ┌─ 2 ── SDK ────────────┴───────────────────────────────┐
  │  OpenAPI · ingestion_client (python) · docs · examples│   integration
  └───────────────────────┬───────────────────────────────┘
       ▲    ▲             │ HTTP
       │    │             ▼
  ┌────┴────┴─ 1 ── ingestion_server (container) ─────────┐
  │  pipeline engine · layers · judge                     │   the Agent
  │  owns docling / embedding / extraction                │
  │  stateless about pipelines (they arrive inline)       │
  └───────────────────────────────────────────────────────┘
       ▲                    ▲
  ┌────┴─────┐      ┌───────┴────────┐
  │ CV CI    │      │ any agent /    │   other SDK consumers —
  │ (curl)   │      │ script         │   no Patron involved
  └──────────┘      └────────────────┘
```

Same pattern as `brain`→agent_server and `tools`→MCP: *the runtime holds references; the code
lives in the service that owns it* (`technical_architecture.md:130`).

### Firing — Jenkins never touches the SDK

```
Jenkins copies cv.pdf → /watched/in   →   [File Initiator] → [Ingestion] → [Event Bus]
                                           (folder_watch fires the deployed Project)
```

Jenkins knows nothing about pipelines, ingestion, or the SDK. It drops a file; the deployed
workflow carries the configured Ingestion block.

This also resolves the naming overlap: `FileInitiator`'s own docstring says *"Fires when a
new/changed file is detected in a watched folder (**e.g. PDF → vector-DB ingestion**)"*
(`blocks.py:536`). **File Initiator watches and fires; Ingestion processes.** They compose.
`specs/toolbox_blocks.md` needs an Ingestion entry (it has none today).

### Execution model — decided: execute-and-wait

The `ingestion` node **kicks off the run and waits for completion** before the next workflow
activity executes. Its output flows downstream normally. This requires §6; it requires no
dispatch-and-return, no mid-graph bus gates, no farm suspension changes.

---

## 4. The SDK (deliverable 2)

The SDK is the contract, not an afterthought of the service. It ships as:

- **`openapi.json`** — generated, versioned, the machine-readable truth.
- **`sdk/python/ingestion_client/`** — a typed client, laid out like the existing
  `agent_bus/sdk/python/agent_bus_client/` (`client.py` · `envelope.py` · `__init__.py`).
- **`documents/sdk.md`** — reference: every endpoint, every state, every error.
- **`examples/`** — runnable, one per integration path:
  `run_once.py` (one-shot, `wait=true`) · `stream_progress.py` (SSE) ·
  `resume_suspended.py` (judge → human decision → resume) · `author_pipeline.py`
  (build + `validate` a pipeline) · `ci_ingest.sh` (the CV Jenkins case, pure `curl`).

Deliverables 3 and 4 are themselves SDK consumers — if an example is awkward to write, the
API is wrong.

### 4.1 Endpoints

REST, JSON, OpenAPI-documented. Every endpoint usable without Patron.

```
POST   /v1/runs                 { pipeline, document, wait? }  -> Run
GET    /v1/runs/{run_id}                                       -> Run
POST   /v1/runs/{run_id}/resume { decision, note? }            -> Run
POST   /v1/runs/{run_id}/cancel                                -> Run
GET    /v1/runs/{run_id}/events                                -> SSE
POST   /v1/pipelines/validate   { pipeline }                   -> { ok, errors[] }
GET    /v1/layers                                              -> [LayerRef]   (§8)
GET    /v1/healthz
```

There is **no `/v1/templates`**: pipelines arrive inline (§5), so the service stores none.

**`POST /v1/runs`** is the whole SDK for most callers:
- `wait=true` (the block's mode) — blocks until terminal, returns the finished `Run`.
- `wait=false` — returns `run_id`; poll `GET` or stream `/events`.

**`Run`**
```json
{ "run_id": "...", "document": "...",
  "state": "running|suspended|completed|failed|cancelled",
  "layers": [ { "name": "llm", "state": "completed",
                "digest": { "entities": 334, "by_type": {...} },
                "judge": { "verdict": "ok", "note": "..." } } ],
  "committed": { "chunks": 71, "entities": 334, "relations": 1392 },
  "error": null }
```

Run state is **persisted** by the service: a run survives a restart and a suspension outlives any
caller. `GET /v1/runs/{id}` is always the truth. Bus events mirror it:
`ingestion.progress` · `ingestion.suspended` · `ingestion.completed` · `ingestion.failed`.

---

## 5. Block configuration

The block's config has **three** aspects. The pipeline is one of them.

```yaml
pipeline:        # the declarative pipeline (below) — inline, self-contained
judge:           # block-level: watches the pipeline, so it sits outside it
  persona: cv_ingest_judge
  template: |
    ...
  on_suspicion: suspend        # suspend | notify
timeout_s: 600   # block-level, inherited from BlockSchema (§6)
```

### 5.0 Run semantics (decided)

- **The engine is single-document.** The API accepts a **list**; the run walks it one at a time.
  `POST /v1/runs { pipeline, documents: [...] }`. One run, N documents, sequential.
- **A run halts on the first failure or judge flag** — state `suspended`, not terminal. Documents
  already processed stay **staged, uncommitted**. A genuine crash is `failed` instead.
- **Resume carries a decision:** `retry` (re-run that document) · `skip` (move to the next) ·
  `abort` (terminate the run).
- **Re-ingest replaces.** The same document ingested twice is wiped and rewritten, never
  duplicated. Safe because `folder_watch` only fires on real changes (§9.2).
- **Deletion is not a run** — it is a removal (§9.1.1).

**Open:** on `abort`, are the staged documents committed or discarded? (§12)

### 5.1 The pipeline

Inline and self-contained. The field's **`default` IS the base pipeline** — a freshly-dropped
block arrives with a working, editable declaration (the mechanism `Branch.branches` uses with
`default=["then","else"]`, `blocks.py:822`).

```yaml
corpus:
  context: "a curriculum vitae"        # injected into extraction prompts
  language: en
  target_db: cv

chunking:
  strategy: pdf_docling                # | markdown_render | plain_text
  target_tokens: 200

types:
  entities:
    organization: { definition: "...", examples: ["Acme Corp"] }
    role:         { definition: "...", examples: ["Senior Engineer"] }
    technology:   { definition: "...", examples: ["PostgreSQL"] }
    domain:       { definition: "...", examples: ["cybersecurity"] }
  relations:
    AT_ORGANIZATION: { from: role, to: organization }

index:                                 # entities promoted to indexed chunk properties
  english_level:    { type: string }
  experience_years: { type: int }

steps:                                 # ordered; tiers independently enabled
  - tier: structural
    entities: [organization, role]
  - tier: llm
    entities: [technology, domain]
    relations: [AT_ORGANIZATION]
  - tier: derived
    relations: [SIMILAR_TO]
    threshold: 0.75
  - layer: custom
    ref: cv_seniority                  # §8
```

**Prompts are generic.** The system prompt is a plain NER analyst — no corpus baked in.
`corpus.context` is the only coupling and it is a parameter. The same shape serves bulário by
changing the vocabulary.

Every edge carries `provenance: structural|derived|llm|custom:<ref>`, so a fact's origin is
visible and one tier can be re-run without the others.

**Layers are pure; commit is atomic.** A layer is `Context → LayerResult` and **writes nothing**.
The service stages results and commits once, at the end. That is what makes "repeat this layer"
safe and lets a suspended run sit for hours without leaving a half-built graph on disk.

**Known trap:** `ConfigField.default` is catalog metadata for the editor only — `lower()` does not
read it (`blocks.py:298` duplicates `:208`). The base pipeline must be stated in both places, or
that duplication fixed deliberately.

---

## 6. Per-node timeout (`agent_runtime`)

A 143s ingestion node dies under the global 120s cap. The fix, and it is small:

**1. Declare once, in `BlockSchema`** (`schema.py:158`) — the single source of truth with four
consumers (catalog · edge validation · codegen · lowering). Appending a common `timeout_s` in
`__post_init__` means:
- `to_catalog_entry()` (`:185`) serialises it → **renders in every block's panel, zero JS**
- `Block.validate()` (`blocks.py:101`) walks `get_schema().config` → **validation free**
- no per-block edits; nothing to remember when adding a block

**2. Apply where a node runs** — `graph_executor.py:125`, the single such line:
```python
out_value = await asyncio.wait_for(handler(node, msg.value, ctx), timeout=node_timeout)
```
The debug gate already sits at `:121`, so the shape is proven.

**3. Carry it through lowering** generically, so no block's `lower()` re-states it.

**4. Derive the outer cap.** `farm.py:337-338` caps the whole run at `job_timeout_s`; a node with
`timeout_s: 600` still dies at 120s. The outer bound becomes the **sum of the graph's node
timeouts** (default where unset). Per-node is the real protection; the outer cap is a backstop
against a wedged run. (A node runs once per incoming message today — `graph_executor.py:12-16` —
so a plain sum is exact for single-visit nodes; fan-in semantics are ours to change if a block
ever needs a barrier.)

---

## 7. The judge

Block-level config; runs **inside the service**, once per layer. It receives the pipeline
configuration and a **real sample of that layer's output** — not only statistics. No historical
baselines in v1. It publishes a notification to the bus and decides `continue | suspend`.

**No new machinery to configure it.** The Agent's judge already takes *both* a preset persona and
an inline template — `blocks.py:254` (`loop_judge_persona`, `control="resource-ref"`,
`kind="preset"`) and `blocks.py:265` (`loop_judge_template`, `control="template"`). That dual
shape gives "pick an existing prompt **or** author a new one" without building preset creation
(which does not exist — `resources_api.py:8`).

Default instruction covers the operator instincts: near-empty output; degenerate type
distribution (the prototype produced 200 `concept` vs 25 `organization` — obvious in a
distribution, invisible in a dump); entities not traceable to the source text; near-duplicate
entities; a stage far slower than its peers.

---

## 8. Custom layers

A custom layer is **internal to `ingestion_server`**. `agent_runtime` never sees it; the pipeline
holds a name.

- A Python module in the service's mounted `layers/` dir implementing `run(ctx) -> LayerResult`.
- `GET /v1/layers` lists them → the block's picker is populated from the SDK.
- Referenced by name: `{ layer: custom, ref: cv_seniority }`.

Delivery is a **host mount**, mirroring Skills (`skills/registry.py`; mounted at
`docker-compose.yml:20-24`; referenced by name through a `resource-ref` picker). No upload
endpoint, no code in the DSL.

---

## 9. Patron — the blocks

### 9.1 `ingestion` (new)

Node type `ingestion`, category Blocks, ports `in: STRING → out: STRING`. The block **calls the
SDK and waits**. It contains no ingestion logic.

**The block MUST read the envelope context — this is settled, not optional.**

`folder_watch` seeds `data.task` with the file's *content* (`emitter.py:125`), and `read_seed`
cannot decode a PDF — it returns `[binary file …: N bytes, not UTF-8 text]` (`emitter.py:48`).
The path and the change type live in `payload.context` (`emitter.py:107-112`).

The deciding case is **deletion**: on a delete there is no content to read, so `data.task` is the
path — a value indistinguishable in shape from `emit: path`. Only `context.change` says which it
is. A block that trusts the seed alone will happily index the literal string
`/watched/in/foo.pdf` as a document.

So the block reads `context.change` and passes it to the SDK — it does **not** branch to different
behaviours. One verb, "reconcile this document with the corpus":

| `context.change` | The Agent does | The block's `out` carries |
|---|---|---|
| `created` · `modified` | runs the pipeline; replaces if the document already exists (§5.0) | the run outcome |
| `deleted` | removes the document's chunks + `mentions`, and any entity left with zero mentions (§9.1.1) | the run outcome, incl. `deleted` counts |

**The block forwards the outcome downstream.** It has no branch, no delete logic, no special case
— it calls one verb, waits, and puts the result on its `out` port. Both change types are the same
verb: *reconcile this document with the corpus*.

**Consequences for `agent_runtime`** (deliverable 3):
- The handler signature is `handler(node, msg.value, ctx)` (`graph_executor.py:125`), so `ctx`
  must expose the envelope's `context` — the block cannot work without it.
- The `out` port carries a structured outcome. `DataSchema` has no `array` type
  (`schema.py:26-27`) and the outcome carries lists (`layers[]`, per-document results), so it
  travels as **JSON in a STRING** rather than a typed object. Typing it properly means extending
  `DataSchema` — deferred, not needed for v1.

### 9.1.1 Deletion — the Agent removes, at commit

The Agent **owns the corpus**: it writes chunks, entities and edges to ArcadeDB. Removal is the
same authority, so a `deleted` change is resolved during the run and applied **in the same atomic
commit** as everything else. Splitting deletion out to a downstream step would leave the corpus
inconsistent between the ingest committing and the removal happening.

The outcome **reports** what went, so it is visible and auditable rather than silent:

```json
{ "run_id": "...", "state": "completed",
  "deleted": { "document": "/watched/in/quarterly.pdf",
               "chunks": 42, "entities": 6, "relations": 51 } }
```

**Resolving the set is the hard part, and only the Agent can do it.** A `technology:postgresql`
entity may be mentioned by documents that still exist. So removal drops the document's chunks and
its `mentions` edges, then garbage-collects only entities left with **zero** remaining mentions.
Removing them wholesale corrupts the graph for every other document. (The CV prototype wipes the
whole corpus instead — legitimate for a single-document corpus, wrong for bulário.)

**The judge does not gate deletion.** It observes and reports like any other stage; it does not
hold a destructive commit for a human.

**Open:** communities and summaries are derived from entities that may now be gone. Recompute them
after a removal, or leave them stale until the next full run? (§12)

**Config panel: bespoke and tabbed**, modelled on `js/agent-config-panel.js` (the only rich panel
today); registered at the `renderBlockInto` dispatch (`props-panel.js:1121-1125`) and given a
larger default size alongside `agent` (`props-panel.js:1165-1168`).

| Tab | Contents |
|---|---|
| **Pipeline** | corpus · chunking · types · index · ordered steps — list editor (§10.1) |
| **Judge** | persona picker + inline template + on_suspicion |
| **Advanced** | timeout_s, service endpoint |

Reuse `window.PatronProps.{field, catalogFor, addManagement}` (`props-panel.js:1254-1263`).

### 9.2 `file_initiator` (existing — three new fields)

```python
ConfigField("emit", "enum", values=["path", "content"], default="path",
            control="select", label="output")
ConfigField("max_content_mb", "integer", control="number", default=64,
            label="max content size (MB)", show_if={"emit": "content"})
ConfigField("on_deleted", "boolean", default=False, control="boolean",
            label="fire on delete")
```

`show_if` (`schema.py:132`) hides the cap unless Content is selected. All three ride the binding
to `folder_watch`, which seeds accordingly:
- `emit: path` → `data.task` = the file path.
- `emit: content`, text → the file's text (today's behaviour).
- `emit: content`, **binary → base64**, not a marker string. Above `max_content_mb`, fail loudly.

Ingestion selects `emit: path` — base64ing a PDF through the bus to a service that will read
bytes off a mount is pure overhead.

**`on_deleted` already exists in the service but is unreachable from Patron.** `folder_watch`
supports it per-binding (`models.py:32-34`, `watcher.py:91`; verified live — the bindings API
returns `"on_deleted":false`), but `FileInitiator._binding_fields()` exposes only `watch_path`
and `match` (`blocks.py:543-550`). The field is pure plumbing: surface it and it works.

Default stays `False`, preserving every existing binding. An ingestion workflow that should track
removals sets it `True`; the Agent then removes the document from the corpus at commit and reports
what went (§9.1.1).

**Change detection is the service's job, not ours.** `folder_watch` is driven by `watchfiles`,
which yields only real changes (`watcher.py:12`) — so an unchanged file never re-fires, and
wipe-and-replace (§5.2) is safe.

**Operational note:** the bus is Valkey streams — in-memory, with retention, readable by
observers. A 100MB file is ~133MB of base64 JSON sitting in the stream. Hence the per-binding
cap rather than a constant.

### 9.3 Registration checklist

Per `specs/data_block_and_agent_vars_port.md:198-206`:

*agent_runtime* — `blocks.py` (class), `catalog.py:43` (`BLOCK_TYPES`), `lower.py:338`
(`_KIND_MAP`), `dsl_graph.py:43` (`NodeKind`), `runner.py:528` (handler).
*patron* — `agent_nodes.js:566` (registry) **and** `:608` (palette), `block-icons.js:15` (icon,
must use `currentColor`), `menu.js:60` + `app.js:1207` (insert menu — the step missed for `data`,
which left a dead menu item).

**No decomposition, no composite.** One IR node; `lower.py:229`'s `else: config = dict(frag)`
carries the fragment as-is.

---

## 10. What must be built that does not exist

| # | Gap | Recommendation |
|---|---|---|
| 1 | List of structured objects (types, steps) | New `control="object-list"` + `ConfigField.item_schema` + one renderer branch (`props-panel.js:608`) — the only option preserving "declare once in Python" for future blocks. v1 alternative: `json` textarea + bespoke `validate()` (`DataSource.validate`, `blocks.py:768-786`, is the model). |
| 2 | Per-node timeout | §6. |
| 3 | `custom-layer` resource for the picker | Descriptor + `sources.py` branch mirroring `skill` (`registry.py`, `sources.py:42-47`), sourced from the ingestion SDK. |
| 4 | File Initiator `emit`/`max_content_mb` + base64 | §9.2, in both `blocks.py` and `folder_watch`. |
| 5 | Preset creation | **Not needed** — dual shape (§7). |
| 6 | `DataSchema` `array` | **Not needed** — ports carry STRING. |
| 7 | Pipeline resource/picker | **Not needed** — pipelines are inline. |

**Still unspecified for `ingestion_server`:** run-state persistence (Valkey? SQLite?); bus subjects
and envelope shape (the `agent_bus_client` SDK exists — `bus.py`/`client.py`/`envelope.py`); the
`Context`/`LayerResult` Python contract; staging/commit mechanics and what "repeat a layer" does to
staged state; API auth (it is a write API to your graph; `mcp-service` uses a bearer token);
network/port; image size (docling ⇒ ~5.8GB); Jenkinsfile + `ci-ready` conventions.

---

## 11. Phasing

1. **`ingestion_server` + SDK** — API, steps, layers, judge, persistence. Prove on CV (prototype
   at `~/env/assets/cv/ingest` is the starting point).
2. **bulário + job2cool pipelines** — proves the DSL is general *before* any UI. CV alone is a
   misleading test bed: 71 chunks barely need a graph.
3. **Per-node `timeout_s`** (§6) — independently useful to every block.
4. **File Initiator `emit`** (§9.2) — independently useful.
5. **The `ingestion` block** — Python block + lowering + handler; JSON-textarea config.
6. **The rich panel** — tabs + `object-list`.
7. **Judge** — notify-only first; suspend once notify is trusted.
8. **Point CV's Jenkins at the deployed workflow** — drop the PDF in `/watched/in`; delete
   `scripts/reingest.py` and its stage.

Vertical slices, tests per feature (`specs/implementation_plan/00_overview.md:19-25`).

---

## 12. Open decisions — owner's call

1. **Suspend vs execute-and-wait.** The node waits for completion, but the judge may suspend
   pending a human decision that takes hours. Either `timeout_s` bounds the node's wait and a
   suspended run returns control (run continues in the service; the workflow reacts to
   `ingestion.completed` later), or the node blocks indefinitely. **These conflict.**
   Recommendation: `timeout_s` bounds the node.
2. **§10.1 — `object-list` control now, or JSON textarea in v1?**
3. **Does `ingestion_server` own docling?** The prototype's image is 5.8GB. CV renders its own PDF
   from markdown via chromium, so chunks and bboxes could be emitted at render time — removing
   docling from CV's path and giving *better* structure (real headings, not a layout model's
   guesses; the ported parser spends ~200 lines reconstructing heading ancestry docling flattened).
   It is a `chunking.strategy`, so both coexist — but it is new code, and docling is proven on this
   document.
4. **Judge in v1: notify-only, or notify+suspend?**
5. **On `abort`, are staged documents committed or discarded?** (§5.0) Discard is the honest
   default — an aborted run leaves nothing — but it throws away good work from documents 1..n-1.
6. **Entity garbage-collection on delete** (§9.1.1): drop only entities with zero remaining
   mentions. Confirm that is the rule, and whether communities/summaries are recomputed after a
   removal or left stale until the next full run.

### Settled since the first draft

- ~~Does the block read the seed or the envelope context?~~ **Context** — deletion forces it
  (§9.1). This makes envelope access in the handler part of deliverable 3.
- ~~How does a document leave a corpus?~~ **`on_deleted` bindings** — the service already
  supports it (verified live); Patron just needs the field (§9.2).
- ~~Scope of a run?~~ **Single-document engine, list-accepting API** (§5.0).
- ~~Re-ingest?~~ **Replace** (§5.0).

---

## 13. Adjacent known gaps (not this spec)

- `agent_runtime`'s `rag` node is backed by **noted-rag/noted-graph** — both stopped
  (`runtime_dsl_specification.md:90`, verified live). That node is dead today and wants repointing
  at graph-server + embeddings-server.
- `embeddings-server` and `llama-vision` mount their models **out of the noted tree** (verified
  live). Deleting `~/env/assets/noted` breaks fleet retrieval.
- **CV's build is broken now**: `scripts/reingest.py` still calls stopped noted, so the stage goes
  UNSTABLE and the chat KB never updates. Phase 8 closes it; until then it stays broken.
