/*
 * resource-manager.js — the GENERIC Resource Manager panel (Resource Model §5b).
 *
 * ONE floating panel that lists ANY declared resource (agents, triggers, tools, presets,
 * targets, recipes) from the runtime's descriptors — no per-resource UI. It reads
 * /resources/catalog (descriptors) + /resources/<id> (items) and renders a type selector +
 * search + a columns table driven entirely by each descriptor's `columns`. Read-only for
 * now; create/edit/delete + action verbs are the next slice (need /resources write endpoints).
 *
 * Opened via the "Manage" menu (command "view.resources"). Exposes window.PatronResourceManager.
 */
(function () {
  "use strict";
  let panel = null, body = null;
  let CAT = null;          // [descriptor, …] from /resources/catalog
  let curType = null;      // selected resource id
  let items = [];          // items for curType
  let resp = null;         // last /resources/<id> envelope (for ok/error)
  let q = "";              // search text

  function ready(cb) { if (typeof jsPanel !== "undefined") return cb(); setTimeout(() => ready(cb), 200); }

  function loadCatalog(cb) {
    if (CAT) return cb();
    fetch("resources/catalog", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { CAT = (d && Array.isArray(d.resources)) ? d.resources : []; cb(); })
      .catch(() => { CAT = []; cb(); });
  }

  function descFor(id) { return (CAT || []).find((r) => r.id === id) || null; }

  function ensurePanel() {
    if (panel) return;
    panel = jsPanel.create({
      headerTitle: '<img src="icons/table.svg" width="16" height="16" style="vertical-align:middle;margin-right:7px;position:relative;top:-1px" alt=""><span class="pttxt">Resource Manager</span>',
      theme: "none", borderRadius: "8px", border: "1px solid var(--panel-border)",
      panelSize: { width: 720, height: 520 },
      position: { my: "center", at: "center", offsetX: 0, offsetY: 0 },
      boxShadow: 3,
      headerControls: { size: "xs", minimize: "remove", smallify: "remove", normalize: "remove", maximize: "remove" },
      addCloseControl: 1,
      callback: (p) => {
        p.content.style.cssText =
          "display:flex;flex-direction:column;padding:0;overflow:hidden;" +
          "background:var(--panel);color:var(--text);font:13px 'Roboto',system-ui,sans-serif";
        body = p.content;
      },
      onclosed: () => { panel = null; body = null; },
    });
  }

  function loadItems(id) {
    resp = null; items = [];
    render();
    fetch("resources/" + encodeURIComponent(id), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { resp = d || { ok: false, items: [], error: "unreachable" }; items = (d && Array.isArray(d.items)) ? d.items : []; render(); })
      .catch(() => { resp = { ok: false, items: [], error: "unreachable" }; items = []; render(); });
  }

  function render() {
    if (!body) return;
    body.innerHTML = "";

    const bar = document.createElement("div"); bar.className = "rm-bar";
    const typeSel = document.createElement("select"); typeSel.className = "pp-input"; typeSel.style.maxWidth = "240px";
    for (const r of (CAT || [])) typeSel.appendChild(new Option(r.label + "  (" + r.id + ")", r.id));
    if (curType) typeSel.value = curType;
    typeSel.addEventListener("change", () => { curType = typeSel.value; q = ""; loadItems(curType); });
    const search = document.createElement("input"); search.type = "search"; search.className = "pp-input"; search.placeholder = "Filter…"; search.value = q;
    bar.appendChild(typeSel); bar.appendChild(search);
    body.appendChild(bar);

    const table = document.createElement("div"); table.className = "rm-list"; body.appendChild(table);
    const foot = document.createElement("div"); foot.className = "rm-foot"; body.appendChild(foot);
    search.addEventListener("input", () => { q = search.value; renderTable(table, foot); });
    renderTable(table, foot);
  }

  function renderTable(table, foot) {
    const d = descFor(curType);
    const cols = (d && d.columns && d.columns.length) ? d.columns : [d ? d.identity : "id"];
    table.innerHTML = "";

    const head = document.createElement("div"); head.className = "rm-row rm-head";
    for (const c of cols) { const cell = document.createElement("div"); cell.className = "rm-cell"; cell.textContent = c; head.appendChild(cell); }
    table.appendChild(head);

    const ql = q.trim().toLowerCase();
    let shown = 0;
    for (const it of items) {
      const hay = cols.map((c) => String(it[c] == null ? "" : it[c])).join(" ").toLowerCase();
      if (ql && hay.indexOf(ql) < 0) continue;
      const row = document.createElement("div"); row.className = "rm-row";
      for (const c of cols) {
        const cell = document.createElement("div"); cell.className = "rm-cell";
        const v = it[c];
        cell.textContent = (v === true) ? "✓" : (v === false) ? "—" : String(v == null ? "" : v);
        row.appendChild(cell);
      }
      table.appendChild(row); shown++;
    }

    const src = d ? d.source : "?";
    foot.className = "rm-foot";
    if (resp && resp.ok === false) {
      foot.classList.add("rm-err");
      foot.textContent = "source: " + src + " — " + (resp.error || "unavailable");
    } else if (resp == null) {
      foot.textContent = "loading…";
    } else {
      foot.textContent = shown + " / " + items.length + " · source: " + src +
        (d && d.capabilities ? " · " + d.capabilities.join("/") : "");
    }
  }

  function open(type) {
    ready(() => loadCatalog(() => {
      ensurePanel();
      curType = type || curType || ((CAT && CAT[0]) ? CAT[0].id : null);
      if (panel && panel.style) panel.style.display = "";
      if (panel && typeof panel.front === "function") panel.front();
      if (curType) loadItems(curType); else render();
    }));
  }

  window.PatronResourceManager = { open };
})();
