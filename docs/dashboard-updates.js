/* 2026-10-13, JFC: automatic dashboard hotfixes. Only reload after the
   controlling SW AND freshly served HTML identify the same release. Never
   interrupt an editor, remember a PIN, or confuse publication with adoption. */
(function () {
  'use strict';
  var built = document.querySelector('meta[name="dashboard-shell"]');
  /* El shell tecnico controla la actualizacion; la etiqueta publica es releaseName.
     No confundir la cache interna con la version que ve el cliente. */
  try {
    var etiqueta = document.getElementById('dashboard-version');
    var publicMeta = document.querySelector('meta[name="dashboard-release"]');
    var publicVersion = publicMeta && String(publicMeta.content || '');
    if (etiqueta && /^(?:v\d+\.\d+\.\d{2}|(?:shell )?v\d+)$/.test(publicVersion)) etiqueta.textContent = 'Dashboard ' + publicVersion;
  } catch (_) {}
  if (!('serviceWorker' in navigator)) return;
  var current = built && built.content, busy = false, reloading = false;
  /* (JFC 2026-11-11, v738) Bitacora local de recargas, igual que la app: ultimas 15 en localStorage
     "f123_recargas_log" = [{m: motivo, t: ms, v: shell}]. Sin UI, sin red, sin datos de clientes. Nunca lanza. */
  function marcarRecarga(motivo, shell) {
    try {
      var a = JSON.parse(localStorage.getItem('f123_recargas_log') || '[]');
      if (!Array.isArray(a)) a = [];
      a.push({ m: String(motivo || ''), t: Date.now(), v: String(shell || '') });
      localStorage.setItem('f123_recargas_log', JSON.stringify(a.slice(-15)));
    } catch (_) {}
  }
  function controllerShell() {
    return new Promise(function(resolve) {
      var controller = navigator.serviceWorker.controller;
      if (!controller) return resolve('');
      var timer = setTimeout(function(){finish('');},3000);
      function finish(shell){clearTimeout(timer);navigator.serviceWorker.removeEventListener('message',receive);resolve(shell);}
      function receive(e){if(e.source === controller && e.data && e.data.tipo === 'shell-actual')finish(String(e.data.shell || ''));}
      navigator.serviceWorker.addEventListener('message',receive);
      try { controller.postMessage({tipo:'que-shell'}); } catch (_) { finish(''); }
    });
  }
  async function check() {
    if (busy || reloading || navigator.onLine === false || document.hidden) return;
    busy = true;
    try {
      var r = await fetch('./version.json?dash=' + Date.now(),{cache:'no-store'});
      if (!r.ok) return;
      var v = await r.json();
      if (!v.shell || v.shell === current) return;
      var reg = await navigator.serviceWorker.getRegistration();
      if (!reg) reg = await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
      await reg.update();
      if (reg.waiting) reg.waiting.postMessage({tipo:'skip-waiting'});
      if (await controllerShell() !== v.shell) return;
      var bridge = window.__dashboardUpdate;
      if (!bridge || typeof bridge.sessionActive !== "function" || bridge.sessionActive() || !bridge.safe()) return;
      var html = await fetch('./dashboard.html?dash=' + Date.now(),{cache:'no-store'});
      if (!html.ok) return;
      var source = await html.text();
      var match = source.match(/<meta\s+name="dashboard-shell"\s+content="([^"]+)"/);
      if (!match || match[1] !== v.shell || bridge.sessionActive() || !bridge.safe()) return;
      if (!await bridge.prepare() || bridge.sessionActive() || !bridge.safe()) return;
      /* (JFC 2026-11-11, v732) Tope anti-bucle: una recarga automatica por version del shell y por pestana. */
      try { var ck = 'f123_dash_recarga:' + v.shell; if (sessionStorage.getItem(ck) === '1') { marcarRecarga('omitida-tope:version-segura', v.shell); return; } sessionStorage.setItem(ck, '1'); } catch (_) {}
      marcarRecarga('version-segura', v.shell);
      reloading = true;
      location.reload();
    } catch (_) { /* Offline/update failure keeps the current report usable. */ }
    finally { busy = false; }
  }
  window.OCDashboardUpdates = {check:check};
  navigator.serviceWorker.addEventListener('controllerchange',check);
  window.addEventListener('online',check);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)check();});
  /* v514 (JFC 2026-10-14, no saturar Cloudflare): antes se preguntaba version.json cada 15 s
     (5.760 consultas al dia por tablero abierto, cada una pasa por el Worker de friendly123.com).
     Ahora: al volver a la pestana, al recuperar internet, al cambiar el service worker y, como
     respaldo, cada 10 min (igual que la app). Un hotfix llega al volver a mirar el tablero. */
  setInterval(check,600000);
  setTimeout(check,1000);
})();
