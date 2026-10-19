// theme.js - light or dark by choice, for this repo's pages (front page, passwords page,
// page not found). A plain script in <head>, before the page draws, so there is no flash.
//
// Pages follow the device unless someone presses the switch beside the gear on the front
// page (index.html, [data-theme-toggle]). The choice is kept on this browser only
// (localStorage "ed_theme", "light" or "dark", not secret) and sets <html data-theme>,
// which theme.css turns into the colours. A choice stays until the person presses the
// switch again (never cleared by the device changing, say at sunset); pressing it back to
// the look the device has clears it, so the page follows the device again. Storage that
// throws (private browsing, blocked cookies) only means the choice is not remembered.
// Without matchMedia the device's look is unknown, so the switch stays hidden.
(function () {
  var KEY = "ed_theme";
  var BAR = { light: "#f5f5f7", dark: "#000000" };   // the browser bar, as index.html's theme-color
  var root = document.documentElement;
  var mq = null;
  var memo = null;   // the choice for this page when storage throws: the switch still works until a reload
  try { mq = window.matchMedia("(prefers-color-scheme: dark)"); } catch (e) { /* very old browser */ }

  function saved() {
    try { var v = localStorage.getItem(KEY); memo = v === "light" || v === "dark" ? v : null; } catch (e) { /* keep memo */ }
    return memo;
  }
  function save(v) {
    memo = v;
    try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) { /* not remembered */ }
  }
  function device() { return mq && mq.matches ? "dark" : "light"; }
  function current() { return saved() || device(); }

  function apply() {
    var v = saved();
    if (v) root.setAttribute("data-theme", v); else root.removeAttribute("data-theme");
    var scheme = document.querySelector('meta[name="color-scheme"]');   // the blank screen before first paint
    if (scheme) scheme.setAttribute("content", v || "light dark");
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      var m = metas[i];
      if (!m.hasAttribute("data-auto")) m.setAttribute("data-auto", m.getAttribute("content") || "");
      m.setAttribute("content", v ? BAR[v] : m.getAttribute("data-auto"));
    }
    var dark = current() === "dark";
    var buttons = document.querySelectorAll("[data-theme-toggle]");
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].setAttribute("aria-pressed", dark ? "true" : "false");
      buttons[j].title = dark ? "Switch to light mode" : "Switch to dark mode";
      buttons[j].hidden = !mq;
    }
  }

  function toggle() {
    var next = current() === "dark" ? "light" : "dark";
    save(next === device() ? null : next);
    apply();
  }

  apply();
  document.addEventListener("DOMContentLoaded", apply);
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-theme-toggle]") : null;
    if (b) toggle();
  });
  if (mq) {
    if (mq.addEventListener) mq.addEventListener("change", apply);
    else if (mq.addListener) mq.addListener(apply);
  }
  window.addEventListener("storage", function (e) { if (e.key === KEY || e.key === null) apply(); });   // another tab
  window.addEventListener("pageshow", apply);   // back button: another tab may have switched meanwhile
})();
