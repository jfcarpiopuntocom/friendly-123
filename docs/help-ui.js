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

  // Contenido del DUEÑO: cubre todo el sistema con lenguaje des-abrumador.
  // Sistema Simon: colores = vocabulario visual del dinero, no decoración.
  // Verde=saludable, Dorado=oportunidad, Naranja=urgente, Rojo=emergencia,
  // Azul=sabiduría (tips/consejos, la capa contable es solo UNA aplicación),
  // Negro=inventario muerto. (JFC 2026-07-04, corrigio "azul=solo contable")
  const AYUDA_DUENO = `
    <span class="rolTag">Guía del dueño</span>
    <h3>Los colores son el idioma de tu negocio</h3>
    <p style="font-size:14px;line-height:1.6;margin:0 0 10px;">
      Tu negocio habla en colores. Verde: todo bien. Rojo: actúa ya. Dorado: hay plata ahí.
      Sin hoja de cálculo, sin terminología contable.
    </p>
    <ul>
      <li><b style="color:#00C87A;">Verde</b>: todo marcha bien. Sigue así.</li>
      <li><b style="color:#E8A020;">Dorado</b>: hay dinero esperándote.</li>
      <li><b style="color:#F97316;">Naranja</b>: se está acabando — revísalo pronto, antes de que sea emergencia.</li>
      <li><b style="color:#E8365D;">Rojo</b>: emergencia — actúa ahora.</li>
      <li><b style="color:#5294AC;">Azul</b>: sabiduría — tips y consejos útiles para tu negocio. (La capa contable es una parte de esto.)</li>
      <li><b style="color:#0A0A0F;">Negro</b>: tu dinero está descansando ahí. Haz que vuelva a trabajar.</li>
    </ul>
    <h3>Hoy: tu semáforo del día</h3>
    <ul>
      <li>Cada mañana, antes de abrir tu negocio, mira esta pantalla. Ella te dirá exactamente por dónde empezar.</li>
      <li>Un solo vistazo: cuánto entró, cuánto salió, qué pide acción.</li>
      <li>El color del encabezado refleja el estado general del día.</li>
    </ul>
    <h3>Inventario y Vender</h3>
    <ul>
      <li>En Vender: toca el producto en la cuadrícula y listo — una unidad vendida (puedes deshacer). También puedes escanear o buscar por código.</li>
      <li>¿No registraste en vivo? Usa el Cierre del día: apunta cuánto salió de cada producto y aplica todo junto.</li>
      <li>Cada movimiento queda registrado con motivo y quién lo hizo.</li>
    </ul>
    <h3>Avanzado (solo tú, candado aparte)</h3>
    <ul>
      <li><b>Gastos fijos</b>: arriendo, luz, sueldos — se dividen en 30 días para saber cuánto cuesta abrir mañana.</li>
      <li><b>Capa contable azul</b>: cuentas T, pérdidas y ganancias, balance. Tiene su propio código — distinto al de entrada.</li>
      <li><b>Claves y recuperación</b>: guarda tu correo antes de cambiar cualquier clave. Sin correo registrado no hay recuperación posible.</li>
    </ul>
    <h3>Seguridad sin paranoia</h3>
    <p>Tus 3 claves se guardan cifradas en este dispositivo. El teclado mezcla los números con un emoji diferente cada vez — nadie puede memorizarlos mirando por encima de tu hombro.</p>
  `;

  // Contenido del EMPLEADO: solo lo operativo del turno, lenguaje simple.
  // Sin mención a claves, gastos ni contabilidad — esa capa no le aparece.
  const AYUDA_EMPLEADO = `
    <span class="rolTag">Guía del empleado</span>
    <h3>Los colores te dicen qué está pasando</h3>
    <ul>
      <li><b style="color:#00C87A;">Verde</b>: bien. <b style="color:#E8A020;">Dorado</b>: hay dinero ahí. <b style="color:#F97316;">Naranja</b>: avisar al dueño pronto. <b style="color:#E8365D;">Rojo</b>: avisar ya.</li>
      <li><b style="color:#5294AC;">Azul</b>: tip o consejo útil. <b style="color:#0A0A0F;">Negro</b>: no se vende, avisa al dueño.</li>
      <li>No necesitas interpretar nada — el color hace el trabajo.</li>
    </ul>
    <h3>Tu turno en 4 pasos</h3>
    <ul>
      <li><b>Hoy</b>: mira el resumen del día al entrar. Si hay rojo, avisa.</li>
      <li><b>Vender</b>: toca el producto en la cuadrícula, o escanea/escribe su código si no lo encuentras rápido.</li>
      <li><b>Vender</b>: toca "Vender 1" para descontar del stock al momento.</li>
      <li><b>Ajustar</b>: si algo se rompió, se venció o el conteo estaba mal — usa Ajustar y escribe el motivo. Queda registrado.</li>
    </ul>
    <h3>Etiquetas</h3>
    <p>Si necesitas reimprimir una etiqueta perdida o dañada, búscala por nombre o código.</p>
  `;

  const modal = document.createElement("div");
  modal.id = "oc-help-modal";
  modal.innerHTML = `<div id="oc-help-sheet">
    <h2>¿Cómo funciona friendly-123?</h2>
    <!-- Slogan informal de Amigable (JFC 2026-07-02): "tu negocio, a color".
         Va aquí y en la bienvenida (welcome-ui.js). El formal "Amigable: punto
         de venta y control de inventario" vive en el footer y la bienvenida. -->
    <p style="font-family:var(--font-display,sans-serif);color:#E8A020;font-size:15px;font-weight:700;margin:0 0 14px;">Tu negocio, a color</p>
    <div id="oc-help-body"></div>
    <button id="oc-help-cerrar">Entendido</button>
  </div>`;
  document.body.appendChild(modal);

  const btn = document.createElement("button");
  btn.id = "oc-help-btn";
  btn.textContent = "Ayuda (?)";

  // brandWrap: logo friendly-123 encima del botón Ayuda, igual que AMIGABLE.
  // ESTADO APROBADO POR JFC (2026-07-15). NO CAMBIAR ESTRUCTURA.
  // - Logo: logo.png (wordmark coloreado), height:22px, clickeable → va a Hoy
  // - Btn: "Ayuda (?)" debajo del logo
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
    document.getElementById("oc-help-body").innerHTML = rol === "empleado" ? AYUDA_EMPLEADO : AYUDA_DUENO;
    modal.classList.add("abierto");
  }
  btn.addEventListener("click", abrir);
  // API minima para otros modulos (welcome-ui.js usa "Ver la guia" en la
  // bienvenida). No exponer mas que abrir().
  window.OCHelp = { abrir };
  document.getElementById("oc-help-cerrar").addEventListener("click", () => modal.classList.remove("abierto"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("abierto"); });

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
