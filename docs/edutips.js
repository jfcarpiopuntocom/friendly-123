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

  var TIPS = {
    en: [
      { t: "Margin is not profit",
        c: "Margin is what's left of the price after the cost of the product. Profit is what's left after everything: rent, power, wages. A product with a healthy margin can still leave you at zero if you sell few units." },
      { t: "What doesn't move, costs you",
        c: "A product sitting on the shelf is your money asleep. Even if it never spoils, it is costing you: that same money could be buying something that actually sells." },
      { t: "Selling more isn't always earning more",
        c: "If you raise sales by cutting prices until the margin is thin, you work harder for the same money. Look at the margin column before celebrating a busy day." },
      { t: "Fixed costs don't wait",
        c: "Rent and wages run on the days you sell and the days you don't. That's why the P&L spreads your monthly cost across every day: so you know how much you need to sell on any given day just to break even." },
      { t: "Your inventory is money, not things",
        c: "Valued inventory tells you how much of your money is right now turned into product. If that figure grows month after month but sales don't, your money is sitting still on the shelf." },
      { t: "Commission paid is a real cost",
        c: "A partner's or rep's commission comes out of your margin, not out of some separate pocket. Always record it: a business that forgets it believes it earns more than it does." },
      { t: "A low price alone won't keep anyone",
        c: "A customer who comes only for the price leaves with the first person who goes lower. The customer data you already have tells you who comes back — those are the ones holding the business up." }
    ],
    es: [
      { t: "Margen no es ganancia",
        c: "El margen es lo que queda del precio despues del costo del producto. La ganancia es lo que queda despues de TODO: arriendo, luz, sueldos. Un producto con buen margen puede seguir dejandote en cero si vendes pocas unidades." },
      { t: "Lo que no rota, cuesta",
        c: "Un producto parado en la percha es dinero tuyo dormido. Aunque no se dane, te esta costando: ese mismo dinero podria estar comprando algo que si sale." },
      { t: "Vender mas no siempre es ganar mas",
        c: "Si subes ventas bajando precios y el margen queda muy delgado, trabajas mas para ganar lo mismo. Mira la columna de margen antes de celebrar un dia de muchas ventas." },
      { t: "El gasto fijo no espera",
        c: "El arriendo y los sueldos corren los dias que vendes y los que no. Por eso el P&G reparte tu gasto mensual entre todos los dias: para que sepas cuanto necesitas vender un dia cualquiera solo para empatar." },
      { t: "Tu inventario es plata, no cosas",
        c: "El inventario valorizado te dice cuanto dinero tuyo esta ahora mismo convertido en producto. Si esa cifra crece mes a mes pero las ventas no, el dinero se te esta quedando quieto en la percha." },
      { t: "Comision pagada es costo real",
        c: "La comision de un socio o comisionista sale de tu margen, no de un bolsillo aparte. Registrala siempre: un negocio que la olvida cree que gana mas de lo que gana." },
      { t: "Precio bajo no fideliza solo",
        c: "El cliente que llega solo por precio se va con el primero que baje mas. Los datos de clientes que ya tienes sirven para saber quien vuelve — esos son los que sostienen el negocio." }
    ]
  };

  function lista() {
    var lang = "en";
    try { if (global.OCI18n && global.OCI18n.getLang) lang = global.OCI18n.getLang(); } catch (_) {}
    return TIPS[lang] || TIPS.en;
  }

  // Indice deterministico por dia. Fecha LOCAL, no UTC, para que el cambio
  // ocurra a medianoche del dueno y no a una hora rara.
  function tipDeHoy() {
    try {
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

  global.OCEdutips = { montar: montar, tipDeHoy: tipDeHoy, TIPS: TIPS };

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
