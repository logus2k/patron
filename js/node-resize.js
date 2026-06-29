/*
 * node-resize.js — edge resize cursors + width-resize from a node's LEFT/RIGHT edge,
 * and a fix for litegraph's "crosshair" hover cursor (#3) → "move".
 *
 * Why a separate module loaded BEFORE app.js: litegraph pre-binds its mouse handlers at
 * canvas construction (litegraph.js ~5715 `this.processMouseDown.bind(this)`), so we must
 * override the prototype methods *before* `new LGraphCanvas` runs (app.js) for the bind to
 * capture our versions. No vendor edits.
 *
 * Constraints honoured:
 *   - Height is LOCKED to content (agent_nodes.js), so only WIDTH resizes — cursors go on
 *     the left/right edges only; the body shows "move" (draggable), never a crosshair.
 *   - Input/output slots sit on those same edges, so we exclude slot hit-zones
 *     (getSlotInPosition) to avoid hijacking connection drags.
 *   - Width is clamped to [contentWidth, MAX_W] by the node's own onResize (setSize → onResize).
 */
(function () {
  "use strict";

  if (typeof LGraphCanvas === "undefined") { console.error("node-resize.js: LGraphCanvas missing (load after litegraph.js, before app.js)"); return; }

  const EDGE_PX = 8;            // screen-px hot-zone around a node's left/right border
  let active = null;           // { lgc, node, mode:'l'|'r', fixedRight } while resizing

  function edgePx(lgc) { return EDGE_PX / (lgc.ds ? lgc.ds.scale : 1); }

  // Returns 'l' | 'r' | null for the left/right resize zone at graph point (x,y) on node.
  // Excludes the title (move) and any slot hit-zone (connect).
  function edgeZone(lgc, node, x, y) {
    if (!node || node.resizable === false || (node.flags && node.flags.collapsed)) return null;
    if (node.getSlotInPosition && node.getSlotInPosition(x, y)) return null; // it's a slot → connect
    const inY = y > node.pos[1] && y < node.pos[1] + node.size[1];          // body only, not title
    if (!inY) return null;
    const e = edgePx(lgc);
    if (Math.abs(x - node.pos[0]) < e) return "l";
    if (Math.abs(x - (node.pos[0] + node.size[0])) < e) return "r";
    return null;
  }

  function applyResize(ev) {
    const lgc = active.lgc, node = active.node;
    const co = lgc.convertEventToCanvasOffset(ev);
    const min = node.computeSize();
    if (active.mode === "l") {
      const w = Math.max(min[0], active.fixedRight - co[0]);
      node.setSize([w, node.size[1]]);                  // onResize clamps width + locks height
      node.pos[0] = active.fixedRight - node.size[0];   // keep the right edge pinned
    } else {
      const w = Math.max(min[0], co[0] - node.pos[0]);
      node.setSize([w, node.size[1]]);
    }
    lgc.setDirty(true, true);
    ev.preventDefault();
  }
  function endResize() {
    window.removeEventListener("pointermove", applyResize, true);
    window.removeEventListener("pointerup", endResize, true);
    const lgc = active.lgc, node = active.node;
    active = null;
    if (lgc.canvas) lgc.canvas.style.cursor = "ew-resize";
    if (lgc.graph && lgc.graph.afterChange) lgc.graph.afterChange(node);
    if (window.PatronApp && window.PatronApp.scheduleSave) window.PatronApp.scheduleSave();
  }
  function startResize(lgc, node, mode) {
    if (lgc.graph && lgc.graph.beforeChange) lgc.graph.beforeChange();
    active = { lgc, node, mode, fixedRight: node.pos[0] + node.size[0] };
    if (lgc.canvas) lgc.canvas.style.cursor = "ew-resize";
    window.addEventListener("pointermove", applyResize, true);
    window.addEventListener("pointerup", endResize, true);
  }

  function inTitle(node, y) {
    const h = LiteGraph.NODE_TITLE_HEIGHT || 30;
    return y < node.pos[1] && y >= node.pos[1] - h; // the title bar sits above the body
  }

  const _down = LGraphCanvas.prototype.processMouseDown;
  LGraphCanvas.prototype.processMouseDown = function (e) {
    if (this.allow_interaction && !this.read_only && !this.connecting_node && this.graph && this.canvas) {
      const co = this.convertEventToCanvasOffset(e); // original hasn't set e.canvasX yet
      const node = this.graph.getNodeOnPos(co[0], co[1], this.visible_nodes);
      const zone = edgeZone(this, node, co[0], co[1]);
      if (zone) {
        startResize(this, node, zone);
        e.preventDefault();
        e.stopPropagation();
        return false; // block litegraph's node-move / its own corner-resize
      }
    }
    const r = _down.apply(this, arguments);
    // A node is draggable ONLY by its title bar — cancel a body-initiated drag.
    if (this.node_dragged) {
      const y = e.canvasY != null ? e.canvasY : this.convertEventToCanvasOffset(e)[1];
      if (!inTitle(this.node_dragged, y)) this.node_dragged = null;
    }
    return r;
  };

  const _move = LGraphCanvas.prototype.processMouseMove;
  LGraphCanvas.prototype.processMouseMove = function (e) {
    const r = _move.apply(this, arguments); // litegraph sets e.canvasX/Y + its own cursor
    if (!this.canvas) return r;
    if (active) { this.canvas.style.cursor = "ew-resize"; return r; }
    if (this.node_dragged) { this.canvas.style.cursor = "move"; return r; }
    if (!this.connecting_node && !this.dragging_canvas && this.graph) {
      const node = this.graph.getNodeOnPos(e.canvasX, e.canvasY, this.visible_nodes);
      if (node) {
        if (node.getSlotInPosition && node.getSlotInPosition(e.canvasX, e.canvasY)) {
          this.canvas.style.cursor = "crosshair";              // slot → connect affordance
        } else if (edgeZone(this, node, e.canvasX, e.canvasY)) {
          this.canvas.style.cursor = "ew-resize";              // L/R edge → resize width
        } else if (inTitle(node, e.canvasY)) {
          this.canvas.style.cursor = "move";                   // title bar → draggable
        } else {
          this.canvas.style.cursor = "default";                // body → not draggable
        }
      }
    }
    return r;
  };
})();
