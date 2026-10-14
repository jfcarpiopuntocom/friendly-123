/* 2026-10-13, JFC: automatic dashboard hotfixes. Only reload after the
   controlling SW AND freshly served HTML identify the same release. Never
   interrupt an editor, remember a PIN, or confuse publication with adoption. */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  var built = document.querySelector('meta[name="dashboard-shell"]');
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
  setInterval(check,15000);
  setTimeout(check,1000);
})();
