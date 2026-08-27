/* Test enfocado del fix A4 (2026-08-27): el botón "Join this notebook" de la
   vista Advanced debe usar OCSyncControl.unirse() (flujo de equipo completo:
   adopta licencia, marca instanceId, cambia de tienda), NO activar() (que solo
   guarda la sala y conecta → aparato "partido"). Interceptamos unirse() y
   activar() para confirmar cuál se dispara al pulsar el botón. */
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
    await page.waitForFunction(() => window.OCSyncControl && window.OCSyncControl.unirse, null, { timeout: 15000 });

    // Intercept both methods to see which one the button calls.
    await page.evaluate(() => {
      window.__llamadas = { unirse: 0, activar: 0 };
      const origUnirse = window.OCSyncControl.unirse;
      const origActivar = window.OCSyncControl.activar;
      window.OCSyncControl.unirse = function (cod) { window.__llamadas.unirse++; return { ok: true, mismo: true, error: "re-sync" }; };
      window.OCSyncControl.activar = function (cod) { window.__llamadas.activar++; return { ok: true }; };
    });

    // Navigate to the Advanced view.
    await page.evaluate(() => {
      const btn = document.querySelector('nav button[data-vista="avanzado"]');
      if (btn) btn.click();
    });
    await page.waitForFunction(() => document.getElementById("oc-sync-unirme"), null, { timeout: 10000 });

    // Fill the join code and click the button.
    await page.evaluate(() => {
      document.getElementById("oc-sync-codigo2").value = "F123-AAAA-BBBB-CCCC-DDDDD";
      document.getElementById("oc-sync-unirme").click();
    });

    const llamadas = await page.evaluate(() => window.__llamadas);
    check("el botón llama a unirse() (no activar())", llamadas.unirse === 1, llamadas);
    check("el botón NO llama a activar()", llamadas.activar === 0, llamadas);
    check("sin errores de página", errs.length === 0, errs.slice(0, 3));

    console.log(fallos.length === 0 ? "\nTODO VERDE — el botón Join usa unirse(), el flujo de equipo completo." : "\nHAY ROJO");
  } finally {
    await browser.close();
  }
})();
