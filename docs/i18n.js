// ============================================================================
// i18n.js — Capa bilingüe EN/ES para friendly-123.
// Inglés es el idioma por DEFECTO; el español se retiene completo (no se
// descarta nada). El usuario cambia de idioma con el switch del header.
//
// Cómo funciona:
//   - DICT.en / DICT.es: diccionarios por clave corta (ej. "nav.today").
//   - t(key): devuelve el texto en el idioma activo, con fallback a inglés y
//     luego a la propia clave (para detectar claves faltantes en desarrollo).
//   - Nodos ESTÁTICOS del HTML se marcan con data-i18n / data-i18n-attr y se
//     traducen solos al cargar y al cambiar de idioma (applyStatic()).
//   - Vistas DINÁMICAS (generadas en JS) llaman window.t("clave") dentro de
//     sus plantillas y se re-renderizan al escuchar el evento "oc-lang-change".
//
// Para agregar textos: añadir la clave en DICT.en y DICT.es. Si falta en es,
// cae a en automáticamente (nunca deja la UI vacía).
// ============================================================================
(function () {
  const DICT = {
    en: {
      "brand.slogan": "Your business, in color",
      "brand.bilingual": "Truly bilingual",
      "header.locationLabel": "Store / shelf",
      "header.bizNameDefault": "My store or shelf(s)",
      "lang.label": "Language",
      "nav.today": "Today",
      "nav.inventory": "Inventory",
      "nav.sell": "Sold",
      "nav.labels": "Labels",
      "nav.shelves": "Shelves",
      "nav.customers": "Customers",
      "nav.commissions": "Commissions",
      "nav.advanced": "Advanced",
      "hoy.loading": "Loading your business...",
      "hoy.moneyIn": "In today",
      "hoy.moneyOut": "Out today",
      "hoy.profit": "Profit today",
      "hoy.inventoryValue": "Your inventory is worth",
      "hoy.salesToday": "Sales today",
      "hoy.avgSale": "Average sale",
      "labels.viewHeading": "Labels ready to print",
      "inv.heading": "Your products",
      "inv.add": "+ Add",
      "inv.recentMoves": "Latest movements",
      "filter.all": "All",
      "filter.urgent": "Urgent",
      "filter.review": "Review",
      "filter.opportunity": "Opportunity",
      "filter.healthy": "Healthy",
      "filter.data": "Data",
      "filter.dormant": "Dormant",
      "shelves.heading": "Shelves",
      "shelves.intro": "Each shelf is an operating unit. Shelves are grouped into branches for reporting and consignment settlement.",
      "shelves.addBranch": "Add branch",
      "shelves.branchPlaceholder": "e.g. Downtown, Holiday Market",
      "shelves.addBranchBtn": "+ Add branch",
      "shelves.addShelf": "Add shelf",
      "shelves.shelfPlaceholder": "e.g. Front Window Shelf",
      "shelves.monthlyTarget": "Monthly target $",
      "shelves.addShelfBtn": "+ Add shelf",
      "fair.heading": "Weekend pop-up",
      "fair.intro": "Create a temporary shelf for a 2-3 day event. When you close it, it is archived with its history and you see its settlement instantly.",
      "fair.eventName": "Event name",
      "fair.namePlaceholder": "e.g. Farmers Market",
      "fair.open": "Open pop-up",
      "common.name": "Name",
      "common.branch": "Branch",
      "common.type": "Type",
      "common.commissionPct": "Commission %",
      "common.phCommission25": "e.g. 25",
      "common.phCommission30": "e.g. 30",
      "common.phTarget300": "e.g. 300",
      "type.own": "Own",
      "type.partner": "Partner",
      "type.franchise": "Franchise",
      "type.consignment": "Consignment",
      "sold.heading": "Sold",
      "sold.intro": "Tap a product and you're done: one unit sold (you can undo within 5s). Scroll down to pick a customer or record the day's close.",
      "sold.howToggle": "How does it work? ▸",
      "sold.step1": "1. Pick the customer (if any) in the selector below.",
      "sold.step2": "2. Tap the product: one unit is deducted from stock.",
      "sold.step3": "3. A blue notice appears below: tap it within 5s if it was a mistake.",
      "sold.step4html": "4. If you don't ring up live, use <strong>Day close</strong> at the end.",
      "sold.scanHeading": "Scan or search by code",
      "sold.scanIntro": "Type or paste the barcode / SKU. (On a tablet with a camera, the reader connects right here.)",
      "sold.scanPlaceholder": "e.g. 7501234567001 or MAR-RED-20",
      "sold.searchBtn": "Search",
      "sold.customerLabel": "Customer:",
      "sold.counterSale": "Counter sale (no customer)",
      "sold.pickBefore": "Pick before tapping the products.",
      "sold.newCustomer": "+ New customer",
      "sold.closeSummary": "🌙 Day close — reconcile everything at once",
      "sold.closeIntro": "The taps in the grid above are already counted for today. Note ONLY the extra you didn't record live: how many units of each product went out. It all applies together when you close.",
      "sold.applyClose": "Apply day close",
      "header.allLocations": "All locations",
      "cust.heading": "Your customers",
      "cust.intro": "Every customer lives in a season, like your crops: 🌱 spring growing, ☀️ summer harvest, 🍂 fall cooling off, ❄️ winter asleep. The color tells you who to take care of and who to wake up.",
      "cust.namePlaceholder": "Customer name",
      "cust.phonePlaceholder": "Phone (optional)",
      "cust.addBtn": "+ Add customer",
      "cust.importHeading": "Import your customer list from a file",
      "cust.importIntro": "If you already have your customers in Excel or on your phone, save the file as <strong>CSV</strong> with two columns, <strong>name</strong> and <strong>phone</strong>, and upload it here. Each one gets their unique code automatically; duplicates (same name) are skipped.",
      "comm.heading": "Commissions",
      "comm.intro": "What you owe each promoter this month, calculated sale by sale — no spreadsheets, no surprises.",
      "adv.heading": "Advanced mode",
      "adv.notice": "This is where the technical detail of the business lives: activity, expenses, and the accounting layer (T-accounts, P&amp;L, balance sheet, and valued inventory). It's not for day-to-day — it's for the accountant, the manager, or anyone who wants to see the numbers in depth. That's why the accounting part asks for a separate passcode.",
      "adv.recentActivity": "Recent activity",
      "adv.monthlyExpenses": "Monthly expenses",
      "adv.expensesIntro": "Rent, electricity, payroll, internet, etc. Enter the monthly total for the selected location. It's split across the real days in the month to estimate the daily operating cost in the P&amp;L.",
      "adv.pickLocation": "Pick a location to edit its expenses:",
      "adv.expensesPlaceholder": "e.g. 350.00",
      "adv.save": "Save",
      "adv.pnlHeading": "Profit & loss (today)",
      "adv.balanceHeading": "Simplified balance sheet",
      "adv.valuedInvHeading": "Valued inventory",
      "footer.tagline": "friendly-123: shelf, customer, and commission control",
    },
    es: {
      "brand.slogan": "Tu negocio, a color",
      "brand.bilingual": "Truly bilingual",
      "header.locationLabel": "Sucursal / percha",
      "header.bizNameDefault": "Mi Local Comercial o Percha(s)",
      "lang.label": "Idioma",
      "nav.today": "Hoy",
      "nav.inventory": "Inventario",
      "nav.sell": "Vendido",
      "nav.labels": "Etiquetas",
      "nav.shelves": "Perchas",
      "nav.customers": "Clientes",
      "nav.commissions": "Comisiones",
      "nav.advanced": "Avanzado",
      "hoy.loading": "Cargando tu negocio...",
      "hoy.moneyIn": "Entró hoy",
      "hoy.moneyOut": "Salió hoy",
      "hoy.profit": "Ganancia de hoy",
      "hoy.inventoryValue": "Tu inventario vale",
      "hoy.salesToday": "Ventas hoy",
      "hoy.avgSale": "Venta promedio",
      "labels.viewHeading": "Etiquetas listas para imprimir",
      "inv.heading": "Tus productos",
      "inv.add": "+ Agregar",
      "inv.recentMoves": "Últimos movimientos",
      "filter.all": "Todos",
      "filter.urgent": "Urgente",
      "filter.review": "Revisar",
      "filter.opportunity": "Oportunidad",
      "filter.healthy": "Sano",
      "filter.data": "Dato",
      "filter.dormant": "Dormido",
      "shelves.heading": "Perchas",
      "shelves.intro": "Cada percha es una unidad operativa. Las perchas se agrupan en sucursales para reportes y liquidación de consignatarios.",
      "shelves.addBranch": "Agregar sucursal",
      "shelves.branchPlaceholder": "Ej: Centro, Feria de Navidad",
      "shelves.addBranchBtn": "+ Agregar sucursal",
      "shelves.addShelf": "Agregar percha",
      "shelves.shelfPlaceholder": "Ej: Percha Feria Artesanal",
      "shelves.monthlyTarget": "Meta mensual $",
      "shelves.addShelfBtn": "+ Agregar percha",
      "fair.heading": "Feria de fin de semana",
      "fair.intro": "Crea una percha temporal para un evento de 2-3 días. Al cerrarla queda archivada con su historial y ves su liquidación al instante.",
      "fair.eventName": "Nombre del evento",
      "fair.namePlaceholder": "Ej: Feria de Otavalo",
      "fair.open": "Abrir feria",
      "common.name": "Nombre",
      "common.branch": "Sucursal",
      "common.type": "Tipo",
      "common.commissionPct": "Comisión %",
      "common.phCommission25": "Ej: 25",
      "common.phCommission30": "Ej: 30",
      "common.phTarget300": "Ej: 300",
      "type.own": "Propio",
      "type.partner": "Socio",
      "type.franchise": "Franquicia",
      "type.consignment": "Consignación",
      "sold.heading": "Vendido",
      "sold.intro": "Toca un producto y listo: una unidad vendida (puedes deshacer en 5s). Baja para elegir cliente o registrar el cierre del día.",
      "sold.howToggle": "¿Cómo funciona? ▸",
      "sold.step1": "1. Elige el cliente (si aplica) en el selector de abajo.",
      "sold.step2": "2. Toca el producto: se descuenta una unidad del stock.",
      "sold.step3": "3. Aparece un aviso azul abajo: tócalo en 5s si fue error.",
      "sold.step4html": "4. Si no vendes en vivo, usa <strong>Cierre del día</strong> al final.",
      "sold.scanHeading": "Escanear o buscar por código",
      "sold.scanIntro": "Escribe o pega el código de barras / SKU. (En tablet con cámara, el lector conecta aquí mismo.)",
      "sold.scanPlaceholder": "Ej: 7501234567001 o MAR-RED-20",
      "sold.searchBtn": "Buscar",
      "sold.customerLabel": "Cliente:",
      "sold.counterSale": "Venta de mostrador (sin cliente)",
      "sold.pickBefore": "Elige antes de tocar los productos.",
      "sold.newCustomer": "+ Nuevo cliente",
      "sold.closeSummary": "🌙 Cierre del día — cuadra todo de una sola vez",
      "sold.closeIntro": "Los toques del grid de arriba ya están incluidos en el día. Apunta SOLO lo adicional que no registraste en vivo: cuántas unidades salieron de cada producto. Aplica todo junto al cerrar.",
      "sold.applyClose": "Aplicar cierre del día",
      "header.allLocations": "Todas las ubicaciones",
      "cust.heading": "Tus clientes",
      "cust.intro": "Cada cliente vive una estación, como tus siembras: 🌱 primavera crece, ☀️ verano cosecha, 🍂 otoño se enfría, ❄️ invierno duerme. El color te dice a quién cuidar y a quién despertar.",
      "cust.namePlaceholder": "Nombre del cliente",
      "cust.phonePlaceholder": "Teléfono (opcional)",
      "cust.addBtn": "+ Agregar cliente",
      "cust.importHeading": "Importar tu cartera desde un archivo",
      "cust.importIntro": "Si ya tienes tus clientes en Excel o en el telefono, guarda el archivo como <strong>CSV</strong> con dos columnas, <strong>nombre</strong> y <strong>telefono</strong>, y subelo aqui. Cada uno recibe su codigo unico automaticamente; los repetidos (mismo nombre) se saltan.",
      "comm.heading": "Comisiones",
      "comm.intro": "Lo que le debes a cada promotor/a este mes, calculado venta por venta — sin Excel, sin sorpresas.",
      "adv.heading": "Modo avanzado",
      "adv.notice": "Aquí vive el detalle técnico del negocio: actividad, gastos, y la capa contable (cuentas T, P&amp;G, balance e inventario valorizado). No es para el día a día — es para el contador, el administrador o quien quiera ver los números a fondo. Por eso la parte contable pide una subclave aparte.",
      "adv.recentActivity": "Actividad reciente",
      "adv.monthlyExpenses": "Gastos mensuales",
      "adv.expensesIntro": "Arriendo, luz, sueldos, internet, etc. Ingresa el total mensual de la ubicación seleccionada. Se reparte entre los días reales del mes para estimar el gasto operativo del día en el P&amp;G.",
      "adv.pickLocation": "Elige una ubicación para editar sus gastos:",
      "adv.expensesPlaceholder": "Ej: 350.00",
      "adv.save": "Guardar",
      "adv.pnlHeading": "Pérdidas y ganancias (hoy)",
      "adv.balanceHeading": "Balance simplificado",
      "adv.valuedInvHeading": "Inventario valorizado",
      "footer.tagline": "Amigable-123: control de inventario, clientes y perchas",
    },
  };

  const LS_KEY = "oc_lang";
  let lang = localStorage.getItem(LS_KEY);
  if (lang !== "en" && lang !== "es") lang = "en"; // default English

  function t(key, fallback) {
    const d = DICT[lang] || DICT.en;
    if (d[key] != null) return d[key];
    if (DICT.en[key] != null) return DICT.en[key];
    return fallback != null ? fallback : key;
  }

  function getLang() { return lang; }

  function setLang(l) {
    lang = l === "es" ? "es" : "en";
    try { localStorage.setItem(LS_KEY, lang); } catch (_) {}
    document.documentElement.lang = lang;
    applyStatic();
    // Las vistas dinámicas escuchan esto para re-renderizar en el nuevo idioma.
    window.dispatchEvent(new CustomEvent("oc-lang-change", { detail: { lang } }));
  }

  // Traduce nodos estáticos marcados en el HTML.
  //   data-i18n="clave"          -> textContent
  //   data-i18n-html="clave"     -> innerHTML (para textos con marcado)
  //   data-i18n-attr="attr:clave,attr:clave" -> atributos (title, placeholder...)
  function applyStatic(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    scope.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    scope.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      el.getAttribute("data-i18n-attr").split(",").forEach((pair) => {
        const idx = pair.indexOf(":");
        if (idx > 0) {
          const attr = pair.slice(0, idx).trim();
          const key = pair.slice(idx + 1).trim();
          if (attr && key) el.setAttribute(attr, t(key));
        }
      });
    });
  }

  window.OCI18n = { t, setLang, getLang, applyStatic, DICT };
  window.t = t; // atajo para las plantillas de las vistas dinámicas

  document.addEventListener("DOMContentLoaded", () => {
    document.documentElement.lang = lang;
    applyStatic();
  });
})();
