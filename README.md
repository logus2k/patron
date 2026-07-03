<div align="center">

# Patron

**Visual authoring front-end for agents & agentic workflows.**

Compose an agent on a node canvas → compile it to the runtime DSL → deploy it to your agent runtime.

![license](https://img.shields.io/badge/license-Apache%202.0-blue)
![no build step](https://img.shields.io/badge/build-none%20(vanilla%20JS)-success)
![backend](https://img.shields.io/badge/backend-python%20stdlib%20(0%20deps)-3776AB)
![canvas](https://img.shields.io/badge/canvas-litegraph.js%201.0-8a4ea5)
![container](https://img.shields.io/badge/image-~50MB%20alpine-2496ED)

<!-- Screenshot: drop an image at docs/screenshot.png and uncomment the line below -->
<!-- <img src="docs/screenshot.png" alt="Patron editor" width="860"> -->

</div>

---

## What is Patron?

Patron is the **human-facing layer** of a self-hosted agentic platform. You model an agent — or a
whole workflow of agents — as a graph of typed blocks on a full-screen canvas, and Patron **lowers
that graph to a runtime DSL** that a separate executor runs. The canvas is the ergonomics; the DSL is
the contract.

> Patron **authors**. It does **not** execute. Execution lives in a separate runtime service; Patron
> compiles to the DSL that runtime consumes and deploys over a small server-to-server bridge.

```
 Patron (author, for humans)  ─►  compile + validate  ─►  runtime DSL (for the machine)  ─►  agent runtime (execute)
```

Two design rules follow from that split, and they shape the whole tool:

- **Nothing canvas-shaped reaches the runtime.** Node positions, colors, and widget state are stripped
  at compile time — the DSL is semantic-only.
- **The palette need not be 1:1 with the DSL.** A friendly Patron block can lower to several runtime
  primitives, so the UI can gain affordances without new runtime concepts.

---

## Features

- 🎛️ **Node-graph editor** on a full-screen [litegraph.js](https://github.com/jagenjo/litegraph.js)
  canvas — pan/zoom, typed ports, drag-to-connect, light **and** dark themes.
- 🧱 **Block palette** — initiators, capability blocks, and destinations (see below), plus a floating
  toolbox, an inline node property editor, and a pull-down menu bar.
- ⚙️ **Compile to DSL** — lower the composition to the runtime DSL and inspect the result.
- 🚀 **One-click deploy** — push the compiled agent to the runtime over a same-origin bridge; it goes
  live on the next trigger (no restart).
- 💾 **Server-side workspace** — the graph, view, panel layout, and theme auto-save to the server
  (no `localStorage`); reload and everything is where you left it.
- 📦 **Tiny container** — a ~50 MB `python:alpine` image; the backend is Python **standard library
  only**, zero pip dependencies.
- 🧩 **No build step** — plain HTML/CSS/JS, vendored libraries. Open it and it runs.

---

## Block vocabulary

| Group | Blocks |
|-------|--------|
| **Initiators** | Scheduled Trigger · File Initiator · Web Initiator · Speech-to-Text |
| **Blocks** | Agent · Vector Database · Graph Database · Data Transform\* · Workflow\* |
| **Destinations** | WhatsApp · Text-to-Speech · Event Bus · File Destination · Web Destination |

<sub>\* Data Transform and Workflow (sub-graph) blocks are in progress.</sub>

---

## Quick start

### Docker (recommended)

```bash
docker compose up -d --build
# → editor on http://localhost:8088
```

The compose file publishes port `8088`, persists the workspace to `./data`, and joins the platform
network so the deploy bridge can reach the runtime by service name.

### Local (no container)

The backend is a single stdlib script — no virtualenv, no `pip install`:

```bash
python3 serve.py            # http://localhost:8088  (pass a port as the 1st arg)
```

Serving purely static files (any web server) also works for **editing/compiling**, but Save/Load and
Deploy need `serve.py` (they're backed by its small API).

---

## Configuration

`serve.py` reads a few environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| _(1st CLI arg)_ | `8088` | Port to serve on |
| `PATRON_HOST` | `0.0.0.0` | Bind address |
| `AGENT_RUNTIME_URL` | `http://127.0.0.1:6817` | Where **Deploy** forwards the compiled agent |
| `AGENT_SCHEDULER_URL` | `http://127.0.0.1:6816` | Where scheduled agents register their cron |

The backend exposes just three routes; everything else is static:

| Route | Purpose |
|-------|---------|
| `GET/PUT /api/workspace` | Load / save the single workspace document (atomic write to `data/`) |
| `POST /api/deploy` | Relay the compiled DSL to the runtime (server-to-server) |

---

## Project structure

```
index.html            entry point (loads the vendored libs + js/ modules)
serve.py              stdlib backend: static files + workspace API + deploy bridge
js/                   editor modules (nodes, menu, panels, inline edit, litegraph patches…)
css/                  themeable styles (light + dark via CSS vars)
vendor/litegraph/     vendored litegraph.js — kept BYTE-PRISTINE (see below)
fonts/  icons/        vendored Roboto + block SVG icons
examples/             sample composition(s) used as demo fixtures
documents/  specs/    design notes and the source/DSL contracts
Dockerfile  docker-compose.yml   container + orchestration
```

---

## Engineering notes

- **Pristine-vendored litegraph.** `vendor/litegraph/litegraph.js` is kept **byte-for-byte identical
  to upstream** (litegraph.js `1.0`), so a new version is a pure drop-in — no fork, no in-file edits.
  Every visual customization lives *outside* the library, in `js/litegraph-patches.js`, as prototype
  overrides applied at load time.
- **Zero-dependency backend.** `serve.py` uses only `http.server` / `json` / `urllib` — nothing to
  install, trivial to audit, tiny to containerize.
- **No `localStorage`.** All persistence is server-side and explicit, so a workspace is portable and
  survives across browsers/machines.
- **No build/bundler.** Vanilla ES; modules are plain `<script>` tags. Edit a file, reload.

---

## Roadmap

- Graph-aware compilation — resolve stages by tracing links (branching, loops, parallel, sub-workflows),
  not just node presence.
- A single source of truth for the block contract, shared with the runtime (no hand-mirrored validators).
- Named/multi-project workspaces.

---

## License

Licensed under the [Apache License 2.0](LICENSE) © 2026 António Cruz.
The vendored **litegraph.js** is MIT © Javi Agenjo.
