/* Smoke test: claim/merge (OCTienda.reconciliar) must re-point identity WITHOUT
   wiping local data. Loads the real app, activates, adds a product, reconciles
   to a new license, and asserts the product survives and identity changed. */
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
    await page.waitForFunction(() => window.OCTienda && window.OCTienda.reconciliar, null, { timeout: 15000 });

    // Activate as own device (789) so we're not on the free-plan demo limits.
    await page.evaluate(async () => {
      await fetch("/api/instancia/activar", { method: "POST", body: JSON.stringify({ instanceId: "inst-smoke", vaciar: false }) });
    });

    // Add a product so there is real data to protect.
    const add = await page.evaluate(async () => {
      const r = await fetch("/api/productos", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "SmokeTestProduct", barcode: "SMK-1", precio: 5, costo: 2, stock: 10, ubicacionId: "u1", umbralRojo: 2, umbralAmarillo: 5 }) });
      return { status: r.status, body: await r.json() };
    });
    check("producto creado (200)", add.status === 200, add);

    // Read identity before reconcile.
    const antes = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("f123_owned") || "null"); } catch (_) { return null; }
    });

    // Reconcile to a new canonical license.
    const r = await page.evaluate(() => window.OCTienda.reconciliar("F123-AAAA-BBBB-CCCC-DDDDD"));
    check("reconciliar responde ok", r && r.ok === true, r);

    // Identity changed to the new license.
    const despues = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("f123_owned") || "null"); } catch (_) { return null; }
    });
    check("licenseCode re-apuntado", despues && despues.licenseCode === "F123-AAAA-BBBB-CCCC-DDDDD", despues);
    check("syncCode re-apuntado", despues && despues.syncCode === "F123-AAAA-BBBB-CCCC-DDDDD", despues);

    // Data NOT wiped: the product still exists.
    const prods = await page.evaluate(async () => {
      const r = await fetch("/api/productos?todas=1"); return await r.json();
    });
    check("producto sobrevive (datos NO borrados)", Array.isArray(prods) && prods.some((p) => p.nombre === "SmokeTestProduct"), prods.length);

    // No page errors.
    check("sin errores de pagina", errs.length === 0, errs);

    console.log(fallos.length ? "\nFALLOS: " + fallos.join(", ") : "\nTODO VERDE — claim/merge no borra datos.");
    process.exit(fallos.length ? 1 : 0);
  } finally {
    await browser.close();
  }
})();
