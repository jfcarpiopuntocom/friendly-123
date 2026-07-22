/* novedades.js — employee "What's New" panel: experimental gamification +
   shift-alert summary. Fully separate module, NEVER touches real sales/
   perchas/inventory — only READS (already-resolved fetches) and counts its
   own points in its own localStorage. If this whole file failed, nothing
   else in the app notices: everything is try/catch and the mount is
   additive.

   EXPERIMENTAL FEATURE (JFC, 2026-07-22): ON by DEFAULT from the employee's
   very first login. The owner can turn it off in Advanced — only an explicit
   "0" disables it. Off = nothing gets hooked (not fetch, not the nav button).

   Score lives ONLY on-device (localStorage f123_novedades_v1), never leaves
   the device, never syncs, competes with no one. It's individual psychological
   reinforcement (Duolingo-style) for 4 good shift habits:
     - Daily use streak (login)
     - Sales logged
     - Shelf photos up to date
     - Transfers handled
*/
(function () {
  var LS_ON = "f123_gamification_on";
  var LS_STATE = "f123_novedades_v1";

  // DEFAULT ON (JFC, 2026-07-22): used to be off by default, now on so the
  // employee sees What's New from their very first login. The owner can turn
  // it off in Advanced — only an explicit "0" disables it.
  function on() {
    try { var v = localStorage.getItem(LS_ON); return v === null || v === "1"; } catch (_) { return true; }
  }
  function hoyISO() {
    try { return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
    catch (_) { return new Date().toISOString().slice(0, 10); }
  }
  function leer() {
    try {
      return JSON.parse(localStorage.getItem(LS_STATE)) || { racha: 0, ultimoLogin: "", puntos: 0, insignias: [], ventasHoy: 0, ultimaFechaVentas: "", noLeidas: 0, ultimaVisita: 0 };
    } catch (_) { return { racha: 0, ultimoLogin: "", puntos: 0, insignias: [], ventasHoy: 0, ultimaFechaVentas: "", noLeidas: 0, ultimaVisita: 0 }; }
  }
  function guardar(st) { try { localStorage.setItem(LS_STATE, JSON.stringify(st)); } catch (_) {} }

  function otorgar(st, id) {
    if (st.insignias.indexOf(id) === -1) {
      st.insignias.push(id);
      st.puntos += 10;
      st.noLeidas += 1;
    }
  }

  function marcarLogin() {
    var st = leer();
    var hoy = hoyISO();
    if (st.ultimoLogin !== hoy) {
      // BUGFIX: Intl.DateTimeFormat for "yesterday" had no try/catch — if it threw
      // on an old device, the error bubbled up through montarTodoEmpleado() and was
      // swallowed by the oc-login listener's catch, silently preventing the whole
      // panel from mounting.
      var ayerISO;
      try {
        var ayer = new Date(Date.now() - 86400000);
        ayerISO = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(ayer);
      } catch (_) {
        var dAyer = new Date(hoy + "T12:00:00"); dAyer.setDate(dAyer.getDate() - 1);
        ayerISO = dAyer.toISOString().slice(0, 10);
      }
      st.racha = (st.ultimoLogin === ayerISO) ? (st.racha + 1) : 1;
      st.ultimoLogin = hoy;
      st.puntos += 5;
      st.noLeidas += 1;
      if (st.racha === 3) otorgar(st, "racha3");
      if (st.racha === 7) otorgar(st, "racha7");
      if (st.racha === 30) otorgar(st, "racha30");
      guardar(st);
    }
  }

  // Additive fetch hook — chains with whatever is already wrapped (same
  // pattern already used by OCSync in avanzado-extra.js), never replaces it.
  function engancharFetch() {
    if (window.__f123NovedadesPatched) return;
    window.__f123NovedadesPatched = true;
    var fetchPrevio = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      var res = await fetchPrevio(input, init);
      try {
        if (res.ok) {
          var url = typeof input === "string" ? input : (input && input.url) || "";
          var metodo = ((init && init.method) || "GET").toUpperCase();
          if (metodo === "POST" && url.indexOf("/api/ventas/cierre") !== -1) marcarVenta();
          else if (metodo === "POST" && url.indexOf("/api/perchas") !== -1 && url.indexOf("foto") !== -1) marcarFotoPercha();
          else if (metodo === "POST" && url.indexOf("/api/transferencias") !== -1) marcarTransferencia();
        }
      } catch (_) {}
      return res;
    };
  }

  function marcarVenta() {
    var st = leer();
    var hoy = hoyISO();
    if (st.ultimaFechaVentas !== hoy) { st.ventasHoy = 0; st.ultimaFechaVentas = hoy; }
    st.ventasHoy += 1;
    st.puntos += 2;
    if (st.ventasHoy === 5) otorgar(st, "ventas5_" + hoy);
    guardar(st);
  }
  function marcarFotoPercha() {
    var st = leer();
    st.puntos += 5;
    // noLeidas handled by otorgar() — don't also increment here (double-increment bug)
    otorgar(st, "foto_" + hoyISO());
    guardar(st);
  }
  function marcarTransferencia() {
    var st = leer();
    st.puntos += 3;
    // noLeidas handled by otorgar() — don't also increment here (double-increment bug)
    otorgar(st, "transf_" + hoyISO());
    guardar(st);
  }

  var css = document.createElement("style");
  css.textContent =
    "#oc-nav-novedades{position:relative;}" +
    "#oc-nav-novedades .oc-nov-badge{position:absolute;top:2px;right:6px;min-width:16px;height:16px;" +
    "border-radius:8px;background:var(--rust,#b2461f);color:#FFFFFF;font-size:13px;font-weight:700;" +
    "line-height:16px;text-align:center;padding:0 3px;}" +
    "@keyframes ocNovGlow{0%,100%{box-shadow:0 0 0 0 rgba(232,160,32,.55);}50%{box-shadow:0 0 0 5px rgba(232,160,32,0);}}" +
    "#oc-nav-novedades.oc-nov-glow{animation:ocNovGlow 1.6s ease-in-out infinite;}" +
    "@media (prefers-reduced-motion: reduce){#oc-nav-novedades.oc-nov-glow{animation:none;}}" +
    ".oc-nov-card{background:var(--blanco-calido,#fbf5e8);border:2px solid var(--brass,#9c7a35);border-radius:10px;padding:16px;margin-bottom:14px;}" +
    ".oc-nov-insignia{display:inline-block;background:var(--amarillo-claro,#fff3c4);border:2px solid var(--brass,#9c7a35);border-radius:20px;padding:6px 12px;margin:0 6px 6px 0;font-size:14px;font-weight:700;color:var(--ink,#211c14);}";
  document.head.appendChild(css);

  function montarNav() {
    if (document.getElementById("oc-nav-novedades")) return;
    var nav = document.querySelector("nav");
    var refBtn = document.querySelector('nav button[data-vista="hoy"]');
    if (!nav || !refBtn) return;
    var b = document.createElement("button");
    b.id = "oc-nav-novedades";
    b.dataset.vista = "novedades";
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5c-4 3.4-6 7-6 10.2A6 6 0 0 0 12 21a6 6 0 0 0 6-8.3c0-3.2-2-6.8-6-10.2z"></path></svg><span>What’s New</span>';
    refBtn.insertAdjacentElement("afterend", b);
    b.addEventListener("click", function () {
      document.querySelectorAll("nav button").forEach(function (x) { x.classList.remove("activo"); });
      b.classList.add("activo");
      document.querySelectorAll(".vista").forEach(function (v) { v.classList.remove("activa"); });
      var sec = document.getElementById("vista-novedades");
      if (sec) sec.classList.add("activa");
      var st = leer(); st.noLeidas = 0; st.ultimaVisita = Date.now(); guardar(st);
      actualizarBadge();
      render();
    });
    actualizarBadge();
  }

  function actualizarBadge() {
    var b = document.getElementById("oc-nav-novedades");
    if (!b) return;
    var st = leer();
    var existente = b.querySelector(".oc-nov-badge");
    if (existente) existente.remove();
    if (st.noLeidas > 0) {
      var badge = document.createElement("span");
      badge.className = "oc-nov-badge";
      badge.textContent = st.noLeidas > 9 ? "9+" : String(st.noLeidas);
      b.appendChild(badge);
      b.classList.add("oc-nov-glow");
    } else {
      b.classList.remove("oc-nov-glow");
    }
  }

  function montarSeccion() {
    if (document.getElementById("vista-novedades")) return;
    var main = document.querySelector("main");
    if (!main) return;
    var sec = document.createElement("section");
    sec.id = "vista-novedades";
    sec.className = "vista";
    main.appendChild(sec);
  }

  function racheFuego(n) {
    if (n <= 0) return "";
    return "🔥".repeat(Math.min(n, 7)) + (n > 7 ? " x" + n : "");
  }

  // Motivational line based on streak — makes the panel feel alive from the
  // very first login, not just an empty counter.
  function mensajeRacha(st) {
    if (st.racha <= 1) return "Welcome to What’s New! Every shift you open counts. Start your streak today.";
    if (st.racha < 3) return "Good start — keep coming back each day to grow your streak.";
    if (st.racha < 7) return "Solid streak! You’re at " + st.racha + " days in a row.";
    if (st.racha < 30) return "Impressive consistency! " + st.racha + " days in a row and counting.";
    return "Legendary streak: " + st.racha + " days straight. This business runs because you show up.";
  }

  // TIPS: short good-practice tips, rotate by day of year (stable through the
  // shift, changes tomorrow). Original content, not copied from anywhere.
  var TIPS = [
    "A shelf photo taken recently sells faster: customers trust what they see.",
    "Closing each sale right away keeps inventory accurate for the next shift.",
    "Gold-flagged products are today’s opportunity — give them a push before the red ones.",
    "Handling a transfer as soon as it arrives keeps the customer from going elsewhere.",
    "Checking Inventory at the start of your shift saves surprises later in the day.",
    "A daily streak isn’t about perfection — it’s about not letting the day pass without checking in."
  ];
  function tipDelDia() {
    // BUGFIX: Date.now()/86400000 flips at UTC midnight — for device-local users
    // this changes the tip mid-shift (e.g. 7pm in UTC-5). hoyISO() returns the
    // local calendar date, so the tip changes at local midnight, same as the streak.
    return TIPS[Number(hoyISO().replace(/-/g, "")) % TIPS.length];
  }

  async function cargarInfoTurno() {
    var API_ = (typeof API !== "undefined" ? API : "/api");
    var ubic = (typeof ubicacionActual !== "undefined" ? ubicacionActual : "todas");
    var out = { alertas: [], impulsados: [], error: false };
    try {
      var dash = await fetch(API_ + "/dashboard?ubicacionId=" + ubic).then(function (r) { return r.json(); });
      out.alertas = (dash && Array.isArray(dash.alertas)) ? dash.alertas.slice(0, 4) : [];
    } catch (_) { out.error = true; }
    try {
      var prods = await fetch(API_ + "/productos?ubicacionId=" + ubic).then(function (r) { return r.json(); });
      out.impulsados = (Array.isArray(prods) ? prods : []).filter(function (p) { return p.estrella; }).slice(0, 4);
    } catch (_) {}
    return out;
  }

  function render() {
    var sec = document.getElementById("vista-novedades");
    if (!sec) return;
    var st = leer();
    var insigniasHtml = st.insignias.length
      ? st.insignias.slice(-8).map(function (id) { return '<span class="oc-nov-insignia">🏅 ' + escHtmlLocal(etiquetaInsignia(id)) + "</span>"; }).join("")
      : '<p style="font-size:14px;color:var(--ink-soft,#5d5340);">No badges yet — they start appearing with your first good habit of the day.</p>';

    sec.innerHTML =
      '<h3 class="seccion" style="margin-top:0;">What’s New</h3>' +
      '<div class="oc-nov-card">' +
        '<h4 style="margin:0 0 6px;font-size:15px;">🧪 Gamification — experimental feature</h4>' +
        '<p style="font-size:14px;color:var(--ink-soft,#5d5340);margin:0 0 10px;">' + escHtmlLocal(mensajeRacha(st)) + '</p>' +
        '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<div><div style="font-size:24px;">' + racheFuego(st.racha) + '</div><div style="font-size:13px;color:var(--ink-soft,#5d5340);">Streak: ' + st.racha + ' day' + (st.racha === 1 ? "" : "s") + '</div></div>' +
          '<div><div style="font-size:24px;font-weight:700;color:var(--rust,#b2461f);">' + st.puntos + '</div><div style="font-size:13px;color:var(--ink-soft,#5d5340);">Points</div></div>' +
          '<div><div style="font-size:24px;font-weight:700;">' + st.ventasHoy + '</div><div style="font-size:13px;color:var(--ink-soft,#5d5340);">Sales today</div></div>' +
        '</div>' +
        insigniasHtml +
      '</div>' +
      '<div class="oc-nov-card">' +
        '<h4 style="margin:0 0 6px;font-size:15px;">💡 Tip of the day</h4>' +
        '<p style="font-size:14px;color:var(--ink-soft,#5d5340);margin:0;">' + escHtmlLocal(tipDelDia()) + '</p>' +
      '</div>' +
      '<div class="oc-nov-card" id="oc-nov-turno">' +
        '<h4 style="margin:0 0 6px;font-size:15px;">📋 Shift alerts</h4>' +
        '<p style="font-size:14px;color:var(--ink-soft,#5d5340);margin:0;">Loading…</p>' +
      '</div>';

    cargarInfoTurno().then(function (info) {
      var cont = document.getElementById("oc-nov-turno");
      if (!cont) return;
      if (info.error) {
        cont.innerHTML = '<h4 style="margin:0 0 6px;font-size:15px;">📋 Shift alerts</h4><p style="font-size:14px;color:var(--ink-soft,#5d5340);margin:0;">Check Inventory for products that need your attention (red and gold) and Perchas for today’s pending photos.</p>';
        return;
      }
      var alertasHtml = info.alertas.length
        ? '<ul style="margin:6px 0 14px;padding-left:0;list-style:none;">' + info.alertas.map(function (a) {
            var color = a.estado === "rojo" ? "var(--rust,#b2461f)" : (a.estado === "amarillo" ? "#8a6d1f" : "var(--ink,#211c14)");
            return '<li style="font-size:14px;color:' + color + ';font-weight:700;margin-bottom:4px;">● ' + escHtmlLocal(a.mensaje) + '</li>';
          }).join("") + '</ul>'
        : '<p style="font-size:14px;color:var(--ink-soft,#5d5340);margin:6px 0 14px;">No pending alerts — all quiet for now.</p>';
      var impulsadosHtml = info.impulsados.length
        ? '<h4 style="margin:0 0 6px;font-size:15px;">⭐ Push these today</h4><ul style="margin:0;padding-left:0;list-style:none;">' + info.impulsados.map(function (p) {
            return '<li style="font-size:14px;color:var(--ink,#211c14);margin-bottom:4px;">⭐ ' + escHtmlLocal(p.nombre) + '</li>';
          }).join("") + '</ul>'
        : '';
      cont.innerHTML = '<h4 style="margin:0 0 6px;font-size:15px;">📋 Shift alerts</h4>' + alertasHtml + impulsadosHtml;
    }).catch(function () {});
  }

  function etiquetaInsignia(id) {
    if (id.indexOf("racha3") === 0) return "3 days in a row";
    if (id.indexOf("racha7") === 0) return "A full week";
    if (id.indexOf("racha30") === 0) return "A month-long streak";
    if (id.indexOf("ventas5") === 0) return "5 sales in one day";
    if (id.indexOf("foto_") === 0) return "Shelf up to date";
    if (id.indexOf("transf_") === 0) return "Transfer handled";
    return "Achievement";
  }
  function escHtmlLocal(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function montarSwitchAvanzado() {
    var vista = document.getElementById("vista-avanzado");
    if (!vista || document.getElementById("oc-nov-switch-card")) return;
    var card = document.createElement("div");
    card.id = "oc-nov-switch-card";
    card.className = "tag-card";
    card.style.cssText = "text-align:left;margin-top:22px;";
    card.innerHTML =
      '<h3 class="seccion" style="margin-top:0;">🧪 Employee gamification (experimental)</h3>' +
      '<p style="font-size:14px;color:var(--ink-soft,#5d5340);margin-top:0;">Gives your employees their own "What’s New" panel: usage streak, points, and badges for good habits (sales, shelf photos, transfers). It doesn’t compete between employees, never leaves the device, and never touches any business data.</p>' +
      '<label style="display:flex;align-items:center;gap:10px;font-size:14px;font-weight:700;cursor:pointer;">' +
        '<input type="checkbox" id="oc-nov-toggle" style="width:20px;height:20px;">' +
        'Turn on experimental gamification' +
      '</label>';
    vista.appendChild(card);
    var chk = document.getElementById("oc-nov-toggle");
    chk.checked = on();
    chk.addEventListener("change", function () {
      try { localStorage.setItem(LS_ON, chk.checked ? "1" : "0"); } catch (_) {}
    });
  }

  function montarTodoEmpleado() {
    if (!on()) return;
    engancharFetch();
    marcarLogin();
    montarSeccion();
    montarNav();
    // render() LAZY: the nav button click already calls render(). Calling it here
    // fires 2 fetches (dashboard + productos) on every login even if the employee
    // never opens What's New. Section stays empty but hidden — no cost until needed.
  }

  window.addEventListener("oc-login", function (e) {
    try {
      var detalle = e && e.detail || {};
      if (detalle.rol === "empleado" && !detalle.demo) montarTodoEmpleado();
      if (detalle.rol === "dueno" && !detalle.demo) montarSwitchAvanzado();
    } catch (_) {}
  });

  window.addEventListener("oc-logout", function () {
    try {
      var b = document.getElementById("oc-nav-novedades");
      if (b) b.remove();
      var sec = document.getElementById("vista-novedades");
      if (sec) sec.remove();
      var card = document.getElementById("oc-nov-switch-card");
      if (card) card.remove();
    } catch (_) {}
  });
})();
