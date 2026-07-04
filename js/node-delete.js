/*
 * node-delete.js — a hover-only "×" in the top-right of every block's title bar that
 * removes the block from the canvas. Removal asks for confirmation UNLESS the block is
 * still pristine (identical to a freshly-created block of its type → "no changes").
 *
 * Self-contained, like node-resize.js: it wraps the LGraphCanvas mouse-handler PROTOTYPES
 * (so it must load AFTER litegraph.js and node-resize.js, BEFORE app.js, for litegraph's
 * constructor-time bind to capture our versions) and lazily attaches the per-frame draw
 * hook to the canvas INSTANCE (the constructor sets instance.onDrawForeground = null, so a
 * prototype hook would be shadowed — we attach on the first mouse event instead, chaining
 * any existing hook). No vendored edits; no app.js changes.
 *
 * Drawn in graph space via canvas.onDrawForeground (litegraph.js ~8089, under the ds
 * transform), so the "×" tracks pan/zoom.
 */
(function (global) {
  "use strict";

  if (typeof LGraphCanvas === "undefined") {
    console.error("node-delete.js: LGraphCanvas missing (load after litegraph.js, before app.js)");
    return;
  }

  const HIT = 9;    // half-size of the clickable "×" hot-zone (graph px @ scale 1)
  const INSET = 13; // "×" center distance from the node's RIGHT edge
  const ARM = 3.4;  // half-length of each stroke of the glyph

  function titleH(node) {
    return node.title_height || (LiteGraph.NODE_TITLE_HEIGHT || 24);
  }
  function btnCenter(node) {
    return [node.pos[0] + node.size[0] - INSET, node.pos[1] - titleH(node) * 0.5];
  }
  function deletable(node) {
    return !!node && node.removable !== false && !(node.flags && node.flags.collapsed);
  }
  function onDeleteBtn(node, x, y) {
    if (!deletable(node)) return false;
    const c = btnCenter(node);
    return Math.abs(x - c[0]) <= HIT && Math.abs(y - c[1]) <= HIT;
  }

  // "No changes" = the block's config equals a freshly-created block of the same type.
  // (Node defaults in agent_nodes.js are deterministic, so two fresh nodes compare equal.)
  function sig(node) {
    const widgets = (node.widgets || []).map((w) => w.value);
    return JSON.stringify({ p: node.properties || {}, w: widgets });
  }
  function isPristine(node) {
    let fresh;
    try { fresh = LiteGraph.createNode(node.type); } catch (e) { return false; }
    return !!fresh && sig(node) === sig(fresh);
  }

  function removeNode(lgc, node) {
    if (!lgc.graph) return;
    if (lgc.graph.beforeChange) lgc.graph.beforeChange();
    lgc.graph.remove(node);
    if (lgc.graph.afterChange) lgc.graph.afterChange();
    if (lgc._delHover === node) lgc._delHover = null;
    lgc.setDirty(true, true);
    if (global.PatronApp && global.PatronApp.scheduleSave) global.PatronApp.scheduleSave();
  }

  function requestDelete(lgc, node) {
    if (isPristine(node)) { removeNode(lgc, node); return; }
    const name = (node.getTitle ? node.getTitle() : node.title) || node.type;
    const opts = {
      title: "Remove block",
      message: 'Remove "' + name + '" from the canvas?\nThis block has changes that will be lost.',
      okLabel: "Remove",
      danger: true,
    };
    if (global.PatronDialogs && global.PatronDialogs.confirm) {
      global.PatronDialogs.confirm(opts).then((ok) => { if (ok) removeNode(lgc, node); });
    } else if (global.confirm(opts.message)) {
      removeNode(lgc, node); // fallback if the in-app dialogs aren't loaded
    }
  }

  // Lazily install the per-frame draw hook on the canvas instance (chaining any existing one).
  function attach(lgc) {
    if (lgc._delAttached) return;
    lgc._delAttached = true;
    const prev = lgc.onDrawForeground;
    lgc.onDrawForeground = function (ctx, rect) {
      if (prev) prev.call(this, ctx, rect);
      const node = this._delHover;
      if (!node || !node.graph || !deletable(node)) return;
      const c = btnCenter(node);
      ctx.save();
      ctx.beginPath();
      ctx.arc(c[0], c[1], HIT, 0, Math.PI * 2);
      ctx.fillStyle = this._delBtnHot ? "rgba(220,60,50,0.95)" : "rgba(0,0,0,0.28)";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(c[0] - ARM, c[1] - ARM); ctx.lineTo(c[0] + ARM, c[1] + ARM);
      ctx.moveTo(c[0] + ARM, c[1] - ARM); ctx.lineTo(c[0] - ARM, c[1] + ARM);
      ctx.stroke();
      ctx.restore();
    };
  }

  const _move = LGraphCanvas.prototype.processMouseMove;
  LGraphCanvas.prototype.processMouseMove = function (e) {
    const r = _move.apply(this, arguments);
    attach(this);
    if (this.canvas && this.graph && !this.connecting_node && !this.dragging_canvas) {
      const n = this.graph.getNodeOnPos(e.canvasX, e.canvasY, this.visible_nodes);
      if (n !== this._delHover) { this._delHover = n; this.setDirty(true, true); }
      const hot = n && onDeleteBtn(n, e.canvasX, e.canvasY);
      if (hot !== this._delBtnHot) { this._delBtnHot = hot; this.setDirty(true, true); }
      if (hot) this.canvas.style.cursor = "pointer"; // the "×" reads as a button
    } else if (this._delHover) {
      this._delHover = null; this._delBtnHot = false; this.setDirty(true, true);
    }
    return r;
  };

  const _down = LGraphCanvas.prototype.processMouseDown;
  LGraphCanvas.prototype.processMouseDown = function (e) {
    attach(this);
    if (this.allow_interaction && !this.read_only && this.graph && this.canvas) {
      const co = this.convertEventToCanvasOffset(e);
      const node = this.graph.getNodeOnPos(co[0], co[1], this.visible_nodes);
      if (node && onDeleteBtn(node, co[0], co[1])) {
        e.preventDefault();
        e.stopPropagation();
        requestDelete(this, node);
        return false; // swallow — don't start a title drag / selection
      }
    }
    return _down.apply(this, arguments);
  };
})(window);
