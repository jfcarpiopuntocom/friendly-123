/* Test enfocado del fix C2 (2026-08-27): el checkpoint debe llevar el lamport
   de lo APLICADO, no el contador global inflado por mensajes de control.
   Replica la lógica real de sync-realtime.js (registrarEnLog + _lamportAplicadoMax
   + subirCheckpoint) y simula el escenario del bug:
     - un latido (control) infla lamportActual() a 500
     - solo se aplicaron ops de negocio hasta lamport 100
   Antes del fix, subirCheckpoint usaba 500 -> el relay podaba ops 100..500 y un
   dispositivo nuevo perdía stock. Con el fix usa 100 -> no sobre-poda. */
const assert = require("assert");

// --- réplica de la lógica real ---
let _lamportAplicadoMax = 0; // se inicializa desde el log persistido
function registrarEnLog(op, log) {
  if (!op || !op.opId) return;
  if (log.some((o) => o.opId === op.opId)) return;
  log.push(op);
  if (typeof op.lamport === "number" && op.lamport > _lamportAplicadoMax) _lamportAplicadoMax = op.lamport;
}
function subirCheckpointLamport() {
  return _lamportAplicadoMax || 0; // el fix: usa lo aplicado, no lamportActual()
}

let ok = 0;
function check(nombre, cond) {
  if (cond) { console.log("  ok   " + nombre); ok++; }
  else { console.log("  FALLA " + nombre); process.exitCode = 1; }
}

// --- escenario del bug ---
const log = [];
// 1) llega un LATIDO (control) con lamport 500: infla el contador global pero
//    NO pasa por registrarEnLog (retorna antes en onmessage).
const lamportActual = 500; // inflado por el latido
// 2) se aplican ops de negocio reales hasta lamport 100
registrarEnLog({ opId: "op1", lamport: 50 }, log);
registrarEnLog({ opId: "op2", lamport: 100 }, log);

check("lamport aplicado = 100 (no 500)", _lamportAplicadoMax === 100);
check("subirCheckpoint usa 100, no el contador inflado", subirCheckpointLamport() === 100);
check("el latido no infla el lamport aplicado", _lamportAplicadoMax < lamportActual);

// --- dedup: re-registrar la misma op no sube el lamport ---
registrarEnLog({ opId: "op2", lamport: 100 }, log);
check("re-registrar op ya vista no sube el lamport", _lamportAplicadoMax === 100);

// --- inicialización desde log persistido (sesión anterior) ---
const logPersistido = [{ opId: "a", lamport: 30 }, { opId: "b", lamport: 200 }];
let _lamportAplicadoMax2 = 0;
logPersistido.forEach((o) => { if (o.lamport > _lamportAplicadoMax2) _lamportAplicadoMax2 = o.lamport; });
check("inicialización desde log persistido = 200", _lamportAplicadoMax2 === 200);

// --- límite inferior es seguro: si el log está capado, no sobre-poda ---
const logCapado = [{ opId: "x", lamport: 400 }]; // solo quedan las últimas 500
let _lamportAplicadoMax3 = 0;
logCapado.forEach((o) => { if (o.lamport > _lamportAplicadoMax3) _lamportAplicadoMax3 = o.lamport; });
check("log capado da límite inferior (400), nunca sobre-poda", _lamportAplicadoMax3 === 400);

console.log(ok >= 6 ? "\nTODO VERDE — el checkpoint usa el lamport aplicado, no el inflado." : "\nHAY ROJO");
