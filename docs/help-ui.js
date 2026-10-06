// help-ui.js — Enlace de ayuda "Ayuda(?)" bajo el botón Salir del header (NO
// es un botón flotante estilo chat/WhatsApp — JFC lo pidió explícitamente
// discreto, parte del header, no una burbuja llamativa). Contenido DISTINTO
// según el rol activo (dueño vs encargado): el dueño necesita entender todo
// el sistema (capa contable, claves, gastos); el encargado solo necesita lo
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
    font-family:var(--font-display,sans-serif);font-size:13px;color:var(--azul-medio,#2c4a68) !important;
    -webkit-text-fill-color:var(--azul-medio,#2c4a68) !important;
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
  /* Ayuda por rol (2026-09-26): pasos numerados, punto de color con tinta oscura, lo
     semanal plegado. Tinta real y 15px: nada gris ni chico. */
  #oc-help-sheet ol.oc-h-pasos{margin:0 0 4px;padding-left:22px;}
  #oc-help-sheet ol.oc-h-pasos li{margin:0 0 6px;color:#0F1923;}
  #oc-help-sheet ul.oc-h-colores{list-style:none;padding-left:0;}
  #oc-help-sheet ul.oc-h-colores li{color:#0F1923;margin:0 0 4px;}
  .oc-h-punto{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:7px;vertical-align:-1px;border:1.5px solid #0F1923;}
  #oc-help-sheet .oc-h-nota{font-size:14px;color:#0F1923;margin:4px 0 8px;}
  #oc-help-sheet details.oc-h-mas{border:2px solid #C9CFC7;border-radius:8px;padding:10px 12px;margin:10px 0;background:#FFFFFF;}
  #oc-help-sheet details.oc-h-mas summary{cursor:pointer;font-family:var(--font-display,sans-serif);font-weight:700;font-size:15px;color:#0F1923;min-height:28px;}
  #oc-help-sheet details.oc-h-mas[open] summary{margin-bottom:6px;}
  
  #oc-help-sheet{position:relative;}
  #oc-help-x{position:sticky; top:0; float:right; margin:-6px -4px 0 0;
    width:44px; height:44px; min-width:44px; border-radius:50%; z-index:5;
    border:2px solid var(--azul-medio,#2E6278); background:var(--blanco-calido,#F8F9FB);
    color:var(--ink,#0F1923); font-size:22px; font-weight:800; line-height:1;
    cursor:pointer; display:flex; align-items:center; justify-content:center;}
  #oc-help-x:active{background:var(--azul-medio,#2E6278); color:#FFFFFF;}
  #oc-help-credito{margin-top:22px; padding-top:14px; border-top:1px solid var(--azul-suave,#dde5ec);
    font-size:14px; line-height:1.5; text-align:center; color:var(--ink-soft,#2C3E50);}
  #oc-help-cerrar{margin-top:18px;width:100%;padding:12px;border-radius:8px;border:2px solid var(--azul-medio,#2E6278);
    background:var(--azul-medio,#2E6278);color:var(--blanco-calido,#F8F9FB);font-family:var(--font-display,sans-serif);
    font-size:15px;cursor:pointer;min-height:44px;}
  #oc-brand-help{overflow:visible;flex-shrink:0;}
  #oc-sync-mini{
    display:inline-flex !important;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;
    font-size:12px;line-height:1.2;font-weight:700;letter-spacing:.02em;margin-top:4px; /* 2026-09-26 Linus b5: minimo 12px */
    border:1.5px solid #14181C;box-sizing:border-box;cursor:default;white-space:nowrap;}
  #oc-sync-mini.sync-on{background:#ffffff !important;border-color:#7f93a4;}
  #oc-sync-mini.sync-on, #oc-sync-mini.sync-on span{
    color:#14181C !important;-webkit-text-fill-color:#14181C !important;}
  #oc-sync-mini.sync-mid{background:#c8c8c8 !important;border-color:#8a8a8a;}
  #oc-sync-mini.sync-mid, #oc-sync-mini.sync-mid span{
    color:#2a2a2a !important;-webkit-text-fill-color:#2a2a2a !important;}
  #oc-sync-mini.sync-off{background:#141414 !important;border-color:#141414;}
  #oc-sync-mini.sync-off, #oc-sync-mini.sync-off span{
    color:#F4F4F4 !important;-webkit-text-fill-color:#F4F4F4 !important;}
  /* Fila de estado + sol/luna (JFC 2026-09-26). En el telefono la PALABRA del estado
     de sync se oculta (el punto queda, y la palabra sigue en aria-label/title para
     lectores de pantalla): ese espacio lo toma el boton de tema. En PC, todo igual. */
  #oc-estado-fila{display:flex;align-items:center;gap:6px;margin-top:4px;}
  #oc-estado-fila #oc-sync-mini{margin-top:0 !important;}
  #oc-tema-toggle{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;
    border-radius:999px;border:1.5px solid #14181C;background:#FFFFFF;color:#0F1923;cursor:pointer;flex-shrink:0;}
  #oc-tema-toggle svg{width:18px;height:18px;display:block;}
  #oc-tema-toggle:focus-visible{outline:3px solid #2E6278;outline-offset:2px;}
  html[data-tema="oscuro"] #oc-sync-mini{box-shadow:0 0 0 2px #FFFFFF;}
  @media (max-width:767px){
    #oc-sync-mini .oc-sync-txt{display:none !important;}
    #oc-sync-mini{padding:4px !important;}
  }
  `;
  document.head.appendChild(css);

  /* AYUDA POR ROL (JFC 2026-09-26: "buena info, util y en el orden en que se necesita por
     rol y para uso real intenso"). LEER ANTES DE TOCAR:
     - Arriba, lo DIARIO en el orden real del turno (abrir Hoy, vender, corregir, ajustar,
       cerrar). Lo semanal/mensual va PLEGADO en <details>: no estorba al que esta vendiendo.
     - Una guia por rol: dueno/admin/demo, empleado, contador, artista. Antes el contador y
       el artista veian la guia del dueno (cosas que no pueden hacer).
     - Nombres de botones y secciones = los de la app (i18n.js). Colores con nombre de la
       app (Yellow, no "Gold") y punto de color + tinta oscura: nada de texto de color claro
       (el verde #00C87A sobre blanco era 2.3:1).
     - Datos verificados: licencia de 5 anos con actualizaciones los 5 anos (save.html; antes
       el ingles decia "2 years"). Los ids oc-help-licencia, oc-prueba-dias y
       oc-help-ver-bienvenida los usan licencia-prueba.js y el tutorial: no renombrarlos.
     - test/labels-manual.test.js exige "travels encrypted"/"viaja cifrado" y manual.html. */
  const PUNTO = (c) => `<span class="oc-h-punto" style="background:${c};" aria-hidden="true"></span>`;
  const T = {
    en: {
      tag: { dueno: "Owner's guide", admin: "Admin guide", demo: "Demo guide", empleado: "Staff guide", contador: "Bookkeeper guide", artista: "Artist guide" },
      adminNota: `<p class="oc-h-nota">You run the day-to-day like the owner. Only the owner handles the license, the recovery email and the commission deals.</p>`,
      diaTit: "Every day, in this order",
      dia: [
        "<b>Today</b>: open it first. The big light says if anything needs you; the alerts below are sorted by urgency.",
        "<b>Sold</b>: tap a product and each tap is one unit sold. Can't find it? Scan or type the code.",
        "On each sale, pick the <b>Sales associate</b> or <b>House sale (no commission)</b>. It is never required.",
        "A mistake? <b>Sold &rarr; Sales log</b>: the pencil fixes it, &#8630; undoes it. Every change records who and from which device.",
        "Stock off, broken or expired? <b>Inventory</b> &rarr; &minus; / + on the card, with a short reason.",
        "Didn't ring up live? Use <b>Day close</b> in Sold at the end of the day."
      ],
      colTit: "What the colors mean",
      col: [
        ["#E8365D", "Red", "emergency: out of stock or expiring. Act today."],
        ["#F97316", "Orange", "soon: sell it first or restock this week."],
        ["#FFC700", "Yellow", "opportunity: good margin, push it."],
        ["#00C87A", "Green", "healthy: nothing to do."],
        ["#0A0A0F", "Black", "money not moving: no sale in 45 days or more."]
      ],
      azul: "Blue is never a stock signal: it only marks calm notes and the interface itself.",
      comTit: "Commissions (weekly or monthly)",
      com: [
        "Each person earns on the sales where they were chosen, even on someone else's shelf. The shelf card shows the <b>split between people</b>.",
        "When you pay, tap <b>Record payment</b>. <b>Send statement</b> opens WhatsApp with a link that works 7 or 30 days.",
        "A return of a sale already paid comes off that person's next amount."
      ],
      cliTit: "Customers",
      cli: [
        "<b>Record debt (fiado)</b> and <b>Record credit (abono)</b> keep what each customer owes or has in favor.",
        "Rate reliability (stars) and manner (hearts) from 1 to 5. A low rating lets you note the incident time, for cameras or audio.",
        "Owner and admin: fix an incident's date, time and note with the pencil in <b>Incidents</b>, and <b>Fire client</b> to blacklist. You can reactivate them later."
      ],
      equTit: "Team, devices and roles",
      equ: [
        "One license is one shared notebook: every device you activate with it stays up to date on its own, PINs and roles included.",
        "To add a device: <b>Advanced &rarr; Shared notebook</b>.",
        "Owner &rarr; Admin &rarr; Staff. The bookkeeper has a separate PIN for the accounting layer and expenses."
      ],
      segTit: "Keep it safe",
      seg: [
        "Save your recovery email in Advanced before changing any PIN. No email, no recovery.",
        "Export a backup from Advanced from time to time.",
        "The dot at the top: white = up to date, gray = syncing, black = offline. Offline you keep selling; it syncs when the signal is back.",
        "The sun/moon button switches light or dark on this device."
      ],
      datTit: "Your data and license",
      dat: `When device sync is on, the business state needed to keep the shared notebook equal (products, stock, sales, customers and photos) travels encrypted through the sync relay to the other devices on your license. Each device keeps a local copy you can export any time. Activation starts a full <span class="oc-prueba-dias">30</span>-day trial. The license lasts <b>5 years</b>, with updates included for all 5.`,
      tutorial: "Take the guided tutorial",
      manual: "Open the full manual",
      emp: {
        turnoTit: "Your shift, in this order",
        turno: [
          "<b>Today</b>: open it when you arrive. Red means tell the owner now.",
          "<b>Sold</b>: tap a product and each tap is one unit sold. Can't find it? Scan or type the code.",
          "On each sale, pick the <b>Sales associate</b> or <b>House sale (no commission)</b>. It is never required.",
          "A mistake? <b>Sold &rarr; Sales log</b>: the pencil fixes it, &#8630; undoes it.",
          "Broken, expired or the count is off? <b>Inventory</b> &rarr; &minus; / + with a short reason. It stays on record.",
          "Didn't ring up live? <b>Day close</b> in Sold at the end."
        ],
        colAccion: "Red or orange: let the owner know. Black: mention it, it isn't selling.",
        cliTit: "Customers",
        cli: ["<b>Record debt (fiado)</b> when a customer takes something to pay later; <b>Record credit (abono)</b> when they pay ahead."],
        etiTit: "Labels",
        eti: ["Reprint a lost or damaged label: find it by name or code in <b>Labels</b>."],
        senTit: "If the dot at the top turns black",
        sen: ["You are offline. Keep selling: everything saves on this device and syncs when the signal is back."]
      },
      con: {
        tit: "What you do here",
        items: [
          "<b>Accounting</b>: T-accounts, P&amp;L and balance sheet, from the real sales and expenses.",
          "<b>Expenses</b>: add, edit or delete an expense. Every change is logged with who made it.",
          "A full backup can be exported by the owner and the bookkeeper, from Advanced."
        ]
      },
      art: {
        tit: "What you can do",
        items: [
          "You see only the pieces on your own shelf, without costs.",
          "Add your pieces to your shelf with name, price and stock.",
          "Sales, customers and money screens are closed to this access. For anything else, ask the owner.",
          "No shelf yet? Ask the owner to assign you one."
        ]
      }
    },
    es: {
      tag: { dueno: "Guía del dueño", admin: "Guía del admin", demo: "Guía de la demo", empleado: "Guía del encargado/a", contador: "Guía del contador/a", artista: "Guía del artista" },
      adminNota: `<p class="oc-h-nota">Llevas el día a día igual que el dueño. Solo el dueño maneja la licencia, el correo de recuperación y los tratos de comisión.</p>`,
      diaTit: "Todos los días, en este orden",
      dia: [
        "<b>Hoy</b>: ábrelo primero. La luz grande dice si algo te necesita; las alertas de abajo van ordenadas por urgencia.",
        "<b>Vendido</b>: toca un producto y cada toque es una unidad vendida. ¿No lo encuentras? Escanea o escribe el código.",
        "En cada venta elige al <b>Comisionista</b> o <b>Venta de la casa (sin comisión)</b>. Nunca es obligatorio.",
        "¿Un error? <b>Vendido &rarr; Registro de ventas</b>: el lápiz lo corrige, &#8630; lo deshace. Cada cambio guarda quién y desde qué aparato.",
        "¿Stock mal, roto o vencido? <b>Inventario</b> &rarr; &minus; / + en la tarjeta, con un motivo corto.",
        "¿No registraste en vivo? Usa <b>Cierre del día</b> en Vendido al final del día."
      ],
      colTit: "Qué significan los colores",
      col: [
        ["#E8365D", "Rojo", "emergencia: sin stock o por vencer. Actúa hoy."],
        ["#F97316", "Naranja", "pronto: véndelo primero o reabastece esta semana."],
        ["#FFC700", "Amarillo", "oportunidad: buen margen, empújalo."],
        ["#00C87A", "Verde", "saludable: nada que hacer."],
        ["#0A0A0F", "Negro", "plata quieta: 45 días o más sin vender."]
      ],
      azul: "El azul nunca es una señal de stock: solo marca notas serenas y la propia interfaz.",
      comTit: "Comisiones (cada semana o cada mes)",
      com: [
        "Cada persona cobra las ventas donde se la eligió, aunque sean en la percha de otra. La tarjeta de la percha muestra el <b>reparto entre personas</b>.",
        "Cuando pagues, toca <b>Record payment</b>. <b>Send statement</b> abre WhatsApp con un enlace que dura 7 o 30 días.",
        "La devolución de una venta ya pagada se descuenta del próximo pago de esa persona."
      ],
      cliTit: "Clientes",
      cli: [
        "<b>Record debt (fiado)</b> y <b>Record credit (abono)</b> llevan lo que cada cliente debe o tiene a favor.",
        "Califica confiabilidad (estrellas) y trato (corazones) de 1 a 5. Una calificación baja te deja anotar la hora del incidente, para cámaras o audios.",
        "Dueño y admin: corrigen fecha, hora y nota de un incidente con el lápiz en <b>Incidents</b>, y mandan a la lista negra con <b>Fire client</b>. Se puede reactivar después."
      ],
      equTit: "Equipo, aparatos y roles",
      equ: [
        "Una licencia es un solo cuaderno compartido: cada aparato activado con ella se mantiene al día solo, PIN y roles incluidos.",
        "Para sumar un aparato: <b>Avanzado &rarr; Cuaderno compartido</b>.",
        "Dueño &rarr; Admin &rarr; Encargado. El contador tiene un PIN aparte para la capa contable y los gastos."
      ],
      segTit: "Para no perder nada",
      seg: [
        "Guarda tu correo de recuperación en Avanzado antes de cambiar cualquier PIN. Sin correo no hay recuperación.",
        "Exporta un respaldo desde Avanzado de vez en cuando.",
        "El punto de arriba: blanco = al día, gris = sincronizando, negro = sin conexión. Sin conexión sigues vendiendo; se sincroniza al volver la señal.",
        "El botón de sol/luna cambia a claro u oscuro en este aparato."
      ],
      datTit: "Tus datos y tu licencia",
      dat: `Cuando la sincronización está activa, el estado necesario para mantener igual el cuaderno compartido (productos, stock, ventas, clientes y fotos) viaja cifrado por el relay de sync hacia los otros aparatos de tu licencia. Cada aparato conserva una copia local que puedes exportar cuando quieras. La activación abre una prueba completa de <span class="oc-prueba-dias">30</span> días. La licencia dura <b>5 años</b>, con actualizaciones incluidas los 5.`,
      tutorial: "Hacer el tutorial guiado",
      manual: "Abrir el manual completo",
      emp: {
        turnoTit: "Tu turno, en este orden",
        turno: [
          "<b>Hoy</b>: ábrelo al llegar. Rojo significa avisar al dueño ya.",
          "<b>Vendido</b>: toca un producto y cada toque es una unidad vendida. ¿No lo encuentras? Escanea o escribe el código.",
          "En cada venta elige al <b>Comisionista</b> o <b>Venta de la casa (sin comisión)</b>. Nunca es obligatorio.",
          "¿Un error? <b>Vendido &rarr; Registro de ventas</b>: el lápiz lo corrige, &#8630; lo deshace.",
          "¿Roto, vencido o el conteo no cuadra? <b>Inventario</b> &rarr; &minus; / + con un motivo corto. Queda en el registro.",
          "¿No registraste en vivo? <b>Cierre del día</b> en Vendido al final."
        ],
        colAccion: "Rojo o naranja: avisa al dueño. Negro: coméntalo, no se está vendiendo.",
        cliTit: "Clientes",
        cli: ["<b>Record debt (fiado)</b> cuando un cliente se lleva algo para pagar después; <b>Record credit (abono)</b> cuando paga por adelantado."],
        etiTit: "Etiquetas",
        eti: ["Reimprime una etiqueta perdida o dañada: búscala por nombre o código en <b>Etiquetas</b>."],
        senTit: "Si el punto de arriba se pone negro",
        sen: ["Estás sin conexión. Sigue vendiendo: todo se guarda en este aparato y se sincroniza al volver la señal."]
      },
      con: {
        tit: "Lo que haces aquí",
        items: [
          "<b>Contabilidad</b>: cuentas T, P&amp;G y balance, a partir de las ventas y gastos reales.",
          "<b>Gastos</b>: agrega, edita o borra un gasto. Cada cambio queda registrado con quién lo hizo.",
          "El respaldo completo lo pueden exportar el dueño y el contador, desde Avanzado."
        ]
      },
      art: {
        tit: "Lo que puedes hacer",
        items: [
          "Ves solo las piezas de tu propia percha, sin costos.",
          "Agrega tus piezas a tu percha con nombre, precio y stock.",
          "Las pantallas de ventas, clientes y dinero están cerradas para este acceso. Para lo demás, pregúntale al dueño.",
          "¿Aún no tienes percha? Pídele al dueño que te asigne una."
        ]
      }
    }
  };
  const _ol = (xs) => `<ol class="oc-h-pasos">${xs.map((x) => `<li>${x}</li>`).join("")}</ol>`;
  const _ul = (xs) => `<ul>${xs.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  const _plegado = (tit, cuerpo) => `<details class="oc-h-mas"><summary>${tit}</summary>${cuerpo}</details>`;
  const _colores = (t, extra) => `<h3>${t.colTit}</h3><ul class="oc-h-colores">${t.col.map((c) => `<li>${PUNTO(c[0])}<b>${c[1]}</b>: ${c[2]}</li>`).join("")}</ul><p class="oc-h-nota">${extra}</p>`;
  const _pie = (t) => `<div id="oc-help-licencia"></div>
    <button id="oc-help-ver-bienvenida" style="width:100%;min-height:44px;padding:10px;border-radius:8px;
      border:2px solid var(--azul-medio,#2E6278);background:transparent;color:var(--azul-medio,#2E6278);
      font-family:var(--font-display,sans-serif);font-size:14px;font-weight:700;cursor:pointer;">${t.tutorial}</button>
    <a href="./manual.html" target="_blank" rel="noopener" style="display:block;text-align:center;margin-top:9px;font-weight:700;color:#2E6278;">${t.manual}</a>`;

  function ayudaPorRol(rol) {
    const t = T[(window.OCI18n && window.OCI18n.getLang() === "es") ? "es" : "en"];
    const r = (rol && t.tag[rol]) ? rol : "dueno";
    let h = `<span class="rolTag">${t.tag[r]}</span>`;
    if (r === "empleado") {
      const e = t.emp;
      return h + `<h3>${e.turnoTit}</h3>` + _ol(e.turno) + _colores(t, e.colAccion)
        + _plegado(e.cliTit, _ul(e.cli)) + _plegado(e.etiTit, _ul(e.eti)) + _plegado(e.senTit, _ul(e.sen))
        + `<a href="./manual.html" target="_blank" rel="noopener" style="display:block;text-align:center;margin-top:14px;font-weight:700;color:#2E6278;">${t.manual}</a>`;
    }
    if (r === "contador") return h + `<h3>${t.con.tit}</h3>` + _ul(t.con.items) + _plegado(t.datTit, `<p>${t.dat}</p>`) + `<a href="./manual.html" target="_blank" rel="noopener" style="display:block;text-align:center;margin-top:14px;font-weight:700;color:#2E6278;">${t.manual}</a>`;
    if (r === "artista") return h + `<h3>${t.art.tit}</h3>` + _ul(t.art.items);
    if (r === "admin") h += t.adminNota;
    return h + `<h3>${t.diaTit}</h3>` + _ol(t.dia) + _colores(t, t.azul)
      + _plegado(t.comTit, _ul(t.com)) + _plegado(t.cliTit, _ul(t.cli)) + _plegado(t.equTit, _ul(t.equ))
      + _plegado(t.segTit, _ul(t.seg)) + _plegado(t.datTit, `<p>${t.dat}</p>`) + _pie(t);
  }

  const modal = document.createElement("div");
  modal.id = "oc-help-modal";
  modal.innerHTML = `<div id="oc-help-sheet">
    <button id="oc-help-x" aria-label="Cerrar" title="Cerrar">&times;</button>
    <h2 id="oc-help-titulo">How does friendly-123 work?</h2>
    <!-- Tagline (JFC 2026-07-15): "Manage your business, in color" — marketing promise, not description. -->
    <p id="oc-help-tagline" style="font-family:var(--font-display,sans-serif);color:#A83D1F;font-size:15px;font-weight:700;margin:0 0 14px;">Manage your business, in color</p>
    <div id="oc-help-body"></div>
    <div id="oc-help-credito">Made In Cuenca: intuitive business apps &mdash; powered by <a href="https://jfcarpio.com" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">jfcarpio.com</a> &middot; <a href="https://avatiun.com" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">avatiun.com</a></div>
    <button id="oc-help-cerrar">Got it</button>
  </div>`;
  document.body.appendChild(modal);

  const btn = document.createElement("button");
  btn.id = "oc-help-btn";
  btn.textContent = "Help (?)";

  // Bilingue (2026-07-17): re-pinta los textos fijos del modal/boton al cambiar
  // de idioma con window.t(); la guia por rol (ayudaPorRol) se arma en cada abrir().
  function pintarTextosFijos() {
    if (!window.t) return;
    btn.textContent = window.t("help.btnLabel");
    const tit = document.getElementById("oc-help-titulo");
    if (tit) tit.textContent = window.t("help.title");
    const tag = document.getElementById("oc-help-tagline");
    if (tag) tag.textContent = window.t("brand.slogan");
    const cerrar = document.getElementById("oc-help-cerrar");
  try{const _x=document.getElementById("oc-help-x"); if(_x) _x.onclick=()=>document.getElementById("oc-help-modal").classList.remove("abierto");}catch(e){}
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

  /* INDICADOR DE SYNC, DISCRETO Y EN ESCALA DE GRISES (JFC 2026-08-25).
     Antes era una pildora de colores (gris/ambar/verde/rojo) enterrada en
     Avanzado; a JFC no le gustaban los colores y la queria junto a Ayuda,
     visible pero discreta, en escala de negro a blanco: offline/synced. Aqui
     va debajo de "Help (?)", en el mismo rincon del header. No impone color a
     la interfaz — solo un punto en escala de grises. SEMANTICA (JFC 2026-08-25,
     "es lo logico"): BLANCO BRILLOSO = synced/al dia (vivo, encendido); NEGRO =
     offline / lleva rato sin conectar (apagado); gris = sincronizando. */
  const mini = document.createElement("div");
  mini.id = "oc-sync-mini";
  /* Tema oscuro: el estado NO se invierte (negro = sin conexion, blanco = al dia). */
  mini.classList.add("oc-sin-invertir");
  mini.setAttribute("aria-live", "polite");
  mini.style.cssText = "display:flex;align-items:center;gap:5px;font-size:12px;line-height:1;font-weight:700;letter-spacing:.02em;color:#14181C;margin-top:4px;cursor:default;";
  const miniDot = document.createElement("span");
  miniDot.style.cssText = "width:8px;height:8px;border-radius:50%;box-sizing:border-box;background:#ffffff;border:1.5px solid #b7b7b7;";
  const miniTxt = document.createElement("span");
  miniTxt.className = "oc-sync-txt";
  mini.appendChild(miniDot);
  mini.appendChild(miniTxt);
  const fila = document.createElement("div");
  fila.id = "oc-estado-fila";
  fila.appendChild(mini);
  /* BOTON SOL/LUNA (JFC 2026-09-26): alterna claro/oscuro en ESTE aparato (OCTema,
     definido en el <head> de index.html). Muestra el icono del modo al que lleva. */
  const temaBtn = document.createElement("button");
  temaBtn.id = "oc-tema-toggle";
  temaBtn.type = "button";
  const SVG_LUNA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  const SVG_SOL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>';
  function pintarTema() {
    const oscuro = !!(window.OCTema && window.OCTema.actual() === "oscuro");
    temaBtn.innerHTML = oscuro ? SVG_SOL : SVG_LUNA;
    temaBtn.setAttribute("aria-pressed", oscuro ? "true" : "false");
    const et = _miniT("tema.oscuro", "Dark mode");
    temaBtn.setAttribute("aria-label", et);
    temaBtn.title = oscuro ? _miniT("tema.claro", "Light mode") : et;
  }
  temaBtn.addEventListener("click", function () { if (window.OCTema) window.OCTema.alternar(); });
  window.addEventListener("oc-tema-change", pintarTema);
  window.addEventListener("oc-lang-change", pintarTema);
  fila.appendChild(temaBtn);
  brandWrap.appendChild(fila);

  function _miniT(k, f) { try { return (window.t ? window.t(k, f) : f); } catch (_) { return f; } }
  function pintarMini(estado) {
    try {
      const C = window.OCSyncControl;
      const e = estado || (C && C.estado ? C.estado() : "apagado");
      const problema = !!(C && C.problemaPersistente && C.problemaPersistente());
      /* ESCALA DE NEGRO A BLANCO = grado de "encendido/al dia" (JFC 2026-08-25).
         4 tonos: NEGRO=offline (apagado) < gris oscuro=reconectando <
         gris claro=sincronizando < BLANCO BRILLOSO=sincronizado (vivo, al dia).
         La etiqueta dice la palabra completa (explica, no solo "Synced") y el
         tooltip explica la escala para quien no sepa que es. */
      let dotBg, dotBorder, dotGlow, txtColor, etiqueta;
      if (e === "conectado") {
        dotBg = "#ffffff"; dotBorder = "#7f93a4"; dotGlow = "0 0 5px 1px rgba(255,255,255,.95), 0 0 0 2px rgba(127,147,164,.30)";
        txtColor = "#0F1923"; etiqueta = _miniT("sync.mini.synced", "Synchronized");
        const n = C && C.presencia ? C.presencia() : null;
        if (n != null && n > 1) etiqueta += " · " + n;
      } else if (e === "conectando" && !problema) {
        dotBg = "#c8c8c8"; dotBorder = "#b0b0b0"; dotGlow = "none"; txtColor = "#0F1923"; etiqueta = _miniT("sync.mini.syncing", "Syncing…");
      } else if (e === "reconectando" && !problema) {
        dotBg = "#6a6a6a"; dotBorder = "#5a5a5a"; dotGlow = "none"; txtColor = "#0F1923"; etiqueta = _miniT("sync.mini.reconnecting", "Reconnecting…");
      } else {
        // NEGRO = offline / apagado / lleva rato sin conectar.
        dotBg = "#141414"; dotBorder = "#141414"; dotGlow = "none"; txtColor = "#0F1923"; etiqueta = _miniT("sync.mini.offline", "Offline");
        // v360 (Hugo/Paco/Luis #3): en el demo no hay sync; "Offline" en negro asustaba.
        try { if (window.OCAuth && window.OCAuth.esDemo && window.OCAuth.esDemo()) { dotBg = "#FFFFFF"; dotBorder = "#0F1923"; etiqueta = _miniT("sync.mini.demo", "Demo"); } } catch (_) {}
      }
      miniDot.style.background = dotBg;
      miniDot.style.borderColor = dotBorder;
      miniDot.style.boxShadow = dotGlow;
      miniTxt.textContent = etiqueta;
      mini.setAttribute("aria-label", etiqueta);
      mini.style.color = txtColor;
      mini.classList.remove("sync-on", "sync-off", "sync-mid");
      mini.classList.add(e === "conectado" ? "sync-on" : ((e === "conectando" || e === "reconectando") && !problema) ? "sync-mid" : "sync-off");
      try { mini.title = _miniT("sync.mini.legend", "Sync status — black: offline · white: up to date"); } catch (_) {}
    } catch (_) {}
  }
  pintarTema();
  pintarMini();
  try { if (window.OCSyncControl && window.OCSyncControl.onEstado) window.OCSyncControl.onEstado(pintarMini); } catch (_) {}
  window.addEventListener("oc-lang-change", function () { pintarMini(); });

  function abrir() {
    const rol = window.OCAuth ? window.OCAuth.rolActual() : null;
    pintarTextosFijos();
    document.getElementById("oc-help-body").innerHTML = ayudaPorRol(rol);
    // Estado de la licencia + invitación a comprar (JFC 2026-09-22, en Ayuda y
    // en el modal). Solo aparece en la guía del dueño, que trae el hueco.
    try { if (window.OCPrueba) window.OCPrueba.pintarAyuda(document.getElementById("oc-help-body")); } catch (_) {}
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
    if (logout && logout.parentNode && !logout.parentNode.contains(brandWrap)) {
      logout.insertAdjacentElement("afterend", brandWrap);
    }
    brandWrap.style.display = "flex";
    btn.style.display = "block";
  });
  window.addEventListener("oc-logout", () => {
    brandWrap.remove();
    modal.classList.remove("abierto");
  });
  try {
    if (window.OCAuth && window.OCAuth.rolActual && window.OCAuth.rolActual()) {
      const logout = document.getElementById("oc-logout");
      if (logout && logout.parentNode && !logout.parentNode.contains(brandWrap)) {
        logout.insertAdjacentElement("afterend", brandWrap);
      }
      brandWrap.style.display = "flex";
      btn.style.display = "block";
    }
  } catch (_) {}
})();
