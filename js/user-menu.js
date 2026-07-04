/*
 * user-menu.js — the logged-in user's avatar (top-right) + a click-to-open popup showing
 * the user's name + email and a Log out action.
 *
 * Identity comes from serve.py GET /api/me → { user, email } (the edge proxy's verified
 * OAuth2Proxy headers; dev falls back to DEFAULT_PRINCIPAL). The proxy does NOT forward a
 * profile picture, so the avatar is an INITIALS disk (deterministic colour from the email).
 * Log out navigates to the OAuth2Proxy sign-out endpoint (`/oauth2/sign_out`).
 */
(function (global) {
  "use strict";

  var SIGN_OUT_URL = "/oauth2/sign_out"; // OAuth2Proxy; a no-op 404 in bare dev (no proxy)

  // A stable pastel-ish hue from the email, so each user gets a consistent avatar colour.
  function colorFor(seed) {
    var h = 0, s = String(seed || "?");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return "hsl(" + h + ", 55%, 45%)";
  }
  // The REAL display name if the IdP/proxy forwarded one (me.name); otherwise null — we do NOT
  // fabricate a name from the email local part (that produced the bogus "Logus2k").
  function realName(me) {
    var n = (me.name || "").trim();
    return n && n.toLowerCase() !== String(me.email || "").toLowerCase() ? n : null;
  }
  function initials(me) {
    var base = realName(me) || (me.email || me.user || "?");
    var parts = base.replace(/@.*/, "").split(/[.\s_-]+/).filter(Boolean);
    var s = parts.length >= 2 ? parts[0][0] + parts[1][0] : (base[0] || "?");
    return s.toUpperCase();
  }
  // Paint a circle element as the Google profile photo if we have one, else an initials disk.
  // A broken/blocked photo falls back to initials (Google photos need no-referrer to load).
  function paintAvatar(el, me) {
    el.textContent = "";
    el.style.background = colorFor(me.email || me.user);
    if (me.picture) {
      var img = document.createElement("img");
      img.alt = ""; img.referrerPolicy = "no-referrer"; img.src = me.picture;
      img.onerror = function () { img.remove(); el.textContent = initials(me); };
      el.appendChild(img);
    } else {
      el.textContent = initials(me);
    }
  }

  function build(me) {
    // avatar button (fixed top-right, above the topbar stacking context)
    var btn = document.createElement("button");
    btn.id = "user-avatar";
    btn.type = "button";
    btn.title = me.email || me.user || "Account";
    paintAvatar(btn, me);
    document.body.appendChild(btn);

    // popup card (hidden until the avatar is clicked)
    var pop = document.createElement("div");
    pop.id = "user-pop";
    pop.hidden = true;

    var head = document.createElement("div");
    head.className = "up-head";
    var av2 = document.createElement("span");
    av2.className = "up-av"; paintAvatar(av2, me);
    var who = document.createElement("div");
    who.className = "up-who";
    var name = realName(me);
    var email = me.email || me.user || "";
    if (name) {
      var nm = document.createElement("div"); nm.className = "up-name"; nm.textContent = name;
      who.appendChild(nm);
    }
    // With no real name, the email IS the primary identifier (bold), not a muted subtitle.
    var em = document.createElement("div");
    em.className = name ? "up-email" : "up-name";
    em.textContent = email; em.title = email;
    who.appendChild(em);
    head.appendChild(av2); head.appendChild(who);
    pop.appendChild(head);

    var sep = document.createElement("div"); sep.className = "up-sep"; pop.appendChild(sep);

    var out = document.createElement("button");
    out.type = "button"; out.className = "up-logout";
    out.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" width="15" height="15">' +
      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>' +
      '<path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg><span>Log out</span>';
    out.addEventListener("click", function () { global.location.href = SIGN_OUT_URL; });
    pop.appendChild(out);

    document.body.appendChild(pop);

    function setOpen(v) {
      pop.hidden = !v;
      btn.classList.toggle("open", v);
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      setOpen(pop.hidden);
    });
    // click-outside / Escape closes it
    document.addEventListener("click", function (e) {
      if (!pop.hidden && e.target !== btn && !pop.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setOpen(false); });
  }

  function init() {
    fetch("api/me", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (me) { if (me && (me.user || me.email)) build(me); })
      .catch(function () { /* no identity available (offline / file://) — no avatar */ });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window);
