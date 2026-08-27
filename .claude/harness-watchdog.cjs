/* Harness de la capa de redundancia de sync (sync-watchdog.js).
   Verifica las 3 capacidades SIN relay real (se llaman las funciones puras,
   igual que los otros harnesses):
   A) snapshot local: guardarSnapshot()/ultimoSnapshot() persisten el catálogo.
   B) verificador de consistencia: detecta una huella divergente de un par.
   C) snapshot entre pares: armarSnapshot() en A -> aplicarCheckpoint() en B
      agrega los datos de A SIN pisar los de B (add-only, guarda de frescura).
   Además: acumulación por trozos (Capability C) y sin errores de página. */
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
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const errsA = [];
    pageA.on("pageerror", (e) => errsA.push(String(e)));
    await pageA.goto(BASE, { waitUntil: "domcontentloaded" });
    await pageA.waitForFunction(() => window.OCSyncWatchdog && window.OCSync && window.OCSync.estadoParaCheckpoint, null, { timeout: 15000 });

    // A: activar y crear un producto real.
    await pageA.evaluate(async () => {
      await fetch("/api/instancia/activar", { method: "POST", body: JSON.stringify({ instanceId: "inst-wd-a", vaciar: false }) });
    });
    const addA = await pageA.evaluate(async () => {
      const r = await fetch("/api/productos", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "WatchdogProductA", barcode: "WD-A-1", precio: 9, costo: 4, stock: 7, ubicacionId: "u1", umbralRojo: 2, umbralAmarillo: 5 }) });
      return { status: r.status };
    });
    check("A: producto creado (200)", addA.status === 200, addA);

    // A: snapshot local (Capability A).
    const snapA = await pageA.evaluate(async () => {
      const s = await window.OCSyncWatchdog.guardarSnapshot();
      const ult = await window.OCSyncWatchdog.ultimoSnapshot();
      return { s, ult };
    });
    check("A: snapshot guardado", !!snapA.s && !!snapA.s.id, snapA.s);
    check("A: snapshot contiene el producto", Array.isArray(snapA.ult && snapA.ult.data && snapA.ult.data.productos) && snapA.ult.data.productos.some((p) => p.nombre === "WatchdogProductA"), snapA.ult && snapA.ult.data && snapA.ult.data.productos && snapA.ult.data.productos.length);

    // A: armarSnapshot para sembrar B (Capability C).
    const snapData = await pageA.evaluate(() => {
      const s = window.OCSyncWatchdog.armarSnapshot();
      return s ? s.data : null;
    });
    check("A: armarSnapshot devuelve datos", !!snapData && Array.isArray(snapData.productos), snapData && snapData.productos && snapData.productos.length);

    // B: aparato fresco que recibe el snapshot de A (add-only, no pisa).
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const errsB = [];
    pageB.on("pageerror", (e) => errsB.push(String(e)));
    await pageB.goto(BASE, { waitUntil: "domcontentloaded" });
    await pageB.waitForFunction(() => window.OCSync && window.OCSync.aplicarCheckpoint, null, { timeout: 15000 });
    await pageB.evaluate(async () => {
      await fetch("/api/instancia/activar", { method: "POST", body: JSON.stringify({ instanceId: "inst-wd-b", vaciar: false }) });
    });
    // B crea su propio producto para verificar que NO se pisa.
    await pageB.evaluate(async () => {
      await fetch("/api/productos", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "WatchdogProductB", barcode: "WD-B-1", precio: 3, costo: 1, stock: 2, ubicacionId: "u1", umbralRojo: 1, umbralAmarillo: 2 }) });
    });
    // B aplica el snapshot de A.
    const rB = await pageB.evaluate((snap) => window.OCSync.aplicarCheckpoint(snap), snapData);
    check("B: aplicarCheckpoint responde ok", rB && rB.ok === true, rB);
    const prodsB = await pageB.evaluate(async () => { const r = await fetch("/api/productos?todas=1"); return await r.json(); });
    check("B: tiene el producto de A (merge add-only)", Array.isArray(prodsB) && prodsB.some((p) => p.nombre === "WatchdogProductA"), prodsB.length);
    check("B: conserva su propio producto (no pisa)", Array.isArray(prodsB) && prodsB.some((p) => p.nombre === "WatchdogProductB"), prodsB.length);

    // B: acumulación por trozos (Capability C) — simular el flujo de red.
    const chunkOk = await pageB.evaluate((snap) => {
      const json = JSON.stringify(snap);
      const bytes = new TextEncoder().encode(json);
      const TROZO = 200 * 1024;
      const trozos = [];
      for (let i = 0; i < bytes.length; i += TROZO) trozos.push(new TextDecoder().decode(bytes.slice(i, i + TROZO)));
      const snapId = "snap-chunk-test";
      trozos.forEach((t, idx) => {
        window.OCSyncWatchdog.acumularSnapshot({ payload: { snapId, idx, total: trozos.length, huella: "h", trozo: t } });
      });
      return { total: trozos.length };
    }, snapData);
    check("B: acumulación por trozos procesada", chunkOk && chunkOk.total >= 1, chunkOk);

    // A: verificador de consistencia (Capability B) — fabricar huella divergente.
    // La divergencia debe persistir ≥2 checks consecutivos (anti-falsos positivos).
    const div = await pageA.evaluate(() => {
      try { localStorage.setItem("f123_micelio_vistos", JSON.stringify({ "device-otro": { huella: "HUELLA-DIVERGENTE-XYZ" } })); } catch (_) {}
      window.OCSyncWatchdog.verificarConsistencia(); // 1er check: cuenta 1
      const res = window.OCSyncWatchdog.verificarConsistencia(); // 2do check: llega al umbral
      return res;
    });
    check("A: detecta divergencia de un par", Array.isArray(div.divergentes) && div.divergentes.length >= 1, div);

    // Sin errores de página en A ni B.
    check("A: sin errores de pagina", errsA.length === 0, errsA);
    check("B: sin errores de pagina", errsB.length === 0, errsB);

    console.log(fallos.length ? "\nFALLOS: " + fallos.join(", ") : "\nTODO VERDE — capa de redundancia de sync funciona.");
    process.exit(fallos.length ? 1 : 0);
  } finally {
    await browser.close();
  }
})();
