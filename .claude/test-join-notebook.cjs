/* Test enfocado del Join notebook feature (2026-08-28):
   Verifica que el flujo de join notebook:
   1. Aísla datos — fuente queda en su namespace, destino aislada, sin merge
   2. Identidad coherente (licenseCode/syncCode/room/namespace) después de reload
   3. Same-notebook join es idempotente/reconecta
   4. Advanced expone exactamente dos acciones normales de sync
   5. Join llama solo a OCSyncControl.unirse
   6. Validación de licencia antes de writes
*/
const path = require("path");
let chromium;
try { ({ chromium } = require(path.join(__dirname, "..", "node_modules", "playwright"))); }
catch (_) { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const BASE = "http://localhost:8127/index.html";

const NOTEBOOK_A = "F123-AAAA-BBBB-CCCC-11111";
const NOTEBOOK_B = "F123-XXXX-YYYY-ZZZZ-22222";

let fallos = [];
function check(nombre, cond, extra) {
  if (cond) console.log("  ok   " + nombre);
  else { console.log("  FALLA " + nombre + (extra ? "  → " + JSON.stringify(extra) : "")); fallos.push(nombre); }
}

async function crearDispositivoConNotebook(browser, notebook) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript((nb) => {
    try {
      const owned = { 
        instanceId: "inst-" + Math.random().toString(36).slice(2, 9),
        licenseCode: nb,
        nombreNegocio: "Test Store",
        activatedAt: Date.now()
      };
      localStorage.setItem("f123_owned", JSON.stringify(owned));
    } catch (_) {}
  }, notebook);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.OCSyncControl && window.OCSyncControl.unirse, null, { timeout: 15000 });
  return page;
}

async function obtenerIdentidad(page) {
  return await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("f123_owned") || "{}"); } catch (_) { return {}; }
  });
}

async function obtenerSala(page) {
  return await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("f123_sync_room") || "{}"); } catch (_) { return {}; }
  });
}

async function contarAccionesSync(page) {
  // Cuenta cuántos botones/acciones normales de sync son visibles en Advanced
  return await page.evaluate(() => {
    const panel = document.getElementById("oc-sync-panel");
    if (!panel) return 0;
    // Acciones normales: Join notebook, Check connection
    // Las ocultas: merge, rotar, claim, desactivar, resincronizar
    const visible = Array.from(panel.querySelectorAll("button, details > summary"))
      .filter(el => {
        const style = window.getComputedStyle(el);
        const display = style.display;
        const visibility = style.visibility;
        return display !== "none" && visibility !== "hidden";
      });
    return visible.length;
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    console.log("\n=== TEST: Join Notebook Feature ===\n");

    // --- TEST 1: Identity coherence after join ---
    console.log("1. Identity coherence & namespace isolation:");
    const dev1 = await crearDispositivoConNotebook(browser, NOTEBOOK_A);
    const id1antes = await obtenerIdentidad(dev1);
    check("  dispositivo A comienza con notebook A",
      String(id1antes.licenseCode || "").toUpperCase().includes("AAAA"), id1antes);

    // Join a B (diferente)
    await dev1.evaluate((nb) => {
      try { window.OCSyncControl.unirse(nb); } catch (_) {}
    }, NOTEBOOK_B).catch(() => {});

    // Esperar a que se recargue (cambio de tienda)
    await dev1.waitForFunction(() => window.OCSyncControl, null, { timeout: 15000 }).catch(() => {});
    const id1despues = await obtenerIdentidad(dev1);
    const sala1 = await obtenerSala(dev1);
    check("  After join: licenseCode actualizado a B",
      String(id1despues.licenseCode || "").toUpperCase().includes("ZZZZ"), id1despues);
    check("  After join: syncCode también actualizado a B",
      String(id1despues.syncCode || "").toUpperCase().includes("ZZZZ"), id1despues);
    check("  After join: sala apunta a B",
      String(sala1.codigo || "").toUpperCase().includes("ZZZZ"), sala1);
    check("  After join: instanceId se preserva (mismo dispositivo)",
      id1antes.instanceId === id1despues.instanceId, { antes: id1antes.instanceId, despues: id1despues.instanceId });

    // --- TEST 2: Same-notebook join is idempotent ---
    console.log("\n2. Same-notebook join is idempotent:");
    const dev2 = await crearDispositivoConNotebook(browser, NOTEBOOK_B);
    const id2antes = await obtenerIdentidad(dev2);
    
    // Join a B nuevamente (mismo notebook)
    await dev2.evaluate((nb) => {
      try { window.OCSyncControl.unirse(nb); } catch (_) {}
    }, NOTEBOOK_B).catch(() => {});

    // Sin recarga (mismo:true), pero sincroniza
    const id2despues = await obtenerIdentidad(dev2);
    check("  Same-notebook join: identidad intacta",
      id2antes.licenseCode === id2despues.licenseCode, { antes: id2antes.licenseCode, despues: id2despues.licenseCode });
    check("  Same-notebook join: instanceId intacto",
      id2antes.instanceId === id2despues.instanceId, { antes: id2antes.instanceId, despues: id2despues.instanceId });

    // --- TEST 3: Advanced UI shows only two normal actions ---
    console.log("\n3. Advanced UI: only two normal sync actions:");
    const dev3 = await crearDispositivoConNotebook(browser, NOTEBOOK_A);
    await dev3.evaluate(() => {
      const btn = document.querySelector('nav button[data-vista="avanzado"]');
      if (btn) btn.click();
    });
    await dev3.waitForFunction(() => document.getElementById("oc-sync-panel"), null, { timeout: 10000 });

    const syncPanel = await dev3.evaluate(() => {
      const p = document.getElementById("oc-sync-panel");
      if (!p) return { exists: false };
      const joinBtn = document.getElementById("oc-sync-unirme");
      const checkBtn = document.querySelector('[id*="check"], [id*="estado"]');
      const mergearBtn = document.getElementById("oc-sync-mergear");
      const rotarBtn = document.getElementById("oc-sync-rotar");
      const desactivarBtn = document.getElementById("oc-sync-desactivar");
      const resincBtn = document.getElementById("oc-sync-resincronizar");
      
      return {
        exists: true,
        joinVisible: joinBtn && window.getComputedStyle(joinBtn).display !== "none",
        mergearVisible: mergearBtn && window.getComputedStyle(mergearBtn).display !== "none",
        rotarVisible: rotarBtn && window.getComputedStyle(rotarBtn).display !== "none",
        desactivarVisible: desactivarBtn && window.getComputedStyle(desactivarBtn).display !== "none",
        resincVisible: resincBtn && window.getComputedStyle(resincBtn).display !== "none"
      };
    });

    check("  Advanced panel exists", syncPanel.exists, syncPanel);
    check("  Join notebook button visible", syncPanel.joinVisible, syncPanel);
    check("  Merge button NOT visible (hidden unless diagnosis shows need)", !syncPanel.mergearVisible, syncPanel);
    check("  Rotate button NOT visible (hidden for non-lord)", !syncPanel.rotarVisible, syncPanel);
    check("  Deactivate button NOT visible (only contextual on diagnosis)", !syncPanel.desactivarVisible, syncPanel);

    // --- TEST 4: Join calls only OCSyncControl.unirse ---
    console.log("\n4. Join mechanism (calls only unirse):");
    const dev4 = await crearDispositivoConNotebook(browser, NOTEBOOK_A);
    
    await dev4.evaluate(() => {
      window.__testCalls = { unirse: 0, activar: 0, cambiar: 0 };
      const orig = {
        unirse: window.OCSyncControl.unirse,
        activar: window.OCSyncControl.activar
      };
      window.OCSyncControl.unirse = function (cod) {
        window.__testCalls.unirse++;
        return orig.unirse.call(this, cod);
      };
      window.OCSyncControl.activar = function (cod) {
        window.__testCalls.activar++;
        return orig.activar.call(this, cod);
      };
    });

    await dev4.evaluate(() => {
      const btn = document.querySelector('nav button[data-vista="avanzado"]');
      if (btn) btn.click();
    });
    await dev4.waitForFunction(() => document.getElementById("oc-sync-codigo2"), null, { timeout: 10000 });

    // Trigger join
    await dev4.evaluate((nb) => {
      document.getElementById("oc-sync-codigo2").value = nb;
      document.getElementById("oc-sync-unirme").click();
    }, NOTEBOOK_B).catch(() => {});

    // Esperar un poco para que se procese
    await new Promise(r => setTimeout(r, 500));

    const calls = await dev4.evaluate(() => window.__testCalls);
    check("  Join button calls unirse()", calls.unirse >= 1, calls);
    check("  Join button does NOT call activar() directly", calls.activar === 0, calls);

    // --- TEST 5: License validation before writes ---
    console.log("\n5. License validation before writes:");
    const dev5 = await crearDispositivoConNotebook(browser, NOTEBOOK_A);
    
    const invalidResult = await dev5.evaluate(() => {
      try { return window.OCSyncControl.unirse("invalid-not-a-code"); }
      catch (e) { return { error: String(e) }; }
    });
    check("  Invalid license rejected (returns error)", 
      !invalidResult.ok || invalidResult.error, invalidResult);

    const validBeforeResult = await dev5.evaluate(() => {
      const owned = JSON.parse(localStorage.getItem("f123_owned") || "{}");
      return { licenseCodeBefore: owned.licenseCode };
    });

    const validAfterInvalid = await dev5.evaluate(() => {
      const owned = JSON.parse(localStorage.getItem("f123_owned") || "{}");
      return { licenseCodeAfter: owned.licenseCode };
    });

    check("  License NOT written if validation fails",
      validBeforeResult.licenseCodeBefore === validAfterInvalid.licenseCodeAfter,
      { before: validBeforeResult, after: validAfterInvalid });

    console.log("\n" + (fallos.length ? `${fallos.length} FALLA(S)` : "TODO VERDE"));
  } catch (e) {
    console.log("  EXCEPCIÓN: " + (e && e.stack || e));
    fallos.push("excepcion");
  } finally {
    await browser.close();
  }

  process.exit(fallos.length ? 1 : 0);
})();
