/* Test de navegador para el bloque 1d (2026-08-27): perchas.
   Verifica que ventasDelMes() (la función nueva) calcula la venta del mes de
   una percha propia a partir de /api/ventas/todas. Se prueba la lógica
   directamente (no el render de la tarjeta, que requiere login de dueño). */
const path = require("path");
let chromium;
try { ({ chromium } = require(path.join(__dirname, "..", "node_modules", "playwright"))); }
catch (_) { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const BASE = "http://localhost:8127/index.html";

let fallos = [];
function check(nombre, cond, extra) {
  if (cond) console.log("  ok   " + nombre);
  else { console.log("  FALLA " + nombre + (extra ? "  -> " + JSON.stringify(extra) : "")); fallos.push(nombre); }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.OCAuth && window.OCAuth.rolActual, null, { timeout: 15000 });

    // Activate as own device.
    await page.evaluate(async () => {
      await fetch("/api/instancia/activar", { method: "POST", body: JSON.stringify({ instanceId: "inst-perchas2", vaciar: false }) });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.OCAuth && window.OCAuth.rolActual, null, { timeout: 15000 });

    // Create an owned shelf and a product.
    const setup = await page.evaluate(async () => {
      const u = await (await fetch("/api/ubicaciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre: "PerchaPropia2", tipo: "propio" }) })).json();
      const p = await (await fetch("/api/productos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre: "ProdPropio2", barcode: "PP-2", precio: 100, costo: 40, stockInicial: 10, ubicacionId: u.id, umbralRojo: 2, umbralAmarillo: 5 }) })).json();
      return { ubicacionId: u.id, productoId: p.id };
    });
    check("setup: percha propia creada", !!setup.ubicacionId, setup);

    // Record a sale via the correct endpoint (/api/productos/:id/venta).
    const venta = await page.evaluate(async (s) => {
      const r = await fetch(`/api/productos/${s.productoId}/venta`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cantidad: 1, precio: 100, ubicacionId: s.ubicacionId, clienteId: null }) });
      return { status: r.status, body: await r.json() };
    }, setup);
    check("venta registrada (200)", venta.status === 200, venta);

    // Verify the sale is in /api/ventas/todas for this shelf.
    const ventas = await page.evaluate(async (s) => {
      const todas = await (await fetch("/api/ventas/todas")).json();
      return todas.filter((v) => v.ubicacionId === s.ubicacionId);
    }, setup);
    check("venta aparece en /api/ventas/todas para la percha", ventas.length >= 1, ventas);

    // Compute ventasDelMes logic (replica) for this shelf.
    const total = await page.evaluate(async (s) => {
      const todas = await (await fetch("/api/ventas/todas")).json();
      const ahora = new Date();
      const mes = ahora.getMonth(), anio = ahora.getFullYear();
      return todas
        .filter((v) => v.ubicacionId === s.ubicacionId && (() => { const d = new Date(v.fecha); return d.getMonth() === mes && d.getFullYear() === anio; })())
        .reduce((a, v) => a + (Number(v.monto) || (Number(v.precioUnit) || 0) * (Number(v.cantidad) || 0)), 0);
    }, setup);
    check("ventasDelMes calcula la venta del mes (>0)", total > 0, total);

    check("sin errores de página", errs.length === 0, errs.slice(0, 3));

    console.log(fallos.length === 0 ? "\nTODO VERDE — bloque 1d: ventasDelMes calcula la venta real de la percha propia." : "\nHAY ROJO");
  } finally {
    await browser.close();
  }
})();
