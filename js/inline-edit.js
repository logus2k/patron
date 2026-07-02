/*
 * inline-edit.js — in-place widget editing is fully DISABLED. Every field is edited only
 * through the Properties panel (js/props-panel.js).
 *
 * litegraph edits widget values in place inside LGraphCanvas.prototype.processNodeWidgets
 * (number arrows/drag, combo dropdown, toggle flip, text prompt). We override that method
 * to intercept any click that lands on a widget and open the Properties panel on that node
 * instead of mutating the value — so the panel is the single, consistent editor.
 *
 * Prototype override only (no edits to vendored litegraph.js). Loaded after litegraph.js.
 */
(function () {
  "use strict";
  if (typeof LGraphCanvas === "undefined") return;

  // NOTE: single-click no longer opens any panel. Editing happens in the block's own panel,
  // opened by DOUBLE-clicking the block (see props-panel.js). Clicking a widget here only
  // selects the node and blocks litegraph's in-place value editing.

  LGraphCanvas.prototype.processNodeWidgets = function (node, pos, event, active_widget) {
    if (!node.widgets || !node.widgets.length ||
        (!this.allow_interaction && !node.flags.allow_interaction)) {
      return null;
    }
    const x = pos[0] - node.pos[0];
    const y = pos[1] - node.pos[1];
    const width = node.size[0];
    const downType = (LiteGraph.pointerevents_method || "mouse") + "down";
    for (const w of node.widgets) {
      if (!w || w.disabled) continue;
      const wh = w.computeSize ? w.computeSize(width)[1] : (LiteGraph.NODE_WIDGET_HEIGHT || 20);
      const ww = w.width || width;
      // same hit-test litegraph uses to decide the pointer is on this widget
      if (x < 6 || x > ww - 12 || w.last_y === undefined || y < w.last_y || y > w.last_y + wh) {
        continue;
      }
      // A widget is under the pointer. Only select the node; NEVER edit in place (and no
      // panel on single click — editing is via double-click on the block).
      if (event.type === downType) {
        if (this.selectNode) this.selectNode(node);
      }
      return w; // consume the interaction so litegraph doesn't edit or drag from the widget
    }
    return null;
  };

  // Safety net: kill litegraph's inline value prompt entirely (no in-place editing).
  LGraphCanvas.prototype.prompt = function () { return null; };
})();
