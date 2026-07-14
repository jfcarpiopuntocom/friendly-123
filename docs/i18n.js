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
      "nav.sell": "Sell",
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
    },
    es: {
      "brand.slogan": "Tu negocio, a color",
      "brand.bilingual": "Truly bilingual",
      "header.locationLabel": "Sucursal / percha",
      "header.bizNameDefault": "Mi Local Comercial o Percha(s)",
      "lang.label": "Idioma",
      "nav.today": "Hoy",
      "nav.inventory": "Inventario",
      "nav.sell": "Vender",
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
