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
    if (etiqueta && /^(?:shell )?v\d+$/.test(publicVersion)) etiqueta.textContent = 'Dashboard ' + publicVersion;
  } catch (_) {}
  if (!('serviceWorker' in navigator)) return;
  var current = built && built.content, busy = false, reloading = false;
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
      if (!bridge || !bridge.safe()) return;
      var html = await fetch('./dashboard.html?dash=' + Date.now(),{cache:'no-store'});
      if (!html.ok) return;
      var source = await html.text();
      var match = source.match(/<meta\s+name="dashboard-shell"\s+content="([^"]+)"/);
      if (!match || match[1] !== v.shell || !bridge.safe()) return;
      if (!await bridge.prepare() || !bridge.safe()) return;
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
