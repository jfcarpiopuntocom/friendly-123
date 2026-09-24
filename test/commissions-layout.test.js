// Commissions: orden por producto y escala tipografica (JFC 2026-09-23).
// "aun apesta, en organizacion, en mostrar en base a productos y no solo a
// perchas ... hasta tamanos disonantes de tipografia tiene". Se mide en la
// pantalla viva v365: 11 tamanos distintos (12..20px), texto de 12px (bajo el
// minimo de 13px de JFC), medallas emoji, gris #8A8A8A, y el alta de
// comisionistas ARRIBA del dinero. Esta prueba fija lo que se corrigio.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "docs", "index.html"), "utf8");

function region() {
  const a = html.indexOf("function matrizComisionistasHtml(");
  const b = html.indexOf("async function exportarComisionesCSV(");
  assert.ok(a > 0 && b > a, "commissions render region not found");
  return html.slice(a, b);
}

test("commissions uses a 3-step type scale (13/14/16px) and nothing below 13px", () => {
  const sizes = new Set([...region().matchAll(/font-size:\s*([0-9.]+)px/g)].map((m) => Number(m[1])));
  for (const s of sizes) assert.ok([13, 14, 16].includes(s), "unexpected font-size " + s + "px");
});

test("commissions has no medal emojis and no grey #8A8A8A", () => {
  const r = region();
  assert.ok(!/[\u{1F947}-\u{1F949}]/u.test(r), "medal emoji still present");
  assert.ok(!/#8A8A8A/i.test(r), "grey #8A8A8A still present");
});

test("money comes first: totals by product, then promoter management at the end", () => {
  const vista = html.slice(html.indexOf('<section id="vista-comisiones"'));
  assert.ok(vista.indexOf('id="listaComisiones"') < vista.indexOf('id="gestionPromotoras"'),
    "promoter form must come after the money");
  const r = region();
  assert.ok(r.includes("comm.totalsHeading"), "month totals strip missing");
  const orden = r.match(/cont\.innerHTML = btnWA \+ btnExport \+ ([^;]+);/);
  assert.ok(orden, "commissions render line not found");
  const partes = orden[1].split("+").map((s) => s.trim());
  assert.ok(partes.indexOf("cardsHtml") === partes.length - 1, "rack cards must be the last block");
  assert.ok(partes[0].startsWith("resumenComisionPorProductoHtml"), "by-product summary must open the view");
});
