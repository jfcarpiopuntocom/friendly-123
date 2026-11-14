// v780 (JFC 13 nov 2026: «no sale lo real o la venta que acabo de hacer» en Summary by product).
// Sync bursts used to call cargarComisiones() again and again; each call made the read in flight stale, so nothing
// was painted while changes kept arriving. refrescarComisionesAuto must run ONE read at a time, let every finished
// read paint, and run exactly one more pass for whatever arrived meanwhile.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "app", "app-inline-01.js"), "utf8");
const ini = src.indexOf("  var _comAuto = ");
const fin = src.indexOf("\n  }\n", src.indexOf("function refrescarComisionesAuto()")) + 4;
assert.ok(ini > 0 && fin > ini, "refrescarComisionesAuto exists in src/app/app-inline-01.js");
const codigo = src.slice(ini, fin);

function montar(activa = true) {
  const ctx = { pintadas: [], llamadas: 0, solicitud: 0, resolver: [], ventas: ["v1"] };
  ctx.document = { getElementById: () => ({ classList: { contains: () => activa } }) };
  ctx.Date = Date; ctx.Promise = Promise;
  // Same stale rule as the real cargarComisiones: a read is painted only if no newer call started.
  ctx.cargarComisiones = function () {
    const run = ++ctx.solicitud; ctx.llamadas++;
    const foto = ctx.ventas.slice();
    return new Promise((r) => ctx.resolver.push(r)).then(() => { if (run === ctx.solicitud) ctx.pintadas.push(foto); });
  };
  vm.createContext(ctx);
  vm.runInContext(codigo + "\nthis.refrescar = refrescarComisionesAuto;", ctx);
  return ctx;
}
const tic = () => new Promise((r) => setImmediate(r));

test("burst of sync refreshes: the read in flight is painted, then one pass with the new sale", async () => {
  const c = montar();
  c.refrescar();
  await tic();
  c.ventas.push("v2-recien-vendida");
  for (let i = 0; i < 10; i++) c.refrescar(); // sync burst while the first read is still running
  assert.strictEqual(c.llamadas, 1, "no second read while one is in flight");
  c.resolver.shift()(); await tic(); await tic();
  assert.deepStrictEqual(c.pintadas, [["v1"]], "the finished read is painted, not thrown away");
  assert.strictEqual(c.llamadas, 2, "exactly one trailing pass for the burst");
  c.resolver.shift()(); await tic(); await tic();
  assert.deepStrictEqual(c.pintadas[1], ["v1", "v2-recien-vendida"], "the last paint includes the newest sale");
  assert.strictEqual(c.llamadas, 2, "no extra passes once quiet");
});

test("view not active: no read at all", async () => {
  const c = montar(false);
  c.refrescar(); await tic();
  assert.strictEqual(c.llamadas, 0);
});

test("a failed read does not block later refreshes", async () => {
  const c = montar();
  c.cargarComisiones = () => { c.llamadas++; return Promise.reject(new Error("ventas-http")); };
  c.refrescar(); await tic(); await tic();
  c.refrescar(); await tic(); await tic();
  assert.strictEqual(c.llamadas, 2);
});
