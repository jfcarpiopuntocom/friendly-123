// tutorial-ui.js — INTERACTIVE TUTORIAL for friendly-123 (JFC 2026-07-17).
// This is NOT the welcome guide (welcome-ui.js, a reading modal) nor Help
// (help-ui.js): this is a LIVE TOUR over the real interface. It dims the
// screen, spotlights the element being explained, navigates between views on
// its own, and ends by taking the owner to create their first product.
// Launch with window.OCTutorial.iniciar() — the "See the tutorial now" button
// on the welcome card (welcome-ui.js) invokes it.
// With 888 the tour runs over the demo stock; with 789 (freshly activated real
// store) it runs over the empty store — same steps, same tour.
// Bilingual EN/ES: self-contained dictionary keyed by OCI18n.getLang() so this
// file needs no i18n.js changes and repaints correctly if launched after a
// language switch.
(function () {
  const TXT = {
    en: {
      pasoDe: (a, b) => "Step " + a + " of " + b,
      atras: "Back", sig: "Next", fin: "Create my first product", salir: "Exit tutorial",
      pasos: [
        { titulo: "Your navigation bar", texto: "From here you move through the whole app. This tutorial walks you through every section — tap Next to move forward." },
        { titulo: "Today: your day at a glance", texto: "Overall traffic light, today's sales and stock alerts. If something needs your attention, it shows up here first, in red." },
        { titulo: "Create your products here", texto: "This button adds a product: name, price, cost and stock. It's the heart of your store — at the end of the tutorial you come back here to create yours." },
        { titulo: "Your products speak in colors", texto: "Red: restock urgently. Yellow: check soon. Blue: good margin, push it. Green: all good. No numbers to interpret — the color tells you." },
        { titulo: "Sell in seconds", texto: "Scan the barcode (or type the SKU) and the sale is recorded with stock deducted. No cash registers, no extra steps." },
        { titulo: "Create your racks", texto: "A rack is a selling spot: your store, a partner's stand, a fair. Here you create them and assign products, with partner commission if it applies." },
        { titulo: "Your customers", texto: "Register customers, rate service and reliability, and see their history. You decide who gets credit and who doesn't — with data." },
        { titulo: "Commissions without arguments", texto: "The app calculates on its own what each partner or promoter earns from what they sold. Settle with one tap and send the receipt via WhatsApp." },
        { titulo: "Advanced: your vault", texto: "Backups, PIN codes, recovery email, accounting reports and expenses. Everything lives on YOUR device — no cloud, no subscriptions." },
      ],
    },
    es: {
      pasoDe: (a, b) => "Paso " + a + " de " + b,
      atras: "Atrás", sig: "Siguiente", fin: "Crear mi primer producto", salir: "Salir del tutorial",
      pasos: [
        { titulo: "Tu barra de navegación", texto: "Desde aquí te mueves por toda la app. Este tutorial te lleva de la mano por cada sección — usa Siguiente para avanzar." },
        { titulo: "Hoy: tu día de un vistazo", texto: "Semáforo general, ventas de hoy y alertas de stock. Si algo necesita tu atención, aparece aquí primero, en rojo." },
        { titulo: "Crea tus productos aquí", texto: "Con este botón das de alta un producto: nombre, precio, costo y stock. Es el corazón de tu negocio — al final del tutorial vuelves aquí a crear el tuyo." },
        { titulo: "Tus productos hablan en colores", texto: "Rojo: reponer urgente. Amarillo: revisar pronto. Azul: buen margen, impúlsalo. Verde: todo en orden. No hay que interpretar números — el color te lo dice." },
        { titulo: "Vende en segundos", texto: "Escanea el código de barras (o escribe el SKU) y la venta queda registrada con stock descontado. Sin cajas registradoras ni pasos extra." },
        { titulo: "Crea tus perchas", texto: "Una percha es un punto de venta: tu local, un stand de socio, una feria. Aquí las creas y les asignas productos, con comisión por socio si aplica." },
        { titulo: "Tus clientes", texto: "Registra clientes, evalúa trato y confiabilidad, y mira su historial. Tú decides a quién fiar y a quién no, con datos." },
        { titulo: "Comisiones sin peleas", texto: "La app calcula sola cuánto le toca a cada socio o promotora según lo vendido. Liquidas con un toque y puedes mandar el recibo por WhatsApp." },
        { titulo: "Avanzado: tu caja fuerte", texto: "Respaldos, claves, correo de recuperación, reportes contables y gastos. Todo vive en TU dispositivo — sin nube, sin suscripciones." },
      ],
    },
  };
  // Vista + selector por paso (mismo orden que TXT.*.pasos).
  const DESTINOS = [
    { vista: "hoy", sel: "nav" },
    { vista: "hoy", sel: null },
    { vista: "inventario", sel: "#btnAltaProducto" },
    { vista: "inventario", sel: "#gridInventario" },
    { vista: "escanear", sel: null },
    { vista: "perchas", sel: "#perchaCrear" },
    { vista: "clientes", sel: "#btnNuevoCliente" },
    { vista: "comisiones", sel: null },
    { vista: "avanzado", sel: null },
  ];

  function idioma() {
    try { return (window.OCI18n && window.OCI18n.getLang() === "es") ? TXT.es : TXT.en; } catch (_) { return TXT.en; }
  }

  let idx = -1;
  let foco = null, tarjeta = null;
  let reposicionar = null;

  function $(s) { return document.querySelector(s); }

  function css() {
    if (document.getElementById("oc-tut-css")) return;
    const st = document.createElement("style");
    st.id = "oc-tut-css";
    // Solid colors always (JFC visual rule): pure white text on dark card,
    // brand accents. Buttons min 44px.
    st.textContent =
      "#oc-tut-foco{position:fixed;z-index:10060;pointer-events:none;border:3px solid #E86040;border-radius:10px;box-shadow:0 0 0 9999px rgba(15,25,35,.78);transition:all .28s ease;}" +
      "#oc-tut-card{position:fixed;z-index:10061;width:min(340px,calc(100vw - 24px));background:#0F1923;border:2px solid #E86040;border-radius:12px;padding:16px;box-shadow:0 10px 34px #060d14;}" +
      "#oc-tut-card .paso{font-family:var(--font-mono,monospace);font-size:13px;font-weight:700;letter-spacing:.06em;color:#28ECAA !important;-webkit-text-fill-color:#28ECAA !important;margin:0 0 4px;}" +
      "#oc-tut-card h3{font-family:var(--font-display,sans-serif);font-size:19px;font-weight:700;color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;margin:0 0 6px;line-height:1.2;}" +
      "#oc-tut-card p{font-size:15px;line-height:1.45;color:#F8F9FB !important;-webkit-text-fill-color:#F8F9FB !important;margin:0 0 12px;}" +
      "#oc-tut-card .fila{display:flex;gap:8px;}" +
      "#oc-tut-card button{min-height:44px;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;touch-action:manipulation;}" +
      "#oc-tut-atras{flex:0 0 auto;padding:0 14px;border:2px solid #5294AC;background:transparent;color:#F8F9FB !important;-webkit-text-fill-color:#F8F9FB !important;}" +
      "#oc-tut-sig{flex:1;border:2px solid #E86040;background:#E86040;color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;}" +
      "#oc-tut-salir{width:100%;margin-top:8px;min-height:44px;border:none;background:transparent;color:#CCCCCC !important;-webkit-text-fill-color:#CCCCCC !important;font-size:13px;text-decoration:underline;cursor:pointer;}" +
      "@media (prefers-color-scheme: dark){#oc-tut-card h3{color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;}#oc-tut-card p{color:#F8F9FB !important;-webkit-text-fill-color:#F8F9FB !important;}}";
    document.head.appendChild(st);
  }

  function irAVista(nombre) {
    const b = document.querySelector('nav button[data-vista="' + nombre + '"]');
    if (b) b.click();
    return b;
  }

  function objetivoDe(d) {
    // Selector may not exist yet (view not painted): fallback to that view's
    // nav button, and lastly the nav itself.
    let el = d.sel ? $(d.sel) : null;
    if (!el) el = $('main .vista.activa') || $('[id^="vista-"].activa') || $('#vista-' + d.vista);
    if (!el) el = document.querySelector('nav button[data-vista="' + d.vista + '"]');
    if (!el) el = $("nav");
    return el;
  }

  function pintar() {
    const L = idioma();
    const d = DESTINOS[idx];
    const txt = L.pasos[idx];
    const el = objetivoDe(d);
    if (!el) return;
    try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {}
    const r = el.getBoundingClientRect();
    const pad = 6;
    foco.style.left = Math.max(4, r.left - pad) + "px";
    foco.style.top = Math.max(4, r.top - pad) + "px";
    foco.style.width = Math.min(window.innerWidth - 8, r.width + pad * 2) + "px";
    foco.style.height = Math.min(window.innerHeight - 8, r.height + pad * 2) + "px";
    tarjeta.querySelector(".paso").textContent = L.pasoDe(idx + 1, DESTINOS.length);
    tarjeta.querySelector("h3").textContent = txt.titulo;
    tarjeta.querySelector("p").textContent = txt.texto;
    const bAtras = document.getElementById("oc-tut-atras");
    bAtras.style.display = idx === 0 ? "none" : "";
    bAtras.textContent = L.atras;
    document.getElementById("oc-tut-sig").textContent = idx === DESTINOS.length - 1 ? L.fin : L.sig;
    document.getElementById("oc-tut-salir").textContent = L.salir;
    const ch = tarjeta.offsetHeight || 190;
    let top = r.bottom + pad + 12;
    if (top + ch > window.innerHeight - 10) top = Math.max(10, r.top - pad - ch - 12);
    let left = Math.min(Math.max(12, r.left), window.innerWidth - (tarjeta.offsetWidth || 340) - 12);
    tarjeta.style.top = top + "px";
    tarjeta.style.left = left + "px";
  }

  function paso(n) {
    idx = Math.max(0, n);
    if (idx >= DESTINOS.length) return terminar();
    irAVista(DESTINOS[idx].vista);
    // Short wait so the view paints before measuring the target.
    setTimeout(pintar, 380);
  }

  function terminar() {
    // Tour end: land on Inventory, ready to create the first real product.
    cerrar();
    irAVista("inventario");
    const b = $("#btnAltaProducto");
    if (b) { try { b.scrollIntoView({ block: "center" }); } catch (_) {} }
  }

  function cerrar() {
    if (foco) { foco.remove(); foco = null; }
    if (tarjeta) { tarjeta.remove(); tarjeta = null; }
    if (reposicionar) {
      window.removeEventListener("resize", reposicionar);
      window.removeEventListener("scroll", reposicionar, true);
      reposicionar = null;
    }
    idx = -1;
  }

  function iniciar() {
    if (foco) cerrar();
    css();
    foco = document.createElement("div"); foco.id = "oc-tut-foco";
    tarjeta = document.createElement("div"); tarjeta.id = "oc-tut-card";
    tarjeta.innerHTML =
      '<p class="paso"></p><h3></h3><p></p>' +
      '<div class="fila"><button id="oc-tut-atras"></button><button id="oc-tut-sig"></button></div>' +
      '<button id="oc-tut-salir"></button>';
    document.body.appendChild(foco);
    document.body.appendChild(tarjeta);
    tarjeta.querySelector("#oc-tut-sig").addEventListener("click", () => paso(idx + 1));
    tarjeta.querySelector("#oc-tut-atras").addEventListener("click", () => paso(idx - 1));
    tarjeta.querySelector("#oc-tut-salir").addEventListener("click", cerrar);
    reposicionar = () => { if (idx >= 0) pintar(); };
    window.addEventListener("resize", reposicionar);
    window.addEventListener("scroll", reposicionar, true);
    paso(0);
  }

  window.OCTutorial = { iniciar: iniciar, cerrar: cerrar };
})();
