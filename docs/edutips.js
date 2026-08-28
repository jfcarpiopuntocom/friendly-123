/*!
 * edutips.js — friendly-123
 * ============================================================================
 * QUE ES / WHAT IT IS
 * ----------------------------------------------------------------------------
 * La cajita azul al pie de la vista contable. Un tip corto que ensena a sacarle
 * mas a la app: una funcion que ya esta pagada y nadie usa, un atajo, una forma
 * mas rapida de hacer algo que hoy se hace a mano.
 *
 * PORTADO de AMIGABLE (JFC 2026-08-20): el mismo cambio de rumbo del
 * 2026-08-15 -- de tips FINANCIEROS a tips de APROVECHAMIENTO -- nunca habia
 * llegado a friendly-123. Los 33 tips (32 + el de PIN) son los mismos,
 * traducidos nativo (no palabra por palabra) para el bloque en.
 *
 * REGLA DE COLOR (JFC 2026-07-28) — IMPORTANTE, NO ROMPER
 * ----------------------------------------------------------------------------
 * El azul esta EXCLUIDO de tableros y tarjetas de inventario. Vive SOLO en dos
 * lugares: "Under watch" (margen flaco) y esta cajita.
 *
 * COMO CAMBIAR EL TEXTO
 * ----------------------------------------------------------------------------
 * Edita TIPS.es y TIPS.en (mismo orden en los dos). Rotacion deterministica
 * por bloque: se recorre la lista entera antes de repetir ninguno.
 * ============================================================================
 */
(function (global) {
  "use strict";

  var TIPS = {
    es: [
      { t: "Los colores te dicen que hacer",
        c: "No hace falta leer un solo numero para saber como esta tu negocio. Verde sigue asi, dorado hay dinero esperandote, naranja se acaba, rojo actua ya, negro no se mueve. Un vistazo a Hoy antes de abrir y ya sabes por donde empezar." },
      { t: "El cierre del dia, si no registraste en vivo",
        c: "Si el mostrador estuvo lleno y no alcanzaste a registrar nada, no tienes que reconstruir venta por venta. En Vendido, el cierre del dia aplica todo junto en una sola pasada." },
      { t: "Busca como piensas, no por columnas",
        c: "El buscador de Inventario y de Clientes encuentra por cualquier cosa: nombre, categoria, codigo, un pedazo de palabra. No tienes que recordar en que campo lo escribiste." },
      { t: "Las perchas son la unidad, no la tienda",
        c: "Si tienes un local y un puesto de feria, no son un solo monton. Separalos en perchas y cada uno te dice su propia verdad: cual sostiene al otro se ve en una tarde." },
      { t: "Reposicion por percha",
        c: "En Perchas, la reposicion arma sola la lista de que pedir y en que orden. Es la diferencia entre ir al proveedor con una lista y ir a ver que se te ocurre." },
      { t: "La etiqueta con codigo la imprimes tu",
        c: "Cada producto puede llevar su codigo de barras. Lo imprimes desde Etiquetas y despues vendes escaneando: se acaba el buscar el producto en la lista con el cliente esperando." },
      { t: "Escanea para vender",
        c: "Si el producto ya tiene su codigo, la camara del telefono es el lector. Apuntar y listo, sin teclear nada." },
      { t: "Tu equipo entra con su propio PIN",
        c: "Cada persona con su clave no es burocracia: es que el log de actividad diga quien hizo cada cosa. El dia que un numero no cuadre, la diferencia entre saber y sospechar es esa." },
      { t: "El historial esta sellado",
        c: "Cada movimiento queda encadenado con el anterior. Si alguien edita o borra uno, la cadena se rompe y el control anti fraude lo dice. No impide que pase; te avisa que paso." },
      { t: "Los clientes se califican solos y tu tambien",
        c: "La app arma sola la matriz de comportamiento: quien vuelve, quien compra fuerte, quien desaparecio. Y tu puedes ponerles estrellas y corazones, o dejar de venderle a quien no quieras." },
      { t: "Fiado sin intereses, pero con memoria",
        c: "Puedes anotar lo que le fias a alguien y armar un plan de pagos, con cuotas fijas o con abonos como vayan cayendo. Sin recargos: solo un aviso cuando toca cobrar." },
      { t: "El respaldo es tuyo, no nuestro",
        c: "En Avanzado puedes bajar todo tu negocio en un archivo y guardarlo donde quieras. Hazlo una vez al mes: son diez segundos y es la diferencia entre un susto y una perdida." },
      { t: "Un equipo, un codigo",
        c: "Con la sincronizacion encendida, lo que registra uno lo ven todos en segundos. Se acaba el mensaje de WhatsApp preguntando cuanto queda." },
      { t: "El tablero de control, para verlo con calma",
        c: "En una pantalla grande cabe lo que en el telefono hay que resumir: producto por producto, venta por venta, con busqueda y exportacion. Se abre desde Avanzado." },
      { t: "Exporta lo que tu contador si pueda usar",
        c: "El reporte contable sale en un archivo que abre en Excel. Mandarle eso en vez de fotos del cuaderno le ahorra a el horas y a ti la factura de esas horas." },
      { t: "Las fotos de producto valen mas que el nombre",
        c: "Una tarjeta con foto se reconoce sin leer. Si tienes encargados nuevos o productos parecidos entre si, poner las fotos es la hora mejor invertida de la semana." },
      { t: "Productos que son casi el mismo",
        c: "Si vendes lo mismo en variantes que solo cambian por dentro, agrupalos por familia con un codigo comun. Se ven juntos y dejas de confundirlos al vender." },
      { t: "Las transferencias entre perchas dejan rastro",
        c: "Mover producto de un lado a otro no es solo restar aqui y sumar alla. Quien recibe confirma lo que llego, y si falta algo se sabe donde." },
      { t: "Las comisiones se calculan solas",
        c: "Si trabajas con promotores o consignacion, la app reparte cada venta segun lo pactado. Se acaba el domingo de calculadora." },
      { t: "Caja chica tambien es tu dinero",
        c: "El taxi, el almuerzo, la funda de la esquina. Anotarlos toma cinco segundos y es la unica forma de que la ganancia del mes sea la de verdad y no la que te gustaria." },
      { t: "Ajustar no es hacer trampa",
        c: "Si algo se rompio, vencio o el conteo estaba mal, usa Ajustar y escribe el motivo. Queda registrado. Un inventario que nunca se ajusta es un inventario que nadie cree." },
      { t: "Lo que se muere en la percha",
        c: "El color negro marca lo que lleva mucho sin moverse. Ese es dinero tuyo detenido: rematarlo con descuento casi siempre sale mejor que esperar a que alguien lo quiera." },
      { t: "Cuanto vale lo que tienes ahora",
        c: "El inventario valorizado te dice, en un numero, cuanto de tu dinero esta ahora mismo convertido en producto. Sirve para pedir un credito y para decidir si comprar mas." },
      { t: "El buscador tambien perdona los acentos",
        c: "Escribe camiseta o Camiseta, con tilde o sin ella: encuentra igual. Esta hecho para teclear rapido con una mano." },
      { t: "Quien esta en el loop",
        c: "En Avanzado ves que dispositivos de tu equipo estan sincronizados y cuales llevan rato sin hablar. El que anda desconectado puede estar vendiendo algo que aqui ya se vendio." },
      { t: "Ponle nombre a cada dispositivo",
        c: "En Avanzado puedes escribir como se llama este aparato: Rosa, el celular del mostrador, tablet feria. Cuando el equipo crece, es la diferencia entre una lista util y una lista de codigos." },
      { t: "Sin internet tambien funciona",
        c: "La app abre y registra aunque se caiga la conexion. Cuando vuelve, se pone al dia sola con el resto del equipo. No pierdes una venta por el wifi." },
      { t: "Instalala como app",
        c: "Desde el navegador puedes agregarla a la pantalla de inicio. Abre a pantalla completa, arranca mas rapido y deja de ser una pestana que se pierde entre veinte." },
      { t: "Las reservas y encargos no viven en la memoria",
        c: "Lo que un cliente aparto o encargo se anota y queda. Es lo que evita vender dos veces lo mismo y quedar mal con quien lo pidio primero." },
      { t: "El correo de recuperacion no es tramite",
        c: "Es lo unico que te devuelve el acceso si olvidas tu PIN. Registralo en Avanzado hoy, no el dia que lo necesites." },
      { t: "Tu codigo de licencia es casi una llave privada",
        c: "Quien lo tenga entra a la sala de tu negocio. Anotalo en un lugar seguro, compartelo solo con tu equipo, y si se filtra puedes cambiarlo desde Avanzado." },
      { t: "La app se reporta sola cuando falla",
        c: "Si algo se rompe, nos llega el dato tecnico y nada mas: ni un producto, ni un cliente, ni una cifra tuya. Casi siempre lo arreglamos antes de que alcances a escribir." },
    ],
    en: [
      { t: "The colors tell you what to do",
        c: "You don't need to read a single number to know how your store is doing. Green: keep going. Gold: money is waiting. Orange: running low. Red: act now. Black: not moving. One glance at Today before you open and you know where to start." },
      { t: "Day close, if you didn't log sales live",
        c: "If the counter was packed and you never got to record anything, you don't have to rebuild it sale by sale. Under Sold, day close applies everything at once, in one pass." },
      { t: "Search how you think, not by column",
        c: "The search in Inventory and Customers finds by anything: name, category, code, part of a word. No need to remember which field you typed it in." },
      { t: "A shelf is the unit, not the store",
        c: "If you have a shop and a fair stand, they're not one pile. Split them into shelves and each one tells you its own truth — which one carries the other shows up in an afternoon." },
      { t: "Restock, per shelf",
        c: "Under Shelves, restocking builds the shopping list on its own — what to order and in what order. That's the difference between walking into your supplier with a list versus winging it." },
      { t: "You print your own barcode labels",
        c: "Every product can carry its own barcode. Print it from Labels, then sell by scanning — no more hunting the product in a list while the customer waits." },
      { t: "Scan to sell",
        c: "If the product already has its code, your phone's camera is the reader. Point and done, no typing." },
      { t: "Your team logs in with their own PIN",
        c: "Everyone having their own code isn't bureaucracy — it's what makes the activity log say who did what. The day a number doesn't add up, that's the difference between knowing and suspecting." },
      { t: "The history is sealed",
        c: "Every movement is chained to the one before it. If someone edits or deletes one, the chain breaks and the anti-fraud check flags it. It doesn't stop it from happening — it tells you it did." },
      { t: "Customers rate themselves, and so can you",
        c: "The app builds the behavior matrix on its own: who comes back, who spends big, who vanished. And you can give stars and hearts, or stop selling to anyone you don't want to." },
      { t: "Store credit without interest, but with memory",
        c: "You can log what someone owes you and set up a payment plan — fixed installments or payments as they come in. No fees, just a reminder when it's due." },
      { t: "The backup is yours, not ours",
        c: "Under Advanced you can download your whole store into a file and keep it wherever you want. Do it once a month: ten seconds, and it's the difference between a scare and a real loss." },
      { t: "One team, one code",
        c: "With sync on, whatever one person logs, everyone sees within seconds. No more WhatsApp messages asking how much is left." },
      { t: "The dashboard, to see it without rushing",
        c: "A big screen fits what a phone has to summarize: product by product, sale by sale, with search and export. Open it from Advanced." },
      { t: "Export what your accountant can actually use",
        c: "The accounting report comes out as a file that opens in Excel. Sending that instead of photos of a notebook saves them hours, and saves you the bill for those hours." },
      { t: "Product photos are worth more than the name",
        c: "A card with a photo is recognized without reading. If you have new staff or similar-looking products, adding photos is the best-spent hour of the week." },
      { t: "Products that are almost the same",
        c: "If you sell the same thing in variants that only differ inside, group them by family with a shared code. They show up together and you stop mixing them up while selling." },
      { t: "Transfers between shelves leave a trail",
        c: "Moving product from one place to another isn't just subtract here, add there. Whoever receives it confirms what arrived, and if something's missing, you know where." },
      { t: "Commissions calculate themselves",
        c: "If you work with reps or consignment, the app splits every sale as agreed. No more Sunday with a calculator." },
      { t: "Petty cash is still your money",
        c: "The taxi, lunch, the corner-store bag. Logging it takes five seconds and it's the only way this month's profit is the real one, not the one you'd like it to be." },
      { t: "Adjusting isn't cheating",
        c: "If something broke, expired, or the count was off, use Adjust and write the reason. It gets logged. An inventory that never gets adjusted is one nobody believes." },
      { t: "What's dying on the shelf",
        c: "The black color marks what hasn't moved in a long time. That's your money sitting still — marking it down almost always beats waiting for someone to want it." },
      { t: "How much is what you have worth right now",
        c: "Valued inventory tells you, in one number, how much of your money is right now turned into product. Useful for applying for credit and for deciding whether to buy more." },
      { t: "The search bar forgives accents too",
        c: "Type shirt or Shirt, with or without an accent: same result either way. Built for typing fast with one hand." },
      { t: "Who's in the loop",
        c: "Under Advanced you can see which of your team's devices are synced and which haven't spoken in a while. The one that's disconnected might be selling something already sold here." },
      { t: "Give each device a name",
        c: "Under Advanced you can write down what this device is called: Rose, the counter phone, fair tablet. As the team grows, that's the difference between a useful list and a list of codes." },
      { t: "It also works without internet",
        c: "The app opens and logs sales even if the connection drops. When it's back, it catches up with the rest of the team on its own. You never lose a sale to wifi." },
      { t: "Install it as an app",
        c: "From the browser you can add it to your home screen. It opens full-screen, starts faster, and stops being one tab lost among twenty." },
      { t: "Holds and layaways don't live in your memory",
        c: "What a customer set aside or ordered gets logged and stays logged. That's what stops you from selling the same thing twice and letting down whoever asked for it first." },
      { t: "The recovery email isn't paperwork",
        c: "It's the only thing that gets your access back if you forget your PIN. Set it up under Advanced today, not the day you need it." },
      { t: "Your license code is almost a private key",
        c: "Whoever has it gets into your store's room. Write it down somewhere safe, share it only with your team, and if it leaks you can rotate it from Advanced." },
      { t: "The app reports its own crashes",
        c: "If something breaks, we get the technical detail and nothing else — not a product, not a customer, not a figure of yours. We usually fix it before you can even type a message." },
    ],
  };

  var TIP_PIN = {
    es: { t: "Los PIN de demo siguen puestos",
      c: "Mientras esten los codigos de ejemplo, cualquiera que los haya visto en la landing puede entrar a tu negocio. Poner los tuyos toma un minuto en Avanzado, y desde ahi cada persona de tu equipo entra con su propia clave: eso es lo que hace que el registro de actividad sirva de algo." },
    en: { t: "The demo PINs are still active",
      c: "As long as the sample codes are there, anyone who saw them on the landing page can get into your store. Setting your own takes a minute under Advanced, and from there everyone on your team logs in with their own code — that's what makes the activity log actually mean something." },
    pin: true,
  };

  var K_PIN_VISTO = "f123_edutip_pin_visto";
  var CADA_MS = 14 * 86400000;

  function idioma() {
    try { return (global.OCI18n && global.OCI18n.getLang() === "es") ? "es" : "en"; } catch (_) { return "en"; }
  }

  function sigueEnDemo() {
    try {
      var raw = localStorage.getItem("f123_owned");
      if (!raw) return true;
      var o = JSON.parse(raw);
      return !(o && o.licenseCode);
    } catch (_) { return false; }
  }

  function tocaElDePin() {
    if (!sigueEnDemo()) return false;
    try {
      var ultimo = Number(localStorage.getItem(K_PIN_VISTO)) || 0;
      return (Date.now() - ultimo) >= CADA_MS;
    } catch (_) { return false; }
  }

  function diasDesdeEpoca() {
    var d = new Date();
    return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);
  }

  function barajaDe(semilla, n) {
    var orden = [], i;
    for (i = 0; i < n; i++) orden.push(i);
    var x = (semilla * 2654435761) % 4294967296;
    for (i = n - 1; i > 0; i--) {
      x = (x * 1103515245 + 12345) % 2147483648;
      var j = x % (i + 1);
      var t = orden[i]; orden[i] = orden[j]; orden[j] = t;
    }
    return orden;
  }

  function tipDeHoy() {
    try {
      var lang = idioma();
      if (tocaElDePin()) return TIP_PIN[lang];
      var arr = TIPS[lang];
      var dia = diasDesdeEpoca();
      var n = arr.length;
      var bloque = Math.floor(dia / n);
      var pos = ((dia % n) + n) % n;
      return arr[barajaDe(bloque + 1, n)[pos]];
    } catch (_) {
      return TIPS[idioma()][0];
    }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function pintar(mount) {
    if (!mount) return;
    var tip = tipDeHoy();
    if (tip.pin) { try { localStorage.setItem(K_PIN_VISTO, String(Date.now())); } catch (_) {} }
    var eyebrow = idioma() === "es" ? "PARA APROVECHAR MEJOR TU APP" : "TO GET MORE OUT OF YOUR APP";
    mount.innerHTML =
      '<div style="font-size:.82rem;font-weight:700;letter-spacing:.04em;'
      + 'color:#2E6278 !important;-webkit-text-fill-color:#2E6278 !important;'
      + 'margin:0 0 6px;">' + esc(eyebrow) + '</div>'
      + '<div style="font-family:Georgia,serif;font-size:17px;font-weight:700;'
      + 'color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;'
      + 'margin:0 0 6px;">' + esc(tip.t) + '</div>'
      + '<div style="font-size:16px;line-height:1.55;'
      + 'color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;'
      + 'margin:0;">' + esc(tip.c) + '</div>';
  }

  function montar() { pintar(document.getElementById("oc-edutip-contable")); }

  global.OCEdutips = {
    montar: montar, tipDeHoy: tipDeHoy, TIPS: TIPS, TIP_PIN: TIP_PIN,
    _baraja: barajaDe, _sigueEnDemo: sigueEnDemo,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", montar, { once: true });
  } else {
    montar();
  }
  try { global.addEventListener("oc-lang-change", montar); } catch (_) {}
})(typeof window !== "undefined" ? window : this);
