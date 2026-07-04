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
    "trigger":         { file: "icons/alarm.svg" },
    "file_initiator":  { file: "icons/file-download-outline.svg" },
    "web_initiator":   { file: "icons/api.svg" },
    "stt_initiator":   { file: "icons/speech-balloon.svg" },
    "console_send":    { file: "icons/textbox-48-regular.svg" },
    "agent":           { file: "icons/robot.svg" },
    "vector_query":    { file: "icons/vector-three.svg" },
    "graph_query":     { file: "icons/graph-light.svg" },
    "transform":       { file: "icons/recycle-1.svg" },
    "composite":       { file: "icons/workflow.svg" },
    "whatsapp":        { file: "icons/whatsapp.svg" },
    "tts":             { file: "icons/speech.svg" },
    "bus":             { file: "icons/bus-alt.svg" },
    "console_receive": { file: "icons/textbox-48-regular.svg" },
    "file_destination":{ file: "icons/file-upload-outline.svg" },
    "web_destination": { file: "icons/web.svg" },
  };

  function redraw() {
    const c = global.PatronApp && global.PatronApp.canvas;
    if (c && c.setDirty) c.setDirty(true, true);
  }

  // ---- DOM icons: a CSS-MASK span so the (currentColor) SVG takes `--icon-fg` (theme-aware),
  // NO white badge. `src` is an icons/*.svg; `extra` = extra inline style (e.g. header margins).
  function maskSpan(src, size, extra) {
    return '<span class="icon-mask" style="width:' + size + 'px;height:' + size + 'px;' +
      (extra || "") + "-webkit-mask-image:url('" + src + "');mask-image:url('" + src + "')\"></span>";
  }
  // Toolbox palette markup (was an <img> in a white badge → now a themed mask span).
  function svgString(type, size) {
    const ic = ICONS[type];
    if (!ic || !ic.file) return "";
    const s = Math.round((size || 24) * (ic.scale || 1)); // per-icon scale (some fill their viewBox)
    return maskSpan(ic.file, s);
  }

  // ---- Canvas icons: recolor the currentColor SVG to a specific colour (the title text colour
  // for the node's state), cached per (type, colour). No white badge — the icon itself contrasts.
  const svgSrc = {};    // type -> fetched SVG source ("" once fetched-but-failed)
  const fetching = {};  // type -> true while the fetch is in flight
  const colored = {};   // "type|colour" -> HTMLImageElement
  function coloredImage(type, color) {
    const ic = ICONS[type];
    if (!ic || !ic.file) return null;
    const key = type + "|" + color;
    if (colored[key]) return colored[key];
    const txt = svgSrc[type];
    if (txt === undefined) {                       // fetch the SVG source once
      if (!fetching[type]) {
        fetching[type] = true;
        fetch(ic.file).then((r) => r.text()).then((t) => { svgSrc[type] = t; redraw(); })
          .catch(() => { svgSrc[type] = ""; });
      }
      return null;
    }
    if (!txt) return null;
    const img = new Image();
    img._ready = false;
    img.onload = function () { img._ready = true; redraw(); };
    img.src = "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(txt.replace(/currentColor/g, color));
    colored[key] = img;
    return img;
  }

  // Draw the icon where litegraph would draw the title box. ctx is translated to the node
  // origin; the title bar is above (negative y). `color` = the icon colour for this state.
  function drawTitleBox(ctx, type, title_height, color) {
    const ic = ICONS[type];
    const img = coloredImage(type, color || "#1d1d1d");
    if (!img || !img._ready) return;
    const s = 18 * ((ic && ic.scale) || 1);
    const x = title_height * 0.5 - s * 0.5 + 3;
    const y = title_height * -0.5 - s * 0.5;
    ctx.drawImage(img, x, y, s, s);
  }

  function fileFor(type) { const ic = ICONS[type]; return ic && ic.file ? ic.file : null; }

  global.PatronIcons = {
    has: (t) => !!ICONS[t],
    svgString: svgString,
    maskSpan: maskSpan,
    fileFor: fileFor,
    drawTitleBox: drawTitleBox,
  };
})(window);
