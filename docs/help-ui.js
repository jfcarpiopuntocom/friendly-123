// help-ui.js — Enlace de ayuda "Ayuda(?)" bajo el botón Salir del header (NO
// es un botón flotante estilo chat/WhatsApp — JFC lo pidió explícitamente
// discreto, parte del header, no una burbuja llamativa). Contenido DISTINTO
// según el rol activo (dueño vs empleado): el dueño necesita entender todo
// el sistema (capa contable, claves, gastos); el empleado solo necesita lo
// operativo del día a día (escanear, vender, leer el semáforo). Depende de
// auth-ui.js (escucha el evento "oc-login" para saber qué rol mostrar y para
// encontrar el botón #oc-logout, debajo del cual se inserta este enlace).
//
// REACTIVADO 2026-07-01 (JFC): indispensable, sobre todo con el timeout de
// inactividad activo. NUNCA quitar/ocultar sin que JFC lo pida en el mismo turno.
(function () {
  const AYUDA_HABILITADA = true;
  if (!AYUDA_HABILITADA) return;

  const css = document.createElement("style");
  css.textContent = `
  #oc-help-btn{display:none;margin-top:6px;background:none;border:none;
    font-family:var(--font-display,sans-serif);font-size:13px;color:var(--blanco-calido,#F8F9FB);
    text-decoration:underline;cursor:pointer;padding:4px;}
  #oc-help-modal{position:fixed;inset:0;z-index:9998;background:rgba(28,48,73,.85);
    display:none;align-items:flex-end;justify-content:center;padding:0;}
  #oc-help-modal.abierto{display:flex;}
  #oc-help-sheet{background:var(--blanco-calido,#F8F9FB);width:100%;max-width:520px;max-height:82vh;
    overflow-y:auto;border-radius:16px 16px 0 0;padding:22px 20px 28px;}
  #oc-help-sheet h2{font-family:var(--font-display,sans-serif);color:var(--ink,#0F1923);margin:0 0 4px;font-size:22px;}
  #oc-help-sheet .rolTag{display:inline-block;font-size:13px;font-weight:700;padding:3px 10px;border-radius:12px;
    margin-bottom:14px;background:var(--azul-medio,#2E6278);color:var(--blanco-calido,#F8F9FB);}
  #oc-help-sheet h3{font-family:var(--font-display,sans-serif);color:var(--ink,#0F1923);font-size:16px;margin:18px 0 6px;}
  #oc-help-sheet p, #oc-help-sheet li{font-size:15px;color:var(--ink-soft,#2C3E50);line-height:1.5;}
  #oc-help-sheet ul{margin:0 0 4px;padding-left:20px;}
  #oc-help-cerrar{margin-top:18px;width:100%;padding:12px;border-radius:8px;border:2px solid var(--azul-medio,#2E6278);
    background:var(--azul-medio,#2E6278);color:var(--blanco-calido,#F8F9FB);font-family:var(--font-display,sans-serif);
    font-size:15px;cursor:pointer;min-height:44px;}
  `;
  document.head.appendChild(css);

  // AYUDA_DUENO/AYUDA_EMPLEADO — updated 2026-07-15 per JFC: reflects true product
  // identity. This is NOT a POS. It is inventory management for vendors, promoters,
  // and commission tracking — built around "perchas" (slots/racks) as the core unit,
  // color-coded for instant interpretation, data always local (you own it).
  // 2 years of patches and updates included — vs the industry standard of 1.
  // Bilingual (2026-07-17 fix): content is picked per current i18n.js language —
  // see ayudaDuenoHTML()/ayudaEmpleadoHTML() below.
  const AYUDA_DUENO_EN = `
    <span class="rolTag">Owner's guide</span>
    <h3>What friendly-123 actually is</h3>
    <p style="font-size:14px;line-height:1.6;margin:0 0 10px;">
      Not a cash register. An inventory management system for vendors, promoters,
      and commission tracking — organized around <b>perchas</b> (your slots, racks,
      or locations) as the essential unit. Colors replace spreadsheets. Your data
      stays on your device: no subscription lock-in, no cloud required.
    </p>
    <h3>The color language (Simon system)</h3>
    <ul>
      <li><b style="color:#00C87A;">Green</b>: healthy — keep going.</li>
      <li><b style="color:#E8A020;">Gold</b>: money sitting there — act on it.</li>
      <li><b style="color:#F97316;">Orange</b>: running low — restock before it becomes a problem.</li>
      <li><b style="color:#E8365D;">Red</b>: emergency — act now.</li>
      <li><b style="color:#5294AC;">Blue</b>: wisdom — tips, insights, and the accounting layer.</li>
      <li><b style="color:#0A0A0F;">Black</b>: dead stock — your money isn't moving. Fix that.</li>
    </ul>
    <h3>Today: your daily signal</h3>
    <ul>
      <li>One glance at Today tells you what needs attention before you open.</li>
      <li>The header color reflects the overall state of the day.</li>
      <li>Didn't log sales live? Use Day Close to record everything at once.</li>
    </ul>
    <h3>Sold (not "sell")</h3>
    <ul>
      <li>Tap a product in the grid — one unit logged as sold. Undo within 5 seconds.</li>
      <li>Every movement is recorded with reason and who did it.</li>
      <li>Commissions calculate automatically per percha and per vendor.</li>
    </ul>
    <h3>Advanced (your lock, your rules)</h3>
    <ul>
      <li><b>Fixed costs</b>: rent, utilities, payroll — divided across 30 days so you know the real cost of opening tomorrow.</li>
      <li><b>Accounting layer</b>: T-accounts, P&amp;L, balance sheet. Separate PIN — your accountant or partner can access it directly without seeing the full system.</li>
      <li><b>Keys and recovery</b>: save your email before changing any PIN. No email on file = no recovery possible.</li>
    </ul>
    <h3>What data leaves this device?</h3>
    <p style="font-size:14px;line-height:1.6;margin:0 0 10px;">
      Short answer: your business data never does. Products, sales, customers, inventory,
      photos — all of it stays in this browser, on this device, always. The only thing
      that's ever sent anywhere is your <b>license</b>: a random device ID, and (only if
      you chose to enter them) your name, email, license code, and WhatsApp number — so
      we can recover your access or reach you if needed. Nothing else, ever, under any
      feature. See <a href="https://github.com/jfcarpiopuntocom/friendly-123/blob/main/PRIVACY.md" target="_blank" rel="noopener" style="color:#5294AC;">PRIVACY.md</a>
      for the full detail, or just open DevTools → Network and watch for yourself.
    </p>
    <h3>Ownership and updates</h3>
    <p style="font-size:14px;line-height:1.6;margin:0 0 14px;">
      Your data lives on this device — no server has it, no subscription can take it away.
      Activation unlocks unlimited products and exports. Includes <b>2 years of patches
      and updates</b> (the industry standard is 1).
    </p>
    <h3>The promise</h3>
    <ul style="font-size:14px;line-height:1.6;">
      <li>Saves you <b>50% of your time</b> versus doing it by hand.</li>
      <li>You learn it <b>in 10 minutes</b> — no manual required.</li>
      <li>Built to <b>last 10 years</b> — no subscription can take it away.</li>
    </ul>
    <h3>Your license</h3>
    <p style="font-size:14px;line-height:1.6;margin:0 0 14px;">
      A private license: permanent use of the app, enforced consensually and without invoking
      intellectual property claims against you. The app itself lives on our website — but
      everything you enter stays on your devices only. It never goes up to any "cloud" or
      central server.
    </p>
    <button id="oc-help-ver-bienvenida" style="width:100%;min-height:44px;padding:10px;border-radius:8px;
      border:2px solid var(--azul-medio,#2E6278);background:transparent;color:var(--azul-medio,#2E6278);
      font-family:var(--font-display,sans-serif);font-size:14px;font-weight:700;cursor:pointer;">
      Take the guided tutorial
    </button>
  `;

  const AYUDA_DUENO_ES = `
    <span class="rolTag">Guía del dueño</span>
    <h3>Qué es friendly-123 en realidad</h3>
    <p style="font-size:14px;line-height:1.6;margin:0 0 10px;">
      No es una caja registradora. Es un sistema de gestión de inventario para
      vendedores, promotoras y control de comisiones — organizado alrededor de
      <b>perchas</b> (tus espacios, racks o ubicaciones) como unidad esencial. Los
      colores reemplazan a las hojas de cálculo. Tus datos se quedan en tu
      dispositivo: sin suscripción atada, sin necesidad de nube.
    </p>
    <h3>El lenguaje de colores (sistema Simon)</h3>
    <ul>
      <li><b style="color:#00C87A;">Verde</b>: saludable — sigue así.</li>
      <li><b style="color:#E8A020;">Dorado</b>: plata quieta ahí — actúa.</li>
      <li><b style="color:#F97316;">Naranja</b>: se está agotando — reabastece antes de que sea problema.</li>
      <li><b style="color:#E8365D;">Rojo</b>: emergencia — actúa ya.</li>
      <li><b style="color:#5294AC;">Azul</b>: sabiduría — tips, insights y la capa contable.</li>
      <li><b style="color:#0A0A0F;">Negro</b>: stock muerto — tu plata no se mueve. Arregla eso.</li>
    </ul>
    <h3>Hoy: tu señal diaria</h3>
    <ul>
      <li>Un vistazo a Hoy te dice qué necesita atención antes de abrir.</li>
      <li>El color del encabezado refleja el estado general del día.</li>
      <li>¿No registraste ventas en vivo? Usa Cierre de día para anotar todo de una vez.</li>
    </ul>
    <h3>Vendido (no "vender")</h3>
    <ul>
      <li>Toca un producto en la grilla — una unidad se registra como vendida. Deshazlo en 5 segundos.</li>
      <li>Cada movimiento queda registrado con motivo y quién lo hizo.</li>
      <li>Las comisiones se calculan automáticamente por percha y por vendedor.</li>
    </ul>
    <h3>Avanzado (tu clave, tus reglas)</h3>
    <ul>
      <li><b>Gastos fijos</b>: alquiler, servicios, planilla — divididos entre los días reales del mes para que sepas el costo real de abrir mañana.</li>
      <li><b>Capa contable</b>: cuentas T, P&amp;G, balance. PIN separado — tu contador o socio puede entrar directo sin ver todo el sistema.</li>
      <li><b>Claves y recuperación</b>: guarda tu correo antes de cambiar cualquier PIN. Sin correo registrado no hay recuperación posible.</li>
    </ul>
    <h3>¿Qué datos salen de este dispositivo?</h3>
    <p style="font-size:14px;line-height:1.6;margin:0 0 10px;">
      Respuesta corta: tus datos de negocio nunca salen. Productos, ventas, clientes,
      inventario, fotos — todo se queda en este navegador, en este dispositivo, siempre.
      Lo único que se envía alguna vez es tu <b>licencia</b>: un ID de dispositivo
      aleatorio, y (solo si decidiste ingresarlos) tu nombre, correo, código de licencia
      y número de WhatsApp — para poder recuperar tu acceso o contactarte si hace falta.
      Nada más, nunca, en ninguna función. Ve <a href="https://github.com/jfcarpiopuntocom/friendly-123/blob/main/PRIVACY.md" target="_blank" rel="noopener" style="color:#5294AC;">PRIVACY.md</a>
      para el detalle completo, o abre DevTools → Network y compruébalo tú mismo.
    </p>
    <h3>Propiedad y actualizaciones</h3>
    <p style="font-size:14px;line-height:1.6;margin:0 0 14px;">
      Tus datos viven en este dispositivo — ningún servidor los tiene, ninguna
      suscripción te los puede quitar. La activación desbloquea productos y
      exportaciones ilimitadas. Incluye <b>2 años de parches y actualizaciones</b>
      (el estándar de la industria es 1).
    </p>
    <h3>La promesa</h3>
    <ul style="font-size:14px;line-height:1.6;">
      <li>Te ahorra <b>50% de tu tiempo</b> comparado con hacerlo a mano.</li>
      <li>Se aprende <b>en 10 minutos</b> — sin manual necesario.</li>
      <li>Construida para <b>durar 10 años</b> — ninguna suscripción te la puede quitar.</li>
    </ul>
    <h3>Tu licencia</h3>
    <p style="font-size:14px;line-height:1.6;margin:0 0 14px;">
      Licencia privada: uso permanente de la app, con cumplimiento consensuado
      y sin invocar propiedad intelectual en tu contra. La app en sí vive en
      nuestro sitio web — pero todo lo que tú ingresas se mantiene solamente
      en tus dispositivos. Nunca sube a ninguna "nube" ni servidor central.
    </p>
    <button id="oc-help-ver-bienvenida" style="width:100%;min-height:44px;padding:10px;border-radius:8px;
      border:2px solid var(--azul-medio,#2E6278);background:transparent;color:var(--azul-medio,#2E6278);
      font-family:var(--font-display,sans-serif);font-size:14px;font-weight:700;cursor:pointer;">
      Hacer el tutorial guiado
    </button>
  `;

  // AYUDA_EMPLEADO: operational only — no mention of PINs, costs, or accounting.
  const AYUDA_EMPLEADO_EN = `
    <span class="rolTag">Vendor / promoter guide</span>
    <h3>Colors tell you what's happening</h3>
    <ul>
      <li><b style="color:#00C87A;">Green</b>: good. <b style="color:#E8A020;">Gold</b>: money waiting. <b style="color:#F97316;">Orange</b>: alert the owner soon. <b style="color:#E8365D;">Red</b>: alert now.</li>
      <li><b style="color:#0A0A0F;">Black</b>: not moving — flag it to the owner.</li>
      <li>You don't need to interpret anything — the color does the work.</li>
    </ul>
    <h3>Your shift in 3 steps</h3>
    <ul>
      <li><b>Today</b>: check the daily summary when you arrive. Red means alert the owner.</li>
      <li><b>Sold</b>: tap the product in the grid — one unit logged. Or scan / type the code if you can't find it fast.</li>
      <li><b>Adjust</b>: something broke, expired, or the count was off? Use Adjust and write the reason. It stays on record.</li>
    </ul>
    <h3>Labels</h3>
    <p>Need to reprint a lost or damaged label? Find it by name or code in the Labels tab.</p>
  `;

  const AYUDA_EMPLEADO_ES = `
    <span class="rolTag">Guía de vendedor / promotora</span>
    <h3>Los colores te dicen qué está pasando</h3>
    <ul>
      <li><b style="color:#00C87A;">Verde</b>: bien. <b style="color:#E8A020;">Dorado</b>: plata esperando. <b style="color:#F97316;">Naranja</b>: avisa al dueño pronto. <b style="color:#E8365D;">Rojo</b>: avisa ya.</li>
      <li><b style="color:#0A0A0F;">Negro</b>: no se mueve — repórtalo al dueño.</li>
      <li>No necesitas interpretar nada — el color hace el trabajo.</li>
    </ul>
    <h3>Tu turno en 3 pasos</h3>
    <ul>
      <li><b>Hoy</b>: revisa el resumen diario al llegar. Rojo significa avisar al dueño.</li>
      <li><b>Vendido</b>: toca el producto en la grilla — una unidad registrada. O escanea / escribe el código si no lo encuentras rápido.</li>
      <li><b>Ajustar</b>: ¿algo se rompió, venció o el conteo estaba mal? Usa Ajustar y escribe el motivo. Queda en el registro.</li>
    </ul>
    <h3>Etiquetas</h3>
    <p>¿Necesitas reimprimir una etiqueta perdida o dañada? Búscala por nombre o código en la pestaña Etiquetas.</p>
  `;

  function ayudaDuenoHTML() {
    return (window.OCI18n && window.OCI18n.getLang() === "es") ? AYUDA_DUENO_ES : AYUDA_DUENO_EN;
  }
  function ayudaEmpleadoHTML() {
    return (window.OCI18n && window.OCI18n.getLang() === "es") ? AYUDA_EMPLEADO_ES : AYUDA_EMPLEADO_EN;
  }

  const modal = document.createElement("div");
  modal.id = "oc-help-modal";
  modal.innerHTML = `<div id="oc-help-sheet">
    <h2 id="oc-help-titulo">How does friendly-123 work?</h2>
    <!-- Tagline (JFC 2026-07-15): "Manage your business, in color" — marketing promise, not description. -->
    <p id="oc-help-tagline" style="font-family:var(--font-display,sans-serif);color:#E8A020;font-size:15px;font-weight:700;margin:0 0 14px;">Manage your business, in color</p>
    <div id="oc-help-body"></div>
    <button id="oc-help-cerrar">Got it</button>
  </div>`;
  document.body.appendChild(modal);

  const btn = document.createElement("button");
  btn.id = "oc-help-btn";
  btn.textContent = "Help (?)";

  // Bilingue (2026-07-17): re-pinta los textos fijos del modal/boton al cambiar
  // de idioma con window.t(); AYUDA_DUENO/EMPLEADO se re-seleccionan en abrir().
  function pintarTextosFijos() {
    if (!window.t) return;
    btn.textContent = window.t("help.btnLabel");
    const tit = document.getElementById("oc-help-titulo");
    if (tit) tit.textContent = window.t("help.title");
    const tag = document.getElementById("oc-help-tagline");
    if (tag) tag.textContent = window.t("brand.slogan");
    const cerrar = document.getElementById("oc-help-cerrar");
    if (cerrar) cerrar.textContent = window.t("help.gotIt");
  }
  window.addEventListener("oc-lang-change", pintarTextosFijos);
  pintarTextosFijos();

  // brandWrap: logo friendly-123 encima del botón Help, igual que AMIGABLE.
  // ESTADO APROBADO POR JFC (2026-07-15). NO CAMBIAR ESTRUCTURA.
  // - Logo: logo.png (wordmark coloreado), height:22px, clickeable → va a Hoy
  // - Btn: "Help (?)" debajo del logo
  // - Se inserta afterend de #oc-logout en el header (flex child del header)
  // ❌ NO ocultar el img ❌ NO cambiar flex-direction a row
  const brandWrap = document.createElement("div");
  brandWrap.id = "oc-brand-help";
  brandWrap.style.cssText = "display:none;flex-direction:column;align-items:flex-end;gap:2px;margin-left:10px;";

  const brandLogo = document.createElement("img");
  brandLogo.src = "./logo.png";
  brandLogo.alt = "friendly-123";
  brandLogo.title = "Ir a Hoy";
  brandLogo.style.cssText = "height:22px;width:auto;object-fit:contain;display:block;cursor:pointer;";
  brandLogo.onerror = function () { this.style.display = "none"; };
  brandLogo.addEventListener("click", () => {
    const hoy = document.querySelector('nav button[data-vista="hoy"]');
    if (hoy) hoy.click();
  });

  btn.style.marginTop = "0";
  brandWrap.appendChild(brandLogo);
  brandWrap.appendChild(btn);

  function abrir() {
    const rol = window.OCAuth ? window.OCAuth.rolActual() : null;
    pintarTextosFijos();
    document.getElementById("oc-help-body").innerHTML = rol === "empleado" ? ayudaEmpleadoHTML() : ayudaDuenoHTML();
    modal.classList.add("abierto");
  }
  btn.addEventListener("click", abrir);
  // API minima para otros modulos (welcome-ui.js usa "Ver la guia" en la
  // bienvenida). No exponer mas que abrir().
  window.OCHelp = { abrir };
  document.getElementById("oc-help-cerrar").addEventListener("click", () => modal.classList.remove("abierto"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("abierto"); });
  // "See the welcome tutorial again" (JFC 2026-07-16): delegado sobre oc-help-body
  // porque su contenido se reemplaza por completo en cada abrir(). Solo reabre el
  // wizard (window.OCWelcome de welcome-ui.js) — no toca ninguna flag.
  document.getElementById("oc-help-body").addEventListener("click", (e) => {
    if (e.target && e.target.id === "oc-help-ver-bienvenida") {
      modal.classList.remove("abierto");
      if (window.OCTutorial && window.OCTutorial.iniciar) window.OCTutorial.iniciar();
      else if (window.OCWelcome && window.OCWelcome.abrir) window.OCWelcome.abrir();
    }
  });

  window.addEventListener("oc-login", () => {
    const logout = document.getElementById("oc-logout");
    if (logout && logout.parentNode && !document.body.contains(brandWrap)) {
      logout.insertAdjacentElement("afterend", brandWrap);
    }
    brandWrap.style.display = "flex";
    btn.style.display = "block";
  });
  window.addEventListener("oc-logout", () => {
    brandWrap.remove();
    modal.classList.remove("abierto");
  });
})();
