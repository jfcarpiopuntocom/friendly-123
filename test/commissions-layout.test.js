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

test("promoter management block uses the same type scale (v366 live left 15px and 13.33px)", () => {
  const a = html.indexOf("async function renderGestionPromotoras(");
  const b = html.indexOf("\nasync function ", a + 10);
  const r = html.slice(a, b > a ? b : a + 20000);
  const sizes = new Set([...r.matchAll(/font-size:\s*([0-9.]+)px/g)].map((m) => Number(m[1])));
  for (const s of sizes) assert.ok([13, 14, 16].includes(s), "unexpected font-size " + s + "px");
  assert.ok(/id="btnAltaPromotora" style="[^"]*font-size:14px/.test(html), "Save agent button has no real size");
  assert.ok(/data-abrir-promotora="\$\{[^}]+\}"[^>]*>\s*<strong style="font-size:16px;/.test(html), "promoter names inherit 13.33px");
});

test("status badges never shrink below 13px on phones (v367 live showed 11px)", () => {
  for (const m of html.matchAll(/\.badge-estado\{[^}]*font-size:\s*([0-9.]+)px/g)) assert.ok(Number(m[1]) >= 13, "badge at " + m[1] + "px");
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
  // JFC 2026-09-23: ranking y matriz RFM "van al fondo, es lo que menos le interesa
  // a nadie y menos con tan poca data": fuera del bloque del dinero, debajo del alta.
  assert.ok(!partes.includes("rankHtml") && !partes.some((p) => p.startsWith("matrizComisionistasHtml")), "ranking/RFM must leave the money block");
  assert.ok(vista.indexOf('id="gestionPromotoras"') < vista.indexOf('id="rankingComisiones"'), "ranking must sit below promoter management");
  assert.ok(/rankingComisiones"\);[\s\S]{0,60}innerHTML = rankHtml \+ matrizComisionistasHtml\(ranking\)/.test(r), "ranking container not filled");
});
