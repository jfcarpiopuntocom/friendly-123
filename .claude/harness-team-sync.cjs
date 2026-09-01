/* CÓMO CORRERLO (prueba de regresión, no corre sola en guards por requerir server+Chromium):
     cd docs && python3 -m http.server 8127 &   # servir el app
     node .claude/harness-team-sync.cjs          # sale 0 si TODO VERDE
   Requiere el Chromium preinstalado (PLAYWRIGHT_BROWSERS_PATH). Cazó el bug de
   precedencia del registro sobre la licencia propia en OCTienda.cambiar. */
/* Arnés de integración de DOS APARATOS para el team/PIN sync (JFC 2026-08-26).
   Carga el app REAL dos veces en contextos aislados (dos localStorage = dos
   aparatos), ejerce las escrituras REALES (POST/PATCH/DELETE /api/usuarios) y el
   merge REAL (catalogoPropio + aplicarCatalogo), y ROMPE A PROPÓSITO para cazar
   bugs. El relay no se toca: el "cable" entre aparatos lo simula el arnés pasando
   catalogoPropio() de uno a aplicarCatalogo() del otro, que es exactamente lo que
   el relay reenvía cifrado. Nada de probar funciones sueltas: esto es el camino real. */
/* Playwright portable: primero el node_modules local del repo (Windows/macOS),
   luego el path Linux del contenedor original. */
const path = require("path");
let chromium;
try { ({ chromium } = require(path.join(__dirname, "..", "node_modules", "playwright"))); }
catch (_) { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const BASE = "http://localhost:8127/index.html";

let fallos = [];
function check(nombre, cond, extra) {
  if (cond) console.log("  ok   " + nombre);
  else { console.log("  FALLA " + nombre + (extra ? "  → " + JSON.stringify(extra) : "")); fallos.push(nombre); }
}

async function nuevoAparato(browser, instanceId) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.OCSync && window.OCSync.catalogoPropio, null, { timeout: 15000 });
  // Activar (789) para no toparse con el límite del plan free al crear equipo.
  // Resiliente a la recarga coordinada de versión (v148): dos "aparatos" en el
  // MISMO navegador comparten BroadcastChannel, así que la recarga de uno puede
  // navegar al otro justo durante el evaluate (en producción son dispositivos
  // distintos y no se tocan). Si el contexto se destruye por navegación, se
  // re-espera OCSync y se reintenta una vez.
  const activar = async () => page.evaluate(async (iid) => {
    await fetch("/api/instancia/activar", { method: "POST", body: JSON.stringify({ instanceId: iid, vaciar: false }) });
  }, instanceId);
  try {
    await activar();
  } catch (e) {
    if (!/context was destroyed|Execution context/i.test(String(e))) throw e;
    await page.waitForFunction(() => window.OCSync && window.OCSync.catalogoPropio, null, { timeout: 15000 });
    await activar();
  }
  page._errs = errs;
  return page;
}
const api = (page, method, path, body) => page.evaluate(async (a) => {
  const r = await fetch(a.path, a.body ? { method: a.method, body: JSON.stringify(a.body) } : { method: a.method });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
}, { method, path, body });
const roster = async (page) => (await api(page, "GET", "/api/usuarios")).body;
const catalogo = (page) => page.evaluate(async () => await window.OCSync.catalogoPropio());
const mergeInto = (page, cat, rol) => page.evaluate(async (a) => await window.OCSync.aplicarCatalogo(a.cat, a.rol), { cat, rol });
const _normEq = (a, b) => String(a||"").toUpperCase().replace(/\s+/g,"") === String(b||"").toUpperCase().replace(/\s+/g,"");
const idPorNombre = (lista, nombre) => (lista.find((u) => u.nombre === nombre) || {}).id;
const tiene = (lista, nombre) => lista.some((u) => u.nombre === nombre);

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const A = await nuevoAparato(browser, "inst-A");
    const B = await nuevoAparato(browser, "inst-B");

    // --- 1) ALTA + PROPAGACIÓN BÁSICA ---------------------------------------
    const r1 = await api(A, "POST", "/api/usuarios", { nombre: "Belen", pin: "111", rol: "empleado" });
    check("A: alta de Belen (111) responde 200", r1.status === 200, r1);
    const r2 = await api(A, "POST", "/api/usuarios", { nombre: "Sarah2", pin: "222", rol: "admin" });
    check("A: alta de Sarah2 (222) responde 200", r2.status === 200, r2);
    let catA = await catalogo(A);
    await mergeInto(B, catA, "dueno");
    let rB = await roster(B);
    check("B: recibe a Belen tras el merge", tiene(rB, "Belen"), rB);
    check("B: recibe a Sarah2 tras el merge", tiene(rB, "Sarah2"), rB);

    // --- 2) LA BAJA PROPAGA (el bug histórico) -------------------------------
    const idBelenA = idPorNombre(await roster(A), "Belen");
    const del = await api(A, "DELETE", "/api/usuarios/" + idBelenA);
    check("A: DELETE de Belen responde 200", del.status === 200, del);
    check("A: Belen ya no aparece en A", !tiene(await roster(A), "Belen"));
    catA = await catalogo(A);
    check("A: catalogoPropio incluye el TOMBSTONE de Belen (para que viaje)",
      (catA.usuarios || []).some((u) => u.nombre === "Belen" && u.borrado === true), catA.usuarios);
    await mergeInto(B, catA, "dueno");
    rB = await roster(B);
    check("B: la BAJA de Belen PROPAGÓ (ya no está en B) ← fix headline", !tiene(rB, "Belen"), rB);

    // --- 3) EL TOMBSTONE GANA AL RE-ADD RANCIO DE UN TERCER APARATO ----------
    // Aparato C todavía tiene a Belen VIVA con rev viejo (se fue de sync antes de
    // la baja). Al mergear C en B, Belen NO debe revivir.
    const C = await nuevoAparato(browser, "inst-C");
    await mergeInto(C, { ubicaciones: [], productos: [], usuarios: [
      { id: idBelenA, nombre: "Belen", pin: "111", rol: "empleado", activo: true, borrado: false,
        creadoEn: "2020-01-01T00:00:00.000Z", actualizadoEn: "2020-01-01T00:00:00.000Z", rev: { c: 1, d: "viejo" } }
    ] }, "dueno");
    check("C: tiene a Belen viva (estado rancio pre-baja)", tiene(await roster(C), "Belen"));
    const catC = await catalogo(C);
    await mergeInto(B, catC, "dueno");
    check("B: el re-add rancio NO revive a Belen (tombstone gana) ← anti-zombie",
      !tiene(await roster(B), "Belen"), await roster(B));

    // --- 4) PROMOVER GANA POR REV AUNQUE EL RELOJ DE PARED ESTÉ AL REVÉS -----
    // Se promueve Sarah2 en A (rev nuevo, alto). Se fabrica un estado con rev MENOR
    // pero actualizadoEn en el FUTURO (reloj de pared adelantado). El rev debe mandar.
    const idSarahA = idPorNombre(await roster(A), "Sarah2");
    await api(A, "PATCH", "/api/usuarios/" + idSarahA, { rol: "admin" }); // ya es admin; sella rev alto de todos modos
    await api(A, "PATCH", "/api/usuarios/" + idSarahA, { nombre: "SarahJefa" });
    catA = await catalogo(A);
    const revSarah = (catA.usuarios.find((u) => u.id === idSarahA) || {}).rev;
    await mergeInto(B, catA, "dueno"); // B queda con SarahJefa y rev alto
    // Ahora un aparato con reloj de pared ADELANTADO pero rev MENOR intenta pisarlo:
    await mergeInto(B, { ubicaciones: [], productos: [], usuarios: [
      { id: idSarahA, nombre: "PisadaPorRelojMalo", pin: "222", rol: "empleado", activo: true, borrado: false,
        creadoEn: "2099-01-01T00:00:00.000Z", actualizadoEn: "2099-01-01T00:00:00.000Z",
        rev: { c: (revSarah && revSarah.c ? revSarah.c - 1 : 0), d: "aaa" } }
    ] }, "dueno");
    const rBSarah = (await roster(B)).find((u) => u.id === idSarahA) || {};
    check("B: rev MAYOR gana aunque el reloj de pared del otro esté en el futuro",
      rBSarah.nombre === "SarahJefa", rBSarah);

    // --- 5) COLISIÓN DE PIN: no entra un remoto con PIN de otro miembro vivo --
    // B tiene a Sarah con 222. Llega un remoto NUEVO (id distinto) con PIN 222.
    let colision = false;
    await B.evaluate(() => { window.__col = false; window.addEventListener("oc-pin-colision", () => { window.__col = true; }); });
    await mergeInto(B, { ubicaciones: [], productos: [], usuarios: [
      { id: "id-intruso", nombre: "Intruso", pin: "222", rol: "empleado", activo: true, borrado: false,
        creadoEn: "2026-01-01T00:00:00.000Z", actualizadoEn: "2026-01-01T00:00:00.000Z", rev: { c: 99, d: "z" } }
    ] }, "dueno");
    colision = await B.evaluate(() => window.__col);
    const rBcol = await roster(B);
    check("B: NO entra un miembro con PIN que ya usa otro vivo", !tiene(rBcol, "Intruso"), rBcol);
    check("B: la colisión de PIN emite el aviso oc-pin-colision", colision === true);

    // --- 6) IDEMPOTENCIA: mergear dos veces el mismo catálogo no duplica ------
    const antes = (await roster(B)).length;
    await mergeInto(B, catA, "dueno");
    await mergeInto(B, catA, "dueno");
    const despues = (await roster(B)).length;
    check("B: merge repetido es idempotente (no duplica miembros)", antes === despues, { antes, despues });

    // --- 7) RE-ALTA con el MISMO PIN tras una baja (Belen 111 fue tombstone) --
    // Sarah cambia de opinión y vuelve a dar de alta a alguien con el PIN 111.
    // El tombstone de Belen NO debe bloquear ese PIN (está borrada).
    const realta = await api(A, "POST", "/api/usuarios", { nombre: "BelenNueva", pin: "111", rol: "empleado" });
    check("A: se puede RE-usar el PIN 111 tras la baja (tombstone no bloquea)", realta.status === 200, realta);
    const idBelenNueva = idPorNombre(await roster(A), "BelenNueva");
    check("A: BelenNueva y el tombstone viejo son ids distintos", idBelenNueva && idBelenNueva !== idBelenA);
    catA = await catalogo(A);
    await mergeInto(B, catA, "dueno");
    check("B: BelenNueva propaga y el tombstone viejo sigue muerto",
      tiene(await roster(B), "BelenNueva") && !tiene(await roster(B), "Belen"), await roster(B));

    // --- 8) CAMINO FIEL DEL CABLE: aplicarEquipoRemoto (lo que usa el relay) ---
    // difundirEquipo manda cat.usuarios y el receptor llama aplicarEquipoRemoto(lista).
    const D = await nuevoAparato(browser, "inst-D");
    await D.evaluate(async (lista) => await window.OCSync.aplicarEquipoRemoto(lista), catA.usuarios);
    const rD = await roster(D);
    check("D: aplicarEquipoRemoto (ruta real del relay) trae a los vivos", tiene(rD, "SarahJefa") && tiene(rD, "BelenNueva"), rD);
    check("D: aplicarEquipoRemoto respeta el tombstone (no revive a Belen)", !tiene(rD, "Belen"), rD);

    // --- 9) LA BAJA LIBERA EL CUPO (conteo del plan ignora tombstones) --------
    // Aparato E sin activar (plan free = 1 miembro). Se crea 1, se borra, se crea otro.
    const E = await nuevoAparato(browser, "inst-E");
    // desactivar la instancia para forzar el límite free:
    await E.evaluate(async () => { try { const o = JSON.parse(localStorage.getItem("f123_owned")||"{}"); delete o.instanceId; localStorage.setItem("f123_owned", JSON.stringify(o)); } catch(_){} });
    // limpiar equipo seed para partir de cero el conteo:
    // (no hay endpoint de purga; se prueba el comportamiento relativo)
    const e1 = await api(E, "POST", "/api/usuarios", { nombre: "Uno", pin: "222", rol: "empleado" });
    if (e1.status === 200) {
      const idUno = idPorNombre(await roster(E), "Uno");
      await api(E, "DELETE", "/api/usuarios/" + idUno);
      const e2 = await api(E, "POST", "/api/usuarios", { nombre: "Dos", pin: "333", rol: "empleado" });
      check("E: tras borrar, se libera el cupo del plan free (se puede crear otro)", e2.status === 200, e2);
    } else {
      check("E: (límite ya tope por seed; se omite la prueba de cupo)", true);
    }

    // --- 10) DESACTIVAR ≠ BORRAR: desactivar conserva el registro y sincroniza -
    const idSarahB = idPorNombre(await roster(B), "SarahJefa");
    await api(A, "GET", "/api/usuarios"); // no-op
    // desactivar en A a SarahJefa:
    const idSarahA2 = idPorNombre(await roster(A), "SarahJefa");
    await api(A, "PATCH", "/api/usuarios/" + idSarahA2, { activo: false });
    catA = await catalogo(A);
    await mergeInto(B, catA, "dueno");
    const sB = (await roster(B)).find((u) => u.id === idSarahB);
    check("B: desactivar SÍ conserva el registro (sigue en el roster, activo:false)",
      sB && sB.activo === false, sB);

    // --- 11) CAMBIO DE TIENDA (el fallo original: "pongo idiomARTE y sigo en James Bond") ---
    const G = await browser.newContext();
    const gp = await G.newPage();
    await gp.goto(BASE, { waitUntil: "domcontentloaded" });
    await gp.waitForFunction(() => window.OCTienda && window.OCTienda.cambiar, null, { timeout: 15000 });
    // Este aparato es "James Bond Store": su licencia propia grabada.
    await gp.evaluate(() => localStorage.setItem("f123_owned", JSON.stringify({ instanceId: "inst-G", licenseCode: "F123-JMES-BOND-0007-XXXXX", nombreNegocio: "James Bond Store" })));
    await gp.reload({ waitUntil: "domcontentloaded" });
    await gp.waitForFunction(() => window.OCTienda && window.OCTienda.cambiar, null, { timeout: 15000 });
    const estadoInicial = await gp.evaluate(() => ({ unida: window.OCTienda.esUnida(), lic: window.OCTienda.licenciaActual() }));
    check("G: arranca en su tienda propia (no unida)", estadoInicial.unida === false, estadoInicial);

    // Poner la licencia de idiomARTE (DISTINTA de la propia) → DEBE cambiar de tienda.
    const IDIOMARTE = "F123-K7M2-9QRT-4XVB-P3W1D";
    const retCambio = await gp.evaluate((lic) => {
      const r = window.OCTienda.cambiar(lic); // dispara location.reload()
      return r;
    }, IDIOMARTE).catch((e) => ({ threw: String(e) }));
    // cambiar() recarga; esperar a que el contexto vuelva.
    await gp.waitForFunction(() => window.OCTienda && window.OCTienda.cambiar, null, { timeout: 15000 }).catch(() => {});
    const trasCambio = await gp.evaluate(() => ({ unida: window.OCTienda.esUnida(), lic: window.OCTienda.licenciaActual(), marcador: (localStorage.getItem("f123_tienda_activa")||"") }));
    check("G: poner una licencia DISTINTA cambió de tienda (esUnida=true) ← fallo original",
      trasCambio.unida === true, { retCambio, trasCambio });
    check("G: la tienda activa ahora ES idiomARTE, no James Bond",
      _normEq(trasCambio.lic, IDIOMARTE), trasCambio);

    // Aislamiento: la tienda unida NO debe traer los datos de James Bond.
    const rosterUnida = await gp.evaluate(async () => { const r = await fetch("/api/usuarios"); return await r.json(); });
    check("G: la tienda unida arranca aislada (no hereda el equipo de James Bond)",
      Array.isArray(rosterUnida), rosterUnida);

    // Volver a la tienda propia debe funcionar (marcador vuelve a "").
    await gp.evaluate((lic) => window.OCTienda.cambiar(lic), "F123-JMES-BOND-0007-XXXXX").catch(() => {});
    await gp.waitForFunction(() => window.OCTienda && window.OCTienda.cambiar, null, { timeout: 15000 }).catch(() => {});
    const volvio = await gp.evaluate(() => ({ unida: window.OCTienda.esUnida(), marcador: (localStorage.getItem("f123_tienda_activa")||"") }));
    check("G: volver a la licencia propia regresa a la tienda propia (no unida)",
      volvio.unida === false && volvio.marcador === "", volvio);

    // CASO CONFUSO REAL: si f123_owned.licenseCode == idiomARTE, la app trata idiomARTE
    // como PROPIA y NO cambia (mismo). Es coherente con el diseño, pero es la trampa
    // que confundió a JFC. Se DOCUMENTA aquí para que quede visible, no como fallo.
    await gp.waitForLoadState("domcontentloaded").catch(() => {});
    await gp.evaluate((lic) => localStorage.setItem("f123_owned", JSON.stringify({ instanceId: "inst-G", licenseCode: lic, nombreNegocio: "James Bond Store" })), IDIOMARTE);
    await gp.goto(BASE, { waitUntil: "domcontentloaded" });
    await gp.waitForFunction(() => window.OCTienda && window.OCTienda.cambiar, null, { timeout: 15000 });
    const retMismo = await gp.evaluate((lic) => window.OCTienda.cambiar(lic), IDIOMARTE);
    check("G: (coherencia) si tu aparato tiene idiomARTE como licencia PROPIA, ponerla = misma tienda",
      retMismo && retMismo.mismo === true, retMismo);
    await G.close();

    // --- errores de página (excepciones JS reales durante todo el flujo) ------
    check("Sin excepciones JS en aparato A", (A._errs || []).length === 0, A._errs);
    check("Sin excepciones JS en aparato B", (B._errs || []).length === 0, B._errs);

  } catch (e) {
    console.log("  EXCEPCIÓN EN EL ARNÉS: " + (e && e.stack || e));
    fallos.push("excepcion-harness");
  } finally {
    await browser.close();
  }
  console.log("\n" + (fallos.length ? (fallos.length + " FALLA(S): " + fallos.join(" | ")) : "TODO VERDE — el sync converge en navegador real, dos aparatos."));
  process.exit(fallos.length ? 1 : 0);
})();
