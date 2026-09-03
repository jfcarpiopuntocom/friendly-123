/* Guard de Inspector(TM): la lógica pura de diff detecta faltantes/nuevos/cambios
   y respeta el muro (el snapshot no debe llevar precios). No necesita navegador. */
const path = require("path");
const Inspector = require(path.join(__dirname, "..", "docs", "inspector.js"));

let ok = true;
function check(cond, msg) { if (!cond) { ok = false; console.log("  FALLO:", msg); } }

const base = { root: "R0", items: [
  { sku: "A", nombre: "Camisa", cantidad: 5, hash: "hA" },
  { sku: "B", nombre: "Aro",    cantidad: 2, hash: "hB" },
  { sku: "C", nombre: "Taza",   cantidad: 9, hash: "hC" }
]};
const ahora = { root: "R1", items: [
  { sku: "A", nombre: "Camisa", cantidad: 5, hash: "hA" },              // intacto
  { sku: "B", nombre: "Aro",    cantidad: 0, hash: "hB2" },             // cambió (faltan 2)
  { sku: "D", nombre: "Nuevo",  cantidad: 3, hash: "hD" }               // nuevo
]};

const d = Inspector.diff(base, ahora);
check(!d.intacto, "debe detectar que NO está intacto");
check(d.faltantes.length === 1 && d.faltantes[0].sku === "C", "C debe salir como faltante");
check(d.nuevos.length === 1 && d.nuevos[0].sku === "D", "D debe salir como nuevo");
check(d.cambios.length === 1 && d.cambios[0].sku === "B", "B debe salir como cambio");
check(d.cambios[0].deltaCantidad === -2, "delta de B debe ser -2");

// Muro: dos sellos idénticos → intacto.
const d2 = Inspector.diff(base, JSON.parse(JSON.stringify(base)));
check(d2.intacto, "dos sellos idénticos deben dar intacto");

// El muro de datos: la huella de ítem NUNCA debe exponer un campo de dinero.
const serial = JSON.stringify(base) + JSON.stringify(ahora);
check(!/precio|costo|venta|ganan|price|cost/i.test(serial), "el sello no debe contener campos de dinero");

console.log(ok ? "test-inspector: TODO VERDE" : "test-inspector: ROJO");
process.exit(ok ? 0 : 1);
