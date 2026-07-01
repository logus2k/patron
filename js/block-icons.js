/*
 * block-icons.js — per-block icons. Two kinds:
 *   - FILE icons (icons/*.svg): full-color illustrated icons, used as-is (their own colors).
 *   - LUCIDE icons (inline line paths): for blocks with no supplied SVG (rag, guardrail);
 *     recolorable via currentColor (white on the title bar, block color in the toolbox).
 *
 * Used in the node title-box (canvas, via onDrawTitleBox) and the toolbox palette (DOM).
 * Exposes window.PatronIcons.
 */
(function (global) {
  "use strict";

  // Keyed by the composer block kind (== graph node type). New vocabulary only.
  // type id -> { file } (colored svg, as-is) | { color, paths } (recolorable Lucide line)
  const ICONS = {
    "trigger":   { file: "icons/clock-alarm-20.svg" },
    "agent":     { file: "icons/assistant.svg" },
    "transform": { file: "icons/arrow-transfer-horizontal-square.svg" },
    "branch":    { file: "icons/nodes-right.svg" },
    "loop":      { file: "icons/arrow-transfer-horizontal-square.svg" },
    "composite": { file: "icons/table.svg" },
    "whatsapp":  { file: "icons/whatsapp-icon.svg" },
    "tts":       { file: "icons/voice-activation-1.svg" },
    "bus":       { file: "icons/bus.svg" },
  };

  function lucideSvg(paths, size, col) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" style="color:' + col + '">' + paths + "</svg>";
  }

  // DOM markup for the toolbox. File icons → <img> (own colors); Lucide → colored line svg.
  function svgString(type, size, color) {
    const ic = ICONS[type];
    if (!ic) return "";
    const s = Math.round((size || 24) * (ic.scale || 1)); // per-icon scale (some fill their viewBox)
    if (ic.file) return '<img src="' + ic.file + '" width="' + s + '" height="' + s + '" style="display:block" alt="">';
    return lucideSvg(ic.paths, s, color || ic.color);
  }

  // Preloaded <img> per type for canvas drawing (file = own colors; Lucide = white).
  const images = {};
  function image(type) {
    const ic = ICONS[type];
    if (!ic) return null;
    if (images[type]) return images[type];
    const img = new Image();
    img._ready = false;
    img.onload = function () {
      img._ready = true;
      if (global.PatronApp && global.PatronApp.canvas && global.PatronApp.canvas.setDirty) {
        global.PatronApp.canvas.setDirty(true, true);
      }
    };
    img.src = ic.file
      ? ic.file
      : "data:image/svg+xml;charset=utf-8," + encodeURIComponent(lucideSvg(ic.paths, 24, "#ffffff"));
    images[type] = img;
    return img;
  }

  // Draw the icon where litegraph would draw the title box. ctx is translated to the node
  // origin; the title bar is above (negative y). Called from onDrawTitleBox.
  function drawTitleBox(ctx, type, title_height) {
    const ic = ICONS[type];
    const img = image(type);
    if (!img || !img._ready) return;
    const s = 18 * ((ic && ic.scale) || 1);
    ctx.drawImage(img, title_height * 0.5 - s * 0.5, title_height * -0.5 - s * 0.5, s, s);
  }

  global.PatronIcons = {
    has: (t) => !!ICONS[t],
    svgString: svgString,
    image: image,
    drawTitleBox: drawTitleBox,
  };
})(window);
