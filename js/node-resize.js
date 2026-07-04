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

  const EDGE_PX = 8;            // screen-px hot-zone around a node's left/right/bottom border
  const CORNER_PX = 16;        // bigger hot-zone at the bottom CORNERS (diagonal both-dim resize)
  let active = null;           // { lgc, node, mode:'l'|'r'|'b'|'br'|'bl', fixedRight } while resizing

  function edgePx(lgc) { return EDGE_PX / (lgc.ds ? lgc.ds.scale : 1); }
  function cornerPx(lgc) { return CORNER_PX / (lgc.ds ? lgc.ds.scale : 1); }

  // The cursor for a resize mode: single-axis edges get ew/ns; the bottom corners get the
  // diagonal ↘ (nwse for bottom-RIGHT) / ↙ (nesw for bottom-LEFT).
  function cursorFor(mode) {
    if (mode === "b") return "ns-resize";
    if (mode === "br") return "nwse-resize";
    if (mode === "bl") return "nesw-resize";
    return "ew-resize"; // 'l' | 'r'
  }

  // Returns 'br' | 'bl' | 'l' | 'r' | 'b' | null for the bottom-corner (both dims) / left-right
  // (width) / bottom (height) resize zone at graph point (x,y) on node. Corners are checked FIRST
  // and use a bigger radius, so grabbing a corner is easy and wins over the single-axis edges.
  // Excludes the title (move) and any slot hit-zone (connect). Top corners = the drag title bar.
  function edgeZone(lgc, node, x, y) {
    if (!node || node.resizable === false || (node.flags && node.flags.collapsed)) return null;
    if (node.getSlotInPosition && node.getSlotInPosition(x, y)) return null; // it's a slot → connect
    const e = edgePx(lgc), c = cornerPx(lgc);
    const left = node.pos[0], right = node.pos[0] + node.size[0];
    const top = node.pos[1], bottom = node.pos[1] + node.size[1];
    // Bottom CORNERS first (diagonal, resize WIDTH + HEIGHT) — a generous square around each corner.
    if (y > top && Math.abs(y - bottom) < c) {
      if (Math.abs(x - right) < c) return "br";
      if (Math.abs(x - left) < c) return "bl";
    }
    // left/right edges (WIDTH) — within the body height only, not the title
    if (y > top && y < bottom) {
      if (Math.abs(x - left) < e) return "l";
      if (Math.abs(x - right) < e) return "r";
    }
    // bottom edge (HEIGHT) — within the node's horizontal span
    if (x > left - e && x < right + e && Math.abs(y - bottom) < e) return "b";
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
    } else if (active.mode === "b") {                   // HEIGHT from the bottom edge
      const h = Math.max(min[1], co[1] - node.pos[1]);
      node.setSize([node.size[0], h]);                  // onResize clamps height to >= content
    } else if (active.mode === "br") {                  // bottom-RIGHT corner — width + height
      const w = Math.max(min[0], co[0] - node.pos[0]);
      const h = Math.max(min[1], co[1] - node.pos[1]);
      node.setSize([w, h]);
    } else {                                            // "bl" — bottom-LEFT corner — width (pin right) + height
      const w = Math.max(min[0], active.fixedRight - co[0]);
      const h = Math.max(min[1], co[1] - node.pos[1]);
      node.setSize([w, h]);
      node.pos[0] = active.fixedRight - node.size[0];   // keep the right edge pinned
    }
    lgc.setDirty(true, true);
    ev.preventDefault();
  }
  function endResize() {
    window.removeEventListener("pointermove", applyResize, true);
    window.removeEventListener("pointerup", endResize, true);
    const lgc = active.lgc, node = active.node, mode = active.mode;
    active = null;
    if (lgc.canvas) lgc.canvas.style.cursor = cursorFor(mode);
    if (lgc.graph && lgc.graph.afterChange) lgc.graph.afterChange(node);
    if (window.PatronApp && window.PatronApp.scheduleSave) window.PatronApp.scheduleSave();
  }
  function startResize(lgc, node, mode) {
    if (lgc.graph && lgc.graph.beforeChange) lgc.graph.beforeChange();
    active = { lgc, node, mode, fixedRight: node.pos[0] + node.size[0] };
    if (lgc.canvas) lgc.canvas.style.cursor = cursorFor(mode);
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
    if (active) { this.canvas.style.cursor = cursorFor(active.mode); return r; }
    if (this.node_dragged) { this.canvas.style.cursor = "move"; return r; }
    if (!this.connecting_node && !this.dragging_canvas && this.graph) {
      const node = this.graph.getNodeOnPos(e.canvasX, e.canvasY, this.visible_nodes);
      if (node) {
        const onSlot = node.getSlotInPosition && node.getSlotInPosition(e.canvasX, e.canvasY);
        const zone = onSlot ? null : edgeZone(this, node, e.canvasX, e.canvasY);
        if (onSlot) {
          this.canvas.style.cursor = "crosshair";              // slot → connect affordance
        } else if (zone) {
          this.canvas.style.cursor = cursorFor(zone); // corners → diagonal, bottom → height, L/R → width
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
