/*
 * props-panel.js — a draggable/resizable Properties panel (jsPanel) for editing the
 * selected node's fields in an HTML form. Behaviour:
 *   - toggled from the View menu ("Properties Panel"),
 *   - opened by DOUBLE-clicking a node (single-click only updates it when already open),
 *   - remembers its position/size/visibility across reloads via the SERVER workspace
 *     (collectWorkspace reads PatronProps.panel(); applyWorkspace stashes PatronApp.propsRect),
 *     exactly like the Toolbox/Output panels — no localStorage,
 *   - mirrors the node's widgets (combo→select, toggle→checkbox, else text); edits sync
 *     back to the node, the canvas widget, the node width, and the autosave.
 *
 * Reaches the canvas + menubar via window.PatronApp (set by app.js).
 */
(function () {
  "use strict";
  let panel = null, body = null, open = false, lastNode = null;
  // Block input-rendering metadata, fetched from agent_runtime's /composer/catalog (the
  // block classes declare each field's `control`). Keyed by block type == node.type.
  // Until it loads (or if unreachable) we fall back to the node's own widgets.
  let CATALOG = null;

  function loadCatalog() {
    fetch("composer/catalog", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((cat) => {
        if (!cat || !cat.blocks) return;
        CATALOG = {};
        for (const b of cat.blocks) CATALOG[b.type] = b.config || [];
        if (open) populate(lastNode); // re-render with proper controls now
      })
      .catch(() => { /* offline — keep the widget fallback */ });
  }

  // Grounded picker source: real WhatsApp Groups/Contacts (proxied to the runtime admin API).
  let WA_TARGETS = null;
  function loadWaTargets() {
    fetch("admin/channels/whatsapp/targets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.targets)) { WA_TARGETS = d.targets; if (open) populate(lastNode); }
      })
      .catch(() => { /* bridge/runtime unreachable — the field falls back to text entry */ });
  }

  // Grounded picker source: real MCP tool catalog (prefixed names), proxied to the runtime
  // admin API. Populates the Agent tools allow-list checklist.
  let MCP_TOOLS = null;
  function loadMcpTools() {
    fetch("admin/channels/mcp/tools", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.tools)) { MCP_TOOLS = d.tools; if (open) populate(lastNode); }
      })
      .catch(() => { /* mcp-service/runtime unreachable — the field falls back to CSV text */ });
  }

  function ready(cb) {
    const app = window.PatronApp;
    if (app && app.canvas) return cb(app);
    setTimeout(() => ready(cb), 200);
  }

  // Position/size is persisted in the SERVER workspace (app.js collectWorkspace reads
  // PatronProps.panel(); applyWorkspace stashes the saved rect on PatronApp.propsRect). We
  // position the panel FROM that rect at creation, so jsPanel's default never overrides it.
  function savedRect() { return (window.PatronApp && window.PatronApp.propsRect) || null; }

  function ensurePanel() {
    if (panel) return;
    const r = savedRect(); // server-persisted rect (position + size), or null
    const px = (v) => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, "")); return isFinite(n) ? n : 0; }; // handles "690px" and "calc(490px)"
    const position = r && r.left && r.top
      ? { my: "left-top", at: "left-top", offsetX: px(r.left), offsetY: px(r.top) }
      : { my: "center-top", at: "center-top", offsetX: 0, offsetY: 58 };
    const panelSize = r && r.width && r.height
      ? { width: px(r.width) || 300, height: px(r.height) || 360 }
      : { width: 300, height: 360 };
    if (typeof jsPanel !== "undefined") {
      panel = jsPanel.create({
        headerTitle: '<img src="icons/table.svg" width="16" height="16" style="vertical-align:middle;margin-right:7px;position:relative;top:-1px" alt=""><span class="pttxt">Properties</span>',
        theme: "none",
        borderRadius: "8px", /* match the litegraph node corner radius (round_radius = 8) */
        border: "1px solid var(--panel-border)",
        panelSize: panelSize,                 // restored from the saved workspace
        position: position,                   // …positioned from it, so jsPanel doesn't recenter
        boxShadow: 3,
        headerControls: { size: "xs", minimize: "remove", smallify: "remove", normalize: "remove", maximize: "remove" },
        addCloseControl: 0,
        callback: (p) => {
          p.content.style.cssText =
            "padding:12px;overflow:auto;background:var(--panel);color:var(--text);" +
            "font:13px 'Roboto',system-ui,-apple-system,sans-serif";
          body = p.content;
        },
      });
      panel.style.display = "none";
    } else {
      panel = document.createElement("div");
      panel.id = "patron-props";
      panel.style.cssText =
        "position:fixed;right:12px;top:64px;width:300px;max-height:70vh;overflow:auto;" +
        "background:var(--panel,#fff);color:var(--text,#1f2328);" +
        "border:1px solid var(--panel-border,#d0d7de);border-radius:8px;padding:12px;" +
        "z-index:9000;box-shadow:0 4px 16px rgba(0,0,0,.18);display:none;" +
        "font:13px 'Roboto',system-ui,-apple-system,sans-serif";
      document.body.appendChild(panel);
      body = panel;
    }
  }

  function fieldFor(node, w) {
    const wrap = document.createElement("label");
    wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;margin-bottom:10px";
    const cap = document.createElement("span");
    cap.textContent = w.label || w.name;   // friendly label (e.g. "chat id"); key stays w.name
    cap.style.cssText = "opacity:.65;font-size:12px";
    wrap.appendChild(cap);

    const commit = (val) => {
      node.properties[w.name] = val;
      w.value = val;
      if (typeof window.PatronFitNodeWidth === "function") window.PatronFitNodeWidth(node);
      if (window.PatronApp.canvas.setDirty) window.PatronApp.canvas.setDirty(true, true);
      if (window.PatronApp.scheduleSave) window.PatronApp.scheduleSave();
    };

    // The canvas widget is a display-only text widget; its real editing type is carried on
    // w.editKind (+ editValues/editMin/editMax). Fall back to w.type for any plain widget.
    const kind = w.editKind || w.type;
    const values = w.editValues || (w.options && w.options.values);
    let input;
    if (kind === "combo" && Array.isArray(values)) {
      input = document.createElement("select");
      for (const v of values) {
        const o = document.createElement("option");
        o.value = v; o.textContent = v;
        input.appendChild(o);
      }
      input.value = w.value;
      input.addEventListener("change", () => commit(input.value));
    } else if (kind === "toggle") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!w.value;
      input.addEventListener("change", () => commit(input.checked));
    } else {
      const num = kind === "number";
      input = document.createElement("input");
      input.type = "text";
      input.value = w.value == null ? "" : String(w.value);
      input.addEventListener("change", () => commit(num ? Number(input.value) : input.value));
    }
    input.style.cssText =
      "padding:5px 8px;border:1px solid var(--panel-border,#d0d7de);border-radius:6px;" +
      "background:var(--bg,#f6f8fa);color:inherit;font:13px system-ui,sans-serif;" +
      "width:100%;box-sizing:border-box";
    wrap.appendChild(input);
    return wrap;
  }

  // Write a value from the panel back to the node property + its canvas widget display.
  function commitValue(node, key, val) {
    node.properties[key] = val;
    const w = (node.widgets || []).find((x) => x.name === key);
    if (w) w.value = val;
    if (typeof window.PatronFitNodeWidth === "function") window.PatronFitNodeWidth(node);
    if (window.PatronApp.canvas.setDirty) window.PatronApp.canvas.setDirty(true, true);
    if (window.PatronApp.scheduleSave) window.PatronApp.scheduleSave();
  }

  // --- MCP tools picker: a SEPARATE, non-modal floating panel (jsPanel), opened from the
  // Agent's tools field. Searchable, shows each tool's description, select-all/clear; writes
  // the CSV allow-list back live. Preserves selected-but-offline ids so nothing is dropped. ---
  let mcpPanel = null, mcpBody = null, mcpCtx = null;

  function mcpSelectedSet() {
    if (!mcpCtx) return new Set();
    return new Set(String(mcpCtx.node.properties[mcpCtx.key] || "")
      .split(",").map((s) => s.trim()).filter(Boolean));
  }

  // Position/size persisted in the SERVER workspace (app.js reads PatronProps.mcpRect();
  // applyWorkspace stashes PatronApp.mcpRect), exactly like the Properties/Toolbox panels.
  const MCP_DEF_W = 800, MCP_DEF_H = 460; // default width doubled (was 400)
  function savedMcpRect() { return (window.PatronApp && window.PatronApp.mcpRect) || null; }
  // Live rect while open, else the last-known saved rect (survives close→reopen + reloads).
  function mcpRectNow() {
    if (mcpPanel) {
      const cs = getComputedStyle(mcpPanel);
      return {
        left: mcpPanel.style.left || cs.left, top: mcpPanel.style.top || cs.top,
        width: mcpPanel.style.width || cs.width, height: mcpPanel.style.height || cs.height,
        hidden: mcpPanel.style.display === "none",
      };
    }
    return savedMcpRect();
  }
  function stashMcpRect() { if (window.PatronApp) window.PatronApp.mcpRect = mcpRectNow(); }

  function ensureMcpPanel() {
    if (mcpPanel) return;
    const r = savedMcpRect();
    const px = (v) => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, "")); return isFinite(n) ? n : 0; };
    const panelSize = r && r.width && r.height
      ? { width: px(r.width) || MCP_DEF_W, height: px(r.height) || MCP_DEF_H }
      : { width: MCP_DEF_W, height: MCP_DEF_H };
    const position = r && r.left && r.top
      ? { my: "left-top", at: "left-top", offsetX: px(r.left), offsetY: px(r.top) }
      : { my: "center", at: "center", offsetX: 0, offsetY: 20 };
    if (typeof jsPanel !== "undefined") {
      mcpPanel = jsPanel.create({
        headerTitle: '<img src="icons/connectors.svg" width="16" height="16" style="vertical-align:middle;margin-right:7px;position:relative;top:-1px" alt=""><span class="pttxt">MCP Tools</span>',
        theme: "none",
        borderRadius: "8px",
        border: "1px solid var(--panel-border)",
        panelSize: panelSize,
        position: position,
        boxShadow: 3,
        headerControls: { size: "xs", minimize: "remove", smallify: "remove", normalize: "remove", maximize: "remove" },
        addCloseControl: 1,
        callback: (p) => {
          p.content.style.cssText =
            "display:flex;flex-direction:column;padding:0;overflow:hidden;" +
            "background:var(--panel);color:var(--text);font:13px 'Roboto',system-ui,sans-serif";
          mcpBody = p.content;
        },
        // Remember where it was when closed, so reopening (and the next autosave) keeps it.
        onclosed: () => { stashMcpRect(); mcpPanel = null; mcpBody = null; },
      });
    } else {
      mcpPanel = document.createElement("div");
      mcpPanel.style.cssText =
        "position:fixed;left:" + (r && r.left ? px(r.left) + "px" : "auto") +
        ";right:" + (r && r.left ? "auto" : "12px") + ";top:" + (r && r.top ? px(r.top) : 80) + "px;" +
        "width:" + panelSize.width + "px;height:" + panelSize.height + "px;display:flex;" +
        "flex-direction:column;background:var(--panel,#fff);color:var(--text,#1f2328);" +
        "border:1px solid var(--panel-border,#d0d7de);border-radius:8px;overflow:hidden;" +
        "z-index:9100;box-shadow:0 4px 16px rgba(0,0,0,.18)";
      document.body.appendChild(mcpPanel);
      mcpBody = mcpPanel;
    }
  }

  function renderMcpPanel(onApply) {
    if (!mcpBody) return;
    mcpBody.innerHTML = "";
    const tools = MCP_TOOLS || [];
    const sel = mcpSelectedSet();

    // toolbar: filter + Select all/Clear + count, all on ONE line
    const bar = document.createElement("div");
    bar.className = "mcp-bar";
    const search = document.createElement("input");
    search.type = "search"; search.className = "pp-input"; search.placeholder = "Filter tools…";
    bar.appendChild(search);
    mcpBody.appendChild(bar);

    if (!tools.length) {
      // catalog unreachable — never block authoring: let the user type names as CSV.
      const msg = document.createElement("div");
      msg.className = "mcp-empty";
      msg.textContent = "MCP catalog unreachable — enter tool names as CSV:";
      const ta = document.createElement("textarea");
      ta.className = "pp-input pp-area pp-mono";
      ta.style.margin = "0 12px 12px";
      ta.value = mcpCtx ? String(mcpCtx.node.properties[mcpCtx.key] || "") : "";
      ta.addEventListener("change", () => {
        if (mcpCtx) { commitValue(mcpCtx.node, mcpCtx.key, ta.value); if (onApply) onApply(); }
      });
      mcpBody.appendChild(msg); mcpBody.appendChild(ta);
      return;
    }

    // Select all / Clear + count live on the SAME line as the filter box (appended to bar).
    const allBtn = document.createElement("button"); allBtn.type = "button"; allBtn.className = "pp-btn"; allBtn.textContent = "Select all";
    const clrBtn = document.createElement("button"); clrBtn.type = "button"; clrBtn.className = "pp-btn"; clrBtn.textContent = "Clear";
    const count = document.createElement("span"); count.className = "mcp-count";
    bar.appendChild(allBtn); bar.appendChild(clrBtn); bar.appendChild(count);

    const list = document.createElement("div");
    list.className = "mcp-list";
    mcpBody.appendChild(list);

    const write = () => {
      const names = [...list.querySelectorAll("input[type=checkbox]:checked")].map((cb) => cb.value);
      const shown = new Set(tools.map((t) => t.name));
      for (const n of sel) if (!shown.has(n)) names.push(n); // keep offline-selected ids
      if (mcpCtx) commitValue(mcpCtx.node, mcpCtx.key, names.join(", "));
      if (onApply) onApply();
      updateCount();
    };

    const known = new Set(tools.map((t) => t.name));
    const rows = [];
    const addRow = (name, desc, unknown) => {
      const row = document.createElement("label");
      row.className = "mcp-row";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = name; cb.checked = sel.has(name); cb.className = "pp-check";
      cb.addEventListener("change", write);
      const txt = document.createElement("div");
      txt.className = "mcp-txt";
      const nm = document.createElement("div"); nm.className = "mcp-name";
      nm.textContent = unknown ? name + "  (not on server)" : name;
      txt.appendChild(nm);
      if (desc) { const d = document.createElement("div"); d.className = "mcp-desc"; d.textContent = desc; txt.appendChild(d); }
      row.appendChild(cb); row.appendChild(txt);
      row._hay = (name + " " + (desc || "")).toLowerCase();
      list.appendChild(row);
      rows.push(row);
    };
    for (const t of tools) addRow(t.name, t.description, false);
    for (const name of sel) if (!known.has(name)) addRow(name, "", true);

    function updateCount() {
      count.textContent = list.querySelectorAll("input[type=checkbox]:checked").length + " selected";
    }
    function applyFilter() {
      const q = search.value.trim().toLowerCase();
      for (const r of rows) r.style.display = (!q || r._hay.indexOf(q) >= 0) ? "" : "none";
    }
    search.addEventListener("input", applyFilter);
    allBtn.addEventListener("click", () => {
      for (const r of rows) if (r.style.display !== "none") r.querySelector("input").checked = true;
      write();
    });
    clrBtn.addEventListener("click", () => {
      for (const r of rows) r.querySelector("input").checked = false;
      write();
    });
    updateCount();
  }

  function openMcpPanel(node, key, onApply) {
    mcpCtx = { node, key };
    ensureMcpPanel();
    renderMcpPanel(onApply);
    if (mcpPanel && mcpPanel.style) mcpPanel.style.display = "";
    if (mcpPanel && typeof mcpPanel.front === "function") mcpPanel.front();
  }

  // Render ONE field from the block's catalog metadata (f = {key, control, label, values,
  // placeholder, min, max}). The control decides the input: text / number / select /
  // textarea (multi-line prompt) / json (monospace + validation).
  function fieldForSchema(node, f) {
    const wrap = document.createElement("label");
    wrap.className = "pp-field";
    const cap = document.createElement("span");
    cap.className = "pp-label";
    cap.textContent = f.label || f.key;
    wrap.appendChild(cap);

    const cur = node.properties[f.key];
    const control = f.control || "text";
    let input, err, extra;

    if (control === "whatsapp-target") {
      // grounded picker: dropdown of real Groups/Contacts + a "Type an id…" text fallback,
      // mirroring the agent_runtime admin UI. Falls back to plain text if targets unloaded.
      const targets = WA_TARGETS || [];
      input = document.createElement("select");
      input.appendChild(new Option("— select —", ""));
      input.appendChild(new Option("Type an id…", "__type__"));
      const grp = (label, items) => {
        if (!items.length) return;
        const og = document.createElement("optgroup");
        og.label = label;
        for (const t of items) og.appendChild(new Option(`${t.name} — ${t.id}`, t.id));
        input.appendChild(og);
      };
      grp("Groups", targets.filter((t) => t.kind === "group"));
      grp("Contacts", targets.filter((t) => t.kind === "contact"));
      const idBox = document.createElement("input");
      idBox.type = "text";
      idBox.className = "pp-input";
      idBox.style.marginTop = "6px";
      idBox.placeholder = "chat id (…@g.us / …@c.us)";
      const known = targets.some((t) => t.id === cur);
      if (cur && known) { input.value = cur; idBox.style.display = "none"; }
      else if (cur) { input.value = "__type__"; idBox.value = cur; }
      else { input.value = ""; idBox.style.display = "none"; }
      // Pick an id AND auto-fill the friendly name (target_name) from the same catalog, so the
      // block carries "L2K Chat" beside the raw id. An unknown/typed id leaves any existing
      // name untouched (never clobbers a hand-entered label with blank).
      const nameFor = (id) => { const t = targets.find((x) => x.id === id); return t ? t.name : ""; };
      const setTarget = (id) => {
        commitValue(node, f.key, id);
        const nm = nameFor(id);
        if (nm) { commitValue(node, "target_name", nm); populate(node); } // re-render the name field
      };
      input.addEventListener("change", () => {
        if (input.value === "__type__") { idBox.style.display = ""; if (idBox.focus) idBox.focus(); }
        else { idBox.style.display = "none"; setTarget(input.value); }
      });
      idBox.addEventListener("change", () => setTarget(idBox.value));
      extra = idBox;
    } else if (control === "mcp-tools") {
      // A read-only input showing the selected tool names + a "…" affordance on the SAME line;
      // the "…" opens a SEPARATE non-modal panel to pick from the real MCP catalog. Selection is
      // a CSV of prefixed names, written back live from the panel.
      input = document.createElement("div");
      input.className = "pp-picker-row";
      const box = document.createElement("input");
      box.type = "text";
      box.readOnly = true;
      box.className = "pp-input";
      box.placeholder = "no tools selected";
      const paint = () => {
        const names = String(node.properties[f.key] || "").split(",").map((s) => s.trim()).filter(Boolean);
        box.value = names.join(", ");
      };
      paint();
      const dots = document.createElement("button");
      dots.type = "button";
      dots.className = "pp-dots";
      dots.textContent = "…";
      dots.title = "Choose MCP tools";
      const openPanel = () => openMcpPanel(node, f.key, paint);
      dots.addEventListener("click", openPanel);
      box.addEventListener("click", openPanel); // clicking the box opens the picker too
      input.appendChild(box);
      input.appendChild(dots);
    } else if (control === "boolean") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!cur;
      input.addEventListener("change", () => commitValue(node, f.key, input.checked));
    } else if (control === "select") {
      input = document.createElement("select");
      for (const v of f.values || []) {
        const o = document.createElement("option");
        o.value = v; o.textContent = v;
        input.appendChild(o);
      }
      input.value = cur;
      input.addEventListener("change", () => commitValue(node, f.key, input.value));
    } else if (control === "number") {
      input = document.createElement("input");
      input.type = "number";
      if (f.min != null) input.min = f.min;
      if (f.max != null) input.max = f.max;
      input.step = "any";
      input.value = cur == null ? "" : cur;
      input.addEventListener("change", () => commitValue(node, f.key, Number(input.value)));
    } else if (control === "textarea" || control === "json") {
      input = document.createElement("textarea");
      input.rows = control === "json" ? 4 : 3;
      input.value = cur == null ? "" : String(cur);
      if (f.placeholder) input.placeholder = f.placeholder;
      err = document.createElement("div");
      err.className = "pp-err";
      input.addEventListener("change", () => {
        if (control === "json" && input.value.trim()) {
          try { JSON.parse(input.value); } catch (e) { err.textContent = "invalid JSON: " + e.message; return; }
        }
        err.textContent = "";
        commitValue(node, f.key, input.value);
      });
    } else { // text
      input = document.createElement("input");
      input.type = "text";
      input.value = cur == null ? "" : String(cur);
      if (f.placeholder) input.placeholder = f.placeholder;
      input.addEventListener("change", () => commitValue(node, f.key, input.value));
    }
    if (input.type === "checkbox") {
      input.className = "pp-check";
      wrap.classList.add("pp-field-row"); // label + checkbox on one row
    } else if (input.tagName === "DIV") {
      /* custom container (e.g. the mcp-tools checklist) — styled internally, leave it */
    } else {
      input.className = "pp-input" +
        (input.tagName === "TEXTAREA" ? " pp-area" : "") +
        (control === "json" ? " pp-mono" : "");
    }
    wrap.appendChild(input);
    if (err) wrap.appendChild(err);
    if (extra) wrap.appendChild(extra);
    return wrap;
  }

  // Before rendering, fill an empty target_name from a KNOWN whatsapp-target id (existing
  // graphs whose id predates this field), so the name field — now shown first — is populated
  // on the very first paint regardless of field order.
  function preresolveTargetName(node, fields) {
    const hasWa = fields.some((f) => f.control === "whatsapp-target");
    if (!hasWa || !WA_TARGETS || node.properties.target_name) return;
    const t = WA_TARGETS.find((x) => x.id === node.properties.target);
    if (t && t.name) commitValue(node, "target_name", t.name);
  }

  function populate(node) {
    lastNode = node || lastNode;
    ensurePanel();
    body.innerHTML = "";
    const h = document.createElement("div");
    h.className = "pp-title";
    h.textContent = node ? (node.title || node.type) : "Properties";
    body.appendChild(h);
    if (!node) {
      const m = document.createElement("div");
      m.className = "pp-empty";
      m.textContent = "Select a node to edit its fields.";
      body.appendChild(m);
      return;
    }
    // Prefer the block's own catalog metadata (control per field); fall back to the node's
    // widgets if the catalog isn't loaded / has no entry for this type.
    const fields = CATALOG && CATALOG[node.type];
    if (fields && fields.length) {
      preresolveTargetName(node, fields); // fill target_name from a known id BEFORE rendering
      for (const f of fields) body.appendChild(fieldForSchema(node, f));
    } else if (node.widgets && node.widgets.length) {
      for (const w of node.widgets) body.appendChild(fieldFor(node, w));
    } else {
      const m = document.createElement("div");
      m.className = "pp-empty";
      m.textContent = "no editable fields";
      body.appendChild(m);
    }
  }

  function selectedNode() {
    const c = window.PatronApp && window.PatronApp.canvas;
    const sel = c && c.selected_nodes;
    if (sel) { const k = Object.keys(sel); if (k.length) return sel[k[0]]; }
    return null;
  }

  function setOpen(v, node) {
    ensurePanel();
    open = v;
    panel.style.display = v ? "" : "none";
    if (v) populate(node || lastNode || selectedNode());
    const mb = window.PatronApp && window.PatronApp.menuBar;
    if (mb) { mb.setContext("propsVisible", v); if (mb.refresh) mb.refresh(); }
    if (window.PatronApp && window.PatronApp.scheduleSave) window.PatronApp.scheduleSave();
  }
  function toggle() { setOpen(!open); }

  window.PatronProps = { toggle, setOpen, isOpen: () => open, populate, panel: () => panel,
                         mcpPanel: () => mcpPanel, mcpRect: mcpRectNow };

  ready((app) => {
    const canvas = app.canvas;
    loadCatalog();    // fetch the block field metadata (controls) up front
    loadWaTargets();  // fetch real WhatsApp Groups/Contacts for the grounded target picker
    loadMcpTools();   // fetch the real MCP tool catalog for the Agent allow-list picker
    if (app.menuBar) {
      app.menuBar.registerCommand("view.properties", toggle);
      app.menuBar.setContext("propsVisible", false);
      if (app.menuBar.refresh) app.menuBar.refresh();
    }
    // Double-click a node -> open the panel on it.
    const prevDbl = canvas.onNodeDblClicked;
    canvas.onNodeDblClicked = function (node) {
      if (prevDbl) prevDbl.call(this, node);
      setOpen(true, node);
    };
    // Single-select only updates the panel when it's already open (never opens it).
    const prevSel = canvas.onNodeSelected;
    canvas.onNodeSelected = function (node) {
      if (prevSel) prevSel.call(this, node);
      if (open) populate(node);
    };
    // Visibility/position restore is driven by app.js applyWorkspace (it has the workspace
    // data and calls PatronProps.restore() after the async load) — see PatronProps.restore.
  });

  // Called by app.js applyWorkspace once PatronApp.propsRect is set. Opens the panel if it
  // was visible when saved (it then positions itself from the saved rect via ensurePanel).
  window.PatronProps.restore = function () {
    const r = savedRect();
    if (r && r.hidden === false) setOpen(true);
  };
})();
