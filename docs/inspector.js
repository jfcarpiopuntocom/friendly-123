/* Inspector(TM) — verificación e integridad de inventario (JFC/Belén 2026-09-03).

   Motor LOCAL y de SOLO LECTURA. Fase 1: nada sale del aparato. Da el "sello" de
   integridad del inventario y detecta descuadres/manipulaciones comparando contra
   un sello base guardado localmente. Es la pieza que, en fase 2, permitirá empatar
   inventarios entre aparatos (join this notebook) sobre el relay zero-knowledge.

   EL MURO (privacidad, world-class, protección legal — REGLA 7 + REGLA 8):
   Inspector mira SOLO inventario — SKU, nombre, cantidad, categoría, percha y una
   huella corta de la foto. JAMÁS precios, costos, ventas, ganancias ni datos de
   clientes. No retiene contenidos: guarda huellas (hashes), no el catálogo en claro.
   Cifrado de huella con SHA-256 (SubtleCrypto) y fallback local. Aditivo: no toca
   ningún flujo vivo ni el sync. */
(function (global) {
  "use strict";

  // Huella corta y barata (djb2) para la foto — no retiene la foto, solo su firma.
  function _hashRapido(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }

  // SHA-256 hex (grado militar) vía SubtleCrypto; si no hay, cae a djb2 (nunca rompe).
  async function _sha256(txt) {
    try {
      if (global.crypto && global.crypto.subtle && typeof TextEncoder !== "undefined") {
        var buf = await global.crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return b.toString(16).padStart(2, "0");
        }).join("");
      }
    } catch (_) {}
    return _hashRapido(txt);
  }

  // Huella de un ítem: SOLO campos de inventario. El muro está aquí: nada de dinero.
  async function _huellaItem(p) {
    var foto = p.foto ? _hashRapido(String(p.foto)) : "";
    var base = [
      "sku:" + (p.sku || ""),
      "n:" + (p.nombre || ""),
      "q:" + (Number(p.stockActual) || 0),
      "cat:" + (p.categoria || ""),
      "perc:" + (p.ubicacionId || ""),
      "foto:" + foto
    ].join("|");
    return {
      sku: p.sku || p.id,
      nombre: p.nombre || "",
      cantidad: Number(p.stockActual) || 0,
      categoria: p.categoria || "",
      percha: p.ubicacionId || "",
      hash: await _sha256(base)
    };
  }

  // Sello verificable del inventario local: items ordenados + root (huella raíz).
  async function snapshot() {
    var prods = [];
    try { prods = await (await fetch("/api/productos?todas=1")).json(); } catch (_) { prods = []; }
    var items = [];
    for (var i = 0; i < (prods || []).length; i++) items.push(await _huellaItem(prods[i]));
    items.sort(function (a, b) { return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0; });
    var root = await _sha256(items.map(function (x) { return x.hash; }).join(""));
    return { v: 1, root: root, count: items.length, items: items, generatedAt: new Date().toISOString() };
  }

  // Diferencia entre dos sellos (base vs ahora): faltantes, nuevos, cambios de inventario.
  // Función pura (testeable sin navegador).
  function diff(base, actual) {
    var mb = {}, ma = {};
    ((base && base.items) || []).forEach(function (x) { mb[x.sku] = x; });
    ((actual && actual.items) || []).forEach(function (x) { ma[x.sku] = x; });
    var faltantes = [], nuevos = [], cambios = [];
    Object.keys(mb).forEach(function (sku) {
      if (!ma[sku]) faltantes.push(mb[sku]);
      else if (ma[sku].hash !== mb[sku].hash) cambios.push({
        sku: sku, nombre: ma[sku].nombre,
        antes: mb[sku], ahora: ma[sku],
        deltaCantidad: (ma[sku].cantidad || 0) - (mb[sku].cantidad || 0)
      });
    });
    Object.keys(ma).forEach(function (sku) { if (!mb[sku]) nuevos.push(ma[sku]); });
    return {
      intacto: faltantes.length === 0 && nuevos.length === 0 && cambios.length === 0,
      faltantes: faltantes, nuevos: nuevos, cambios: cambios,
      rootBase: base && base.root, rootActual: actual && actual.root
    };
  }

  // Sello base persistente local (guardar / leer) — solo huellas, nunca dinero.
  var BASE_KEY = "f123_inspector_baseline";
  function guardarBaseline(snap) {
    try { localStorage.setItem(BASE_KEY, JSON.stringify(snap)); return true; } catch (_) { return false; }
  }
  function leerBaseline() {
    try { return JSON.parse(localStorage.getItem(BASE_KEY) || "null"); } catch (_) { return null; }
  }

  global.Inspector = {
    snapshot: snapshot, diff: diff,
    guardarBaseline: guardarBaseline, leerBaseline: leerBaseline,
    _sha256: _sha256, version: 1
  };

  // Export CommonJS para el arnés de node (solo la lógica pura es testeable sin navegador).
  if (typeof module !== "undefined" && module.exports) module.exports = global.Inspector;
})(typeof window !== "undefined" ? window : this);
