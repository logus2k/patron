/*
 * inline-edit.js — replace litegraph's detached "Value … OK" prompt with an input
 * overlaid directly on the clicked widget row, so editing happens IN the control.
 *
 * Monkey-patches LGraphCanvas.prototype.prompt (no edits to vendored litegraph.js).
 * Combo widgets (dropdowns) use a context menu, not prompt, so they're unaffected.
 * Loaded after vendor/litegraph/litegraph.js.
 */
(function () {
  "use strict";
  if (typeof LGraphCanvas === "undefined") return;

  LGraphCanvas.prototype.prompt = function (title, value, callback, event, multiline) {
    const gc = LGraphCanvas.active_canvas || this;
    const canvas = gc.canvas;
    const rect = canvas.getBoundingClientRect();
    const ds = gc.ds || this.ds || {};
    const scale = ds.scale || 1;
    const off = ds.offset || [0, 0];

    // Place the input over the widget row. The active widget is gc.node_widget
    // ([node, widget]); widget.last_y is the row's y offset from node.pos[1], in graph
    // units. Screen px = (graph + offset) * scale, plus the canvas page offset.
    let left, top, width, height;
    const nw = gc.node_widget;
    const editNode = (nw && nw[0]) || gc.node_over || null; // for re-fitting after edit
    if (nw && nw[0] && nw[1] && typeof nw[1].last_y === "number") {
      const node = nw[0], w = nw[1];
      left = rect.left + (node.pos[0] + 6 + off[0]) * scale;
      top = rect.top + (node.pos[1] + w.last_y + off[1]) * scale;
      width = (node.size[0] - 12) * scale;
      height = (LiteGraph.NODE_WIDGET_HEIGHT || 20) * scale;
    } else if (event) {
      // Fallback: at the click point (still on the widget the user pressed).
      const node = gc.node_over;
      if (node) {
        left = rect.left + (node.pos[0] + 6 + off[0]) * scale;
        width = (node.size[0] - 12) * scale;
      } else {
        left = event.clientX - 70; width = 170;
      }
      top = event.clientY - 11; height = 22;
    } else {
      left = rect.left + 40; top = rect.top + 40; width = 170; height = 22;
    }

    if (this._inlineEdit) this._inlineEdit.remove();

    const el = document.createElement(multiline ? "textarea" : "input");
    if (!multiline) el.type = "text";
    el.value = value == null ? "" : value;
    el.spellcheck = false;
    Object.assign(el.style, {
      position: "fixed",
      left: Math.round(left) + "px",
      top: Math.round(top) + "px",
      width: Math.max(60, Math.round(width)) + "px",
      height: multiline ? Math.max(60, Math.round(height * 4)) + "px"
                        : Math.max(20, Math.round(height)) + "px",
      zIndex: "10000",
      boxSizing: "border-box",
      padding: "1px 10px",
      // Match the widget "pill" so it reads as the value becoming editable in place,
      // not a popup box: light fill, soft rounded, thin accent ring, no shadow.
      background: "#eef2f8",
      color: "#1f2328",
      border: "1px solid #4493f8",
      borderRadius: "8px",
      font: (LiteGraph.NODE_TEXT_SIZE || 13) + "px 'Roboto', system-ui, -apple-system, sans-serif",
      boxShadow: "none",
      outline: "none",
    });
    document.body.appendChild(el);
    this._inlineEdit = el;
    el.focus();
    if (el.select) el.select();

    let done = false;
    const cleanup = () => {
      el.remove();
      if (this._inlineEdit === el) this._inlineEdit = null;
    };
    const commit = () => {
      if (done) return;
      done = true;
      const v = el.value;
      cleanup();
      if (callback) callback(v);
      if (editNode && typeof window.PatronFitNodeWidth === "function") {
        window.PatronFitNodeWidth(editNode); // grow the node if the new value is longer
      }
      gc.dirty_canvas = true;
    };
    const cancel = () => {
      if (done) return;
      done = true;
      cleanup();
    };

    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
      else if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault(); commit();
      }
      e.stopPropagation(); // don't let canvas shortcuts fire while typing
    });
    el.addEventListener("blur", commit);
    // Keep clicks inside the input from reaching the canvas.
    ["pointerdown", "mousedown", "click"].forEach((t) =>
      el.addEventListener(t, (e) => e.stopPropagation()));

    return el;
  };
})();
