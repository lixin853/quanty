/* ============================================================
   Pulse Design System — interactions
   Theme + convention + density toggles, live token values, copy.
   ============================================================ */
(function () {
  "use strict";
  var root = document.documentElement;
  var media = window.matchMedia("(prefers-color-scheme: dark)");

  /* ---------- Persistence helpers ---------- */
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  /* ---------- Theme ---------- */
  function applyTheme(choice) {
    if (choice === "system") {
      root.setAttribute("data-theme", media.matches ? "dark" : "light");
    } else {
      root.setAttribute("data-theme", choice);
    }
    setPressed("theme-switch", "data-theme-val", choice);
    refreshSwatchValues();
  }
  media.addEventListener("change", function () {
    if ((load("pulse-theme") || "light") === "system") applyTheme("system");
  });

  /* ---------- Convention ---------- */
  function applyConvention(choice) {
    root.setAttribute("data-convention", choice);
    setPressed("conv-switch", "data-conv-val", choice);
    refreshSwatchValues();
  }

  /* ---------- Density ---------- */
  function applyDensity(choice) {
    var t = document.getElementById("data-table");
    if (t) t.classList.toggle("compact", choice === "compact");
    setPressed("density-switch", "data-density", choice);
  }

  /* ---------- Generic pressed-state for a .switch group ---------- */
  function setPressed(groupId, attr, val) {
    var group = document.getElementById(groupId);
    if (!group) return;
    group.querySelectorAll("button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute(attr) === val));
    });
  }

  /* ---------- Wire switches ---------- */
  function wire(groupId, attr, fn, storeKey) {
    var group = document.getElementById(groupId);
    if (!group) return;
    group.addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      var val = btn.getAttribute(attr);
      fn(val);
      if (storeKey) store(storeKey, val);
    });
  }

  /* ---------- Live swatch values (resolved per theme/convention) ---------- */
  function refreshSwatchValues() {
    var cs = getComputedStyle(root);
    document.querySelectorAll(".swatch").forEach(function (sw) {
      var name = sw.getAttribute("data-var");
      var val = cs.getPropertyValue(name).trim();
      var out = sw.querySelector(".val");
      if (out) out.textContent = val || "—";
    });
  }

  /* ---------- Spacing demo (generated) ---------- */
  function buildSpacing() {
    var host = document.getElementById("space-demo");
    if (!host) return;
    [0,1,2,3,4,5,6,7,8,9].forEach(function (n) {
      var token = "--space-" + n;
      var row = document.createElement("div");
      row.className = "scale-row";
      row.setAttribute("data-copy", "var(" + token + ")");
      row.innerHTML =
        '<span class="label">' + token + '</span>' +
        '<span class="space-bar" style="width:var(' + token + ')"></span>';
      host.appendChild(row);
    });
  }

  /* ---------- Copy-to-clipboard ---------- */
  var toast = document.getElementById("toast");
  var toastTimer;
  function showToast(label) {
    if (!toast) return;
    toast.innerHTML = "Copied <code>" + label + "</code>";
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 1400);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(fallbackCopy.bind(null, text));
    }
    fallbackCopy(text);
    return Promise.resolve();
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }

  document.addEventListener("click", function (e) {
    // Swatch → copy resolved color value
    var sw = e.target.closest(".swatch");
    if (sw) {
      var name = sw.getAttribute("data-var");
      var val = getComputedStyle(root).getPropertyValue(name).trim();
      copyText(val); showToast(val);
      return;
    }
    // Anything with data-copy → copy that string
    var el = e.target.closest("[data-copy]");
    if (el) {
      var text = el.getAttribute("data-copy");
      copyText(text); showToast(text);
    }
  });

  /* ---------- Init ---------- */
  applyTheme(load("pulse-theme") || "light");
  applyConvention(load("pulse-conv") || "western");
  applyDensity("comfortable");
  buildSpacing();
  refreshSwatchValues();

  wire("theme-switch", "data-theme-val", function (v) { applyTheme(v); }, "pulse-theme");
  wire("conv-switch", "data-conv-val", function (v) { applyConvention(v); }, "pulse-conv");
  wire("density-switch", "data-density", function (v) { applyDensity(v); }, null);
})();
