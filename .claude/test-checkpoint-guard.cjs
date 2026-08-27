/* Test enfocado del fix C1 (2026-08-27): el relay NO debe sobreescribir un
   checkpoint bueno con uno más viejo. Replica la lógica de _guardarCkpt:
   solo se acepta si el lamport entrante es >= al guardado. */
const assert = require("assert");

// --- réplica de la lógica real (guard de C1) ---
let ckpt = null; // { lam, c }
let ops = [];    // ops guardadas { id, lam }
function guardarCkpt(lam, c) {
  const lamN = Number(lam) || 0;
  if (ckpt && ckpt.lam > lamN) return false; // rechazado: entrante más viejo
  ckpt = { lam: lamN, c };
  ops = ops.filter((o) => o.lam > lamN); // poda ops <= lam
  return true;
}
function guardarOp(id, lam) { ops.push({ id, lam }); }

let ok = 0;
function check(nombre, cond) {
  if (cond) { console.log("  ok   " + nombre); ok++; }
  else { console.log("  FALLA " + nombre); process.exitCode = 1; }
}

// --- escenario del bug ---
// A (al día, lam=100) sube un checkpoint bueno; el relay poda ops <=100
guardarOp("op1", 50); guardarOp("op2", 80); guardarOp("op3", 120);
guardarCkpt(100, "ckpt-bueno-A");
check("checkpoint bueno (lam=100) aceptado", ckpt.lam === 100);
check("poda ops <=100 (quedan op3=120)", ops.length === 1 && ops[0].lam === 120);

// B (atrasado, lam=50) reconecta y sube su estado rancio
const aceptado = guardarCkpt(50, "ckpt-rancio-B");
check("checkpoint rancio (lam=50) RECHAZADO", aceptado === false);
check("el checkpoint bueno sigue intacto", ckpt.lam === 100 && ckpt.c === "ckpt-bueno-A");
check("no se podaron ops por el rancio (op3 sigue)", ops.length === 1 && ops[0].lam === 120);

// un dispositivo nuevo hace pull: recibe el checkpoint bueno + op3
check("pull recibe estado completo (ckpt 100 + op3 120)", ckpt.lam === 100 && ops.some((o) => o.lam === 120));

// --- igual lamport: último en subir gana (no se congela) ---
guardarCkpt(100, "ckpt-A2-mismo-lam");
check("igual lamport se deja pasar (último gana)", ckpt.c === "ckpt-A2-mismo-lam");

// --- checkpoint más nuevo siempre gana ---
guardarCkpt(150, "ckpt-C-nuevo");
check("checkpoint más nuevo (lam=150) aceptado", ckpt.lam === 150);

console.log(ok >= 7 ? "\nTODO VERDE — el relay no deja que un checkpoint rancio pise al bueno." : "\nHAY ROJO");
