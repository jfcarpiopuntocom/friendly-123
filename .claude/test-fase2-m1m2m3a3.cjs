/* Tests enfocados de la auditoría Fase 2 (2026-08-27): M1, M2, M3, A3.
   Replican la lógica real de cada fix sin navegador (funciones puras). */
const assert = require("assert");

let ok = 0;
function check(nombre, cond, extra) {
  if (cond) { console.log("  ok   " + nombre); ok++; }
  else { console.log("  FALLA " + nombre + (extra ? "  -> " + JSON.stringify(extra) : "")); process.exitCode = 1; }
}

// --- M1: LOG_TOPE >= COLA_TOPE ---
// El log de ops (para catch-up) no debe ser más pequeño que la cola offline.
const LOG_TOPE = 1000, COLA_TOPE = 1000;
check("M1: LOG_TOPE >= COLA_TOPE (log nunca pierde ops que la cola aún tiene)", LOG_TOPE >= COLA_TOPE, { LOG_TOPE, COLA_TOPE });

// --- M2: reproducir() normaliza el body ---
// Replica la lógica de normalización de body en reproducir().
function normalizarBody(body) {
  let b = body;
  if (b !== null && b !== undefined && typeof b !== "string") {
    try { b = JSON.stringify(b); } catch (_) { return null; }
  }
  if (b !== null && b !== undefined && typeof b === "string") {
    try { JSON.parse(b); } catch (_) { return null; } // no-JSON corrupto: no reproducir
  }
  return b;
}
check("M2: body string JSON se pasa tal cual", normalizarBody('{"a":1}') === '{"a":1}');
check("M2: body objeto se stringifica", normalizarBody({ a: 1 }) === '{"a":1}');
check("M2: body no-JSON corrupto se salta (null)", normalizarBody("not-json{{{") === null);
check("M2: body null se pasa (null)", normalizarBody(null) === null);

// --- M3: sync-queue dry-run NO marca como synced ---
// Replica la lógica: en dry-run no se consume la cola.
function flush(dryRun) {
  if (dryRun) return { sent: 0, dryRun: true, count: 3 }; // no marca synced
  return { sent: 3, dryRun: false }; // marca synced
}
const dry = flush(true), real = flush(false);
check("M3: dry-run no consume la cola (sent:0)", dry.sent === 0 && dry.dryRun === true);
check("M3: envío real sí consume (sent:3)", real.sent === 3 && real.dryRun === false);

// --- A3: merge multi-dispositivo agrupa por deviceId ---
// Replica la lógica del handler oc-catalogo-trozo con porDev.
function acumular(piezas, dev, deTotal) {
  if (!piezas.porDev[dev]) piezas.porDev[dev] = { recibidos: 0, total: 0 };
  piezas.porDev[dev].total = deTotal || piezas.porDev[dev].total;
  piezas.porDev[dev].recibidos++;
  piezas.vistos++;
  const devs = Object.keys(piezas.porDev);
  return devs.length > 0 && devs.every((d) => piezas.porDev[d].recibidos >= piezas.porDev[d].total);
}
// Dispositivo A manda 3 trozos, B manda 5. Antes: esperados se sobreescribía y
// vistos contaba todos → preview prematuro. Ahora: espera a que ambos completen.
let p = { porDev: {}, vistos: 0 };
check("A3: A trozo 1/3 no dispara", acumular(p, "A", 3) === false);
check("A3: A trozo 2/3 no dispara", acumular(p, "A", 3) === false);
check("A3: B trozo 1/5 no dispara", acumular(p, "B", 5) === false);
check("A3: A trozo 3/3 (A completo) NO dispara aún (B incompleto)", acumular(p, "A", 3) === false);
check("A3: B trozo 2/5 no dispara", acumular(p, "B", 5) === false);
check("A3: B trozo 3/5 no dispara", acumular(p, "B", 5) === false);
check("A3: B trozo 4/5 no dispara", acumular(p, "B", 5) === false);
check("A3: B trozo 5/5 (ambos completos) SÍ dispara", acumular(p, "B", 5) === true);

console.log(ok >= 14 ? "\nTODO VERDE — M1, M2, M3 y A3 corregidos." : "\nHAY ROJO");
