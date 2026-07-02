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
      headerTitle: '<img src="icons/table.svg" width="16" height="16" style="vertical-align:middle;margin-left:3px;margin-right:7px;position:relative;top:-1px" alt=""><span class="pttxt">Resource Manager</span>',
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

  // Run a verb on one item: 'delete' → DELETE /resources/<id>/<key>; else POST …/<verb>.
  function runVerb(id, key, verb) {
    const base = "resources/" + encodeURIComponent(id) + "/" + encodeURIComponent(key);
    const url = verb === "delete" ? base : base + "/" + encodeURIComponent(verb);
    return fetch(url, { method: verb === "delete" ? "DELETE" : "POST" })
      .then((r) => r.json().catch(() => ({ ok: false, error: "bad response" })))
      .catch((e) => ({ ok: false, error: String(e && e.message || e) }));
  }

  // Inline schema-driven edit form (replaces the list; "← Back" returns). Renders the
  // descriptor's schema fields that are present on the item (identity excluded), submits a
  // PUT /resources/<id>/<key>. Used for editable resources (e.g. a trigger's cron/timezone).
  function editItem(d, item) {
    if (!body) return;
    body.innerHTML = "";
    const bar = document.createElement("div"); bar.className = "rm-bar";
    const back = document.createElement("button"); back.type = "button"; back.className = "pp-btn"; back.textContent = "← Back";
    back.addEventListener("click", () => render());
    const title = document.createElement("span"); title.className = "rm-count"; title.textContent = "Edit " + d.label + " · " + item[d.identity];
    bar.appendChild(back); bar.appendChild(title);
    body.appendChild(bar);

    const form = document.createElement("div"); form.className = "rm-form";
    const inputs = {};
    for (const f of (d.schema || [])) {
      if (f.key === d.identity) continue;
      if (item[f.key] === undefined) continue; // only fields present on the item (editable ones)
      const wrap = document.createElement("label"); wrap.className = "pp-field";
      const cap = document.createElement("span"); cap.className = "pp-label"; cap.textContent = f.label || f.key; wrap.appendChild(cap);
      const inp = document.createElement("input"); inp.type = "text"; inp.className = "pp-input";
      inp.value = item[f.key] == null ? "" : String(item[f.key]);
      wrap.appendChild(inp); form.appendChild(wrap); inputs[f.key] = inp;
    }
    body.appendChild(form);

    const foot = document.createElement("div"); foot.className = "rm-foot";
    const save = document.createElement("button"); save.type = "button"; save.className = "pp-btn"; save.textContent = "Save";
    const status = document.createElement("span"); status.style.marginLeft = "10px";
    save.addEventListener("click", async () => {
      save.disabled = true; foot.className = "rm-foot"; status.textContent = "saving…";
      const payload = {}; for (const k in inputs) payload[k] = inputs[k].value;
      const res = await fetch("resources/" + encodeURIComponent(d.id) + "/" + encodeURIComponent(item[d.identity]), {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
      if (res && res.ok) { render(); loadItems(curType); }
      else { foot.className = "rm-foot rm-err"; status.textContent = "save failed: " + ((res && res.error) || "error"); save.disabled = false; }
    });
    foot.appendChild(save); foot.appendChild(status);
    body.appendChild(foot);
  }

  function renderTable(table, foot) {
    const d = descFor(curType);
    const cols = (d && d.columns && d.columns.length) ? d.columns : [d ? d.identity : "id"];
    const caps = (d && d.capabilities) || [];
    const verbs = [].concat((d && d.actions) || []); // declared actions…
    if (caps.indexOf("delete") >= 0) verbs.push("delete"); // …plus delete when allowed
    const idKey = d ? d.identity : "id";
    table.innerHTML = "";

    const hasActions = verbs.length || (d && d.editable);
    const head = document.createElement("div"); head.className = "rm-row rm-head";
    for (const c of cols) { const cell = document.createElement("div"); cell.className = "rm-cell"; cell.textContent = c; head.appendChild(cell); }
    if (hasActions) { const ah = document.createElement("div"); ah.className = "rm-cell rm-actions"; ah.textContent = "actions"; head.appendChild(ah); }
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
      if (hasActions) {
        const key = String(it[idKey]);
        const act = document.createElement("div"); act.className = "rm-cell rm-actions";
        if (d && d.editable) {
          const eb = document.createElement("button");
          eb.type = "button"; eb.className = "rm-act"; eb.textContent = "edit";
          eb.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); editItem(d, it); });
          act.appendChild(eb);
        }
        for (const v of verbs) {
          const btn = document.createElement("button");
          btn.type = "button"; btn.className = "rm-act" + (v === "delete" ? " rm-danger" : "");
          btn.textContent = v;
          btn.addEventListener("click", async (e) => {
            e.preventDefault(); e.stopPropagation();
            if (v === "delete" && !window.confirm("Delete " + curType + " '" + key + "'?")) return;
            btn.disabled = true;
            const res = await runVerb(curType, key, v);
            if (res && res.ok) { loadItems(curType); }
            else { foot.className = "rm-foot rm-err"; foot.textContent = v + " failed: " + ((res && res.error) || "error"); btn.disabled = false; }
          });
          act.appendChild(btn);
        }
        row.appendChild(act);
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
