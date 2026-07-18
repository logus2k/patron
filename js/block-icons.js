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
    // scale: 0.889 → 2px smaller than the default (canvas 18→16, toolbox 20→18).
    "trigger":         { file: "icons/alarm.svg", scale: 0.889 },
    "file_initiator":  { file: "icons/file-download-outline.svg" },
    "web_initiator":   { file: "icons/api.svg" },
    "stt_initiator":   { file: "icons/speech-balloon.svg", scale: 0.889 },
    "console_send":    { file: "icons/text-align-top.svg", dy: 2 },   // nudge 2px DOWN (canvas y+)
    "agent":           { file: "icons/robot.svg" },
    "vector_query":    { file: "icons/vector-three.svg" },
    "graph_query":     { file: "icons/graph-light.svg" },
    "ingestion":       { file: "icons/file-input.svg" },
    // MCP: one deterministic tool call (no LLM). Same icon as the MCP Tool resource.
    "mcp":             { file: "icons/connectors.svg" },
    "data":            { file: "icons/data.svg", scale: 0.778 }, // 4px smaller (canvas 18→14, toolbox 20→16)
    "transform":       { file: "icons/recycle-solid.svg" },
    "composite":       { file: "icons/workflow.svg" },
    "whatsapp":        { file: "icons/whatsapp.svg", scale: 0.944 },
    "tts":             { file: "icons/speech.svg" },
    "bus":             { file: "icons/bus-alt.svg", scale: 0.944 },
    "console_receive": { file: "icons/text-align-bottom.svg", dy: -2 }, // nudge 2px UP (canvas y-)
    "file_destination":{ file: "icons/file-upload-outline.svg" },
    "web_destination": { file: "icons/web.svg", scale: 0.833 }, // 3px smaller (canvas 18→15)
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
  // ONE canonical rendered icon size for ALL surfaces (toolbox palette, block title on canvas,
  // and the block's Configuration-panel header). Per-icon `scale` multiplies THIS single base so
  // an icon is the SAME pixel size everywhere — no more three-different-sizes drift.
  const ICON_PX = 18;
  function sizeFor(type) { const ic = ICONS[type]; return Math.round(ICON_PX * ((ic && ic.scale) || 1)); }

  // Toolbox palette markup (a themed CSS-mask span). `size` is ignored — the canonical sizeFor()
  // governs so the toolbox matches the block + config-panel exactly.
  function svgString(type /*, size (ignored) */) {
    const ic = ICONS[type];
    if (!ic || !ic.file) return "";
    const s = sizeFor(type);
    // Same per-icon vertical nudge as the canvas (ic.dy): CSS top +down / -up matches the sign.
    const extra = ic.dy ? ("position:relative;top:" + ic.dy + "px;") : "";
    return maskSpan(ic.file, s, extra);
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
    const s = sizeFor(type); // canonical size — identical to toolbox + config-panel
    const x = 10; // 4px accent stripe + 6px left padding before the icon
    const y = title_height * -0.5 - s * 0.5 + ((ic && ic.dy) || 0); // per-icon vertical nudge
    ctx.drawImage(img, x, y, s, s);
  }

  function fileFor(type) { const ic = ICONS[type]; return ic && ic.file ? ic.file : null; }

  global.PatronIcons = {
    has: (t) => !!ICONS[t],
    svgString: svgString,
    maskSpan: maskSpan,
    fileFor: fileFor,
    dyFor: (t) => { const ic = ICONS[t]; return (ic && ic.dy) || 0; }, // per-icon vertical nudge (px, +down)
    sizeFor: sizeFor, // canonical rendered px for a type (ICON_PX × scale) — use for ALL surfaces
    drawTitleBox: drawTitleBox,
  };
})(window);
