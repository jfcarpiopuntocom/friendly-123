// loyverse.js — Cliente de la API de Loyverse + caché de catálogo.
// Activo solo si existe process.env.LOYVERSE_TOKEN. Si no existe, server.js
// usa db.js (datos de demo locales) en su lugar — así el proyecto sigue
// funcionando sin token para seguir desarrollando/mostrando la UI.

const BASE = "https://api.loyverse.com/v1.0";
const TOKEN = process.env.LOYVERSE_TOKEN;

function activo() {
  return Boolean(TOKEN);
}

async function llamar(endpoint, opts = {}) {
  const res = await fetch(`${BASE}${endpoint}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    throw new Error(`Loyverse API ${res.status} en ${endpoint}: ${texto.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Trae todas las páginas de un listado paginado de Loyverse (cursor-based).
async function listarTodo(endpoint, llaveColeccion) {
  let resultados = [];
  let cursor = null;
  do {
    const qs = cursor ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}` : endpoint;
    const data = await llamar(qs);
    resultados = resultados.concat(data[llaveColeccion] || []);
    cursor = data.cursor || null;
  } while (cursor);
  return resultados;
}

// ---------- Caché de catálogo (evita golpear la API en cada click) ----------
const CACHE_MS = 20_000;
let cache = { ts: 0, ubicaciones: [], productos: [], proveedoresPorId: {} };
let enVuelo = null;

async function refrescarCatalogo(forzar = false) {
  if (!forzar && Date.now() - cache.ts < CACHE_MS) return cache;
  if (enVuelo) return enVuelo;

  enVuelo = (async () => {
    const [stores, items, inventory, suppliers] = await Promise.all([
      listarTodo("/stores?limit=250", "stores"),
      listarTodo("/items?limit=250", "items"),
      listarTodo("/inventory?limit=250", "inventory_levels"),
      listarTodo("/suppliers?limit=250", "suppliers").catch(() => []),
    ]);

    const proveedoresPorId = {};
    for (const s of suppliers) proveedoresPorId[s.id] = s.name;

    // inventory_levels: [{ variant_id, store_id, in_stock }]
    const stockPorVarianteTienda = {};
    for (const inv of inventory) {
      stockPorVarianteTienda[`${inv.variant_id}__${inv.store_id}`] = Number(inv.in_stock || 0);
    }

    // Umbrales editables localmente (Loyverse no expone puntos de reorden de forma consistente
    // entre planes), guardados en data/umbrales.json por variant_id.
    const umbrales = require("./umbrales");

    const productos = [];
    for (const item of items) {
      const variants = item.variants || [];
      for (const v of variants) {
        const tiendasDeVariante = v.stores && v.stores.length ? v.stores : stores.map((s) => ({ store_id: s.id }));
        for (const st of tiendasDeVariante) {
          const storeId = st.store_id;
          const key = `${v.variant_id}__${storeId}`;
          const u = umbrales.get(v.variant_id);
          productos.push({
            id: `${v.variant_id}__${storeId}`,
            variantId: v.variant_id,
            nombre: item.item_name + (variants.length > 1 && v.variant_name ? ` (${v.variant_name})` : ""),
            categoria: item.category_id || "Sin categoría",
            sku: v.sku || "—",
            barcode: v.barcode || v.sku || "—",
            ubicacionId: storeId,
            precio: Number(st.price ?? v.default_price ?? 0),
            costo: Number(v.cost ?? v.default_cost ?? 0),
            stockActual: stockPorVarianteTienda[key] ?? 0,
            umbralRojo: u.umbralRojo,
            umbralAmarillo: u.umbralAmarillo,
            proveedor: proveedoresPorId[item.supplier_id] || "Sin proveedor",
          });
        }
      }
    }

    cache = {
      ts: Date.now(),
      ubicaciones: stores.map((s) => ({ id: s.id, nombre: s.name })),
      productos,
    };
    return cache;
  })();

  try {
    return await enVuelo;
  } finally {
    enVuelo = null;
  }
}

async function getUbicaciones() {
  return (await refrescarCatalogo()).ubicaciones;
}

async function getProductos() {
  return (await refrescarCatalogo()).productos;
}

// Ajusta stock en Loyverse vía un inventory adjustment (no crea un recibo/venta —
// la caja real sigue siendo Loyverse POS; esto solo corrige/refleja stock).
async function ajustarStock({ variantId, storeId, delta, motivo }) {
  await llamar("/inventory", {
    method: "POST",
    body: JSON.stringify({
      inventory_levels: [
        {
          variant_id: variantId,
          store_id: storeId,
          stock_adjustment: {
            quantity: delta,
            reason: motivo || "Ajuste desde AMIGABLE",
          },
        },
      ],
    }),
  });
  await refrescarCatalogo(true);
}

// Ventas de hoy, leídas directo de los recibos reales de Loyverse (solo lectura).
async function getVentasHoy(storeId, fechaISO) {
  const params = new URLSearchParams({
    limit: "250",
    created_at_min: `${fechaISO}T00:00:00.000Z`,
    created_at_max: `${fechaISO}T23:59:59.999Z`,
  });
  if (storeId && storeId !== "todas") params.set("store_id", storeId);

  const receipts = await listarTodo(`/receipts?${params.toString()}`, "receipts");
  const ventas = [];
  for (const r of receipts) {
    if (r.cancelled_at || r.refund_for) continue;
    for (const li of r.line_items || []) {
      ventas.push({
        ubicacionId: r.store_id,
        cantidad: Number(li.quantity || 0),
        precioUnit: Number(li.price || 0),
        costoUnit: Number(li.cost || 0),
        fecha: r.receipt_date || r.created_at,
      });
    }
  }
  return ventas;
}

module.exports = { activo, getUbicaciones, getProductos, ajustarStock, getVentasHoy, refrescarCatalogo };
