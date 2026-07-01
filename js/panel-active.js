/*
 * panel-active.js — mark the "selected" jsPanel (Toolbox / Output / Properties) so its
 * title bar shows a light pastel blue (css: .jsPanel.patron-active .jsPanel-hdr). The
 * active panel is the last one clicked / brought to front — only one at a time.
 */
(function () {
  "use strict";

  function setActive(panel) {
    if (!panel || !panel.classList || panel.classList.contains("patron-active")) {
      if (!panel) return;
    }
    document.querySelectorAll(".jsPanel.patron-active").forEach((el) => {
      if (el !== panel) el.classList.remove("patron-active");
    });
    if (panel && panel.classList) panel.classList.add("patron-active");
  }

  // Clicking anywhere inside a panel selects it (jsPanel also brings it to front).
  document.addEventListener(
    "pointerdown",
    (e) => {
      const panel = e.target && e.target.closest && e.target.closest(".jsPanel");
      if (panel) setActive(panel);
    },
    true
  );

  // Follow jsPanel's own front event (covers programmatic front / keyboard focus).
  document.addEventListener("jspanelfronted", (e) => {
    const p = (e && e.panel) || (e && e.detail && e.detail.panel) || null;
    if (p) setActive(p);
  });
})();
