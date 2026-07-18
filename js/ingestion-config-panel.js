/*
 * ingestion-config-panel.js — the configuration panel for the Ingestion block.
 *
 * The block turns a document into a searchable corpus + a knowledge graph. Its
 * configuration is a declarative PIPELINE (corpus, entity/relation vocabulary,
 * ordered layers), plus a block-level judge that watches each layer.
 *
 * The pipeline is one JSON property, so a flat "paste JSON here" textarea is the
 * only thing the generic renderer can do with it. That is unusable for authoring
 * a vocabulary. This panel renders that JSON as real controls — add/remove entity
 * types, reorder layers — and writes it straight back to the same property, so
 * the DSL contract is unchanged and hand-editing still works.
 *
 * It does NOT reimplement field controls: judge/agent_url/timeout come from
 * props-panel.js's renderers + grounded pickers via window.PatronProps.field.
 *
 * Exposes window.PatronIngestionConfig = { render(container, node) }.
 */
(function (global) {
  "use strict";

  const TABS = [
    { id: "corpus",  label: "Corpus" },
    { id: "types",   label: "Types" },
    { id: "layers",  label: "Layers" },
    { id: "judge",   label: "Judge",    keys: ["judge_enabled", "judge_persona",
                                               "judge_template", "on_suspicion"] },
    { id: "advanced", label: "Advanced", keys: ["agent_url", "timeout_s"] },
  ];

  const TIERS = ["structural", "llm", "derived", "communities"];
  const STRATEGIES = ["pdf_docling", "plain_text"];

  function fields() {
    return (global.PatronProps && global.PatronProps.catalogFor)
      ? global.PatronProps.catalogFor("ingestion") : null;
  }
  function fmap() {
    const m = {};
    for (const f of fields() || []) m[f.key] = f;
    return m;
  }
  function put(pane, node, m, key) {
    const f = m[key];
    if (f && global.PatronProps && global.PatronProps.field) {
      pane.appendChild(global.PatronProps.field(node, f));
    }
  }

  // ---- the pipeline lives in ONE json property -----------------------------
  // Seeded from the catalog's default on first open, so the base pipeline has a
  // single source of truth (blocks.py _DEFAULT_PIPELINE) rather than a copy here.
  function readPipeline(node, m) {
    let raw = node.properties.pipeline;
    if (!raw || !String(raw).trim()) raw = (m.pipeline && m.pipeline.default) || "{}";
    try {
      const p = JSON.parse(raw);
      return (p && typeof p === "object") ? p : {};
    } catch (e) {
      return null;   // invalid JSON — the caller shows the raw editor instead
    }
  }
  function writePipeline(node, p) {
    const text = JSON.stringify(p, null, 2);
    if (global.PatronProps && global.PatronProps.commit) {
      global.PatronProps.commit(node, "pipeline", text);
    } else {
      node.properties.pipeline = text;
      if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
    }
  }

  // ---- small control helpers (styled by the existing .pp-* classes) --------
  function row(label) {
    const d = document.createElement("div"); d.className = "pp-field";
    if (label) {
      const l = document.createElement("label"); l.className = "pp-label";
      l.textContent = label; d.appendChild(l);
    }
    return d;
  }
  function textInput(value, oninput, placeholder) {
    const i = document.createElement("input");
    i.type = "text"; i.className = "pp-input"; i.value = value || "";
    if (placeholder) i.placeholder = placeholder;
    i.addEventListener("change", () => oninput(i.value));
    return i;
  }
  function select(values, value, onchange) {
    const s = document.createElement("select"); s.className = "pp-input";
    for (const v of values) {
      const o = document.createElement("option"); o.value = v; o.textContent = v;
      if (v === value) o.selected = true;
      s.appendChild(o);
    }
    s.addEventListener("change", () => onchange(s.value));
    return s;
  }
  function numberInput(value, onchange, min, max) {
    const i = document.createElement("input");
    i.type = "number"; i.className = "pp-input"; i.value = value;
    if (min != null) i.min = min;
    if (max != null) i.max = max;
    i.addEventListener("change", () => onchange(Number(i.value)));
    return i;
  }
  function btn(text, onclick, title) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "pp-btn"; b.textContent = text;
    if (title) b.title = title;
    b.addEventListener("click", onclick);
    return b;
  }
  function note(text) {
    const d = document.createElement("div");
    d.className = "pp-note"; d.textContent = text;
    return d;
  }

  // ---- Corpus -------------------------------------------------------------
  function renderCorpus(pane, node, p, rerender) {
    const c = p.corpus || (p.corpus = {});

    const ctx = row("what this corpus is");
    ctx.appendChild(textInput(c.context, (v) => { c.context = v; writePipeline(node, p); },
                              "e.g. a curriculum vitae"));
    ctx.appendChild(note("Injected into the extraction prompt — the ONLY corpus-specific " +
                         "thing the generic extractor is told."));
    pane.appendChild(ctx);

    const db = row("target database");
    db.appendChild(textInput(c.target_db, (v) => { c.target_db = v; writePipeline(node, p); },
                             "e.g. cv"));
    db.appendChild(note("One pipeline = one corpus = one graph namespace."));
    pane.appendChild(db);

    const lang = row("language");
    lang.appendChild(textInput(c.language || "en",
                               (v) => { c.language = v; writePipeline(node, p); }, "en"));
    pane.appendChild(lang);

    const ch = p.chunking || (p.chunking = {});
    const st = row("chunking");
    st.appendChild(select(STRATEGIES, ch.strategy || "pdf_docling",
                          (v) => { ch.strategy = v; writePipeline(node, p); rerender(); }));
    st.appendChild(note(ch.strategy === "plain_text"
      ? "Text/markdown. Real heading ancestry, but NO bounding boxes — citations " +
        "cannot highlight a page."
      : "PDF/DOCX/HTML via docling. Chunks + per-item bounding boxes, so a citation " +
        "highlights the exact lines."));
    pane.appendChild(st);

    const tt = row("target tokens per chunk");
    tt.appendChild(numberInput(ch.target_tokens || 200,
                               (v) => { ch.target_tokens = v; writePipeline(node, p); }, 20, 4000));
    pane.appendChild(tt);
  }

  // ---- Types --------------------------------------------------------------
  function renderTypes(pane, node, p, rerender) {
    const t = p.types || (p.types = {});
    const ents = t.entities || (t.entities = {});
    const rels = t.relations || (t.relations = {});

    pane.appendChild(note("What to extract. The definition and examples carry the whole " +
                          "burden of precision; `not` is the contrastive half — types that " +
                          "contrast cleanly separate in one pass, overlapping ones duplicate."));

    for (const name of Object.keys(ents)) {
      const e = ents[name] || {};
      const box = document.createElement("div"); box.className = "ing-item";

      const head = document.createElement("div"); head.className = "ing-item-head";
      head.appendChild(textInput(name, (v) => {
        if (!v || v === name) return;
        delete Object.assign(ents, { [v]: ents[name] })[name];
        // Any step or relation naming the old type must follow the rename.
        for (const s of p.steps || []) {
          s.entities = (s.entities || []).map((x) => (x === name ? v : x));
        }
        for (const r of Object.values(rels)) {
          if (r.from === name) r.from = v;
          if (r.to === name) r.to = v;
        }
        writePipeline(node, p); rerender();
      }, "type name"));
      head.appendChild(btn("✕", () => {
        delete ents[name];
        for (const s of p.steps || []) s.entities = (s.entities || []).filter((x) => x !== name);
        for (const k of Object.keys(rels)) {
          if (rels[k].from === name || rels[k].to === name) delete rels[k];
        }
        writePipeline(node, p); rerender();
      }, "remove this type (and anything referencing it)"));
      box.appendChild(head);

      const def = document.createElement("textarea");
      def.className = "pp-area"; def.rows = 2; def.value = e.definition || "";
      def.placeholder = "what this type IS";
      def.addEventListener("change", () => { e.definition = def.value; writePipeline(node, p); });
      box.appendChild(def);

      box.appendChild(textInput((e.examples || []).join(", "), (v) => {
        e.examples = v.split(",").map((x) => x.trim()).filter(Boolean);
        writePipeline(node, p);
      }, "examples, comma separated"));

      box.appendChild(textInput(e.not || "", (v) => {
        if (v) e.not = v; else delete e.not;
        writePipeline(node, p);
      }, "NOT … (what it must not be confused with)"));

      pane.appendChild(box);
    }

    pane.appendChild(btn("+ entity type", () => {
      let n = "new_type", i = 1;
      while (ents[n]) n = "new_type_" + (++i);
      ents[n] = { definition: "", examples: [] };
      writePipeline(node, p); rerender();
    }));

    // --- relations ---
    const names = Object.keys(ents);
    pane.appendChild(note("Typed relations between entity types."));
    for (const rname of Object.keys(rels)) {
      const r = rels[rname] || {};
      const box = document.createElement("div"); box.className = "ing-item";
      const head = document.createElement("div"); head.className = "ing-item-head";
      head.appendChild(textInput(rname, (v) => {
        if (!v || v === rname) return;
        delete Object.assign(rels, { [v]: rels[rname] })[rname];
        for (const s of p.steps || []) {
          s.relations = (s.relations || []).map((x) => (x === rname ? v : x));
        }
        writePipeline(node, p); rerender();
      }, "RELATION_NAME"));
      head.appendChild(btn("✕", () => {
        delete rels[rname];
        for (const s of p.steps || []) {
          s.relations = (s.relations || []).filter((x) => x !== rname);
        }
        writePipeline(node, p); rerender();
      }, "remove this relation"));
      box.appendChild(head);

      const fromTo = document.createElement("div"); fromTo.className = "ing-row";
      fromTo.appendChild(select(names, r.from, (v) => { r.from = v; writePipeline(node, p); }));
      const arrow = document.createElement("span"); arrow.className = "ing-arrow";
      arrow.textContent = "→"; fromTo.appendChild(arrow);
      fromTo.appendChild(select(names, r.to, (v) => { r.to = v; writePipeline(node, p); }));
      box.appendChild(fromTo);
      pane.appendChild(box);
    }
    pane.appendChild(btn("+ relation", () => {
      if (names.length < 1) return;
      let n = "RELATES_TO", i = 1;
      while (rels[n]) n = "RELATES_TO_" + (++i);
      rels[n] = { from: names[0], to: names[names.length - 1], definition: "" };
      writePipeline(node, p); rerender();
    }));
  }

  // ---- Layers -------------------------------------------------------------
  function renderLayers(pane, node, p, rerender) {
    const steps = p.steps || (p.steps = []);
    const names = Object.keys((p.types && p.types.entities) || {});
    const rnames = Object.keys((p.types && p.types.relations) || {});

    pane.appendChild(note("Ordered. Each layer sees what the ones before it produced. " +
                          "`llm` is the expensive tier — one call per chunk."));

    steps.forEach((s, i) => {
      const box = document.createElement("div"); box.className = "ing-item";

      const head = document.createElement("div"); head.className = "ing-item-head";
      const kind = s.layer === "custom" ? "custom" : (s.tier || "llm");
      head.appendChild(select(TIERS.concat(["custom"]), kind, (v) => {
        if (v === "custom") { s.layer = "custom"; delete s.tier; s.ref = s.ref || ""; }
        else { s.tier = v; delete s.layer; delete s.ref; }
        writePipeline(node, p); rerender();
      }));
      const sp = document.createElement("span"); sp.className = "ing-spacer"; head.appendChild(sp);
      head.appendChild(btn("↑", () => {
        if (i === 0) return;
        steps.splice(i - 1, 0, steps.splice(i, 1)[0]);
        writePipeline(node, p); rerender();
      }, "earlier"));
      head.appendChild(btn("↓", () => {
        if (i >= steps.length - 1) return;
        steps.splice(i + 1, 0, steps.splice(i, 1)[0]);
        writePipeline(node, p); rerender();
      }, "later"));
      head.appendChild(btn("✕", () => {
        steps.splice(i, 1); writePipeline(node, p); rerender();
      }, "remove this layer"));
      box.appendChild(head);

      if (s.layer === "custom") {
        box.appendChild(textInput(s.ref || "", (v) => { s.ref = v; writePipeline(node, p); },
                                  "layer name, as mounted on the Agent"));
        box.appendChild(note("Code lives on the Agent and is referenced by name."));
      } else if (s.tier === "derived") {
        const th = row("similarity threshold");
        th.appendChild(numberInput(s.threshold != null ? s.threshold : 0.75,
                                   (v) => { s.threshold = v; writePipeline(node, p); }, 0, 1));
        box.appendChild(th);
      } else if (s.tier === "communities") {
        box.appendChild(note("PageRank + Louvain, then an LLM summary per cluster."));
      } else {
        // structural / llm: which types this layer is responsible for
        box.appendChild(checkList("entities", names, s.entities || [], (v) => {
          s.entities = v; writePipeline(node, p);
        }));
        box.appendChild(checkList("relations", rnames, s.relations || [], (v) => {
          s.relations = v; writePipeline(node, p);
        }));
      }
      pane.appendChild(box);
    });

    pane.appendChild(btn("+ layer", () => {
      steps.push({ tier: "llm", entities: [], relations: [] });
      writePipeline(node, p); rerender();
    }));
  }

  function checkList(label, all, chosen, onchange) {
    const d = row(label);
    if (!all.length) { d.appendChild(note("none declared yet — see the Types tab")); return d; }
    const wrap = document.createElement("div"); wrap.className = "ing-checks";
    for (const name of all) {
      // NB: .pp-check styles the BOX (16x16), not the label — putting it on the
      // label collapses the row.
      const l = document.createElement("label"); l.className = "ing-check";
      const cb = document.createElement("input");
      cb.className = "pp-check";
      cb.type = "checkbox"; cb.checked = chosen.indexOf(name) >= 0;
      cb.addEventListener("change", () => {
        const set = new Set(chosen);
        cb.checked ? set.add(name) : set.delete(name);
        onchange(all.filter((x) => set.has(x)));
      });
      l.appendChild(cb);
      l.appendChild(document.createTextNode(" " + name));
      wrap.appendChild(l);
    }
    d.appendChild(wrap);
    return d;
  }

  // ---- raw fallback -------------------------------------------------------
  // Invalid JSON must never trap the user in a form that cannot represent it.
  function renderRaw(pane, node, m) {
    pane.appendChild(note("The pipeline is not valid JSON — showing the raw editor. " +
                          "Fix it here and the tabs come back."));
    put(pane, node, m, "pipeline");
  }

  function render(container, node) {
    container.innerHTML = "";
    const m = fmap();
    if (!m || !Object.keys(m).length) {
      const w = document.createElement("div");
      w.className = "pp-empty"; w.textContent = "Loading ingestion configuration…";
      container.appendChild(w);
      return;
    }
    if (global.PatronProps && global.PatronProps.preresolve) {
      const list = fields(); if (list) global.PatronProps.preresolve(node, list);
    }

    const active = node._icTab && TABS.some((t) => t.id === node._icTab) ? node._icTab : "corpus";
    const rerender = () => render(container, node);

    const strip = document.createElement("div"); strip.className = "ac-tabs";
    for (const t of TABS) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "ac-tab" + (t.id === active ? " active" : "");
      b.textContent = t.label;
      b.addEventListener("click", () => { node._icTab = t.id; rerender(); });
      strip.appendChild(b);
    }
    container.appendChild(strip);

    const pane = document.createElement("div"); pane.className = "ac-pane";
    container.appendChild(pane);

    const tab = TABS.find((x) => x.id === active) || TABS[0];
    if (tab.keys) {
      for (const k of tab.keys) put(pane, node, m, k);
      if (tab.id === "judge") {
        pane.appendChild(note("The judge watches each layer and reports. `suspend` halts the " +
                              "run for a human decision; `notify` only publishes. It never " +
                              "gates a deletion."));
      }
    } else {
      const p = readPipeline(node, m);
      if (p === null) renderRaw(pane, node, m);
      else if (tab.id === "corpus") renderCorpus(pane, node, p, rerender);
      else if (tab.id === "types") renderTypes(pane, node, p, rerender);
      else if (tab.id === "layers") renderLayers(pane, node, p, rerender);
    }

    if (global.PatronProps && global.PatronProps.addManagement) {
      global.PatronProps.addManagement(node, container);
    }
  }

  global.PatronIngestionConfig = { render: render };
})(window);
