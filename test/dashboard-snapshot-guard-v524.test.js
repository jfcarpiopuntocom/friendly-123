// Dashboard-only regression. No sockets, backend writes, licenses, or customer data.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function crearVisor() {
  const html = fs.readFileSync(path.join(__dirname, "../docs/dashboard.html"), "utf8");
  const ini = html.indexOf("  function recibirTrozo(p, emisor)");
  const fin = html.indexOf("  /* ---------------------------------------------------------------- VISTAS */", ini);
  assert.ok(ini > 0 && fin > ini, "receiver located");
  const visto = [], avisos = [];
  const c = {
    datos: { productos: [{ id: "p1", stockActual: 1 }], ventas: [{ id: "v1" }],
      cobertura: { productos: true, ventas: true } },
    fotoEnCurso: "prev", fotoFecha: "2026-10-15T12:00:00.000Z",
    esperados: {}, recibidos: {}, fotoTemporal: {}, totalTrozos: 0, clavesTrozos: {},
    ultimoDato: 0, reconexionMs: 1500, _fuenteDatosDashboard: "remota",
    $: () => ({ textContent: "" }),
    pulso: (mensaje) => avisos.push(mensaje),
    mostrar() { visto.push(this.datos); },
    window: { OCBusinessReadModel: require("../docs/core/business-read-model.js") },
    Date, Number, Object, String
  };
  vm.createContext(c);
  vm.runInContext(html.slice(ini, fin) + "\nthis.receive = recibirTrozo;", c);
  function foto(id, cuando, ventas, cobertura = { productos: true, ventas: true }) {
    const tablas = [
      ["ventas", ventas],
      ["productos", [{ id: "p1", stockActual: 1 }]],
      ["cobertura", [cobertura]]
    ];
    tablas.forEach(([tabla, filas], k) =>
      c.receive({ fotoId: id, generadaEn: cuando, k, deTotal: tablas.length,
        tabla, i: 0, total: 1, filas, negocio: "Fixture business" }, "peer-b"));
  }
  return { c, foto, visto, avisos };
}

test("v524 dashboard does not erase previously visible sales from a newer-dated incomplete peer photo", () => {
  const { c, foto, visto } = crearVisor();
  foto("stale", "2026-10-15T12:10:00.000Z", []);
  assert.equal(visto.length, 0, "stale photo must not repaint");
  assert.equal(c.datos.ventas[0].id, "v1", "last complete visible data preserved");
  assert.equal(c.receive.sinConciliar, true, "warning remains until valid photo");
  assert.equal(c.fotoEnCurso, "", "rejected photo must not suppress next recovery");
});

test("v524 failed sales API does not replace complete snapshot with a false zero", () => {
  const { c, foto, visto } = crearVisor();
  foto("missing-api", "2026-10-15T12:10:00.000Z", [], { productos: true, ventas: false });
  assert.equal(visto.length, 0);
  assert.equal(c.datos.ventas.length, 1);
  assert.equal(c.receive.sinConciliar, true);
});

test("v524 accepts recovering peer with historical sales even if its clock is earlier than the rejected photo", () => {
  const { c, foto, visto } = crearVisor();
  foto("stale", "2026-10-15T12:10:00.000Z", []);
  foto("recovered", "2026-10-15T12:02:00.000Z", [{ id: "v1" }, { id: "v2" }]);
  assert.equal(visto.length, 1, "complete recovery can paint");
  assert.equal(c.datos.ventas.length, 2);
  assert.equal(c.receive.sinConciliar, false);
});
