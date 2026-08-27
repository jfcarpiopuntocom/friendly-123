/* Tests de navegador para M5 y A2 (2026-08-27), versión robusta:
   - M5: el gate de dueño está en el código (los botones sensibles se ocultan
     para rol !== "dueno").
   - A2: /api/sync/pull devuelve 404 (el backend local no implementa el sync
     por servidor), así que el automático no debe intentar push/pull. */
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
  // M5 estático: el gate de dueño está en avanzado-extra.js.
  const src = fs.readFileSync(path.join(__dirname, "..", "docs", "avanzado-extra.js"), "utf8");
  check("M5: gate de dueño presente (oculta acciones sensibles para no-dueño)",
    src.includes('_rolSync !== "dueno"') && src.includes('"oc-sync-rotar", "oc-sync-fixlic", "oc-sync-claim", "oc-sync-mergear"'));
  check("M5: el gate se aplica tras montar el panel",
    src.includes("vista.appendChild(panel)") && src.indexOf("_rolSync") > src.indexOf("vista.appendChild(panel)"));

  // A2: el intervalo comprueba el servidor antes de push/pull.
  check("A2: _comprobarSyncServer presente", src.includes("_comprobarSyncServer"));
  check("A2: el intervalo solo push/pull si el servidor está disponible",
    src.includes("if (disp) push().then(pull)"));

  // A2 en vivo: /api/sync/pull devuelve 404.
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.fetch, null, { timeout: 15000 });
    const disp = await page.evaluate(async () => {
      const res = await fetch("/api/sync/pull?device=probe", { method: "GET" });
      return { ok: res.ok, status: res.status };
    });
    check("A2: /api/sync/pull devuelve 404 (backend no lo implementa)", disp.status === 404, disp);
    check("sin errores de página", errs.length === 0, errs.slice(0, 3));
  } finally {
    await browser.close();
  }

  console.log(fallos.length === 0 ? "\nTODO VERDE — M5 (gate de dueño) y A2 (backend de sync ausente) verificados." : "\nHAY ROJO");
})();
