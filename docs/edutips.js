/*!
 * edutips.js — friendly-123
 * ============================================================================
 * The blue box at the foot of the accounting view. A short reflection that
 * teaches how to read the numbers already on screen, not a new number.
 *
 * COLOR RULE (JFC 2026-07-28) — DO NOT BREAK
 * ----------------------------------------------------------------------------
 * Blue is EXCLUDED from dashboards and inventory cards: there, color is the
 * language of action (the Simon colors) and adding blue muddies it. Blue lives
 * in exactly two calm places, both at the foot of their section:
 *   1. "Under watch" — products with a thin margin.
 *   2. This box — an accounting reflection or tip.
 * If blue is ever needed anywhere else, ask first.
 *
 * BILINGUAL
 * ----------------------------------------------------------------------------
 * The tips are written NATIVE in each language, not translated word for word:
 * a literal translation of plain-spoken business advice reads stiff and
 * foreign, which is the opposite of the point. To edit, change the arrays
 * below. One tip per day, deterministic — the owner sees the same tip all day
 * and can go back to it, instead of it shifting under their eyes on refresh.
 * ============================================================================
 */
(function (global) {
  "use strict";

  /* CAMBIO DE RUMBO (JFC, 2026-08-15 en amigable-123, homologado aqui
     2026-08-19): antes eran tips FINANCIEROS (margen, P&G, rotacion). Ya no.
     Ahora son de APROVECHAMIENTO. El motivo es simple: buena parte de lo que
     ya esta construido no se usa porque nadie sabe que existe, y una leccion
     de contabilidad no arregla eso. Si un tip menciona tiempo o dinero
     ahorrado, es porque es cierto y concreto, no de adorno.

     Los tips en ingles estan escritos NATIVOS, no traducidos palabra por
     palabra: una traduccion literal de consejo llano de negocio suena tiesa y
     ajena, que es justo lo contrario de lo que se busca. En ingles la unidad
     se llama "shelf" (ver nav.shelves en i18n.js), no "percha". */
  var TIPS = {
    en: [
      { t: "The colors tell you what to do",
        c: "You don't need to read a single number to know how your business is doing. Green means carry on, gold means there's money waiting, orange means it's running out, red means act now, black means it isn't moving. One look at Today before you open and you know where to start." },
      { t: "The end-of-day close, when you couldn't ring things up live",
        c: "If the counter was packed and you never got to record anything, you don't have to rebuild it sale by sale. In Sold, the end-of-day close applies the whole lot in one pass." },
      { t: "Search the way you think, not by column",
        c: "The search box in Inventory and in Customers finds by anything: name, category, code, half a word. You don't have to remember which field you typed it into." },
      { t: "The shelf is the unit, not the store",
        c: "If you have a storefront and a market stall, they are not one pile. Split them into shelves and each one tells you its own truth: which one is carrying the other becomes obvious in an afternoon." },
      { t: "Restocking, shelf by shelf",
        c: "In Shelves, the restock list builds itself — what to order and in what order. That's the difference between walking into your supplier with a list and walking in to see what comes to mind." },
      { t: "You print the barcode label yourself",
        c: "Every product can carry its own barcode. Print it from Labels and then sell by scanning: no more hunting for the product in a list while the customer waits." },
      { t: "Scan to sell",
        c: "If the product already has its code, your phone camera is the scanner. Point and done, nothing to type." },
      { t: "Your team signs in with their own PIN",
        c: "One key per person isn't red tape: it's what makes the activity log say who did what. The day a number doesn't add up, that's the difference between knowing and suspecting." },
      { t: "The history is sealed",
        c: "Every movement is chained to the one before it. If someone edits or deletes one, the chain breaks and the anti-fraud check says so. It doesn't stop it from happening; it tells you that it did." },
      { t: "Customers rate themselves, and you rate them too",
        c: "The app builds the behavior matrix on its own: who comes back, who buys big, who vanished. And you can give them stars and hearts, or stop selling to whoever you'd rather not." },
      { t: "Store credit with no interest, but with memory",
        c: "You can write down what you let someone take on credit and set up a payment plan, either fixed installments or payments as they come. No surcharges: just a nudge when it's time to collect." },
      { t: "The backup is yours, not ours",
        c: "In Advanced you can download your whole business as one file and keep it wherever you want. Do it once a month: it takes ten seconds and it's the difference between a scare and a loss." },
      { t: "One team, one code",
        c: "With sync on, what one person records everyone sees within seconds. No more texting to ask how many are left." },
      { t: "The control board, for looking at things calmly",
        c: "A big screen fits what a phone has to summarize: product by product, sale by sale, with search and export. You open it from Advanced." },
      { t: "Export something your accountant can actually use",
        c: "The accounting report comes out as a file that opens in Excel. Sending that instead of photos of a notebook saves them hours and saves you the bill for those hours." },
      { t: "Product photos are worth more than the name",
        c: "A card with a photo is recognized without reading. If you have new staff or products that look alike, adding the photos is the best-spent hour of your week." },
      { t: "Products that are almost the same",
        c: "If you sell the same thing in variants that only differ on the inside, group them into a family with a shared code. They show up together and you stop mixing them up at the counter." },
      { t: "Transfers between shelves leave a trail",
        c: "Moving product from one place to another isn't just subtract here and add there. Whoever receives it confirms what arrived, and if something is missing you know where." },
      { t: "Commissions work themselves out",
        c: "If you work with reps or on consignment, the app splits every sale the way you agreed. No more Sunday with a calculator." },
      { t: "Petty cash is your money too",
        c: "The cab, the lunch, the bag from the corner store. Writing them down takes five seconds and it's the only way the month's profit is the real one instead of the one you'd like." },
      { t: "Adjusting isn't cheating",
        c: "If something broke, expired, or the count was wrong, use Adjust and write the reason. It gets recorded. An inventory that never gets adjusted is an inventory nobody believes." },
      { t: "What dies on the shelf",
        c: "Black marks what has gone a long time without moving. That's your money standing still: clearing it at a discount almost always beats waiting for someone to want it." },
      { t: "What you're holding is worth this much",
        c: "Valued inventory tells you, in one number, how much of your money is right now turned into product. It's what you show to ask for credit, and what you check before buying more." },
      { t: "The search box forgives accents too",
        c: "Type cafe or café, with the accent or without: it finds it either way. It's built for typing fast with one hand." },
      { t: "Who's in the loop",
        c: "In Advanced you can see which of your team's devices are in sync and which have gone quiet for a while. The one that's offline may be selling something that was already sold here." },
      { t: "Give every device a name",
        c: "In Advanced you can write what this device is called: Rosa, the counter phone, market tablet. When the team grows, that's the difference between a useful list and a list of codes." },
      { t: "It works without internet too",
        c: "The app opens and records even if the connection drops. When it comes back, it catches up with the rest of the team on its own. You don't lose a sale to the wifi." },
      { t: "Install it as an app",
        c: "From the browser you can add it to your home screen. It opens full screen, starts faster, and stops being a tab lost among twenty." },
      { t: "Holds and special orders don't live in your head",
        c: "What a customer set aside or ordered gets written down and stays. That's what keeps you from selling the same thing twice and letting down whoever asked first." },
      { t: "The recovery email isn't paperwork",
        c: "It's the only thing that gives you your access back if you forget your PIN. Register it in Advanced today, not the day you need it." },
      { t: "Your license code is almost a private key",
        c: "Whoever has it gets into your business's room. Write it down somewhere safe, share it only with your team, and if it leaks you can change it from Advanced." },
      { t: "The app reports its own failures",
        c: "If something breaks, we get the technical detail and nothing else: not a product, not a customer, not a figure of yours. Most of the time we've fixed it before you get around to writing." }
    ],
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
        c: "Si trabajas con asociados o consignacion, la app reparte cada venta segun lo pactado. Se acaba el domingo de calculadora." },
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
        c: "Si algo se rompe, nos llega el dato tecnico y nada mas: ni un producto, ni un cliente, ni una cifra tuya. Casi siempre lo arreglamos antes de que alcances a escribir." }
    ]
  };

  /* ==========================================================================
     EL TIP DE LOS PIN. Aparte del arreglo, con su propia regla.

     Sale cada 14 dias como maximo mientras el dispositivo siga con los PIN de
     demo, y DEJA DE SALIR en cuanto los cambien. Un recordatorio que sigue
     apareciendo despues de que ya hiciste lo que pedia es la forma mas rapida
     de que la gente deje de leer esta cajita.

     No regana: dice para que sirve. Nadie cambia un PIN porque lo rete un
     cuadrito azul.
     ========================================================================== */
  var TIP_PIN = {
    en: { t: "The demo PINs are still in place",
          c: "While the example codes are still there, anyone who saw them on the landing page can get into your business. Setting your own takes a minute in Advanced, and from then on each person on your team signs in with their own key: that is what makes the activity log worth anything.",
          pin: true },
    es: { t: "Los PIN de demo siguen puestos",
          c: "Mientras esten los codigos de ejemplo, cualquiera que los haya visto en la landing puede entrar a tu negocio. Poner los tuyos toma un minuto en Avanzado, y desde ahi cada persona de tu equipo entra con su propia clave: eso es lo que hace que el registro de actividad sirva de algo.",
          pin: true }
  };

  var K_PIN_VISTO = "f123_edutip_pin_visto";
  var CADA_MS = 14 * 86400000;

  /* Si el dispositivo ya fue apropiado, los PIN de demo ya no aplican: al
     activar con 789 el PIN del dueno se reemplaza. Se comprueba por el mismo
     dato que usa el resto de la app, no por una bandera propia que se pueda
     desincronizar. */
  function sigueEnDemo() {
    try {
      var raw = localStorage.getItem("f123_owned");
      if (!raw) return true;              /* nunca activado: sigue en demo */
      var o = JSON.parse(raw);
      return !(o && o.licenseCode);
    } catch (_) {
      /* Ante la duda NO se muestra: es preferible callar un recordatorio que
         acusar de inseguro a quien ya hizo los deberes. */
      return false;
    }
  }
  function tocaElDePin() {
    try {
      if (!sigueEnDemo()) return false;
      var visto = Number(localStorage.getItem(K_PIN_VISTO) || 0);
      if (Date.now() - visto < CADA_MS) return false;
      localStorage.setItem(K_PIN_VISTO, String(Date.now()));
      return true;
    } catch (_) { return false; }
  }

  function lista() {
    var lang = "en";
    try { if (global.OCI18n && global.OCI18n.getLang) lang = global.OCI18n.getLang(); } catch (_) {}
    return TIPS[lang] || TIPS.en;
  }

  // Indice deterministico por dia. Fecha LOCAL, no UTC, para que el cambio
  // ocurra a medianoche del dueno y no a una hora rara.
  function idioma() {
    try { if (global.OCI18n && global.OCI18n.getLang) return global.OCI18n.getLang(); } catch (_) {}
    return "en";
  }
  function tipDeHoy() {
    try {
      if (tocaElDePin()) return TIP_PIN[idioma()] || TIP_PIN.en;
      var arr = lista();
      var d = new Date();
      var dias = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
      return arr[Math.abs(dias) % arr.length];
    } catch (_) { return lista()[0]; }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function T(k) { try { return (global.t ? global.t(k) : k); } catch (_) { return k; } }

  // Colores solidos con -webkit-text-fill-color: iOS en modo oscuro
  // reinterpreta los colores heredados y deja el texto invisible.
  function pintar(mount) {
    if (!mount) return;
    var tip = tipDeHoy();
    mount.innerHTML =
      '<div style="font-size:.82rem;font-weight:700;letter-spacing:.04em;'
      + 'color:#2E6278 !important;-webkit-text-fill-color:#2E6278 !important;'
      + 'margin:0 0 6px;">' + esc(T("edutip.eyebrow")) + '</div>'
      + '<div style="font-family:Georgia,serif;font-size:17px;font-weight:700;'
      + 'color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;'
      + 'margin:0 0 6px;">' + esc(tip.t) + '</div>'
      + '<div style="font-size:16px;line-height:1.55;'
      + 'color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;'
      + 'margin:0;">' + esc(tip.c) + '</div>';
  }

  function montar() { pintar(document.getElementById("oc-edutip-contable")); }

  global.OCEdutips = { montar: montar, tipDeHoy: tipDeHoy, TIPS: TIPS, TIP_PIN: TIP_PIN };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", montar, { once: true });
  } else {
    montar();
  }
  // Repintar al cambiar de idioma: sin esto el tip se queda en el idioma
  // anterior hasta recargar, que es justo el bug que delata una app bilingue
  // mal terminada.
  try { global.addEventListener("oc-lang-change", montar); } catch (_) {}
})(typeof window !== "undefined" ? window : this);
