/*
 * props-panel.js — a draggable/resizable Properties panel (jsPanel) for editing the
 * selected node's fields in an HTML form. Behaviour:
 *   - toggled from the View menu ("Properties Panel"),
 *   - opened by DOUBLE-clicking a node (single-click only updates it when already open),
 *   - remembers its position/size across reloads (localStorage),
 *   - mirrors the node's widgets (combo→select, toggle→checkbox, else text); edits sync
 *     back to the node, the canvas widget, the node width, and the autosave.
 *
 * Reaches the canvas + menubar via window.PatronApp (set by app.js).
 */
(function () {
  "use strict";
  const LS_KEY = "patron.props.rect";
  let panel = null, body = null, open = false, lastNode = null;

  function ready(cb) {
    const app = window.PatronApp;
    if (app && app.canvas) return cb(app);
    setTimeout(() => ready(cb), 200);
  }

  function saveRect() {
    if (!panel) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        left: panel.style.left, top: panel.style.top,
        width: panel.style.width, height: panel.style.height,
      }));
    } catch (e) { /* ignore */ }
  }
  function restoreRect() {
    if (!panel) return;
    let r;
    try { r = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) { r = null; }
    if (!r) return;
    if (r.left) panel.style.left = r.left;
    if (r.top) panel.style.top = r.top;
    if (r.width && r.height && typeof panel.resize === "function") {
      try { panel.resize({ width: parseInt(r.width, 10), height: parseInt(r.height, 10) }); }
      catch (e) { panel.style.width = r.width; panel.style.height = r.height; }
    }
  }

  function ensurePanel() {
    if (panel) return;
    if (typeof jsPanel !== "undefined") {
      panel = jsPanel.create({
        headerTitle: "⚙ Properties",
        theme: "none",
        borderRadius: "8px", /* match the litegraph node corner radius (round_radius = 8) */
        border: "1px solid var(--panel-border)",
        panelSize: { width: 300, height: 360 },
        position: { my: "center-top", at: "center-top", offsetX: 0, offsetY: 58 },
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
      restoreRect();
      panel.addEventListener("jspanelmovestop", saveRect);
      panel.addEventListener("jspanelresizestop", saveRect);
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
    cap.textContent = w.name;
    cap.style.cssText = "opacity:.65;font-size:12px";
    wrap.appendChild(cap);

    const commit = (val) => {
      node.properties[w.name] = val;
      w.value = val;
      if (typeof window.PatronFitNodeWidth === "function") window.PatronFitNodeWidth(node);
      if (window.PatronApp.canvas.setDirty) window.PatronApp.canvas.setDirty(true, true);
      if (window.PatronApp.scheduleSave) window.PatronApp.scheduleSave();
    };

    let input;
    if (w.type === "combo" && w.options && Array.isArray(w.options.values)) {
      input = document.createElement("select");
      for (const v of w.options.values) {
        const o = document.createElement("option");
        o.value = v; o.textContent = v;
        input.appendChild(o);
      }
      input.value = w.value;
      input.addEventListener("change", () => commit(input.value));
    } else if (w.type === "toggle") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!w.value;
      input.addEventListener("change", () => commit(input.checked));
    } else {
      const num = w.type === "number";
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

  function populate(node) {
    lastNode = node || lastNode;
    ensurePanel();
    body.innerHTML = "";
    const h = document.createElement("div");
    h.textContent = node ? (node.title || node.type) : "Properties";
    h.style.cssText = "font-weight:600;margin-bottom:10px";
    body.appendChild(h);
    if (!node) {
      const m = document.createElement("div");
      m.textContent = "Select a node to edit its fields.";
      m.style.opacity = ".6";
      body.appendChild(m);
      return;
    }
    if (!node.widgets || !node.widgets.length) {
      const m = document.createElement("div");
      m.textContent = "no editable fields";
      m.style.opacity = ".6";
      body.appendChild(m);
    } else {
      for (const w of node.widgets) body.appendChild(fieldFor(node, w));
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
  }
  function toggle() { setOpen(!open); }

  window.PatronProps = { toggle, setOpen, isOpen: () => open, populate };

  ready((app) => {
    const canvas = app.canvas;
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
  });
})();
