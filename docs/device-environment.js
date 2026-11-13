/* friendly-123: local-only user-visible device/browser label; never mutates sync/identity. */
(function () {
      "use strict";
      function detectarEntorno() {
        var n = window.navigator || {}, ua = String(n.userAgent || ""), platform = String(n.platform || "");
        var ipad = /iPad/i.test(ua) || (/Mac/i.test(platform) && n.maxTouchPoints > 1);
        var device = ipad ? "iPad" : /iPhone|iPod/i.test(ua) ? "iPhone"
          : /Android/i.test(ua) ? (/Mobile/i.test(ua) ? "Android phone" : "Android tablet")
          : /Windows/i.test(ua) ? "Windows PC"
          : /Mac/i.test(ua) || /Mac/i.test(platform) ? "Mac"
          : /Linux/i.test(ua) ? "Linux PC" : "Device";
        var pwa = false;
        try { pwa = n.standalone === true || Boolean(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches); } catch (_) {}
        // In an installed iOS PWA, the origin browser is not reliably exposed.
        if (pwa) return device + " · PWA";
        var browser = /OPiOS|OPT\/|OPR\/|Opera/i.test(ua) ? "Opera"
          : /EdgiOS|EdgA\/|Edg\//i.test(ua) ? "Edge"
          : /FxiOS|Firefox\//i.test(ua) ? "Firefox"
          : /CriOS|Chrome\//i.test(ua) ? "Chrome"
          : /SamsungBrowser\//i.test(ua) ? "Samsung Internet"
          : /DuckDuckGo/i.test(ua) ? "DuckDuckGo"
          : /Safari\//i.test(ua) ? "Safari" : "Browser";
        return device + " · " + browser;
      }
      function pintarEntorno() {
        var kind = document.getElementById("oc-advanced-device-env");
        var name = document.getElementById("oc-advanced-device-name");
        if (kind) kind.textContent = detectarEntorno();
        if (name) {
          var apodo = "";
          try { apodo = window.OCMicelio && window.OCMicelio.miApodo ? (window.OCMicelio.miApodo() || "") : ""; } catch (_) {}
          name.textContent = apodo || (typeof window.t === "function" ? window.t("device.name") : "Name this device");
        }
      }
      pintarEntorno();
      window.addEventListener("oc-login", pintarEntorno);
      window.addEventListener("oc-micelio-cambio", pintarEntorno);
      window.addEventListener("oc-lang-change", pintarEntorno);
    })();
