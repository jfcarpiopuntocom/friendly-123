/* Test enfocado del fix A1 (2026-08-27): unificar el dedup del doble motor de
   sync. El lazy sync deduplica por op.id (f123_sync_ids_aplicados) y el relay
   por op.opId (f123_sync_ops_aplicadas). Antes, si un mismo cambio viajaba por
   ambos motores, se aplicaba dos veces (doble conteo de stock). Ahora
   reproducir() salta ops cuyo opId ya aplicó el relay y registra en el ledger
   del relay las que aplica aquí. Replica la lógica real. */
const assert = require("assert");

let ok = 0;
function check(nombre, cond, extra) {
  if (cond) { console.log("  ok   " + nombre); ok++; }
  else { console.log("  FALLA " + nombre + (extra ? "  -> " + JSON.stringify(extra) : "")); process.exitCode = 1; }
}

// --- réplica de la lógica de reproducir() con dedup unificado ---
function reproducir(ops, aplicados, relayAplicados) {
  const porDispositivo = {};
  ops.forEach((op) => {
    if (op.dev === "yo") return;
    if (op.id && aplicados.has(op.id)) return;
    if (op.opId && relayAplicados.has(op.opId)) return; // ya lo aplicó el relay
    (porDispositivo[op.dev] = porDispositivo[op.dev] || []).push(op);
  });
  let aplicadas = 0;
  for (const dev in porDispositivo) {
    for (const op of porDispositivo[dev]) {
      aplicados.add(op.id);
      if (op.opId) relayAplicados.add(op.opId);
      aplicadas++;
    }
  }
  return aplicadas;
}

// --- escenario: el relay ya aplicó un cambio (opId X), el lazy sync recibe el mismo ---
const aplicados = new Set();
const relayAplicados = new Set(["op-relay-1"]); // el relay ya aplicó op-relay-1
const ops = [
  { id: "lazy-1", opId: "op-relay-1", dev: "A", url: "/api/productos", method: "POST" }, // ya aplicado por relay
  { id: "lazy-2", opId: "op-relay-2", dev: "A", url: "/api/productos", method: "POST" }, // nuevo
  { id: "lazy-3", dev: "A", url: "/api/ventas", method: "POST" }, // sin opId (solo lazy)
];
const n = reproducir(ops, aplicados, relayAplicados);
check("A1: la op ya aplicada por el relay NO se re-aplica", n === 2, n);
check("A1: la op con opId nuevo se aplica y se registra en el ledger del relay", relayAplicados.has("op-relay-2"));
check("A1: la op sin opId (solo lazy) se aplica", aplicados.has("lazy-3"));
check("A1: la op ya aplicada por el relay no queda en el ledger lazy", !aplicados.has("lazy-1"));

// --- idempotencia: re-ejecutar no duplica ---
const n2 = reproducir(ops, aplicados, relayAplicados);
check("A1: re-ejecutar es idempotente (no duplica)", n2 === 0, n2);

// --- ops propias se ignoran ---
const opsPropias = [{ id: "lazy-4", opId: "op-4", dev: "yo", url: "/api/x", method: "POST" }];
const n3 = reproducir(opsPropias, aplicados, relayAplicados);
check("A1: las ops propias se ignoran", n3 === 0, n3);

console.log(ok >= 6 ? "\nTODO VERDE — A1: dedup unificado entre lazy sync y relay." : "\nHAY ROJO");
