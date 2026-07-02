# Toolbox — target block roster (after implementation)

The complete set of blocks expected in the Patron Toolbox once
[`block_management.md`](block_management.md) is fully implemented (the
[`implementation_plan/`](implementation_plan/)). Grounded on §8 of the spec and the existing
`agent_runtime/composer/blocks.py`.

**Status legend:** *Exists* = already a class in `composer/blocks.py`; *New* = to be built.

## 1. Initiators (sources — out only; they fire a Project)

| Block | Fires when… | Status | Source / backing | Spec |
|-------|-------------|--------|------------------|------|
| **Schedule Trigger** | a Schedule (cron/tz) or channel event fires | Exists (`trigger`) | Agent Scheduler (Schedule + Bindings) | §6, §9.3.1 |
| **File Initiator** | a new/changed file appears in a watched folder | **New** | new **folder-watch service** | §8, §9.3.1 |
| **Web Initiator** | a request hits a configured Web API route | **New** | new **HTTP-ingress service** | §8, §9.3.1 |
| **Speech-to-Text** | incoming speech is transcribed to text | **New** | an **STT / audio-ingress service** | §8, §9.3.1 |

## 2. Agents & Workflows

| Block | Role | Status | Source / notes | Spec |
|-------|------|--------|----------------|------|
| **Agent** | the workhorse — binds an agent_server **profile** + **tools** + **skills** + **loop type** | Exists | agent_server `/admin/api/agents` (+ pickers) | §8.1, §8.3, §8.4 |
| **Workflow** | a deployed Project referenced as one participant (own IN/OUT, nestable) | Exists (`Composite`) | an agent_runtime record | §8.2 |

## 3. Behavior blocks around an Agent

| Block | Role | Status | Placement | Spec |
|-------|------|--------|-----------|------|
| **RAG** | pre-inference retrieve-then-inject | **New** | wired **before** an Agent | §8.1 |
| **Guardrail** | input/output checks (forbidden patterns, min confidence) | **New** as a block (runtime `nodes/guardrail.py` exists) | **before / after / both** an Agent | §8.1 |

*(RAG used the other way — during inference — is not a block; it's just a tool on the Agent. The
agent **loop type** is config on the Agent block, not a separate block — see §8.4.)*

## 4. On-the-wire

| Block | Role | Status | Spec |
|-------|------|--------|------|
| **Transform** | data/protocol transformation between two blocks | Exists | §7.1 |

## 5. Destinations (sinks — in only; Bus / File / Web may also be used **inline** as taps)

| Block | Role | Status | Source / notes | Spec |
|-------|------|--------|----------------|------|
| **WhatsApp** | deliver to a WhatsApp group/contact | Exists | select/bind an existing target | §8 |
| **Text-to-Speech** | deliver to a TTS target | Exists (`tts`) | per channel | §8 |
| **Bus** | publish to a stream | Exists | per channel; usable inline (tap) | §7.1, §8 |
| **File Destination** | write the outcome to a file | **New** | usable inline (tap) | §7.1, §8 |
| **Web Destination** | end/continue by calling an outbound Web API | **New** | usable inline (tap) | §7.1, §8 |

## Summary count

**14 block types** in scope: 4 initiators, 2 agent/workflow, 2 behavior (RAG, Guardrail),
1 transform, 5 destinations. Of these, **7 are new** (File Initiator, Web Initiator, Speech-to-Text,
RAG, Guardrail, File Destination, Web Destination); the rest already exist as classes in
`composer/blocks.py` (Schedule Trigger = `trigger`, Text-to-Speech = `tts`).

## Removed from the Toolbox (2026-07-02)

To make the Patron Toolbox match this roster exactly, everything **not** in the list above was
removed from the palette:

- **GoF demo nodes** — Task Source, Inspector, Builder Agent, Factory Agent, Proxy Agent, Chain of
  Responsibility (were `js/patterns.js`, now deleted; palette groups + the `loadDemo` builder gone).
- **Branch** and **Loop** — the *Control* family; removed from `js/agent_nodes.js` (node defs +
  registry + palette) and `js/block-icons.js`.

**Note:** the Python classes `Branch`/`Loop` still exist in `composer/blocks.py` (the backend Block
model, graph-form control) — they are simply **no longer offered in the Toolbox**. Re-add them there
only if the Control family is brought into scope. (The *Control* `Loop` block is distinct from the
Agent **loop type** of §8.4.)
