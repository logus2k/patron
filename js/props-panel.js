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
          if (open) populate(lastNode);
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
          if (open) populate(lastNode);
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
      mcpPanel.setHeaderTitle('<img src="' + icon + '" width="16" height="16" style="vertical-align:middle;margin-right:7px;position:relative;top:-1px" alt=""><span class="pttxt">' + ((d0 && d0.label) || "Select") + '</span>');
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
        headerTitle: '<img src="icons/chat-bubble-text-square.svg" width="16" height="16" style="vertical-align:middle;margin-right:7px;position:relative;top:-1px" alt=""><span class="pttxt">Template Studio</span>',
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

  function renderTemplateStudio(onApply) {
    if (!tplBody || !tplCtx) return;
    tplBody.innerHTML = "";
    const node = tplCtx.node, key = tplCtx.key;

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
    tplBody.appendChild(bar);
    tplBody.appendChild(ta);

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
    tplBody.appendChild(foot);

    setTimeout(() => ta.focus(), 0);
  }

  function openTemplateStudio(node, key, onApply) {
    tplCtx = { node, key };
    ensureTemplateStudio();
    renderTemplateStudio(onApply);
    if (tplPanel && tplPanel.style) tplPanel.style.display = "";
    if (tplPanel && typeof tplPanel.front === "function") tplPanel.front();
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
        input.appendChild(new Option("— select —", ""));
        const allowFree = !!(desc && desc.allow_free);
        if (allowFree) input.appendChild(new Option("Type an id…", "__type__"));
        const vals = items.map((it) => String(it[idKey]));
        const optFor = (it) => {
          const v = String(it[idKey]);
          const lab = it[labelKey] != null ? String(it[labelKey]) : v;
          return new Option(lab === v ? v : lab + " — " + v, v);
        };
        const groupBy = desc && desc.group_by;
        if (groupBy) {
          const groups = {};
          for (const it of items) { const g = String(it[groupBy] || "other"); (groups[g] = groups[g] || []).push(it); }
          for (const g of Object.keys(groups)) {
            const og = document.createElement("optgroup");
            og.label = g.charAt(0).toUpperCase() + g.slice(1) + "s";
            for (const it of groups[g]) og.appendChild(optFor(it));
            input.appendChild(og);
          }
        } else {
          for (const it of items) input.appendChild(optFor(it));
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
      }
    } else if (control === "template") {
      // The important task-prompt field: an inline textarea for quick edits + a button that
      // opens the Template Studio (a large dedicated editor with {vars} chips).
      input = document.createElement("div");
      input.className = "pp-picker";
      const ta = document.createElement("textarea");
      ta.className = "pp-input pp-area";
      ta.rows = 3;
      ta.value = cur == null ? "" : String(cur);
      if (f.placeholder) ta.placeholder = f.placeholder;
      const paint = () => { ta.value = String(node.properties[f.key] || ""); };
      ta.addEventListener("change", () => commitValue(node, f.key, ta.value));
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pp-btn";
      btn.textContent = "⤢ Open studio…";
      btn.addEventListener("click", () => openTemplateStudio(node, f.key, paint));
      input.appendChild(ta);
      input.appendChild(btn);
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
      if (!desc || !desc.sets || !Object.keys(desc.sets).length) continue;
      const cur = node.properties[f.key];
      if (!cur) continue;
      const items = RESOURCE_ITEMS[f.kind];
      if (!items || !items.length) { loadResourceItems(f.kind); continue; }
      const idKey = desc.identity || "id";
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
      preresolveRefs(node, fields); // fill sibling fields (e.g. target_name) SILENTLY before render
      for (const f of fields) body.appendChild(fieldForSchema(node, f));
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
  // property that identifies the deployed resource (e.g. trigger → scheduler job_id == agent_id).
  const BLOCK_RESOURCE = {
    trigger: { resource: "trigger", keyProp: "agent_id" },
  };
  function addManagementRow(node) {
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
        if (v === "delete" && !window.confirm("Delete " + map.resource + " '" + key + "'?")) return;
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
    body.appendChild(sec);
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
                         mcpPanel: () => mcpPanel, mcpRect: mcpRectNow,
                         tplPanel: () => tplPanel, tplRect: tplRectNow };

  ready((app) => {
    const canvas = app.canvas;
    loadCatalog();    // fetch the block field metadata (controls) up front
    loadResources();  // fetch the resource catalog (descriptors) for generic resource-ref pickers
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
