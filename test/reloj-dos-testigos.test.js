// Aviso de reloj con DOS testigos (JFC 2026-10-01): "me dice 2 min atras aunque esta en Auto".
// Extrae el codigo REAL de docs/avanzado-extra.js y lo corre con relojes simulados.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/../docs/avanzado-extra.js", "utf8");
const ini = src.indexOf("var _testigo"), fin = src.indexOf("var _pintarSyncMinBase");
assert.ok(ini > 0 && fin > ini, "no encontre el bloque del aviso de reloj");
const bloque = src.slice(ini, src.lastIndexOf("/* Aviso de datos", fin));

async function correr({ relayMs, servidorMs }) {
  const nodo = { style: { display: "none" }, textContent: "" };
  const canario = [];
  const ahora = Date.now();
  const g = {
    document: { getElementById: () => nodo },
    window: {
      OCLatencia: { desvioReloj: () => ({ hayAviso: Math.abs(relayMs) > 60000, desfaseMs: relayMs, minutos: Math.abs(relayMs) / 60000, adelantado: relayMs < 0 }) },
      OCCanarios: { fallo: (s, c) => canario.push(c) },
    },
    fetch: () => Promise.resolve({ headers: { get: () => new Date(ahora + servidorMs).toUTCString() } }),
  };
  const fn = new Function("document", "window", "fetch", bloque + "; return _pintarReloj;")(g.document, g.window, g.fetch);
  fn(); await new Promise((r) => setTimeout(r, 20)); fn();
  return { visible: nodo.style.display !== "none", texto: nodo.textContent, canario, nota: g.window._ocRelojNota };
}

test("los dos testigos dicen 2 min atras: SIN aviso visible (nivel 1-5 min), solo nota de diagnostico", async () => {
  const r = await correr({ relayMs: 120000, servidorMs: 120000 });
  assert.equal(r.visible, false);
  assert.match(r.nota, /behind ~2 min \(warning shows from 5\)/);
});
test("los dos testigos dicen 6 min atras: avisa, con texto honesto para Auto puesto", async () => {
  const r = await correr({ relayMs: 360000, servidorMs: 360000 });
  assert.equal(r.visible, true);
  assert.equal(r.nota, "");
  assert.match(r.texto, /6 minutes behind/);
  assert.match(r.texto, /Sync now/);
  assert.match(r.texto, /time\.is/);
  assert.doesNotMatch(r.texto, /turn on automatic time\)/);
});
test("relay dice 2 min, servidor dice hora correcta: NO acusa al aparato y avisa al canario", async () => {
  const r = await correr({ relayMs: 120000, servidorMs: 0 });
  assert.equal(r.visible, false);
  assert.deepEqual(r.canario, ["reloj-testigos-discrepan"]);
});
test("relay y servidor en lados opuestos: no acusa", async () => {
  const r = await correr({ relayMs: 120000, servidorMs: -120000 });
  assert.equal(r.visible, false);
});
test("relay sin desvio: no avisa ni consulta", async () => {
  const r = await correr({ relayMs: 2000, servidorMs: 0 });
  assert.equal(r.visible, false);
  assert.deepEqual(r.canario, []);
});
