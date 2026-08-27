/* Test enfocado del fix A5 (2026-08-27): reconciliar() (claim/merge) debe
   alinear el NAMESPACE de tienda (f123_tienda_activa) con la licencia canónica.
   Antes solo fijaba licenseCode/syncCode y la sala; f123_tienda_activa quedaba
   apuntando al namespace viejo → el aparato quedaba "partido" y el merge
   posterior aterrizaba en el namespace equivocado.

   Escenario real del bug: el aparato está en una tienda unida vieja
   ("::F123-OLD-...") y hace claim a la canónica. Después del claim debe quedar
   en el namespace de la canónica ("" porque licenseCode = canónica), y sus
   datos locales deben sobrevivir (el merge add-only ocurre en memoria). */
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

    // Activate as own device so we're not on the free-plan demo limits.
    await page.evaluate(async () => {
      await fetch("/api/instancia/activar", { method: "POST", body: JSON.stringify({ instanceId: "inst-ns", vaciar: false }) });
    });

    // Simulate being in an OLD joined store namespace (the bug scenario).
    await page.evaluate(() => {
      localStorage.setItem("f123_tienda_activa", "::F123-OLD-OLD-OLD-OLDOLD");
    });
    // Reload so OC_STATE_SUFIJO reflects the old namespace.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.OCTienda && window.OCTienda.reconciliar, null, { timeout: 15000 });

    const nsAntes = await page.evaluate(() => localStorage.getItem("f123_tienda_activa"));
    check("aparato empieza en el namespace viejo", nsAntes === "::F123-OLD-OLD-OLD-OLDOLD", nsAntes);

    // Add a product in the old namespace (data to protect).
    const add = await page.evaluate(async () => {
      const r = await fetch("/api/productos", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "NSProduct", barcode: "NS-1", precio: 5, costo: 2, stock: 10, ubicacionId: "u1", umbralRojo: 2, umbralAmarillo: 5 }) });
      return { status: r.status };
    });
    check("producto creado en namespace viejo (200)", add.status === 200, add);

    // Claim to the canonical license.
    const r = await page.evaluate(() => window.OCTienda.reconciliar("F123-AAAA-BBBB-CCCC-DDDDD"));
    check("reconciliar responde ok", r && r.ok === true, r);

    // After claim: identity AND namespace aligned to the canonical.
    const despues = await page.evaluate(() => ({
      tienda: localStorage.getItem("f123_tienda_activa"),
      owned: (() => { try { return JSON.parse(localStorage.getItem("f123_owned") || "null"); } catch (_) { return null; } })()
    }));
    check("licenseCode re-apuntado a la canónica", despues.owned && despues.owned.licenseCode === "F123-AAAA-BBBB-CCCC-DDDDD", despues.owned);
    check("syncCode re-apuntado a la canónica", despues.owned && despues.owned.syncCode === "F123-AAAA-BBBB-CCCC-DDDDD", despues.owned);
    /* A5: el namespace debe alinearse con la canónica. Como licenseCode = canónica,
       la tienda propia (sufijo "") ES la canónica. Antes del fix, f123_tienda_activa
       seguía en "::F123-OLD-..." (aparato partido). */
    check("f123_tienda_activa alineado a la canónica (sufijo '')", despues.tienda === "", despues.tienda);

    // Data NOT wiped: the product still exists in memory (merge add-only).
    const prods = await page.evaluate(async () => {
      const r = await fetch("/api/productos?todas=1"); return await r.json();
    });
    check("producto sobrevive (datos NO borrados)", Array.isArray(prods) && prods.some((p) => p.nombre === "NSProduct"), Array.isArray(prods) ? prods.length : prods);

    check("sin errores de página", errs.length === 0, errs.slice(0, 3));

    console.log(fallos.length === 0 ? "\nTODO VERDE — reconciliar alinea el namespace de tienda con la canónica." : "\nHAY ROJO");
  } finally {
    await browser.close();
  }
})();
