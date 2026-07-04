/*
 * node-resize.js — edge-resize: WIDTH from a node's LEFT/RIGHT edges + HEIGHT from its BOTTOM
 * edge, with matching hover cursors, and a fix for litegraph's "crosshair" hover cursor (#3) → "move".
 *
 * Why a separate module loaded BEFORE app.js: litegraph pre-binds its mouse handlers at
 * canvas construction (litegraph.js ~5715 `this.processMouseDown.bind(this)`), so we must
 * override the prototype methods *before* `new LGraphCanvas` runs (app.js) for the bind to
 * capture our versions. No vendor edits.
 *
 * Resize zones:
 *   - WIDTH from the left/right edges (ew-resize); the right edge stays pinned when dragging left.
 *   - HEIGHT from the bottom edge (ns-resize). The TOP edge is the title bar (used for dragging),
 *     so vertical resize is bottom-only. Height is clamped to >= content (never shorter).
 *   - Input/output slots sit on the L/R edges, so we exclude slot hit-zones (getSlotInPosition)
 *     to avoid hijacking connection drags.
 *   - Both dimensions are clamped by the node's own onResize (setSize → onResize) in agent_nodes.js.
 */
(function () {
  "use strict";

  if (typeof LGraphCanvas === "undefined") { console.error("node-resize.js: LGraphCanvas missing (load after litegraph.js, before app.js)"); return; }

  const EDGE_PX = 8;            // screen-px hot-zone around a node's left/right border
  let active = null;           // { lgc, node, mode:'l'|'r', fixedRight } while resizing

  function edgePx(lgc) { return EDGE_PX / (lgc.ds ? lgc.ds.scale : 1); }

  // Returns 'l' | 'r' | 'b' | null for the left/right (width) or bottom (height) resize zone at
  // graph point (x,y) on node. Excludes the title (move) and any slot hit-zone (connect).
  function edgeZone(lgc, node, x, y) {
    if (!node || node.resizable === false || (node.flags && node.flags.collapsed)) return null;
    if (node.getSlotInPosition && node.getSlotInPosition(x, y)) return null; // it's a slot → connect
    const e = edgePx(lgc);
    // left/right edges (WIDTH) — within the body height only, not the title
    const inBodyY = y > node.pos[1] && y < node.pos[1] + node.size[1];
    if (inBodyY) {
      if (Math.abs(x - node.pos[0]) < e) return "l";
      if (Math.abs(x - (node.pos[0] + node.size[0])) < e) return "r";
    }
    // bottom edge (HEIGHT) — within the node's horizontal span
    const inX = x > node.pos[0] - e && x < node.pos[0] + node.size[0] + e;
    if (inX && Math.abs(y - (node.pos[1] + node.size[1])) < e) return "b";
    return null;
  }

  function applyResize(ev) {
    const lgc = active.lgc, node = active.node;
    const co = lgc.convertEventToCanvasOffset(ev);
    const min = node.computeSize();
    if (active.mode === "l") {
      const w = Math.max(min[0], active.fixedRight - co[0]);
      node.setSize([w, node.size[1]]);                  // onResize clamps width
      node.pos[0] = active.fixedRight - node.size[0];   // keep the right edge pinned
    } else if (active.mode === "r") {
      const w = Math.max(min[0], co[0] - node.pos[0]);
      node.setSize([w, node.size[1]]);
    } else { // "b" — HEIGHT from the bottom edge
      const h = Math.max(min[1], co[1] - node.pos[1]);
      node.setSize([node.size[0], h]);                  // onResize clamps height to >= content
    }
    lgc.setDirty(true, true);
    ev.preventDefault();
  }
  function endResize() {
    window.removeEventListener("pointermove", applyResize, true);
    window.removeEventListener("pointerup", endResize, true);
    const lgc = active.lgc, node = active.node, mode = active.mode;
    active = null;
    if (lgc.canvas) lgc.canvas.style.cursor = mode === "b" ? "ns-resize" : "ew-resize";
    if (lgc.graph && lgc.graph.afterChange) lgc.graph.afterChange(node);
    if (window.PatronApp && window.PatronApp.scheduleSave) window.PatronApp.scheduleSave();
  }
  function startResize(lgc, node, mode) {
    if (lgc.graph && lgc.graph.beforeChange) lgc.graph.beforeChange();
    active = { lgc, node, mode, fixedRight: node.pos[0] + node.size[0] };
    if (lgc.canvas) lgc.canvas.style.cursor = mode === "b" ? "ns-resize" : "ew-resize";
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
    if (active) { this.canvas.style.cursor = active.mode === "b" ? "ns-resize" : "ew-resize"; return r; }
    if (this.node_dragged) { this.canvas.style.cursor = "move"; return r; }
    if (!this.connecting_node && !this.dragging_canvas && this.graph) {
      const node = this.graph.getNodeOnPos(e.canvasX, e.canvasY, this.visible_nodes);
      if (node) {
        const onSlot = node.getSlotInPosition && node.getSlotInPosition(e.canvasX, e.canvasY);
        const zone = onSlot ? null : edgeZone(this, node, e.canvasX, e.canvasY);
        if (onSlot) {
          this.canvas.style.cursor = "crosshair";              // slot → connect affordance
        } else if (zone) {
          this.canvas.style.cursor = zone === "b" ? "ns-resize" : "ew-resize"; // bottom → height, L/R → width
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
