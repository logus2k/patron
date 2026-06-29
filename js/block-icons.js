/*
 * block-icons.js — per-block icons in the clean Lucide/Feather LINE style used by tutor's
 * sidebar (fill:none, stroke:currentColor, 2px round strokes). Used in two places:
 *   1) the node's title-box (canvas) via onDrawTitleBox — stroked WHITE for the title bar,
 *   2) the toolbox palette item (DOM) — stroked in the block's COLOR.
 *
 * Each entry is just the icon geometry (paths); svgString wraps it in the shared line-icon
 * <svg> and sets the color. Exposes window.PatronIcons.
 */
(function (global) {
  "use strict";

  // type id -> { color (toolbox tint), paths (Lucide-style geometry, no fill/stroke attrs) }
  const ICONS = {
    "patron/agent/trigger":   { color: "#e8a33d", paths: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>' },                                                                 // zap — fires
    "patron/agent/rag":       { color: "#4a90d9", paths: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' },                                                  // search — retrieval
    "patron/agent/brain":     { color: "#9b59b6", paths: '<path d="M9 4a2.5 2.5 0 0 0-2.5 2.5A2.5 2.5 0 0 0 4 9a2.5 2.5 0 0 0 1 2 2.5 2.5 0 0 0-.5 3.5A2.5 2.5 0 0 0 7 19a2 2 0 0 0 4 0V5a1 1 0 0 0-2-1z"/><path d="M15 4a2.5 2.5 0 0 1 2.5 2.5A2.5 2.5 0 0 1 20 9a2.5 2.5 0 0 1-1 2 2.5 2.5 0 0 1 .5 3.5A2.5 2.5 0 0 1 17 19a2 2 0 0 1-4 0V5a1 1 0 0 1 2-1z"/>' }, // brain
    "patron/agent/tools":     { color: "#e67e22", paths: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>' }, // wrench
    "patron/agent/guardrail": { color: "#e74c3c", paths: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },                                                                       // shield
    "patron/agent/deliver":   { color: "#13a08a", paths: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>' },                                           // send
    "patron/dest/whatsapp":   { color: "#25d366", paths: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' }, // chat bubble
    "patron/dest/tts":        { color: "#8e44ad", paths: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>' }, // volume
    "patron/dest/bus":        { color: "#5a6f8c", paths: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>' }, // repeat
  };

  // The shared line-icon wrapper (tutor's exact style). color defaults to the block tint;
  // pass "#fff" for the colored title bar.
  function svgString(type, size, color) {
    const ic = ICONS[type];
    if (!ic) return "";
    const s = size || 24;
    const col = color || ic.color;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" style="color:' + col + '">' + ic.paths + "</svg>";
  }

  // Preloaded WHITE <img> per type for canvas drawing (reads on the colored title bar).
  const images = {};
  function image(type) {
    if (!ICONS[type]) return null;
    if (images[type]) return images[type];
    const img = new Image();
    img._ready = false;
    img.onload = function () {
      img._ready = true;
      if (global.PatronApp && global.PatronApp.canvas && global.PatronApp.canvas.setDirty) {
        global.PatronApp.canvas.setDirty(true, true);
      }
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString(type, 24, "#ffffff"));
    images[type] = img;
    return img;
  }

  // Draw the (white) line icon where litegraph would draw the title box. ctx is translated
  // to the node origin; the title bar is above (negative y). Called from onDrawTitleBox.
  function drawTitleBox(ctx, type, title_height) {
    const img = image(type);
    if (!img || !img._ready) return;
    const s = 18;
    ctx.drawImage(img, title_height * 0.5 - s * 0.5, title_height * -0.5 - s * 0.5, s, s);
  }

  global.PatronIcons = {
    has: (t) => !!ICONS[t],
    svgString: svgString,
    image: image,
    drawTitleBox: drawTitleBox,
  };
})(window);
