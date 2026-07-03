/*
 * dialogs.js — in-app modal dialogs replacing the browser's prompt()/confirm().
 * Themed (uses the same CSS vars as the rest of Patron), keyboard-friendly
 * (Enter = OK, Esc / click-outside = Cancel), and Promise-based so callers just
 * `await`. Exposes window.PatronDialogs = { prompt, confirm }.
 *
 *   const name = await PatronDialogs.prompt({ title, label, value, okLabel });
 *   // -> the string, or null if cancelled
 *   const ok = await PatronDialogs.confirm({ title, message, okLabel, danger });
 *   // -> true / false
 */
(function (global) {
  "use strict";

  function open(opts, resolve) {
    const ov = document.createElement("div");
    ov.className = "ptdlg-overlay";
    const card = document.createElement("div");
    card.className = "ptdlg-card";

    if (opts.title) {
      const h = document.createElement("div");
      h.className = "ptdlg-title";
      h.textContent = opts.title;
      card.appendChild(h);
    }
    if (opts.message) {
      const m = document.createElement("div");
      m.className = "ptdlg-msg";
      m.textContent = opts.message; // pre-wrap in CSS preserves newlines
      card.appendChild(m);
    }

    let field = null;
    if (opts.input) {
      if (opts.label) {
        const l = document.createElement("label");
        l.className = "ptdlg-label";
        l.textContent = opts.label;
        card.appendChild(l);
      }
      field = document.createElement(opts.multiline ? "textarea" : "input");
      field.className = "ptdlg-input" + (opts.multiline ? " ptdlg-multiline" : "");
      if (!opts.multiline) field.type = "text";
      field.value = opts.value != null ? opts.value : "";
      card.appendChild(field);
    }

    const btns = document.createElement("div");
    btns.className = "ptdlg-btns";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ptdlg-btn";
    cancel.textContent = opts.cancelLabel || "Cancel";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "ptdlg-btn ptdlg-ok" + (opts.danger ? " ptdlg-danger" : "");
    ok.textContent = opts.okLabel || "OK";
    btns.appendChild(cancel);
    btns.appendChild(ok);
    card.appendChild(btns);

    ov.appendChild(card);
    document.body.appendChild(ov);

    let done = false;
    function close(result) {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      ov.remove();
      resolve(result);
    }
    function accept() { close(opts.input ? (field.value != null ? field.value : "") : true); }
    function reject() { close(opts.input ? null : false); }

    ok.addEventListener("click", accept);
    cancel.addEventListener("click", reject);
    // click on the backdrop (not the card) cancels
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) reject(); });
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); reject(); }
      // Enter accepts; in a multiline field require Ctrl/Cmd+Enter so plain Enter adds a line
      else if (e.key === "Enter" && (!opts.multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); accept(); }
    }
    document.addEventListener("keydown", onKey, true);

    if (field) { field.focus(); if (!opts.multiline) field.select(); }
    else ok.focus();
  }

  global.PatronDialogs = {
    prompt: function (opts) {
      return new Promise(function (res) { open(Object.assign({ input: true, okLabel: "OK" }, opts), res); });
    },
    confirm: function (opts) {
      return new Promise(function (res) { open(Object.assign({ input: false, okLabel: "OK" }, opts), res); });
    },
  };
})(window);
