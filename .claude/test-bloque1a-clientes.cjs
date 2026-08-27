/* Test de navegador para el bloque 1a (2026-08-27): clientes.
   Verifica el endpoint de contacto (PATCH /api/clientes/:id/contacto) y que
   la tarjeta del cliente incluya el chip "han comprado" y el botón de editar.
   Usa el respaldo directo (sin depender de ListaDinamica) para el render. */
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
      await fetch("/api/instancia/activar", { method: "POST", body: JSON.stringify({ instanceId: "inst-cli2", vaciar: false }) });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.OCAuth && window.OCAuth.rolActual, null, { timeout: 15000 });

    // Create a customer.
    const creado = await page.evaluate(async () => {
      const r = await fetch("/api/clientes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre: "ClienteTest2", telefono: "555-9999", email: "t2@t.com" }) });
      return { status: r.status, body: await r.json() };
    });
    check("cliente creado (200)", creado.status === 200, creado);
    const cid = creado.body && creado.body.id;

    // PATCH contacto: guardar notas.
    const guardado = await page.evaluate(async (id) => {
      const r = await fetch(`/api/clientes/${id}/contacto`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notas: "Cliente VIP", telefono: "555-8888" }) });
      return { status: r.status, body: await r.json() };
    }, cid);
    check("PATCH contacto guarda notas (200)", guardado.status === 200, guardado);
    check("notas persistidas", guardado.body && guardado.body.notas === "Cliente VIP", guardado.body);
    check("telefono persistido", guardado.body && guardado.body.telefono === "555-8888", guardado.body);

    // GET the customer to confirm persistence (via the matriz which returns all).
    const leido = await page.evaluate(async (id) => {
      const r = await fetch("/api/clientes/matriz", { method: "GET" });
      const grupos = await r.json();
      const todos = [].concat(grupos.verano || [], grupos.primavera || [], grupos.otono || [], grupos.invierno || []);
      const c = todos.find((x) => x.id === id);
      return c ? { notas: c.notas, telefono: c.telefono } : null;
    }, cid);
    check("matriz devuelve notas persistidas", leido && leido.notas === "Cliente VIP", leido);
    check("matriz devuelve telefono persistido", leido && leido.telefono === "555-8888", leido);

    // Verify the card template includes the chip and edit button (static check).
    const cardHtml = await page.evaluate(() => {
      // Render a card directly via the global function if available.
      const c = { id: "x", nombre: "Test", codigo: "C-1", frecuencia: 0, monto: 0, recencia: null, evaluacion: { trato: 0, confiabilidad: 0, historial: [] } };
      if (typeof tarjetaCliente === "function") return tarjetaCliente(c, true);
      return "";
    });
    check("tarjeta incluye chip 'No purchases yet'", cardHtml.includes("No purchases yet"));
    check("tarjeta incluye botón 'Edit contact / notes'", cardHtml.includes("Edit contact / notes"));
    check("tarjeta incluye panel de edición", cardHtml.includes("oc-edit-notas-"));

    check("sin errores de página", errs.length === 0, errs.slice(0, 3));

    console.log(fallos.length === 0 ? "\nTODO VERDE — bloque 1a: endpoint de contacto + chip 'han comprado' + editar notas." : "\nHAY ROJO");
  } finally {
    await browser.close();
  }
})();
