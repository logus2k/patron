/*
 * link-menu.js — Patron-owned context menu for connection links.
 *
 * litegraph's native link menu (showLinkMenu → LiteGraph.ContextMenu) renders as a
 * collapsed thin line inside Patron, so we override showLinkMenu with our own themed,
 * self-rendered menu (it does NOT use LiteGraph.ContextMenu, so it always shows).
 *
 * Clicking the dot at a link's midpoint opens:
 *   - "Insert node ▸" → drills into the agent palette; creates the chosen node at the
 *                       link midpoint and rewires  left → node → right  (this is how a
 *                       Transform/adapter block gets dropped onto a connection).
 *   - "Delete link"   → removes the link.
 *
 * Reaches the canvas via window.PatronApp; the node list via window.PatronAgentNodes.
 */
(function () {
  "use strict";

  let menuEl = null;

  function closeMenu() {
    if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
    menuEl = null;
    document.removeEventListener("pointerdown", onDocDown, true);
    document.removeEventListener("keydown", onKey, true);
  }
  function onDocDown(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
  function onKey(e) { if (e.key === "Escape") closeMenu(); }

  function makeMenu() {
    const el = document.createElement("div");
    el.style.cssText =
      "position:fixed;z-index:100001;min-width:172px;padding:5px;" +
      "background:var(--panel,#fff);color:var(--text,#1f2328);" +
      "border:1px solid var(--panel-border,#d0d7de);border-radius:8px;" +
      "box-shadow:0 6px 22px rgba(0,0,0,.22);" +
      "font:13px 'Roboto',system-ui,-apple-system,sans-serif;user-select:none";
    return el;
  }
  function row(label, opts) {
    opts = opts || {};
    const r = document.createElement("div");
    r.style.cssText =
      "padding:6px 10px;border-radius:6px;cursor:pointer;white-space:nowrap;" +
      "display:flex;align-items:center;justify-content:space-between;gap:14px;" +
      (opts.danger ? "color:#c0392b;" : "");
    const t = document.createElement("span");
    t.textContent = label;
    r.appendChild(t);
    if (opts.caret) { const c = document.createElement("span"); c.textContent = opts.caret; c.style.opacity = ".55"; r.appendChild(c); }
    r.addEventListener("mouseenter", () => (r.style.background = "var(--bg,#f0f3f7)"));
    r.addEventListener("mouseleave", () => (r.style.background = "transparent"));
    if (opts.onClick) r.addEventListener("click", (e) => { e.stopPropagation(); opts.onClick(); });
    return r;
  }

  // The palette node types (agent blocks + destinations), as {type, label}.
  function paletteItems() {
    const P = window.PatronAgentNodes, out = [];
    if (P && P.PALETTE && P.PALETTE.items) out.push.apply(out, P.PALETTE.items);
    if (P && P.DESTINATIONS && P.DESTINATIONS.items) out.push.apply(out, P.DESTINATIONS.items);
    return out;
  }

  function place(clientX, clientY) {
    const r = menuEl.getBoundingClientRect();
    let x = clientX, y = clientY;
    if (x + r.width > window.innerWidth) x = window.innerWidth - r.width - 6;
    if (y + r.height > window.innerHeight) y = window.innerHeight - r.height - 6;
    menuEl.style.left = Math.max(6, x) + "px";
    menuEl.style.top = Math.max(6, y) + "px";
  }

  function ready(cb) {
    if (window.LGraphCanvas && window.PatronApp && window.PatronApp.canvas) return cb();
    setTimeout(() => ready(cb), 150);
  }

  ready(function () {
    const LGraphCanvas = window.LGraphCanvas;

    LGraphCanvas.prototype.showLinkMenu = function (link, e) {
      const canvas = this, graph = this.graph;
      const nodeL = graph.getNodeById(link.origin_id);
      const nodeR = graph.getNodeById(link.target_id);
      const fromType = nodeL && nodeL.outputs && nodeL.outputs[link.origin_slot] ? nodeL.outputs[link.origin_slot].type : 0;
      const destType = nodeR && nodeR.inputs && nodeR.inputs[link.target_slot] ? nodeR.inputs[link.target_slot].type : 0;
      const center = link._pos ? [link._pos[0], link._pos[1]] : null;
      const at = { x: e ? e.clientX : 200, y: e ? e.clientY : 200 };

      // Create `typeId`, drop it at the link midpoint, and rewire left → node → right.
      // Mirrors litegraph's own showLinkMenu "Add Node" wiring (connectByType both ends).
      function insertNode(typeId) {
        const node = LiteGraph.createNode(typeId);
        if (!node) return;
        graph.add(node);
        if (center) node.pos = [center[0] - node.size[0] * 0.5, center[1] - node.size[1] * 0.5];
        if (nodeL && node.inputs && node.inputs.length && nodeR) {
          if (nodeL.connectByType(link.origin_slot, node, fromType)) {
            node.connectByType(link.target_slot, nodeR, destType);
          }
        }
        canvas.setDirty(true, true);
        if (window.PatronApp && window.PatronApp.scheduleSave) window.PatronApp.scheduleSave();
      }

      function showRoot() {
        closeMenu();
        menuEl = makeMenu();
        menuEl.appendChild(row("Insert node", { caret: "▸", onClick: showInsert }));
        const sep = document.createElement("div");
        sep.style.cssText = "height:1px;background:var(--panel-border,#d0d7de);margin:4px 2px";
        menuEl.appendChild(sep);
        menuEl.appendChild(row("Delete link", {
          danger: true,
          onClick: () => { graph.removeLink(link.id); canvas.setDirty(true, true); closeMenu();
            if (window.PatronApp && window.PatronApp.scheduleSave) window.PatronApp.scheduleSave(); },
        }));
        document.body.appendChild(menuEl);
        place(at.x, at.y);
        document.addEventListener("pointerdown", onDocDown, true);
        document.addEventListener("keydown", onKey, true);
      }

      function showInsert() {
        closeMenu();
        menuEl = makeMenu();
        menuEl.appendChild(row("‹ Back", { onClick: showRoot }));
        const sep = document.createElement("div");
        sep.style.cssText = "height:1px;background:var(--panel-border,#d0d7de);margin:4px 2px";
        menuEl.appendChild(sep);
        const items = paletteItems();
        if (!items.length) menuEl.appendChild(row("(no node types)", {}));
        for (const it of items) {
          menuEl.appendChild(row(it.label, { onClick: () => { insertNode(it.type); closeMenu(); } }));
        }
        document.body.appendChild(menuEl);
        place(at.x, at.y);
        document.addEventListener("pointerdown", onDocDown, true);
        document.addEventListener("keydown", onKey, true);
      }

      showRoot();
      return false; // suppress litegraph's own menu
    };
  });
})();
