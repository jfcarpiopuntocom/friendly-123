/* Test de navegador para el bloque 1c (2026-08-27): gastos.
   - El botón "gastos" existe en el nav.
   - POST /api/gastos registra un gasto.
   - GET /api/gastos lo devuelve con el total.
   - La vista gastos renderiza el resumen y la lista. */
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

    // Activate as owner.
    await page.evaluate(async () => {
      await fetch("/api/instancia/activar", { method: "POST", body: JSON.stringify({ instanceId: "inst-gastos", vaciar: false }) });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.OCAuth && window.OCAuth.rolActual, null, { timeout: 15000 });

    // Nav has the gastos button.
    const tieneBtn = await page.evaluate(() => !!document.querySelector('nav button[data-vista="gastos"]'));
    check("nav tiene botón 'gastos'", tieneBtn);

    // POST a gasto.
    const creado = await page.evaluate(async () => {
      const r = await fetch("/api/gastos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ concepto: "Renta", monto: 150.5 }) });
      return { status: r.status, body: await r.json() };
    });
    check("POST gasto (200)", creado.status === 200, creado);
    check("gasto tiene concepto y monto", creado.body && creado.body.concepto === "Renta" && creado.body.monto === 150.5, creado.body);

    // GET gastos.
    const lista = await page.evaluate(async () => {
      const r = await fetch("/api/gastos", { method: "GET" });
      return { status: r.status, body: await r.json() };
    });
    check("GET gastos (200)", lista.status === 200, lista);
    check("gasto en la lista", Array.isArray(lista.body.gastos) && lista.body.gastos.some((g) => g.concepto === "Renta"), lista.body);
    check("total calculado", lista.body.total === 150.5, lista.body);

    // Navigate to gastos and check the view renders.
    await page.evaluate(() => {
      const btn = document.querySelector('nav button[data-vista="gastos"]');
      if (btn) btn.click();
    });
    await page.waitForFunction(() => document.getElementById("listaGastos"), null, { timeout: 10000 });
    const render = await page.evaluate(async () => {
      if (typeof cargarGastos === "function") await cargarGastos();
      const cont = document.getElementById("listaGastos");
      const resumen = document.getElementById("gastosResumen");
      return { lista: cont ? cont.textContent : "", resumen: resumen ? resumen.textContent : "" };
    });
    check("vista gastos muestra el gasto", render.lista.includes("Renta"), render);
    check("vista gastos muestra el resumen", render.resumen.includes("Expenses"), render);

    check("sin errores de página", errs.length === 0, errs.slice(0, 3));

    console.log(fallos.length === 0 ? "\nTODO VERDE — bloque 1c: sección gastos (registrar + resumen gastos/ingresos)." : "\nHAY ROJO");
  } finally {
    await browser.close();
  }
})();
