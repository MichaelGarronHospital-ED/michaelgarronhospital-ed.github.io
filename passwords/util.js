// ============================================================================
//  Small helpers for the passwords page (from hiring's js/util.js).
//
//  The page's content policy allows no inline script and no inline style, so
//  nothing here writes a style attribute or an onclick attribute: buttons get
//  their handlers with addEventListener, and showing or hiding uses the
//  hidden attribute and classes.
// ============================================================================

// ---- storage that cannot take the page down ---------------------------------
// Some browsers (blocked cookies, private modes, locked-down in-app browsers)
// THROW on any use of localStorage or sessionStorage, even reading it. This
// page keeps only a wrong-try count and a sign-out reason there, never a value.
const safeGet = (kind, k) => { try { return window[kind].getItem(k); } catch { return null; } };
const safeSet = (kind, k, v) => { try { window[kind].setItem(k, v); return true; } catch { return false; } };
const safeDel = (kind, k) => { try { window[kind].removeItem(k); } catch { /* blocked: nothing to remove */ } };
export const ss = { get: (k) => safeGet("sessionStorage", k), set: (k, v) => safeSet("sessionStorage", k, v), del: (k) => safeDel("sessionStorage", k) };
export const ls = { get: (k) => safeGet("localStorage", k), set: (k, v) => safeSet("localStorage", k, v), del: (k) => safeDel("localStorage", k) };

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

// A phone or tablet: don't focus a field to fix (that opens the keyboard over
// the message); mark it instead.
export const isTouch = () => { try { return window.matchMedia("(pointer: coarse)").matches; } catch { return false; } };

// Keep focus inside an open dialog; Tab and Shift+Tab wrap.
function trapTab(wrap, e) {
  const f = [...wrap.querySelectorAll("button:not([disabled]), input:not([disabled]), textarea, a[href]")].filter((x) => x.offsetParent !== null);
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
}

// Say something to screen readers through the dialog's one live region,
// which is never replaced (round 1 m2): a step's title and its message.
export function announce(text) {
  const live = document.getElementById("flowLive");
  if (!live) return;
  live.textContent = "";
  // a new text node each time, so the same words are read again
  setTimeout(() => { live.textContent = text || ""; }, 30);
}

// Return on a field marked enterkeyhint="next" moves to the next field instead
// of submitting (phones show "next" on the keyboard; round 1 D-M2).
export function enterMovesOn(form) {
  form.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target.matches || !e.target.matches('input[enterkeyhint="next"]')) return;
    const fields = [...form.querySelectorAll("input:not([disabled])")].filter((x) => x.offsetParent !== null);
    const nextField = fields[fields.indexOf(e.target) + 1];
    if (nextField) { e.preventDefault(); nextField.focus(); }
  });
}

// A small multi-step dialog. show(ctl) paints the first step; ctl has:
//   ctl.step({ title, html, buttons: [{ label, kind: "filled"|"tinted"|"plain"|"danger", run, id, disabled, main }], wire })
//     wire(body) runs after the step is painted (to add input handlers).
//     The main button (main: true, else the last "filled" one) is the form's
//     submit button: Return in a field presses it (round 1 D-M2).
//   ctl.body, ctl.close(value)
// Escape closes with null unless opts.sticky (or ctl.sticky is set while a
// change runs). The page behind is inert while it is open.
export function flowDialog(show, opts = {}) {
  const wrap = document.getElementById("flowWrap"), form = document.getElementById("flowForm");
  const title = document.getElementById("flowTitle"), body = document.getElementById("flowBody"), btns = document.getElementById("flowBtns");
  const behind = [...document.querySelectorAll("body > header, body > main")];
  const prevFocus = document.activeElement;
  if (!form.dataset.wired) {
    form.dataset.wired = "1";
    form.addEventListener("submit", (e) => e.preventDefault());
    enterMovesOn(form);
  }
  return new Promise((resolve) => {
    let closed = false;
    const onKey = (e) => {
      if (e.key === "Escape" && !opts.sticky && !ctl.sticky) { e.preventDefault(); e.stopPropagation(); ctl.close(null); }
      else if (e.key === "Tab") trapTab(wrap, e);
    };
    const ctl = {
      body, sticky: false,
      get closed() { return closed; },
      close(v = null) {
        if (closed) return; closed = true;
        wrap.hidden = true; body.textContent = ""; btns.textContent = ""; title.textContent = "";
        behind.forEach((el) => { el.inert = false; });
        document.removeEventListener("keydown", onKey, true);
        if (prevFocus && prevFocus.isConnected && prevFocus.focus) { try { prevFocus.focus(); } catch { /* gone */ } }
        if (opts.onClose) { try { opts.onClose(v); } catch { /* ignore */ } }
        resolve(v);
      },
      step({ title: t, html, buttons = [], wire, focus = true }) {
        if (closed) return;
        title.textContent = t || "";
        body.innerHTML = html || "";
        btns.textContent = "";
        const filled = buttons.filter((b) => b.kind === "filled");
        const main = buttons.find((b) => b.main) || filled[filled.length - 1] || null;
        for (const b of buttons) {
          const el = document.createElement("button");
          el.type = b === main ? "submit" : "button";
          el.className = "ed-btn " + ({ filled: "ed-btn-filled", tinted: "ed-btn-tinted", danger: "ed-btn-danger", plain: "ed-btn-plain" }[b.kind || "tinted"]);
          el.textContent = b.label;
          if (b.id) el.id = b.id;
          if (b.disabled) el.disabled = true;
          el.addEventListener("click", (e) => { e.preventDefault(); if (!el.disabled) b.run(ctl, el); });
          btns.appendChild(el);
        }
        if (wire) wire(body);
        const msg = [...body.querySelectorAll(".pw-msg")].map((x) => x.textContent.trim()).find(Boolean);
        announce([t, msg].filter(Boolean).join(". "));
        wrap.scrollTop = 0;
        if (!focus) return;
        // a phone: focus the title, so the keyboard stays closed and the
        // message at the top is read first; a computer: the first field
        const field = body.querySelector("input:not([disabled]), textarea");
        if (field && !isTouch()) field.focus();
        else { title.focus(); }
      },
    };
    wrap.hidden = false;
    behind.forEach((el) => { el.inert = true; });
    document.addEventListener("keydown", onKey, true);
    show(ctl);
  });
}
