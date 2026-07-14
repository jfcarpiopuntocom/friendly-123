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

  const FLAG = 'amigable_bienvenida_v2'; // subir versión = volver a mostrarla

  const css = document.createElement('style');
  // Paleta: SOLO el chasis Sinclair Bloom oficial de index.html (plata
  // #C4CDD8, tinta azul #0F1923, brass #5294AC, rust #E86040, fondo frio
  // #F8F9FB). PROHIBIDO beige/ocre/castano aqui — regla JFC 2026-07-07:
  // "respeta el color scheme del index". Se usan var() con fallback al hex
  // oficial por si este script cargara fuera de index.html.
  css.textContent = `
  #am-welcome{position:fixed;inset:0;z-index:9997;background:var(--azul-oscuro,#0F1923);
    display:none;align-items:center;justify-content:center;padding:20px;}
  #am-welcome.abierto{display:flex;}
  #am-welcome-card{background:var(--blanco-calido,#F8F9FB);width:100%;max-width:440px;border-radius:14px;
    border:2px solid var(--sim-plata,#C4CDD8);border-top:4px solid var(--brass,#5294AC);
    padding:30px 24px 26px;text-align:center;box-shadow:0 12px 40px #060d14;}
  #am-welcome .marca{font-family:var(--font-mono,monospace);font-size:14px;font-weight:700;
    letter-spacing:.14em;text-transform:uppercase;color:#2E6278 !important;-webkit-text-fill-color:#2E6278 !important;margin:0 0 6px;}
  #am-welcome h2{font-family:var(--font-display,sans-serif);font-size:27px;font-weight:700;line-height:1.15;
    color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;margin:0 0 12px;}
  #am-welcome .tagline{font-family:var(--font-display,sans-serif);font-size:22px;font-weight:700;
    color:#E86040 !important;-webkit-text-fill-color:#E86040 !important;margin:0 0 4px;}
  #am-welcome .formal{font-family:var(--font-mono,monospace);font-size:14px;
    color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;margin:0 0 18px;}
  #am-welcome .cuerpo{font-family:var(--font-body,sans-serif);font-size:16px;line-height:1.5;
    color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;margin:0 0 22px;}
  #am-welcome button{width:100%;min-height:48px;padding:14px;border-radius:9px;border:2px solid var(--brass,#5294AC);
    background:var(--azul-oscuro,#0F1923);color:#F8F9FB !important;-webkit-text-fill-color:#F8F9FB !important;
    font-family:var(--font-display,sans-serif);font-size:16px;font-weight:700;cursor:pointer;}
  /* "Ver la guia": secundario (outline plata/azul) sobre el primario "Empezar" */
  #am-welcome button#am-welcome-guia{background:transparent;border-color:var(--azul-medio,#2E6278);
    color:#2E6278 !important;-webkit-text-fill-color:#2E6278 !important;margin:0 0 10px;}
  @media (prefers-color-scheme: dark){
    #am-welcome{background:#0F1923;}
    #am-welcome-card{background:#F8F9FB;}
    #am-welcome .marca, #am-welcome .formal{color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;}
    #am-welcome .marca{color:#2E6278 !important;-webkit-text-fill-color:#2E6278 !important;}
    #am-welcome h2, #am-welcome .cuerpo{color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;}
    #am-welcome .tagline{color:#E86040 !important;-webkit-text-fill-color:#E86040 !important;}
    #am-welcome button{color:#F8F9FB !important;-webkit-text-fill-color:#F8F9FB !important;}
    #am-welcome button#am-welcome-guia{color:#2E6278 !important;-webkit-text-fill-color:#2E6278 !important;}
  }
  @media (prefers-reduced-motion: no-preference){
    #am-welcome.abierto #am-welcome-card{animation:amwin .28s ease;}
    @keyframes amwin{from{transform:translateY(14px);}to{transform:translateY(0);}}
  }`;
  document.head.appendChild(css);

  const modal = document.createElement('div');
  modal.id = 'am-welcome';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div id="am-welcome-card" role="dialog" aria-label="Bienvenida">
      <p class="marca">Amigable-123</p>
      <h2>Bienvenido</h2>
      <p class="tagline">Tu negocio, a color</p>
      <p class="formal">Control de inventario, clientes y perchas</p>
      <p class="cuerpo">Manejar tu negocio no tiene por qué ser aburrido ni abrumador. Aquí tus productos hablan en colores que se encienden solos cuando hay que actuar: verde si todo marcha bien, dorado si hay dinero esperándote, rojo si toca actuar ya. Funciona sin internet, tus datos son solo tuyos, y no hay suscripciones ni anuncios de nadie.</p>
      <button id="am-welcome-guia">Ver la guía</button>
      <button id="am-welcome-ok">Empezar</button>
    </div>`;
  document.body.appendChild(modal);

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

  function quizasMostrar() {
    let visto = false;
    try { visto = localStorage.getItem(FLAG) === '1'; } catch (_) {}
    if (!visto) modal.classList.add('abierto');
  }

  // SOLO tras un login real (evento oc-login que auth-ui dispara DESPUÉS de
  // ocultar el candado). Regla JFC 2026-07-07: la bienvenida JAMÁS puede
  // aparecer antes de digitar el PIN, ni saltárselo. Doble candado: si por
  // cualquier razón #oc-gate sigue visible, no se muestra nada. Y sale UNA
  // sola vez por dispositivo (FLAG) — nunca "a cada rato", no corta el flow.
  window.addEventListener('oc-login', () => {
    const gate = document.getElementById('oc-gate');
    if (gate && gate.style.display !== 'none') return; // candado visible: ni hablar
    quizasMostrar();
  });
})();
