/*
 * agent-config-panel.js — a dedicated, TABBED configuration panel for the Agent block.
 *
 * Replaces the flat ~31-row list with tabs (Basics / Model / Prompt / Tools / Skills /
 * Memory / Loop / Grounding) and CONDITIONAL fields (Loop shows only the sub-fields for its
 * chosen type; Memory shows max-turns only for thread_window). Each capability tab shows a
 * small dot when it carries non-default config, so the agent's shape reads at a glance.
 *
 * It does NOT reimplement field controls: it reuses props-panel.js's exact renderers +
 * grounded pickers (persona/tools/skills) + the template studio via window.PatronProps.field
 * (a thin seam). props-panel.js routes an Agent block here from its double-click panel.
 *
 * Exposes window.PatronAgentConfig = { render(container, node) }.
 */
(function (global) {
  "use strict";

  // Tab layout. `keys` render straight through PatronProps.field; `special` tabs
  // (Memory/Loop) render conditionally. Order = the natural authoring flow.
  const TABS = [
    { id: "basics",  label: "Basics",    keys: ["enabled", "persona", "description"] },
    { id: "model",   label: "Model",     keys: ["temperature", "max_tokens", "top_p", "top_k", "min_p"] },
    { id: "prompt",  label: "Prompt",    keys: ["input_template", "input_vars"] },
    { id: "tools",   label: "Tools",     keys: ["tools_allow", "tools_max_rounds"] },
    { id: "skills",  label: "Skills",    keys: ["skills_allow", "skills_context"] },
    { id: "memory",  label: "Memory",    special: "memory" },
    { id: "loop",    label: "Loop",      special: "loop" },
    { id: "ground",  label: "Grounding", keys: ["rag_domains", "rag_rewriter", "rag_use_graph",
                                                "guard_forbidden", "guard_min_confidence"] },
  ];

  // A capability tab shows a dot when it carries non-default config (Basics/Model are core).
  function tabActive(id, p) {
    switch (id) {
      case "prompt": return !!(p.input_template && String(p.input_template).trim());
      case "tools":  return !!(p.tools_allow && String(p.tools_allow).trim());
      case "skills": return !!(p.skills_allow && String(p.skills_allow).trim());
      case "memory": return (p.memory || "none") !== "none";
      case "loop":   return (p.loop_type || "off") !== "off";
      case "ground": return !!(p.rag_domains || p.rag_use_graph || p.guard_forbidden || p.guard_min_confidence);
      default:       return false;
    }
  }

  function agentFields() {
    return (global.PatronProps && global.PatronProps.catalogFor)
      ? global.PatronProps.catalogFor("agent") : null;
  }
  function fieldMap() {
    const m = {};
    for (const f of agentFields() || []) m[f.key] = f;
    return m;
  }
  function put(pane, node, fmap, key) {
    const f = fmap[key];
    if (f && global.PatronProps && global.PatronProps.field) pane.appendChild(global.PatronProps.field(node, f));
  }
  // Attach a re-render on a rendered select field (the conditional drivers).
  function onSelectChange(fieldEl, cb) {
    const s = fieldEl && fieldEl.querySelector && fieldEl.querySelector("select");
    if (s) s.addEventListener("change", () => setTimeout(cb, 0));
  }

  // Memory: policy, then max-turns ONLY for thread_window.
  function renderMemory(pane, node, fmap, rerender) {
    const f = fmap["memory"];
    if (f) { const el = global.PatronProps.field(node, f); pane.appendChild(el); onSelectChange(el, rerender); }
    if ((node.properties.memory || "none") === "thread_window") put(pane, node, fmap, "memory_max_turns");
  }

  // Loop: type, then per-type fields; cap + iteration-input for any non-off type.
  function renderLoop(pane, node, fmap, rerender) {
    const tf = fmap["loop_type"];
    if (tf) { const el = global.PatronProps.field(node, tf); pane.appendChild(el); onSelectChange(el, rerender); }
    const t = node.properties.loop_type || "off";
    if (t === "off") {
      const hint = document.createElement("div");
      hint.className = "pp-empty"; hint.style.marginTop = "4px";
      hint.textContent = "Loop is off — the agent runs once.";
      pane.appendChild(hint);
      return;
    }
    if (t === "counter")    put(pane, node, fmap, "loop_n");
    if (t === "expression") put(pane, node, fmap, "loop_expression");
    if (t === "judge") {
      put(pane, node, fmap, "loop_judge_persona");
      const vf = fmap["loop_verdict_read"];
      if (vf) { const el = global.PatronProps.field(node, vf); pane.appendChild(el); onSelectChange(el, rerender); }
      put(pane, node, fmap,
          (node.properties.loop_verdict_read || "expression") === "field"
            ? "loop_verdict_field" : "loop_verdict_expression");
      put(pane, node, fmap, "loop_judge_template");
    }
    put(pane, node, fmap, "loop_max_iter");
    put(pane, node, fmap, "loop_iteration_input");
  }

  function render(container, node) {
    container.innerHTML = "";
    const fmap = fieldMap();
    if (!Object.keys(fmap).length) {
      // Catalog not loaded yet — props-panel re-renders open panels when it arrives.
      const m = document.createElement("div");
      m.className = "pp-empty"; m.textContent = "Loading agent configuration…";
      container.appendChild(m);
      return;
    }
    // Resolve any resource-ref side-effects silently (same as the generic panel).
    if (global.PatronProps && global.PatronProps.preresolve) {
      const list = agentFields(); if (list) global.PatronProps.preresolve(node, list);
    }

    const p = node.properties;
    const active = node._acTab && TABS.some((t) => t.id === node._acTab) ? node._acTab : "basics";
    const rerender = () => render(container, node);

    // Tab strip (wraps to rows in a narrow panel).
    const strip = document.createElement("div"); strip.className = "ac-tabs";
    for (const t of TABS) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "ac-tab" + (t.id === active ? " active" : "");
      b.textContent = t.label;
      if (tabActive(t.id, p)) { const d = document.createElement("span"); d.className = "ac-dot"; b.appendChild(d); }
      b.addEventListener("click", () => { node._acTab = t.id; rerender(); });
      strip.appendChild(b);
    }
    container.appendChild(strip);

    // Active pane.
    const pane = document.createElement("div"); pane.className = "ac-pane";
    container.appendChild(pane);
    const tab = TABS.find((x) => x.id === active) || TABS[0];
    if (tab.special === "memory") renderMemory(pane, node, fmap, rerender);
    else if (tab.special === "loop") renderLoop(pane, node, fmap, rerender);
    else for (const k of tab.keys) put(pane, node, fmap, k);

    // Per-block management verbs (deploy/delete), same as the generic panel.
    if (global.PatronProps && global.PatronProps.addManagement) global.PatronProps.addManagement(node, container);
  }

  global.PatronAgentConfig = { render: render };
})(window);
