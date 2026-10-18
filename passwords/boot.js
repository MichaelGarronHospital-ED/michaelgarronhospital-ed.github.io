// ============================================================================
//  Runs first, as a classic script (old browsers too), before the page module.
//  1. Refuses to run inside a frame: another site could otherwise show this
//     page under its own and watch what is typed. The module checks
//     window.__edFramed and does nothing.
//  2. The last-resort net: if the module never runs (a very old browser, or a
//     blocked download), say so instead of leaving a dead sign-in box.
//  Plain old JavaScript on purpose (ES5).
// ============================================================================
(function () {
  var framed = true;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  function onReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  if (framed) {
    window.__edFramed = true;
    onReady(function () {
      var main = document.getElementById("main");
      if (!main) return;
      main.textContent = "";
      var p = document.createElement("p");
      p.className = "pw-framed";
      p.textContent = "Open this page on its own.";
      main.appendChild(p);
    });
    return;
  }
  var shown = false;
  function fatal(msg) {
    if (shown || window.__edReady) return;
    shown = true;
    var e = document.getElementById("gerr");
    if (e) e.textContent = msg;
    var f = document.getElementById("gateForm");
    if (f) f.hidden = true;
  }
  window.addEventListener("error", function (ev) {
    var m = (ev && ev.message) || "";
    if (/SyntaxError|Unexpected token|Unexpected identifier|is not a function|is not a constructor/.test(m))
      fatal("This browser can't run this page. It is most likely too old. Update iOS or Android, or try another device.");
  });
  onReady(function () {
    setTimeout(function () {
      if (!window.__edReady)
        fatal("The page didn't finish loading. Reload. If you are on a hospital network or using a content blocker, try mobile data.");
    }, 8000);
  });
})();
