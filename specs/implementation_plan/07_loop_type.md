# Phase 07 — Loop type

## Goal
Add the **outer repeat loop** around an agent's action — types **off / counter / expression /
judge** — with the embedded Judge, the iteration-input option, and max-iter safety caps.

## Spec refs
§8.4 (loop type: four types, embedded Judge, iteration-input option, max-iter caps; outer loop vs
the Brain node's inner `max_rounds`), §8.1 (loop bundled on the Agent block).

## Depends on
Phase 05 (deploy + graph execution). Independent of Phase 06 (can run in parallel).

## Scope
- **In:** outer loop execution in the runtime; the four types; embedded Judge (an agent profile run
  in the judging role); iteration-input option (same input vs reinsert previous outcome); max-iter
  caps on the open-ended types; Agent panel loop config.
- **Out:** composable/OR-combined loop types (explicitly rejected — types are separate); barrier
  fan-in (rejected in §9.3.2).

## Work by component
- **agent_runtime**
  - **Loop wrapper** around the Agent node's invocation in the executor — **distinct** from the
    Brain node's inner `max_rounds` tool loop:
    - `off`: run once.
    - `counter`: run `n` times.
    - `expression`: repeat until the configured expression matches the outcome; **+ max-iter cap**.
    - `judge`: each iteration, run the **embedded Judge** (an agent profile with its own prompt/
      skills/tools, configured *inside* the Agent block) over the outcome; stop when it validates;
      **+ max-iter cap**. **How the verdict is read is a configurable option** (expression on the
      Judge's output, or a structured field).
  - **Iteration input** option: feed the original input each time, or reinsert the previous outcome.
  - Enforce **max-iter** as a hard force-exit on `expression`/`judge` ("never trust the model to
    stop"); `counter` bounded by `n`; `off` single-shot.
- **patron**
  - Agent panel **loop** section: type selector + per-type fields (`n`; expression; embedded-Judge
    profile + verdict-read option; max-iter; iteration-input).

## Data & API changes
- Agent node config gains a `loop` object (`type`, per-type params, `max_iter`, `iteration_input`,
  and for `judge` the embedded Judge definition + verdict-read option).

## Tests & exit criteria
- **pytest (agent_runtime):** `off` runs once; `counter` runs exactly `n`; `expression` stops on
  match and force-exits at the cap; `judge` stops when the embedded Judge validates and force-exits
  at the cap; verdict-read option works both ways; iteration-input feeds same vs previous outcome.
- **Playwright e2e:** loop config on the Agent panel persists per type.
- **Exit:** an agent can be deployed with each loop type and behaves per its config, always bounded.

## Risks / notes
- Keep the outer loop and the inner `max_rounds` clearly separate in code and logs.
- `expression` match semantics (regex vs substring) — decide here (overview open decision).
