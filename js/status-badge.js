/**
 * Patron — Deploy status badge (bottom-left).
 *
 * Near-real-time deploy-readiness of the CURRENT graph. It lowers the live graph with the
 * SAME compiler as Deploy via a dry-run (POST /api/projects/<uid>/status — no persistence),
 * then paints one of a few states. It recompiles on start and (debounced) on every edit, so
 * the badge tracks the graph without the user asking. Clicking a non-green badge opens the
 * Output panel with the reason (wired by app.js via onClick).
 *
 * States (worst→best): unsaved · empty · checking · error · undeployed · modified · deployed.
 * Only `error` and `modified` are "actionable" (worth a click for detail); `deployed` is green.
 */
(function () {
  "use strict";

  const S = {
    unsaved:    { cls: "unsaved",    label: "UNSAVED" },
    empty:      { cls: "empty",      label: "EMPTY" },
    checking:   { cls: "checking",   label: "CHECKING…" },
    error:      { cls: "error",      label: "WON'T COMPILE" },
    undeployed: { cls: "undeployed", label: "NOT DEPLOYED" },
    modified:   { cls: "modified",   label: "MODIFIED" },
    deployed:   { cls: "deployed",   label: "DEPLOYED" },
    offline:    { cls: "offline",    label: "RUNTIME OFFLINE" },
  };

  let badgeEl = null, textEl = null;
  let clickHandler = null;
  let lastState = "empty";
  let lastDetail = "";
  let seq = 0;          // guards against out-of-order async results (last write wins)
  let timer = 0;

  function mount(el) {
    if (!el) return;
    badgeEl = el;
    badgeEl.innerHTML = '<span class="db-dot"></span><span class="db-text"></span>';
    textEl = badgeEl.querySelector(".db-text");
    badgeEl.addEventListener("click", () => {
      if (clickHandler) clickHandler(lastState, lastDetail);
    });
    paint("empty", "No blocks yet — add a block to build a workflow.");
  }

  function onClick(fn) { clickHandler = fn; }

  function paint(state, detail) {
    lastState = state;
    lastDetail = detail || "";
    const s = S[state] || S.empty;
    if (!badgeEl) return;
    badgeEl.className = "db-" + s.cls;                 // one state class drives the color
    textEl.textContent = s.label;
    badgeEl.title = detail || s.label;
    // Actionable states get a pointer + subtle emphasis (there's a reason worth reading).
    badgeEl.classList.toggle("db-actionable",
      state === "error" || state === "modified" || state === "offline");
  }

  // Map a /status response → [state, human detail for the Output panel].
  function classify(r) {
    if (!r || r.ok === false) {
      const errs = ((r && r.errors) || ["won't compile"]).join("\n- ");
      return ["error", "❌ This graph won't deploy:\n- " + errs];
    }
    const warns = r.warnings || [];
    const wtxt = warns.length
      ? "\n\n⚠️ " + warns.length + " warning(s):\n- " + warns.join("\n- ") : "";
    if (!r.deployed)
      return ["undeployed", "Compiles OK — not deployed yet. Build ▸ Deploy to go live." + wtxt];
    if (r.in_sync)
      return ["deployed", "✅ This exact graph is deployed (version " +
        (r.deployed_version || "?") + ") and live." + wtxt];
    return ["modified", "⚠️ Deployed (version " + (r.deployed_version || "?") +
      "), but the graph changed since. Re-deploy to update." + wtxt];
  }

  // ctx: { saved:bool, uid, name, graph } — graph is a litegraph serialize() object.
  async function check(ctx) {
    if (!ctx || !ctx.graph || !((ctx.graph.nodes || []).length)) {
      paint("empty", "No blocks yet — add a block to build a workflow.");
      return;
    }
    if (!ctx.saved || !ctx.uid) {
      paint("unsaved", "Unsaved scratch — Save the project (File ▸ Save) to enable Deploy.");
      return;
    }
    const mine = ++seq;
    paint("checking", "Checking deploy status…");
    let r;
    try {
      const res = await fetch("api/projects/" + ctx.uid + "/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: ctx.name || "Untitled Project", composition: ctx.graph }),
      });
      r = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (mine === seq) paint("offline", "Status check failed: " + (r.error || ("HTTP " + res.status)));
        return;
      }
    } catch (e) {
      if (mine === seq) paint("offline", "Can't reach agent_runtime — is the runtime up?");
      return;
    }
    if (mine !== seq) return;                          // a newer check superseded this one
    const [state, detail] = classify(r);
    paint(state, detail);
  }

  // Debounced check — call on every edit; coalesces a burst of changes into one probe.
  function scheduleCheck(getCtx, delay) {
    clearTimeout(timer);
    timer = setTimeout(() => check(getCtx()), delay == null ? 400 : delay);
  }

  window.PatronStatus = {
    mount, onClick, check, scheduleCheck, paint,
    state: () => lastState,
    detail: () => lastDetail,
  };
})();
