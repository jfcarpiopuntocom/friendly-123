// welcome-ui.js — Mensaje de bienvenida para first-timers (JFC 2026-07-02).
// AMIGABLE (demo de Amigable). Aparece UNA sola vez, tras el primer login
// exitoso (escucha "oc-login"), y marca un flag en localStorage para no
// repetirse. Aquí conviven, sin chocar, el slogan informal de la línea
// ("tu negocio, a color") y el nombre formal ("Amigable: punto de venta y
// control de inventario") con su variante ("control de lo que ya es suyo").
//
// Reglas de legibilidad (CLAUDE.md): colores sólidos hex, sin opacidad en
// texto, tamaños >=13px, color + -webkit-text-fill-color con !important y
// bloque prefers-color-scheme:dark repetido para que iOS/WhatsApp no oscurezca.
(function () {
  'use strict';

  const FLAG = 'f123_bienvenida_v3'; // subir versión = volver a mostrarla
  // v3 (2026-07-16): bug corregido — auth-ui.js marcaba esta flag como "vista"
  // en el momento de activar (antes de que el wizard se mostrara ni una vez).
  // Subir la version fuerza a que TODOS los dispositivos ya activados (incluidos
  // clientes reales de JFC) vean el wizard de verdad al menos una vez.
  const FLAG_CONFIRMADO = 'f123_bienvenida_confirmada'; // 2do login: exige confirmar, no solo cerrar

  const css = document.createElement('style');
  // Paleta: SOLO el chasis Sinclair Bloom oficial de index.html (plata
  // #C4CDD8, tinta azul #0F1923, brass #5294AC, rust #E86040, fondo frio
  // #F8F9FB). PROHIBIDO beige/ocre/castano aqui — regla JFC 2026-07-07:
  // "respeta el color scheme del index". Se usan var() con fallback al hex
  // oficial por si este script cargara fuera de index.html.
  css.textContent = `
  .am-welcome-overlay{position:fixed;inset:0;z-index:9997;background:var(--azul-oscuro,#0F1923);
    display:none;align-items:center;justify-content:center;padding:20px;}
  .am-welcome-overlay.abierto{display:flex;}
  .am-welcome-card{background:var(--blanco-calido,#F8F9FB);width:100%;max-width:440px;border-radius:14px;
    border:2px solid var(--sim-plata,#C4CDD8);border-top:4px solid var(--brass,#5294AC);
    padding:30px 24px 26px;text-align:center;box-shadow:0 12px 40px #060d14;}
  .am-welcome-overlay .marca{font-family:var(--font-mono,monospace);font-size:14px;font-weight:700;
    letter-spacing:.14em;text-transform:uppercase;color:#2E6278 !important;-webkit-text-fill-color:#2E6278 !important;margin:0 0 6px;}
  .am-welcome-overlay h2{font-family:var(--font-display,sans-serif);font-size:27px;font-weight:700;line-height:1.15;
    color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;margin:0 0 12px;}
  .am-welcome-overlay .tagline{font-family:var(--font-display,sans-serif);font-size:22px;font-weight:700;
    color:#E86040 !important;-webkit-text-fill-color:#E86040 !important;margin:0 0 4px;}
  .am-welcome-overlay .formal{font-family:var(--font-mono,monospace);font-size:14px;
    color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;margin:0 0 18px;}
  .am-welcome-overlay .cuerpo{font-family:var(--font-body,sans-serif);font-size:16px;line-height:1.5;
    color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;margin:0 0 22px;}
  .am-welcome-overlay button{width:100%;min-height:48px;padding:14px;border-radius:9px;border:2px solid var(--brass,#5294AC);
    background:var(--azul-oscuro,#0F1923);color:#F8F9FB !important;-webkit-text-fill-color:#F8F9FB !important;
    font-family:var(--font-display,sans-serif);font-size:16px;font-weight:700;cursor:pointer;}
  /* "Ver la guia": secundario (outline plata/azul) sobre el primario "Empezar" */
  .am-welcome-overlay button#am-welcome-guia{background:transparent;border-color:var(--azul-medio,#2E6278);
    color:#2E6278 !important;-webkit-text-fill-color:#2E6278 !important;margin:0 0 10px;}
  @media (prefers-color-scheme: dark){
    .am-welcome-overlay{background:#0F1923;}
    .am-welcome-card{background:#F8F9FB;}
    .am-welcome-overlay .marca, .am-welcome-overlay .formal{color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;}
    .am-welcome-overlay .marca{color:#2E6278 !important;-webkit-text-fill-color:#2E6278 !important;}
    .am-welcome-overlay h2, .am-welcome-overlay .cuerpo{color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;}
    .am-welcome-overlay .tagline{color:#E86040 !important;-webkit-text-fill-color:#E86040 !important;}
    .am-welcome-overlay button{color:#F8F9FB !important;-webkit-text-fill-color:#F8F9FB !important;}
    .am-welcome-overlay button#am-welcome-guia{color:#2E6278 !important;-webkit-text-fill-color:#2E6278 !important;}
  }
  @media (prefers-reduced-motion: no-preference){
    .am-welcome-overlay.abierto .am-welcome-card{animation:amwin .28s ease;}
    @keyframes amwin{from{transform:translateY(14px);}to{transform:translateY(0);}}
  }
  #am-rec-card label{display:flex;align-items:flex-start;gap:10px;text-align:left;font-family:var(--font-body,sans-serif);
    font-size:15px;line-height:1.4;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;margin:0 0 20px;cursor:pointer;}
  #am-rec-card input[type=checkbox]{width:22px;height:22px;min-width:22px;margin-top:1px;accent-color:var(--brass,#5294AC);}
  .am-welcome-overlay button:disabled{background:#8B95A1;border-color:#8B95A1;color:#F8F9FB !important;-webkit-text-fill-color:#F8F9FB !important;cursor:not-allowed;}
  @media (prefers-color-scheme: dark){
    #am-rec-card label{color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;}
  }`;
  document.head.appendChild(css);

  const modal = document.createElement('div');
  modal.id = 'am-welcome';
  modal.className = 'am-welcome-overlay';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div id="am-welcome-card" class="am-welcome-card" role="dialog" aria-label="Welcome">
      <p class="marca">friendly-123</p>
      <h2>Welcome</h2>
      <p class="tagline">Manage your business, in color</p>
      <p class="formal">Inventory management · clients · commissions · racks</p>
      <p class="cuerpo">Managing your business doesn't have to be complicated. Products talk in colors that light up when action is needed: green when everything's good, gold when money is waiting, red when it's time to move. Works offline. Your data is yours alone. No subscriptions, no ads.</p>
      <button id="am-welcome-guia">See the guide</button>
      <button id="am-welcome-ok">Get started</button>
    </div>`;
  document.body.appendChild(modal);

  // Recordatorio (2do login sin confirmar): a diferencia del modal de arriba,
  // este NO se puede cerrar clickeando afuera ni con un boton neutro — exige
  // tildar el checkbox para habilitar "Continue". Intencional (JFC 2026-07-16):
  // "es mejor cargosearles" que dejar que alguien distraido se lo salte.
  const reminder = document.createElement('div');
  reminder.id = 'am-welcome-reminder';
  reminder.className = 'am-welcome-overlay';
  reminder.setAttribute('aria-hidden', 'true');
  reminder.innerHTML = `
    <div id="am-rec-card" class="am-welcome-card" role="dialog" aria-label="Confirm you watched the welcome tutorial">
      <p class="marca">friendly-123</p>
      <h2>Quick check</h2>
      <p class="cuerpo" style="margin-bottom:16px;">Before you continue, confirm you went through the welcome tutorial. It only takes a minute and it's how everything below will make sense.</p>
      <button id="am-rec-ver" style="width:100%;min-height:44px;padding:10px;border-radius:7px;border:2px solid var(--brass,#5294AC);background:transparent;color:var(--azul-medio,#2E6278) !important;-webkit-text-fill-color:var(--azul-medio,#2E6278) !important;font-family:var(--font-display,sans-serif);font-size:15px;font-weight:700;cursor:pointer;margin:0 0 14px;">See the tutorial now</button>
      <label><input type="checkbox" id="am-rec-check"> Yes, I already went through the welcome tutorial</label>
      <button id="am-rec-continuar" disabled>Continue</button>
    </div>`;
  document.body.appendChild(reminder);

  function cerrar() {
    modal.classList.remove('abierto');
    try { localStorage.setItem(FLAG, '1'); } catch (_) { /* modo privado: se mostrará otra vez, aceptable */ }
  }
  document.getElementById('am-welcome-ok').addEventListener('click', cerrar);
  // "Ver la guia" cierra la bienvenida (queda marcada como vista) y abre la
  // Ayuda completa via la API de help-ui.js. La Ayuda sigue siempre
  // disponible en el boton (?) — esto es solo el atajo del primer minuto.
  document.getElementById('am-welcome-guia').addEventListener('click', () => {
    cerrar();
    if (window.OCHelp && window.OCHelp.abrir) window.OCHelp.abrir();
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });

  const recCheck = document.getElementById('am-rec-check');
  const recBtn = document.getElementById('am-rec-continuar');
  recCheck.addEventListener('change', () => { recBtn.disabled = !recCheck.checked; });
  recBtn.addEventListener('click', () => {
    if (recCheck.checked) {
      try { localStorage.setItem(FLAG_CONFIRMADO, '1'); } catch (_) {}
      reminder.classList.remove('abierto');
    }
  });
  document.getElementById('am-rec-ver').addEventListener('click', () => {
    reminder.classList.remove('abierto');
    modal.classList.add('abierto');
  });
  // Sin click-outside-to-close ni tecla Escape aqui a proposito: el candado
  // de confirmacion es el punto entero de este modal.

  function quizasMostrar() {
    let visto = false, confirmado = false;
    try { visto = localStorage.getItem(FLAG) === '1'; } catch (_) {}
    try { confirmado = localStorage.getItem(FLAG_CONFIRMADO) === '1'; } catch (_) {}
    if (!visto) { modal.classList.add('abierto'); return; }
    if (!confirmado) reminder.classList.add('abierto');
  }

  // API para "Ver el tutorial de bienvenida nuevamente" en Ayuda (help-ui.js).
  // Reabre el wizard completo sin tocar ninguna flag — es solo un replay.
  window.OCWelcome = { abrir: () => modal.classList.add('abierto') };

  // SOLO tras un login real (evento oc-login que auth-ui dispara DESPUÉS de
  // ocultar el candado). Regla JFC 2026-07-07: la bienvenida JAMÁS puede
  // aparecer antes de digitar el PIN, ni saltárselo. Doble candado: si por
  // cualquier razón #oc-gate sigue visible, no se muestra nada.
  window.addEventListener('oc-login', (e) => {
    // Solo mostrar al dueño — no empleado, contador, ni demo
    if (!e.detail || e.detail.rol !== 'dueno' || e.detail.demo) return;
    const gate = document.getElementById('oc-gate');
    if (gate && gate.style.display !== 'none') return; // candado visible: ni hablar
    quizasMostrar();
  });
})();
