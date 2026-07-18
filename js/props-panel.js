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
        if (open) populate(lastNode); rerenderOpenPanels();
      })
      .catch(() => { /* offline — keep the widget fallback */ });
  }


  // --- Resource model: ONE generic grounded source for any declared resource. The editor reads
  // /resources/catalog (descriptors) + /resources/<id> (items), so a field with control
  // "resource-ref" (+ kind = resource id) renders a picker with NO bespoke code. This is the
  // generalization of the old per-field loaders (preset/mcp/whatsapp). ---
  let RESOURCES = null;              // id -> descriptor
  const RESOURCE_ITEMS = {};         // id -> [items] (session cache; [] also marks in-flight)
  function loadResources() {
    fetch("resources/catalog", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.resources)) {
          RESOURCES = {};
          for (const r of d.resources) RESOURCES[r.id] = r;
          if (open) populate(lastNode); rerenderOpenPanels();
        }
      })
      .catch(() => { /* runtime unreachable — resource-ref fields fall back to text entry */ });
  }
  function loadResourceItems(id) {
    if (RESOURCE_ITEMS[id]) return;  // cached / in-flight
    RESOURCE_ITEMS[id] = [];
    fetch("resources/" + encodeURIComponent(id), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.items)) {
          RESOURCE_ITEMS[id] = d.items;
          if (open) populate(lastNode); rerenderOpenPanels();
          // if the multi-select picker is open on this resource, refresh it now that items arrived
          if (mcpPanel && mcpCtx && mcpCtx.rid === id) renderMcpPanel(mcpCtx.onApply);
        }
      })
      .catch(() => { /* unreachable — the field falls back to text entry */ });
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
        headerTitle: window.PatronIcons.maskSpan("icons/table.svg", 16, "vertical-align:middle;margin-left:3px;margin-right:7px;position:relative;top:-1px;") + '<span class="pttxt">Properties</span>',
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
        // Closing DESTROYS the jsPanel DOM node — drop our refs so ensurePanel() recreates it
        // on the next double-click (otherwise setOpen would act on a detached element = dead).
        onclosed: () => { panel = null; body = null; open = false; },
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
        headerTitle: window.PatronIcons.maskSpan("icons/connectors.svg", 16, "vertical-align:middle;margin-left:3px;margin-right:7px;position:relative;top:-1px;") + '<span class="pttxt">MCP Tools</span>',
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
    if (!mcpBody || !mcpCtx) return;
    mcpBody.innerHTML = "";
    // GENERIC multi-select over any resource (mcpCtx.rid). Value = descriptor identity;
    // display name = columns[0]; description = columns[1] (if declared).
    const d0 = (RESOURCES && RESOURCES[mcpCtx.rid]) || null;
    const idKey = d0 && d0.identity ? d0.identity : "name";
    const nameKey = d0 && d0.columns && d0.columns[0] ? d0.columns[0] : idKey;
    const descKey = d0 && d0.columns && d0.columns[1] ? d0.columns[1] : null;
    const items = RESOURCE_ITEMS[mcpCtx.rid] || [];
    const sel = mcpSelectedSet();

    // toolbar: filter + Select all/Clear + count, all on ONE line
    const bar = document.createElement("div");
    bar.className = "mcp-bar";
    const search = document.createElement("input");
    search.type = "search"; search.className = "pp-input"; search.placeholder = "Filter…";
    bar.appendChild(search);
    mcpBody.appendChild(bar);

    if (!items.length) {
      // source unreachable / still loading — never block authoring: let the user type CSV.
      const msg = document.createElement("div");
      msg.className = "mcp-empty";
      msg.textContent = ((d0 && d0.label) || "Items") + " list unavailable — enter values as CSV:";
      const ta = document.createElement("textarea");
      ta.className = "pp-input pp-area pp-mono";
      ta.style.margin = "0 12px 12px";
      ta.value = String(mcpCtx.node.properties[mcpCtx.key] || "");
      ta.addEventListener("change", () => {
        commitValue(mcpCtx.node, mcpCtx.key, ta.value); if (onApply) onApply();
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

    const known = new Set(items.map((t) => String(t[idKey])));
    const write = () => {
      const names = [...list.querySelectorAll("input[type=checkbox]:checked")].map((cb) => cb.value);
      for (const n of sel) if (!known.has(n)) names.push(n); // keep offline-selected ids
      commitValue(mcpCtx.node, mcpCtx.key, names.join(", "));
      if (onApply) onApply();
      updateCount();
    };

    const rows = [];
    const addRow = (value, label, desc, unknown) => {
      const row = document.createElement("label");
      row.className = "mcp-row";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = value; cb.checked = sel.has(value); cb.className = "pp-check";
      cb.addEventListener("change", write);
      const txt = document.createElement("div");
      txt.className = "mcp-txt";
      const nm = document.createElement("div"); nm.className = "mcp-name";
      nm.textContent = unknown ? value + "  (not on server)" : label;
      txt.appendChild(nm);
      if (desc) { const dd = document.createElement("div"); dd.className = "mcp-desc"; dd.textContent = desc; txt.appendChild(dd); }
      row.appendChild(cb); row.appendChild(txt);
      row._hay = (value + " " + label + " " + (desc || "")).toLowerCase();
      list.appendChild(row);
      rows.push(row);
    };
    for (const t of items) {
      const v = String(t[idKey]);
      addRow(v, t[nameKey] != null ? String(t[nameKey]) : v, descKey ? t[descKey] : "", false);
    }
    for (const v of sel) if (!known.has(v)) addRow(v, v, "", true);

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

  // Open the generic multi-select picker panel for a resource (rid). onApply repaints the field.
  function openResourcePicker(node, key, rid, onApply) {
    mcpCtx = { node, key, rid, onApply };
    loadResourceItems(rid);           // fetch items (cached); re-renders the panel when they arrive
    ensureMcpPanel();
    const d0 = (RESOURCES && RESOURCES[rid]) || null;
    if (mcpPanel && typeof mcpPanel.setHeaderTitle === "function") {
      const icon = d0 && d0.icon ? d0.icon : "icons/connectors.svg";
      mcpPanel.setHeaderTitle('<img src="' + icon + '" width="16" height="16" style="vertical-align:middle;margin-left:3px;margin-right:7px;position:relative;top:-1px" alt=""><span class="pttxt">' + ((d0 && d0.label) || "Select") + '</span>');
    }
    renderMcpPanel(onApply);
    if (mcpPanel && mcpPanel.style) mcpPanel.style.display = "";
    if (mcpPanel && typeof mcpPanel.front === "function") mcpPanel.front();
  }

  // --- Template Studio: a SEPARATE, non-modal editor panel for the input_template — a large
  // editor + clickable {vars} chips (derived from the node's input_vars). Writes back live.
  // (The LLM co-author loop is a planned follow-up.) ---
  let tplPanel = null, tplBody = null, tplCtx = null;

  function insertAtCursor(ta, text) {
    const s = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    const e = ta.selectionEnd == null ? ta.value.length : ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + text.length;
  }

  // Position/size persisted in the SERVER workspace (app.js reads PatronProps.tplRect();
  // applyWorkspace stashes PatronApp.tplRect), exactly like the MCP/Properties panels.
  const TPL_DEF_W = 640, TPL_DEF_H = 460;
  function savedTplRect() { return (window.PatronApp && window.PatronApp.tplRect) || null; }
  function tplRectNow() {
    if (tplPanel) {
      const cs = getComputedStyle(tplPanel);
      return {
        left: tplPanel.style.left || cs.left, top: tplPanel.style.top || cs.top,
        width: tplPanel.style.width || cs.width, height: tplPanel.style.height || cs.height,
        hidden: tplPanel.style.display === "none",
      };
    }
    return savedTplRect();
  }
  function stashTplRect() { if (window.PatronApp) window.PatronApp.tplRect = tplRectNow(); }

  function ensureTemplateStudio() {
    if (tplPanel) return;
    const r = savedTplRect();
    const px = (v) => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, "")); return isFinite(n) ? n : 0; };
    const panelSize = r && r.width && r.height
      ? { width: px(r.width) || TPL_DEF_W, height: px(r.height) || TPL_DEF_H }
      : { width: TPL_DEF_W, height: TPL_DEF_H };
    const position = r && r.left && r.top
      ? { my: "left-top", at: "left-top", offsetX: px(r.left), offsetY: px(r.top) }
      : { my: "center", at: "center", offsetX: 0, offsetY: 20 };
    if (typeof jsPanel !== "undefined") {
      tplPanel = jsPanel.create({
        headerTitle: window.PatronIcons.maskSpan("icons/chat-bubble-text-square.svg", 16, "vertical-align:middle;margin-left:3px;margin-right:7px;position:relative;top:-1px;") + '<span class="pttxt">Template Studio</span>',
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
          tplBody = p.content;
        },
        // Remember where it was when closed, so reopening (and the next autosave) keeps it.
        onclosed: () => { stashTplRect(); tplPanel = null; tplBody = null; },
      });
    } else {
      tplPanel = document.createElement("div");
      tplPanel.style.cssText =
        "position:fixed;left:" + (r && r.left ? px(r.left) + "px" : "auto") +
        ";right:" + (r && r.left ? "auto" : "12px") + ";top:" + (r && r.top ? px(r.top) : 80) + "px;" +
        "width:" + panelSize.width + "px;height:" + panelSize.height + "px;display:flex;" +
        "flex-direction:column;background:var(--panel,#fff);color:var(--text,#1f2328);" +
        "border:1px solid var(--panel-border,#d0d7de);border-radius:8px;overflow:hidden;" +
        "z-index:9100;box-shadow:0 4px 16px rgba(0,0,0,.18)";
      document.body.appendChild(tplPanel);
      tplBody = tplPanel;
    }
  }

  // Build the Template Studio CONTENT — {var} chips + editor + co-author "Improve" footer —
  // into `host`. Used INLINE in the Prompt tab (control:"template", the merged Studio) and by
  // the legacy floating panel (renderTemplateStudio). Writes back live via commitValue.
  function buildTemplateEditor(host, node, key, onApply) {
    // toolbar: {vars} chips derived from the node's input_vars JSON keys
    const bar = document.createElement("div");
    bar.className = "tpl-bar";
    const hint = document.createElement("span");
    hint.className = "tpl-hint";
    hint.textContent = "Insert variable:";
    bar.appendChild(hint);
    let vars = [];
    try {
      const o = JSON.parse(String(node.properties.input_vars || "{}"));
      if (o && typeof o === "object" && !Array.isArray(o)) vars = Object.keys(o);
    } catch (e) { /* invalid input_vars — no chips */ }

    const ta = document.createElement("textarea");
    ta.className = "tpl-editor pp-mono";
    ta.value = String(node.properties[key] || "");
    ta.addEventListener("input", () => { commitValue(node, key, ta.value); if (onApply) onApply(); });

    if (vars.length) {
      for (const v of vars) {
        const chip = document.createElement("button");
        chip.type = "button"; chip.className = "tpl-chip"; chip.textContent = "{" + v + "}";
        chip.addEventListener("click", () => {
          insertAtCursor(ta, "{" + v + "}");
          commitValue(node, key, ta.value);
          if (onApply) onApply();
          ta.focus();
        });
        bar.appendChild(chip);
      }
    } else {
      const none = document.createElement("span");
      none.className = "tpl-hint";
      none.textContent = "(define input_vars to get variable chips)";
      bar.appendChild(none);
    }
    host.appendChild(bar);
    host.appendChild(ta);

    // co-author footer: an instruction + "Improve" → the template_writer LLM rewrites the editor.
    const foot = document.createElement("div");
    foot.className = "tpl-foot";
    const instr = document.createElement("input");
    instr.type = "text"; instr.className = "pp-input";
    instr.placeholder = "Ask the writer to change something (e.g. \"add a friendly intro\")…";
    const improve = document.createElement("button");
    improve.type = "button"; improve.className = "pp-btn"; improve.textContent = "✨ Improve";
    const status = document.createElement("span"); status.className = "tpl-status";
    const runImprove = async () => {
      const instruction = instr.value.trim();
      if (!instruction) { instr.focus(); return; }
      improve.disabled = true; instr.disabled = true;
      status.classList.remove("tpl-err"); status.textContent = "Writing…";
      try {
        const resp = await fetch("admin/tools/template-writer", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template: ta.value, instruction: instruction, vars: vars }),
        });
        const d = await resp.json();
        if (d && d.ok && d.template) {
          ta.value = d.template; commitValue(node, key, ta.value); if (onApply) onApply();
          instr.value = ""; status.textContent = "Updated ✓";
        } else {
          status.textContent = (d && d.error) ? ("Failed: " + d.error) : "Failed";
          status.classList.add("tpl-err");
        }
      } catch (e) {
        status.textContent = "Failed: " + e.message; status.classList.add("tpl-err");
      } finally {
        improve.disabled = false; instr.disabled = false;
      }
    };
    improve.addEventListener("click", runImprove);
    instr.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runImprove(); } });
    foot.appendChild(instr); foot.appendChild(improve); foot.appendChild(status);
    host.appendChild(foot);
    return ta;
  }

  // Legacy floating Template Studio panel — now UNUSED (the Studio is merged inline into the
  // Prompt tab, control:"template"). Kept inert so app.js's tplRect persistence stays valid;
  // nothing opens it anymore. Safe to prune later along with app.js's tpl wiring.
  function renderTemplateStudio(onApply) {
    if (!tplBody || !tplCtx) return;
    tplBody.innerHTML = "";
    const ta = buildTemplateEditor(tplBody, tplCtx.node, tplCtx.key, onApply);
    setTimeout(() => ta.focus(), 0);
  }

  function openTemplateStudio(node, key, onApply) {
    tplCtx = { node, key };
    ensureTemplateStudio();
    renderTemplateStudio(onApply);
    if (tplPanel && tplPanel.style) tplPanel.style.display = "";
    if (tplPanel && typeof tplPanel.front === "function") tplPanel.front();
  }

  // Conditional visibility: a field with `show_if: {other: value}` is shown ONLY when the
  // sibling property `other` currently equals `value` (value may be a scalar or a list). This
  // makes mutually-exclusive fields (e.g. JSON block inline `content` vs file `path`) hide the
  // one that doesn't apply. No show_if → always visible.
  function fieldVisible(node, f) {
    const cond = f && f.show_if;
    if (!cond) return true;
    for (const key in cond) {
      const want = cond[key];
      const have = node.properties[key];
      const ok = Array.isArray(want) ? want.map(String).includes(String(have))
                                     : String(have) === String(want);
      if (!ok) return false;
    }
    return true;
  }
  // Build a starter argument object from a tool's JSON Schema: every declared property,
  // required ones first, seeded with a value of the right shape (a declared default when the
  // tool offers one). This is what turns "{}" into a filled-in form the author can edit,
  // instead of a blank object they have to guess at.
  function skeletonFromSchema(schema) {
    const props = (schema && schema.properties) || {};
    const required = new Set((schema && schema.required) || []);
    const keys = Object.keys(props).sort((a, b) => (required.has(b) ? 1 : 0) - (required.has(a) ? 1 : 0));
    const out = {};
    for (const k of keys) {
      const p = props[k] || {};
      if (p.default !== undefined) { out[k] = p.default; continue; }
      const t = Array.isArray(p.type) ? p.type[0] : p.type;
      out[k] = t === "integer" || t === "number" ? 0
             : t === "boolean" ? false
             : t === "array" ? []
             : t === "object" ? {}
             : "";
    }
    return out;
  }

  // A compact, readable rendering of the same contract: name, type, required, description.
  function schemaHintLines(schema) {
    const props = (schema && schema.properties) || {};
    const required = new Set((schema && schema.required) || []);
    return Object.keys(props).map((k) => {
      const p = props[k] || {};
      const t = Array.isArray(p.type) ? p.type.join("|") : (p.type || "any");
      const req = required.has(k) ? " · required" : "";
      const def = p.default !== undefined ? " · default " + JSON.stringify(p.default) : "";
      const desc = p.description ? " — " + p.description : "";
      return k + " (" + t + ")" + req + def + desc;
    });
  }

  // Look up the item currently selected in another field (used by fills_template/schema_hint).
  function selectedItemOf(node, fields, siblingKey) {
    const f = (fields || []).find((x) => x.key === siblingKey);
    if (!f) return null;
    const desc = RESOURCES && RESOURCES[f.kind];
    const items = RESOURCE_ITEMS[f.kind];
    if (!desc || !items || !items.length) { if (f.kind) loadResourceItems(f.kind); return null; }
    const idKey = desc.identity || "id";
    const cur = node.properties[f.key];
    if (!cur) return null;
    return items.find((it) => String(it[idKey]) === String(cur)) || null;
  }

  // True when some other field DEPENDS on `key` (its visibility via show_if, its options via
  // values_by, the items of a grounded picker via scope_by, or its placeholder via
  // placeholders_by) — so changing `key` must re-render the panel.
  function fieldDrivesRerender(fields, key) {
    return (fields || []).some((f) =>
      (f.show_if && Object.prototype.hasOwnProperty.call(f.show_if, key)) ||
      (f.values_by && f.values_by.field === key) ||
      (f.scope_by && f.scope_by.field === key) ||
      (f.schema_hint && f.schema_hint.field === key) ||
      (f.placeholders_by && f.placeholders_by.field === key));
  }

  // The selectable options for an enum/select field, resolving a data-driven `values_by`
  // ({field, values}) against the CURRENT value of the sibling field (e.g. `source` limited to
  // ["file"] when `format` is binary). Falls back to the static `values`.
  function fieldValues(node, f) {
    const vb = f && f.values_by;
    if (vb && vb.field && vb.values) {
      const v = vb.values[String(node.properties[vb.field])];
      if (Array.isArray(v)) return v;
    }
    return (f && f.values) || [];
  }

  // The placeholder for a field, resolving a data-driven `placeholders_by` ({field, values}) against
  // the CURRENT value of the sibling field (e.g. `content`'s example changes with `format`). Falls
  // back to the static `placeholder`.
  function fieldPlaceholder(node, f) {
    const pb = f && f.placeholders_by;
    if (pb && pb.field && pb.values) {
      const ex = pb.values[String(node.properties[pb.field])];
      if (ex != null) return ex;
    }
    return f && f.placeholder ? f.placeholder : "";
  }

  // Render ONE field from the block's catalog metadata (f = {key, control, label, values,
  // placeholder, min, max, show_if}). The control decides the input: text / number / select /
  // textarea (multi-line prompt) / json (monospace + validation). `rerender` (optional) is
  // called after a value change that can alter which fields are visible (a show_if driver).
  function fieldForSchema(node, f, rerender) {
    const wrap = document.createElement("label");
    wrap.className = "pp-field";
    const cap = document.createElement("span");
    cap.className = "pp-label";
    cap.textContent = f.label || f.key;
    wrap.appendChild(cap);

    const cur = node.properties[f.key];
    const control = f.control || "text";
    // `pre` renders ABOVE the control (a scope_by search box); `extra` renders below it.
    let input, err, extra, pre;

    if (control === "resource-ref") {
      // GENERIC grounded picker for ANY declared resource (kind = resource id). Descriptor
      // drives everything: multi → summary + "…" checklist panel; single → dropdown, optionally
      // optgrouped (group_by), with a "type an id" escape (allow_free) and pick side-effects
      // (sets → fill sibling fields, e.g. target_name). Plain-text fallback if not loaded.
      const rid = f.kind;
      const desc = RESOURCES && RESOURCES[rid];
      if (desc) loadResourceItems(rid);
      const items = RESOURCE_ITEMS[rid] || [];
      const idKey = desc && desc.identity ? desc.identity : "id";
      const labelKey = desc && desc.columns && desc.columns[0] ? desc.columns[0] : idKey;
      const sets = (desc && desc.sets) || null;
      const itemById = (id) => items.find((it) => String(it[idKey]) === String(id));
      const applyPick = (value) => {
        commitValue(node, f.key, value);
        if (sets && Object.keys(sets).length) {
          const it = itemById(value);
          for (const sib in sets) {
            const v = it ? it[sets[sib]] : null;
            if (v != null && String(v) !== "") commitValue(node, sib, String(v));
          }
          populate(node); // re-render sibling fields (e.g. target_name)
        }
        // Picking a tool seeds its arguments: the author sees the real parameter names
        // instead of an empty object. Only fills when the target is still empty/{} —
        // an authored payload is never overwritten by changing the selection.
        const ft = f.fills_template;
        if (ft && ft.field) {
          const item = (items || []).find((x) => String(x[idKey]) === String(value));
          const schema = item && item[ft.from || "input_schema"];
          const cur = String(node.properties[ft.field] || "").trim();
          if (schema && (cur === "" || cur === "{}")) {
            commitValue(node, ft.field, JSON.stringify(skeletonFromSchema(schema), null, 2));
          }
        }
        // A grounded pick can ALSO drive other fields — e.g. choosing `server` narrows the
        // `tool` list via scope_by. Same rule the plain select control already applies.
        const fields = CATALOG && CATALOG[node.type];
        if (rerender && fieldDrivesRerender(fields, f.key)) rerender(node);
      };
      if (desc && desc.multi) {
        // multi-select → summary box + "…" opens the shared searchable checklist panel
        input = document.createElement("div");
        input.className = "pp-picker-row";
        const box = document.createElement("input");
        box.type = "text"; box.readOnly = true; box.className = "pp-input";
        box.placeholder = "none selected";
        const paint = () => {
          box.value = String(node.properties[f.key] || "").split(",").map((s) => s.trim()).filter(Boolean).join(", ");
        };
        paint();
        const dots = document.createElement("button");
        dots.type = "button"; dots.className = "pp-dots"; dots.textContent = "…";
        dots.title = "Choose " + (desc.label || rid);
        const openPanel = () => openResourcePicker(node, f.key, rid, paint);
        dots.addEventListener("click", openPanel);
        box.addEventListener("click", openPanel);
        input.appendChild(box); input.appendChild(dots);
      } else if (!desc || !items.length) {
        // not-ready single → plain text (never block authoring)
        input = document.createElement("input");
        input.type = "text";
        input.value = cur == null ? "" : String(cur);
        if (f.placeholder) input.placeholder = f.placeholder;
        input.addEventListener("change", () => commitValue(node, f.key, input.value));
      } else {
        input = document.createElement("select");
        const allowFree = !!(desc && desc.allow_free);
        const vals = items.map((it) => String(it[idKey]));
        const optFor = (it) => {
          const v = String(it[idKey]);
          const lab = it[labelKey] != null ? String(it[labelKey]) : v;
          return new Option(lab === v ? v : lab + " — " + v, v);
        };
        const groupBy = desc && desc.group_by;

        // `scope_by` ({field, item}): by DEFAULT the list is narrowed to the items belonging
        // to a sibling field's current value (e.g. only the selected server's tools). A search
        // OVERRIDES that scope and matches across ALL items, so a tool on another host is still
        // reachable without switching servers first; clearing the search returns to the scope.
        const scope = f.scope_by || null;
        const scopeVal = scope ? String(node.properties[scope.field] || "").trim() : "";
        let searchBox = null;
        const visibleItems = (q) => {
          const query = (q || "").trim().toLowerCase();
          if (query) {
            return items.filter((it) =>
              Object.keys(it).some((k) => String(it[k] || "").toLowerCase().includes(query)));
          }
          if (scope && scopeVal) {
            return items.filter((it) => String(it[scope.item] || "") === scopeVal);
          }
          return items;
        };
        const fillOptions = (list) => {
          input.innerHTML = "";
          input.appendChild(new Option("— select —", ""));
          if (allowFree) input.appendChild(new Option("Type an id…", "__type__"));
          if (groupBy) {
            const groups = {};
            for (const it of list) { const g = String(it[groupBy] || "other"); (groups[g] = groups[g] || []).push(it); }
            for (const g of Object.keys(groups)) {
              const og = document.createElement("optgroup");
              og.label = g;   // the raw key (a server key is an id, not a word to pluralize)
              for (const it of groups[g]) og.appendChild(optFor(it));
              input.appendChild(og);
            }
          } else {
            for (const it of list) input.appendChild(optFor(it));
          }
        };
        fillOptions(visibleItems(""));

        if (scope) {
          // The search sits directly above the dropdown it filters.
          searchBox = document.createElement("input");
          searchBox.type = "search";
          searchBox.className = "pp-input";
          searchBox.style.marginBottom = "6px";
          searchBox.placeholder = scopeVal
            ? "Search all servers… (empty = " + scopeVal + " only)"
            : "Search…";
          searchBox.addEventListener("input", () => {
            const keep = input.value;
            fillOptions(visibleItems(searchBox.value));
            // Preserve the current selection if it survived the filter.
            if (keep && [...input.options].some((o) => o.value === keep)) input.value = keep;
          });
        }
        const known = vals.includes(String(cur));
        let idBox = null;
        if (allowFree) {
          idBox = document.createElement("input");
          idBox.type = "text"; idBox.className = "pp-input"; idBox.style.marginTop = "6px";
          idBox.placeholder = f.placeholder || "type an id";
        }
        if (cur && known) { input.value = cur; if (idBox) idBox.style.display = "none"; }
        else if (cur && allowFree) { input.value = "__type__"; idBox.value = cur; }
        else if (cur) { input.appendChild(new Option(cur + "  (not on server)", cur)); input.value = cur; if (idBox) idBox.style.display = "none"; }
        else { input.value = ""; if (idBox) idBox.style.display = "none"; }
        input.addEventListener("change", () => {
          if (input.value === "__type__") { if (idBox) { idBox.style.display = ""; if (idBox.focus) idBox.focus(); } }
          else { if (idBox) idBox.style.display = "none"; applyPick(input.value); }
        });
        if (idBox) { idBox.addEventListener("change", () => applyPick(idBox.value)); extra = idBox; }
        if (searchBox) pre = searchBox;   // the scope_by search renders above the dropdown
      }
    } else if (control === "template") {
      // Merged Template Studio: the full {var}-chips editor + co-author, rendered INLINE here
      // (was a small textarea + "⤢ Open studio…" button opening a separate panel). The editor
      // has its own resize grip, and the Agent Configuration panel is resizable for more room.
      input = document.createElement("div");
      input.className = "tpl-inline";
      buildTemplateEditor(input, node, f.key, null);
    } else if (control === "boolean") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!cur;
      input.addEventListener("change", () => commitValue(node, f.key, input.checked));
    } else if (control === "select") {
      input = document.createElement("select");
      const vals = fieldValues(node, f);   // may be narrowed by values_by (sibling-dependent)
      for (const v of vals) {
        const o = document.createElement("option");
        o.value = v; o.textContent = v;
        input.appendChild(o);
      }
      // If the current value is no longer allowed (e.g. source="inline" but format went binary),
      // snap to the first allowed option and commit — so the state can never be invalid.
      if (vals.length && !vals.map(String).includes(String(cur))) {
        commitValue(node, f.key, vals[0]);
        input.value = vals[0];
      } else {
        input.value = cur;
      }
      input.addEventListener("change", () => {
        commitValue(node, f.key, input.value);
        // If other fields depend on this select (visibility / options / placeholder), re-render.
        const fields = CATALOG && CATALOG[node.type];
        if (rerender && fieldDrivesRerender(fields, f.key)) rerender(node);
      });
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
      const ta_ph = fieldPlaceholder(node, f);
      if (ta_ph) input.placeholder = ta_ph;
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
      const tx_ph = fieldPlaceholder(node, f);
      if (tx_ph) input.placeholder = tx_ph;
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
    if (pre) wrap.appendChild(pre);
    wrap.appendChild(input);
    if (err) wrap.appendChild(err);
    if (extra) wrap.appendChild(extra);

    // `schema_hint`: spell out the parameter contract of the tool selected in a sibling
    // field, right under the payload the author has to write. The information was always
    // published by the tool — this is just the first place it is actually shown.
    if (f.schema_hint && f.schema_hint.field) {
      const fields = CATALOG && CATALOG[node.type];
      const item = selectedItemOf(node, fields, f.schema_hint.field);
      const schema = item && item[f.schema_hint.item || "input_schema"];
      const lines = schema ? schemaHintLines(schema) : [];
      if (lines.length) {
        const hint = document.createElement("div");
        hint.className = "pp-hint";
        hint.style.cssText =
          "margin-top:6px;font-size:11px;line-height:1.5;opacity:.75;" +
          "border-left:2px solid var(--panel-border,#8884);padding-left:8px";
        const head = document.createElement("div");
        head.style.cssText = "font-weight:600;opacity:.9;margin-bottom:2px";
        head.textContent = "parameters";
        hint.appendChild(head);
        for (const l of lines) {
          const row = document.createElement("div");
          row.textContent = l;
          hint.appendChild(row);
        }
        wrap.appendChild(hint);
      }
    }
    return wrap;
  }

  // Set a property + its canvas widget WITHOUT persisting — for view-time resolution that must
  // NOT dirty/save the workspace (merely opening the panel shouldn't rewrite the graph).
  function silentSet(node, key, val) {
    node.properties[key] = val;
    const w = (node.widgets || []).find((x) => x.name === key);
    if (w) w.value = val;
  }

  // Before rendering, resolve any resource-ref field's `sets` side-effects from a KNOWN current
  // value (e.g. fill target_name from a known WhatsApp id) — SILENTLY, so viewing a node never
  // triggers an autosave. Only fills siblings that are empty; the user's pick still persists.
  function preresolveRefs(node, fields) {
    if (!RESOURCES) return;
    for (const f of fields) {
      if ((f.control || "") !== "resource-ref") continue;
      const desc = RESOURCES[f.kind];
      if (!desc) continue;
      const idKey = desc.identity || "id";
      const items = RESOURCE_ITEMS[f.kind];

      // `default_first`: preselect the first available item when the field is still empty.
      // With a single MCP server there is nothing to choose, and leaving it blank would also
      // leave anything scoped to it (the tool list) unscoped. Silent, like the rest of this
      // pass — opening a panel must never dirty the graph; the value persists as soon as the
      // user touches anything.
      if (f.default_first && !node.properties[f.key]) {
        if (!items || !items.length) loadResourceItems(f.kind);   // re-renders on arrival
        else if (items[0] && items[0][idKey] != null) silentSet(node, f.key, String(items[0][idKey]));
      }

      if (!desc.sets || !Object.keys(desc.sets).length) continue;
      const cur = node.properties[f.key];
      if (!cur) continue;
      if (!items || !items.length) { loadResourceItems(f.kind); continue; }
      const it = items.find((x) => String(x[idKey]) === String(cur));
      if (!it) continue;
      for (const sib in desc.sets) {
        if (!node.properties[sib] && it[desc.sets[sib]] != null) silentSet(node, sib, String(it[desc.sets[sib]]));
      }
    }
  }

  function populate(node) {
    lastNode = node || lastNode;
    ensurePanel();
    // This is the block's OWN panel (opened by double-clicking the block) — title it by the
    // block, not "Properties" (there is no generic Properties panel anymore).
    if (panel && panel.setHeaderTitle) {
      // Title the panel "<Block> Configuration" so it's easy to tell a config panel from its
      // block on the canvas. The block name is NOT repeated in the body (it's here already).
      const nm = node ? (node.title || node.type) : "Block";
      panel.setHeaderTitle('<span class="pttxt">' + nm + ' Configuration</span>');
    }
    body.innerHTML = "";
    if (!node) {
      const m = document.createElement("div");
      m.className = "pp-empty";
      m.textContent = "Select a node to edit its fields.";
      body.appendChild(m);
      return;
    }
    if (node.type === "trigger") { renderScheduleInto(body, node); return; }
    if (node.type === "agent" && window.PatronAgentConfig) { window.PatronAgentConfig.render(body, node); return; }
    // Prefer the block's own catalog metadata (control per field); fall back to the node's
    // widgets if the catalog isn't loaded / has no entry for this type.
    const fields = CATALOG && CATALOG[node.type];
    if (fields && fields.length) {
      preresolveRefs(node, fields); // fill sibling fields (e.g. target_name) SILENTLY before render
      for (const f of fields) {
        if (!fieldVisible(node, f)) continue; // hide mutually-exclusive fields (show_if)
        body.appendChild(fieldForSchema(node, f, populate));
      }
    } else if (node.widgets && node.widgets.length) {
      for (const w of node.widgets) body.appendChild(fieldFor(node, w));
    } else {
      const m = document.createElement("div");
      m.className = "pp-empty";
      m.textContent = "no editable fields";
      body.appendChild(m);
    }
    addManagementRow(node); // this block's OWN management verbs (composer model: per-block, not central)
  }

  // Per-block management: a block that maps to a deployed resource gets its management verbs
  // right here in its own (double-click) panel — NOT in a central manager. Keyed by a node
  // property that identifies the deployed resource. (Empty for now: the legacy trigger→scheduler
  // job mapping keyed off agent_id, which was removed — the Project uid drives deploy/undeploy.)
  const BLOCK_RESOURCE = {};
  function addManagementRow(node, container) {
    container = container || body;
    const map = BLOCK_RESOURCE[node.type];
    if (!map || !RESOURCES) return;
    const desc = RESOURCES[map.resource];
    if (!desc) return;
    const key = node.properties[map.keyProp];
    if (!key) return;
    const verbs = (desc.actions || []).slice();
    if ((desc.capabilities || []).indexOf("delete") >= 0) verbs.push("delete");
    if (!verbs.length) return;

    const sec = document.createElement("div"); sec.className = "pp-manage";
    const h = document.createElement("div"); h.className = "pp-manage-h";
    h.textContent = "Manage " + (desc.label || map.resource).toLowerCase() + " · " + key;
    sec.appendChild(h);
    const row = document.createElement("div"); row.className = "pp-manage-row";
    const status = document.createElement("span"); status.className = "pp-manage-status";
    for (const v of verbs) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "pp-btn" + (v === "delete" ? " pp-danger" : "");
      b.textContent = v;
      b.addEventListener("click", async () => {
        if (v === "delete" && !(await window.PatronDialogs.confirm({
          title: "Delete", message: "Delete " + map.resource + " '" + key + "'?",
          okLabel: "Delete", danger: true,
        }))) return;
        b.disabled = true; status.className = "pp-manage-status"; status.textContent = "…";
        const base = "resources/" + encodeURIComponent(map.resource) + "/" + encodeURIComponent(key);
        const url = v === "delete" ? base : base + "/" + encodeURIComponent(v);
        const res = await fetch(url, { method: v === "delete" ? "DELETE" : "POST" })
          .then((r) => r.json()).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
        if (res && res.ok) { status.textContent = v + " ✓"; }
        else { status.className = "pp-manage-status pp-err"; status.textContent = v + " failed: " + ((res && res.error) || "error"); }
        b.disabled = false;
      });
      row.appendChild(b);
    }
    row.appendChild(status);
    sec.appendChild(row);
    container.appendChild(sec);
  }

  // ===== DEDICATED per-block panels: one separate panel INSTANCE per node, keyed by node id.
  // Double-clicking a block opens (or fronts) its own panel; multiple can be open at once, each
  // remembering its own position/size in the workspace. =====
  const blockPanels = {}; // nodeId -> { panel, node }

  function blockRectStore() {
    const a = window.PatronApp || {};
    return (a.blockRects = a.blockRects || {});
  }
  function saveBlockRect(id, jp) {
    if (!jp) return;
    const cs = getComputedStyle(jp);
    blockRectStore()[id] = {
      left: jp.style.left || cs.left, top: jp.style.top || cs.top,
      width: jp.style.width || cs.width, height: jp.style.height || cs.height,
    };
    if (window.PatronApp && window.PatronApp.scheduleSave) window.PatronApp.scheduleSave();
  }

  // ===== Scheduled Trigger: a DEDICATED, purpose-built scheduler UI (not the generic
  // label→value rows). Opens on double-click like any block panel, but renders a mode
  // selector (Cron / Interval / One-off) + the right fields + a live human-readable
  // preview. Writes straight to the node properties the deploy path reads. =====
  const CRON_PRESETS = [
    { label: "Every day at 07:00", cron: "0 7 * * *" },
    { label: "Every hour (on the hour)", cron: "0 * * * *" },
    { label: "Every 15 minutes", cron: "*/15 * * * *" },
    { label: "Weekdays at 08:00", cron: "0 8 * * 1-5" },
    { label: "Every Monday at 09:00", cron: "0 9 * * 1" },
    { label: "First of the month at 00:00", cron: "0 0 1 * *" },
  ];
  const CRON_FIELDS = [["minute"], ["hour"], ["day"], ["month"], ["weekday"]];
  const TZ_COMMON = ["UTC", "Europe/Lisbon", "Europe/London", "Europe/Madrid",
                     "America/New_York", "America/Los_Angeles", "Asia/Tokyo"];
  const IVL_UNITS = ["seconds", "minutes", "hours", "days", "weeks"];

  // Best-effort human-readable cron. Falls back to the raw expression for shapes it can't
  // phrase, so it never misdescribes a schedule.
  function cronText(expr) {
    const parts = String(expr || "").trim().split(/\s+/);
    if (parts.length !== 5) return expr ? "cron: " + expr : "(incomplete)";
    const [mi, h, dom, mon, dow] = parts;
    const p2 = (n) => (String(n).length < 2 ? "0" + n : "" + n);
    const num = (s) => /^\d+$/.test(s);
    const DOW = { "0": "Sunday", "1": "Monday", "2": "Tuesday", "3": "Wednesday",
                  "4": "Thursday", "5": "Friday", "6": "Saturday", "7": "Sunday" };
    const time = (num(mi) && num(h)) ? p2(h) + ":" + p2(mi) : null;
    if (mi === "*") return "every minute";
    if (h === "*" && num(mi)) return "hourly at :" + p2(mi);
    if (/^\*\/\d+$/.test(mi) && h === "*") return "every " + mi.slice(2) + " minutes";
    if (dom === "*" && mon === "*") {
      if (dow === "*") return time ? "every day at " + time : "daily";
      if (dow === "1-5") return "weekdays at " + (time || "?");
      if (DOW[dow]) return "every " + DOW[dow] + " at " + (time || "?");
    }
    if (num(dom) && mon === "*" && dow === "*") return "day " + dom + " monthly at " + (time || "?");
    return "cron: " + expr;
  }

  // Keep the canvas node's one-line summary + width in sync after a schedule edit.
  function refreshTriggerNode(node) {
    node.properties.schedule_summary = window.PatronScheduleSummary
      ? window.PatronScheduleSummary(node.properties) : "";
    const w = (node.widgets || []).find((x) => x.name === "schedule_summary");
    if (w) w.value = node.properties.schedule_summary;
    if (typeof window.PatronFitNodeWidth === "function") window.PatronFitNodeWidth(node);
    const c = window.PatronApp && window.PatronApp.canvas;
    if (c && c.setDirty) c.setDirty(true, true);
  }
  function commitSchedule(node, key, val) {
    commitValue(node, key, val);   // property + autosave + node refit
    refreshTriggerNode(node);       // one-line summary widget
  }

  // A labelled field (reuses the pp-* look). Returns { wrap, input }.
  function schField(labelText, control, value, onCommit, opts) {
    opts = opts || {};
    const wrap = document.createElement("label");
    wrap.className = "pp-field";
    const cap = document.createElement("span");
    cap.className = "pp-label"; cap.textContent = labelText;
    wrap.appendChild(cap);
    let input;
    if (control === "select") {
      input = document.createElement("select"); input.className = "pp-input";
      for (const o of opts.options || []) {
        const opt = document.createElement("option");
        opt.value = o.value; opt.textContent = o.label;
        if (String(o.value) === String(value)) opt.selected = true;
        input.appendChild(opt);
      }
      input.addEventListener("change", () => onCommit(input.value));
    } else {
      input = document.createElement("input");
      input.type = control === "number" ? "number"
        : (control === "datetime" ? "datetime-local" : "text");
      input.className = "pp-input";
      if (control === "number" && opts.min != null) input.min = opts.min;
      if (opts.placeholder) input.placeholder = opts.placeholder;
      input.value = value == null ? "" : String(value);
      const fire = () => onCommit(input.value);
      input.addEventListener("change", fire);
      input.addEventListener("blur", fire);
    }
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }

  function renderScheduleInto(container, node) {
    container.innerHTML = "";
    const p = node.properties;
    // No block-name heading in the body — the panel title carries "<Block> Configuration".

    // mode tabs (Cron / Interval / One-off) — same folder-tab look as Agent Configuration
    const mode = p.schedule_mode || "cron";
    const tabs = document.createElement("div"); tabs.className = "ac-tabs";
    for (const [val, lbl] of [["cron", "Cron"], ["interval", "Interval"], ["date", "One-off"]]) {
      const b = document.createElement("button"); b.type = "button"; b.textContent = lbl;
      b.className = "ac-tab" + (val === mode ? " active" : "");
      b.addEventListener("click", () => {
        if ((p.schedule_mode || "cron") === val) return;
        commitSchedule(node, "schedule_mode", val);
        renderScheduleInto(container, node);  // re-render for the new mode
      });
      tabs.appendChild(b);
    }
    container.appendChild(tabs);

    const sub = document.createElement("div"); sub.className = "sch-sub";
    container.appendChild(sub);
    const preview = document.createElement("div"); preview.className = "sch-preview";
    const paintPreview = () => {
      preview.innerHTML = "";
      const lead = document.createElement("span"); lead.textContent = "→ ";
      const strong = document.createElement("b");
      const m = p.schedule_mode || "cron";
      if (m === "interval") strong.textContent = window.PatronScheduleSummary(p);
      else if (m === "date") strong.textContent = p.run_date ? ("once at " + p.run_date) : "one-off (set a date/time)";
      else strong.textContent = cronText(p.cron) + (p.timezone ? " · " + p.timezone : "");
      preview.appendChild(lead); preview.appendChild(strong);
    };

    if (mode === "cron") {
      const grid = document.createElement("div"); grid.className = "sch-cron";
      const cur = String(p.cron || "0 7 * * *").trim().split(/\s+/);
      while (cur.length < 5) cur.push("*");
      const boxes = [];
      CRON_FIELDS.forEach(([lbl], i) => {
        const cell = document.createElement("div"); cell.className = "sch-cell";
        const cap = document.createElement("span"); cap.textContent = lbl;
        const inp = document.createElement("input"); inp.className = "pp-input"; inp.value = cur[i];
        const commit = () => {
          cur[i] = (inp.value || "*").trim() || "*"; inp.value = cur[i];
          commitSchedule(node, "cron", cur.join(" ")); paintPreview();
        };
        inp.addEventListener("change", commit); inp.addEventListener("blur", commit);
        cell.appendChild(cap); cell.appendChild(inp); grid.appendChild(cell); boxes.push(inp);
      });
      sub.appendChild(grid);
      const pf = schField("preset", "select", "", (v) => {
        if (!v) return;
        const arr = v.trim().split(/\s+/); while (arr.length < 5) arr.push("*");
        commitSchedule(node, "cron", v);
        boxes.forEach((bx, i) => (bx.value = arr[i] || "*"));
        paintPreview();
      }, { options: [{ value: "", label: "— quick presets —" }]
        .concat(CRON_PRESETS.map((x) => ({ value: x.cron, label: x.label }))) });
      pf.wrap.classList.add("sch-presets");
      sub.appendChild(pf.wrap);
      const tz = schField("timezone (IANA · blank = UTC)", "text", p.timezone,
        (v) => { commitSchedule(node, "timezone", v.trim()); paintPreview(); },
        { placeholder: "e.g. Europe/Lisbon" });
      const dl = document.createElement("datalist"); dl.id = "sch-tz-list";
      for (const z of TZ_COMMON) { const o = document.createElement("option"); o.value = z; dl.appendChild(o); }
      tz.input.setAttribute("list", "sch-tz-list");
      tz.wrap.appendChild(dl);
      sub.appendChild(tz.wrap);
    } else if (mode === "interval") {
      const wrap = document.createElement("div"); wrap.className = "pp-field";
      const cap = document.createElement("span"); cap.className = "pp-label"; cap.textContent = "interval";
      const row = document.createElement("div"); row.className = "sch-ivl";
      const every = document.createElement("span");
      every.textContent = "every"; every.style.cssText = "color:var(--muted);font-size:12px;";
      const num = document.createElement("input");
      num.type = "number"; num.min = "1"; num.className = "pp-input sch-num";
      num.value = p.interval_value == null ? 30 : p.interval_value;
      const sel = document.createElement("select"); sel.className = "pp-input";
      for (const u of IVL_UNITS) {
        const o = document.createElement("option"); o.value = u; o.textContent = u;
        if (u === (p.interval_unit || "minutes")) o.selected = true; sel.appendChild(o);
      }
      const commitNum = () => {
        let n = parseInt(num.value, 10); if (!(isFinite(n) && n > 0)) n = 1;
        num.value = n; commitSchedule(node, "interval_value", n); paintPreview();
      };
      num.addEventListener("change", commitNum); num.addEventListener("blur", commitNum);
      sel.addEventListener("change", () => { commitSchedule(node, "interval_unit", sel.value); paintPreview(); });
      row.appendChild(every); row.appendChild(num); row.appendChild(sel);
      wrap.appendChild(cap); wrap.appendChild(row); sub.appendChild(wrap);
    } else {  // date (one-off)
      sub.appendChild(schField("run at (one-off)", "datetime", p.run_date,
        (v) => { commitSchedule(node, "run_date", (v || "").trim()); paintPreview(); }).wrap);
      sub.appendChild(schField("timezone (optional)", "text", p.timezone,
        (v) => { commitSchedule(node, "timezone", v.trim()); paintPreview(); },
        { placeholder: "e.g. Europe/Lisbon" }).wrap);
    }

    container.appendChild(preview);
    paintPreview();

    // seed / task
    container.appendChild(schField(
      "task / query (seed · optional)", "text", p.task,
      (v) => commitSchedule(node, "task", v),
      { placeholder: "e.g. latest AI-safety papers" }).wrap);

    addManagementRow(node, container);  // deploy/delete verbs, same as any block
  }

  // Render a block's fields + management into a given container (works for any panel instance).
  function renderBlockInto(container, node) {
    if (node && node.type === "trigger") { renderScheduleInto(container, node); return; }
    if (node && node.type === "agent" && window.PatronAgentConfig) {
      window.PatronAgentConfig.render(container, node); return;
    }
    if (node && node.type === "ingestion" && window.PatronIngestionConfig) {
      window.PatronIngestionConfig.render(container, node); return;
    }
    container.innerHTML = "";
    // No block-name heading in the body — the panel title already carries "<Block> Configuration".
    const fields = CATALOG && CATALOG[node.type];
    if (fields && fields.length) {
      preresolveRefs(node, fields);
      const rerender = () => renderBlockInto(container, node);
      for (const f of fields) {
        if (!fieldVisible(node, f)) continue; // hide mutually-exclusive fields (show_if)
        container.appendChild(fieldForSchema(node, f, rerender));
      }
    } else if (node.widgets && node.widgets.length) {
      for (const w of node.widgets) container.appendChild(fieldFor(node, w));
    } else {
      const m = document.createElement("div");
      m.className = "pp-empty"; m.textContent = "no editable fields";
      container.appendChild(m);
    }
    addManagementRow(node, container);
  }

  function openBlockPanel(node) {
    if (!node || typeof jsPanel === "undefined") return;
    const id = String(node.id);
    const existing = blockPanels[id];
    if (existing && existing.panel) {                 // already open → front + refresh, no duplicate
      existing.node = node;
      existing.panel.style.display = "";
      if (existing.panel.front) existing.panel.front();
      if (existing.panel.content) renderBlockInto(existing.panel.content, node);
      return;
    }
    const r = blockRectStore()[id];
    const px = (v) => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, "")); return isFinite(n) ? n : 0; };
    const cascade = Object.keys(blockPanels).length;  // offset new panels so they don't stack exactly
    const position = (r && r.left && r.top)
      ? { my: "left-top", at: "left-top", offsetX: px(r.left), offsetY: px(r.top) }
      : { my: "left-top", at: "left-top", offsetX: 340 + cascade * 26, offsetY: 92 + cascade * 26 };
    // The Agent block's config is TABBED and carries the inline Template Studio, so it gets a
    // larger default (600×490) than the flat-list blocks (320×380). A saved rect still wins.
    // The tabbed panels (Agent, Ingestion) need room; the flat list does not.
    const isRich = node.type === "agent" || node.type === "ingestion";
    const panelSize = (r && r.width && r.height)
      ? { width: px(r.width) || 320, height: px(r.height) || 380 }
      : { width: isRich ? 600 : 320, height: isRich ? 490 : 380 };
    const jp = jsPanel.create({
      headerTitle: (function () {
        // Show the block's OWN icon in the header, same spot as on the block's canvas title —
        // including the per-icon vertical nudge (ic.dy) so Text Send/Receive et al. sit the same
        // 2px offset here as on the block. Base header offset is top:1px, plus dy.
        const src = window.PatronIcons && window.PatronIcons.fileFor(node.type);
        const dy = (window.PatronIcons && window.PatronIcons.dyFor(node.type)) || 0;
        // Canonical icon size (PatronIcons.sizeFor) — IDENTICAL to the toolbox + block-title icon,
        // so the same icon is the same pixel size on all three surfaces.
        const sz = (window.PatronIcons && window.PatronIcons.sizeFor) ? window.PatronIcons.sizeFor(node.type) : 16;
        const ico = src ? window.PatronIcons.maskSpan(src, sz,
          "vertical-align:middle;margin-left:3px;margin-right:7px;position:relative;top:" + (1 + dy) + "px;") : "";
        return ico + '<span class="pttxt">' + (node.title || node.type) + " Configuration</span>";
      })(),
      theme: "none", borderRadius: "8px", border: "1px solid var(--panel-border)",
      panelSize: panelSize, position: position, boxShadow: 3,
      headerControls: { size: "xs", minimize: "remove", smallify: "remove", normalize: "remove", maximize: "remove" },
      callback: (p) => {
        p.classList.add("patron-config-panel");  // scopes the block-style close button (css)
        p.content.style.cssText =
          "padding:12px;overflow:auto;background:var(--panel);color:var(--text);font:13px 'Roboto',system-ui,sans-serif";
        renderBlockInto(p.content, node);
      },
      dragit: { stop: function () { saveBlockRect(id, jp); } },
      resizeit: { stop: function () { saveBlockRect(id, jp); } },
      onclosed: function () { saveBlockRect(id, jp); delete blockPanels[id]; },
    });
    // Selection linking (block_management.md §3): clicking a block's panel selects its
    // canvas block, so with several panels open you always know which block each manages.
    jp.addEventListener("pointerdown", function () {
      const c = window.PatronApp && window.PatronApp.canvas;
      const cur = blockPanels[id] && blockPanels[id].node;
      if (c && c.selectNode && cur) { c.selectNode(cur); c.setDirty(true, true); }
    }, true);
    blockPanels[id] = { panel: jp, node: node };
  }

  // Close a block's Configuration panel (if open) — used when the block itself is deleted.
  function closeBlockPanelFor(nodeId) {
    const e = blockPanels[String(nodeId)];
    if (e && e.panel && e.panel.close) e.panel.close(); // onclosed cleans up blockPanels[id]
  }

  // Re-render every open block panel (e.g. after the catalog / resource lists load).
  function rerenderOpenPanels() {
    for (const id in blockPanels) {
      const e = blockPanels[id];
      if (e && e.panel && e.panel.content) renderBlockInto(e.panel.content, e.node);
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
    if (v) {
      populate(node || lastNode || selectedNode());
      ensureOnScreen();          // a stale saved position must never hide the panel
      if (panel.front) panel.front();
    }
    const mb = window.PatronApp && window.PatronApp.menuBar;
    if (mb) { mb.setContext("propsVisible", v); if (mb.refresh) mb.refresh(); }
    if (window.PatronApp && window.PatronApp.scheduleSave) window.PatronApp.scheduleSave();
  }

  // Guarantee the panel is within the viewport — if a persisted rect put it off-screen, a
  // double-click would "do nothing" (panel opens where you can't see it). Snap it back.
  function ensureOnScreen() {
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight;
    if (r.left < 0 || r.top < 40 || r.left > W - 60 || r.top > H - 60 || r.width < 40 || r.height < 40) {
      panel.style.left = Math.max(40, W - 360) + "px";
      panel.style.top = "72px";
    }
  }
  function toggle() { setOpen(!open); }

  window.PatronProps = { toggle, setOpen, isOpen: () => open, populate, panel: () => panel,
                         openBlock: openBlockPanel,   // double-click → this block's dedicated panel
                         mcpPanel: () => mcpPanel, mcpRect: mcpRectNow,
                         tplPanel: () => tplPanel, tplRect: tplRectNow,
                         // Seams for bespoke per-block panels (e.g. the tabbed Agent config in
                         // js/agent-config-panel.js): reuse the SAME field renderers/pickers.
                         field: fieldForSchema,
                         catalogFor: (t) => (CATALOG && CATALOG[t]) || null,
                         preresolve: preresolveRefs,
                         // A bespoke panel that owns a whole property (the ingestion
                         // pipeline JSON) needs the same write path as a field: set,
                         // sync the canvas widget, refit, dirty, autosave.
                         commit: commitValue,
                         addManagement: addManagementRow };

  ready((app) => {
    const canvas = app.canvas;
    loadCatalog();    // fetch the block field metadata (controls) up front
    loadResources();  // fetch the resource catalog (descriptors) for generic resource-ref pickers
    // Deleting a block closes its Configuration panel too (graph.remove → onNodeRemoved).
    if (app.graph) {
      const prevRemoved = app.graph.onNodeRemoved;
      app.graph.onNodeRemoved = function (node) {
        if (prevRemoved) prevRemoved.call(this, node);
        if (node) closeBlockPanelFor(node.id);
      };
    }
    if (app.menuBar) {
      app.menuBar.registerCommand("view.properties", toggle);
      app.menuBar.setContext("propsVisible", false);
      if (app.menuBar.refresh) app.menuBar.refresh();
    }
    // Double-click a node -> open ITS dedicated panel.
    const prevDbl = canvas.onNodeDblClicked;
    canvas.onNodeDblClicked = function (node) {
      if (prevDbl) prevDbl.call(this, node);
      openBlockPanel(node);
    };
    // litegraph only fires processNodeDblClicked when the node is ALREADY selected
    // (litegraph.js: `is_double_click && this.selected_nodes[node.id]`), so a first double-click
    // on an unselected node does nothing. Bind a raw DOM dblclick on the canvas that hit-tests
    // the node under the cursor and opens its panel regardless of selection state. Reliable.
    const cv = canvas.canvas || document.getElementById("graph-canvas");
    if (cv && !cv._patronDbl) {
      cv._patronDbl = true;
      cv.addEventListener("dblclick", function (e) {
        try {
          const g = window.PatronApp.graph;
          const pos = canvas.convertEventToCanvasOffset(e);
          const node = g.getNodeOnPos(pos[0], pos[1], canvas.visible_nodes);
          if (node) {
            e.preventDefault(); e.stopPropagation();
            if (canvas.selectNode) canvas.selectNode(node);
            openBlockPanel(node);
          }
        } catch (err) { /* never let a hit-test error break the editor */ }
      }, true);
    }
    // Visibility/position restore is driven by app.js applyWorkspace (it has the workspace
    // data and calls PatronProps.restore() after the async load) — see PatronProps.restore.
  });

  // The block panel opens ONLY on double-click — never auto-opened on startup (that produced a
  // stray empty "Block" panel). No-op kept so app.js applyWorkspace can still call it safely.
  window.PatronProps.restore = function () { /* intentionally does nothing */ };
})();
