/* CÓMO CORRERLO:
     cd docs && python3 -m http.server 8127 &
     node .claude/harness-join-identity.cjs   # sale 0 si TODO VERDE
   Prueba la IDENTIDAD al unirse (JFC 2026-08-26), en navegador real:
     - usuario NORMAL que pone una licencia SE VUELVE device de ese negocio
       (adopta licenseCode) → el panel lo cuenta, no forja una licencia aparte;
     - el LORD (super-admin) NUNCA adopta la licencia ajena al unirse (SYNCIDENTITYFIX
       2026-08-31, P0: supera la decisión del 2026-08-28). Conserva su identidad
       canónica; si no tiene canónica guardada, queda como está (no adopta nada).
       Solo REGISTRA el acceso (auditoría) y queda como observador (toco=false).
       Así la PC del Lord nunca reporta la licencia del cliente al Worker. El
       guardrail de "no contar el aparato de JFC como device del cliente" lo cubre
       el panel (esMio). */
/* Playwright portable: primero el node_modules local del repo (Windows/macOS),
   luego el path Linux del contenedor original. */
const path = require("path");
let chromium;
try { ({ chromium } = require(path.join(__dirname, "..", "node_modules", "playwright"))); }
catch (_) { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const BASE = "http://localhost:8127/index.html";
const OWN = "F123-JMES-BOND-0007-XXXXX";
const IDIOMARTE = "F123-K7M2-9QRT-4XVB-P3W1D";
let fallos = [];
const check = (n, c, e) => { if (c) console.log("  ok   " + n); else { console.log("  FALLA " + n + (e ? "  → " + JSON.stringify(e) : "")); fallos.push(n); } };

async function device(browser, { lord }) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Sembrar identidad ANTES de cargar la app.
  await page.addInitScript((a) => {
    try {
      localStorage.setItem("f123_owned", JSON.stringify({ instanceId: "inst-" + (a.lord ? "lord" : "normal"), licenseCode: a.own, nombreNegocio: "James Bond Store" }));
      if (a.lord) localStorage.setItem("f123_lord", "1");
    } catch (_) {}
  }, { lord, own: OWN });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.OCSyncControl && window.OCSyncControl.unirse, null, { timeout: 15000 });
  return page;
}
const owned = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("f123_owned") || "{}"); } catch (_) { return {}; } });
const accesos = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("f123_accesos") || "[]"); } catch (_) { return []; } });

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    // --- USUARIO NORMAL: adopta la licencia (cuenta como device) --------------
    const N = await device(browser, { lord: false });
    await N.evaluate((lic) => { try { window.OCSyncControl.unirse(lic); } catch (_) {} }, IDIOMARTE).catch(() => {});
    await N.waitForFunction(() => window.OCSyncControl, null, { timeout: 15000 }).catch(() => {});
    const oN = await owned(N);
    check("NORMAL: al unirse ADOPTA la licencia de idiomARTE (cuenta como device, no forja licencia aparte)",
      String(oN.licenseCode || "").replace(/\s+/g, "").toUpperCase() === IDIOMARTE, oN);
    const aN = await accesos(N);
    check("NORMAL: no deja registro de acceso de lord (no es super-admin)", aN.length === 0, aN);

    // --- LORD: NO adopta la licencia ajena; conserva su identidad, registra acceso ---
    const L = await device(browser, { lord: true });
    await L.evaluate((lic) => { try { window.OCSyncControl.unirse(lic); } catch (_) {} }, IDIOMARTE).catch(() => {});
    await L.waitForFunction(() => window.OCSyncControl, null, { timeout: 15000 }).catch(() => {});
    const oL = await owned(L);
    check("LORD: al unirse NO adopta la licencia ajena; conserva su identidad canónica (SYNCIDENTITYFIX 2026-08-31)",
      String(oL.licenseCode || "").replace(/\s+/g, "").toUpperCase() === OWN.replace(/\s+/g, "").toUpperCase(), oL);
    const aL = await accesos(L);
    check("LORD: registra el acceso a la tienda del cliente (auditoría)",
      aL.length >= 1 && String(aL[aL.length - 1].licencia || "").replace(/\s+/g, "").toUpperCase() === IDIOMARTE, aL);
    check("LORD: el acceso queda como observador (toco=false por defecto)",
      aL.length >= 1 && aL[aL.length - 1].toco === false, aL);
  } catch (e) {
    console.log("  EXCEPCIÓN: " + (e && e.stack || e)); fallos.push("excepcion");
  } finally { await browser.close(); }
  console.log("\n" + (fallos.length ? (fallos.length + " FALLA(S): " + fallos.join(" | ")) : "TODO VERDE — identidad al unirse correcta (normal adopta y cuenta; lord observa y registra)."));
  process.exit(fallos.length ? 1 : 0);
})();
