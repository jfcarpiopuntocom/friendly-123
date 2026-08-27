/* Harness de fail-safes de integridad del sync (FASE 2, 2026-08-27).
   Verifica, SIN relay real (funciones puras, como los otros harnesses):
   1) DEDUP: aplicar la misma op dos veces (mismo opId) NO dobla el stock
      (el set _opsAplicadas lo hace no-op; el tope subió 500->2000).
   2) COLA: el desborde de la cola offline deja una marca visible en el
      watchdog (f123_sync_cola_desbordada) — nunca se pierde stock en silencio.
   3) MICELIO: la poda quita aparatos callados >24h pero conserva mi id y los
      frescos.
   Además: comprobaciones estáticas de que los topes nuevos están en el código,
   y sin errores de página. */
const path = require("path");
const fs = require("fs");
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
  // Comprobaciones estáticas: los topes nuevos están en el código.
  const srcMB = fs.readFileSync(path.join(__dirname, "..", "docs", "mock-backend.js"), "utf8");
  const srcSR = fs.readFileSync(path.join(__dirname, "..", "docs", "sync-realtime.js"), "utf8");
  check("estatico: dedup tope 2000 en mock-backend", /s\.size > 2000/.test(srcMB));
  check("estatico: cola tope 1000 en sync-realtime", /arr\.slice\(-1000\)/.test(srcSR));
  check("estatico: marca de desborde en sync-realtime", /f123_sync_cola_desbordada/.test(srcSR));

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.OCSync && window.OCSync.aplicarOpRemota && window.OCSyncWatchdog && window.OCMicelio, null, { timeout: 15000 });
    await page.evaluate(async () => {
      await fetch("/api/instancia/activar", { method: "POST", body: JSON.stringify({ instanceId: "inst-failsafe", vaciar: false }) });
    });

    // 1) DEDUP: misma op dos veces no dobla el stock.
    const dedup = await page.evaluate(async () => {
      await fetch("/api/productos", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "FailsafeProd", barcode: "FS-1", precio: 5, costo: 2, stockInicial: 10, ubicacionId: "u1", umbralRojo: 1, umbralAmarillo: 3 }) });
      const lista = await (await fetch("/api/productos?todas=1")).json();
      const p = lista.find((x) => x.sku === "FS-1");
      const op = { opId: "op-failsafe-dedup-1", tipo: "ajuste", payload: { productoId: p.id, delta: -3 } };
      const r1 = window.OCSync.aplicarOpRemota(op);
      const r2 = window.OCSync.aplicarOpRemota(op);
      const lista2 = await (await fetch("/api/productos?todas=1")).json();
      const p2 = lista2.find((x) => x.sku === "FS-1");
      return { r1, r2, stockFinal: p2.stockActual };
    });
    check("dedup: 1a aplicacion aplica (ok, no repetida)", dedup.r1 && dedup.r1.ok === true && !dedup.r1.repetida, dedup.r1);
    check("dedup: 2a aplicacion es repetida (no-op)", dedup.r2 && dedup.r2.repetida === true, dedup.r2);
    check("dedup: stock no se dobla (10-3=7)", dedup.stockFinal === 7, dedup.stockFinal);

    // 2) COLA: la marca de desborde es visible en el watchdog.
    const cola = await page.evaluate(() => {
      localStorage.setItem("f123_sync_cola_desbordada", "1234");
      return window.OCSyncWatchdog.estado().colaDesbordada;
    });
    check("cola: marca de desborde visible en watchdog", cola === 1234, cola);

    // 3) MICELIO: poda aparatos callados >24h, conserva mi id y los frescos.
    const micelio = await page.evaluate(() => {
      const yoId = "d-micelio-yo-test";
      localStorage.setItem("f123_micelio_yo", JSON.stringify({ id: yoId, apodo: "Yo" }));
      const ahora = Date.now();
      localStorage.setItem("f123_micelio_vistos", JSON.stringify({
        [yoId]: { apodo: "Yo", rol: "dueno", huella: "h", visto: ahora },
        "d-viejo": { apodo: "Viejo", rol: "empleado", huella: "h", visto: ahora - 25 * 60 * 60 * 1000 },
        "d-fresco": { apodo: "Fresco", rol: "empleado", huella: "h", visto: ahora - 60 * 1000 },
      }));
      const eq = window.OCMicelio.equipo();
      const ids = eq.map((x) => x.id);
      return { ids, tieneYo: ids.includes(yoId), tieneViejo: ids.includes("d-viejo"), tieneFresco: ids.includes("d-fresco") };
    });
    check("micelio: poda el aparato callado >24h", micelio.tieneViejo === false, micelio);
    check("micelio: conserva el aparato fresco", micelio.tieneFresco === true, micelio);
    check("micelio: conserva mi propio id", micelio.tieneYo === true, micelio);

    check("sin errores de pagina", errs.length === 0, errs);

    console.log(fallos.length ? "\nFALLOS: " + fallos.join(", ") : "\nTODO VERDE — fail-safes de integridad del sync funcionan.");
    process.exit(fallos.length ? 1 : 0);
  } finally {
    await browser.close();
  }
})();
