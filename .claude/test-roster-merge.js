/* Prueba de mesa del reloj lógico del roster (JFC 2026-08-26, Camino A).
   Extrae la función REAL _revDomina de mock-backend.js y la ejerce, para no
   probar una copia. Comprueba las invariantes que hacían fallar el team sync:
     - el rev con contador mayor gana (causalidad, no reloj de pared);
     - empate de contador se rompe por deviceId, determinista en ambos aparatos;
     - sin rev en ninguno → null (el llamador cae al reloj de pared, como antes);
     - un tombstone con rev mayor gana a un registro vivo con rev menor.
   Corre con:  node docs/_test-roster-merge.js   (sale 0 si todo pasa). */
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "..", "docs", "mock-backend.js"), "utf8");

// Extrae el cuerpo textual de _revDomina del archivo real.
const m = src.match(/function _revDomina\(a, b\) \{[\s\S]*?\n  \}/);
if (!m) { console.error("NO se encontró _revDomina en mock-backend.js"); process.exit(2); }
// eslint-disable-next-line no-eval
const _revDomina = eval("(" + m[0].replace(/^function _revDomina/, "function") + ")");

let fallos = 0;
function ok(nombre, cond) {
  if (cond) { console.log("  ok   " + nombre); }
  else { console.log("  FALLA " + nombre); fallos++; }
}

// 1) Contador mayor gana, aunque el deviceId sea "menor".
ok("rev.c mayor gana (remoto 5 vs local 3)", _revDomina({ c: 5, d: "aaa" }, { c: 3, d: "zzz" }) === true);
ok("rev.c menor pierde (remoto 2 vs local 9)", _revDomina({ c: 2, d: "zzz" }, { c: 9, d: "aaa" }) === false);

// 2) Empate de contador → desempata deviceId, y es SIMÉTRICO (los dos aparatos
//    calculan el mismo ganador, así convergen sin quedar oscilando).
const A = { c: 7, d: "device-A" }, B = { c: 7, d: "device-B" };
const aGanaEnUno = _revDomina(A, B);       // ¿gana A visto como "remoto"?
const aGanaEnOtro = !_revDomina(B, A);     // ¿gana A visto como "local"?
ok("empate de contador: desempate por deviceId es determinista", aGanaEnUno === aGanaEnOtro);
ok("empate de contador: exactamente uno gana", _revDomina(A, B) !== _revDomina(B, A));

// 3) Sin rev en ninguno → null (el llamador usa el reloj de pared, igual que antes).
ok("sin rev en ninguno → null (fallback a reloj de pared)", _revDomina(null, null) === null);
ok("sin rev en ninguno (objetos vacíos) → null", _revDomina({}, {}) === null);

// 4) Un registro CON rev gana a uno viejo SIN rev (el nuevo pasó por el camino bueno).
ok("registro con rev gana a registro sin rev", _revDomina({ c: 1, d: "x" }, null) === true);
ok("registro sin rev NO gana a registro con rev", _revDomina(null, { c: 1, d: "x" }) === false);

// 5) Caso real de la baja: tombstone (rev mayor) debe ganar al vivo (rev menor).
//    _revDomina no mira 'borrado' — decide el orden; el merge adopta el campo
//    'borrado' del ganador. Aquí se comprueba el orden, que es lo que fallaba.
ok("tombstone con rev mayor gana al vivo con rev menor",
   _revDomina({ c: 10, d: "quien-borro" }, { c: 4, d: "quien-lo-tenia" }) === true);

if (fallos) { console.log("\n" + fallos + " prueba(s) FALLARON"); process.exit(1); }
console.log("\nTODO VERDE — el reloj lógico del roster converge como se espera.");
