/* Fixation tests: they pin current correct behavior (v468); they are not proof of a bug fix.
   Covers: customer balances (cartera.js), payment plans (plan-pagos.js / plan-pagos-ui.js),
   expense voiding and balance text (index.html inline JS), and the big-screen dashboard
   commissions (dashboard.html inline JS) against the backend /api/liquidaciones. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { browser } = require('./helpers/browser.cjs');

const docs = path.join(__dirname, '..', 'docs');
const read = f => fs.readFileSync(path.join(docs, f), 'utf8');
const carteraSrc = read('cartera.js');
const planSrc = read('plan-pagos.js');
const indexSrc = read('index.html');
const dashSrc = read('dashboard.html');
const planUiSrc = read('plan-pagos-ui.js');

/* Cut one function out of a big inline script between two anchors (never loads the whole file). */
function cut(src, from, to) {
  const a = src.indexOf(from);
  assert.ok(a >= 0, 'anchor not found: ' + from);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, 'end anchor not found: ' + to);
  const chunk = src.slice(a, b);
  return chunk.slice(0, chunk.lastIndexOf('}') + 1);
}

/* In-memory fact ledger with the same surface as AMG.Hechos (todos / registrar / verificarCadenas). */
function ledger() {
  const facts = []; let t = 1000000;
  return {
    facts,
    api: {
      todos: async () => facts.slice(),
      registrar: async (tipo, payload) => { t += 10000; const h = { id: 'h' + facts.length, tipo, ts: t, datos: { payload } }; facts.push(h); return h; },
      verificarCadenas: async () => ({ ok: true }),
    },
  };
}
function world() {
  const L = ledger();
  const window = { AMG: { Hechos: L.api } };
  const ctx = { window, console, localStorage: { getItem: () => null, setItem() {} }, Date, Math, JSON };
  vm.runInNewContext(carteraSrc, ctx);
  vm.runInNewContext(planSrc, ctx);
  return { L, AMG: window.AMG };
}
const plan = { montoTotal: 300, numCuotas: 3, primerVencimiento: '2026-01-05T12:00:00.000Z', frecuencia: 'mensual' };
const hecho = (tipo, ts, datos) => ({ id: tipo + ts, tipo, ts, datos });

/* ---------------- cartera.js: calcularSaldo ---------------- */
test('calcularSaldo: debts minus credits in exact cents, never float drift (0.10+0.20 owed, 0.30 paid = 0)', () => {
  // WHY: money must be summed in cents; 0.1+0.2 in floats is 0.30000000000000004.
  const { AMG } = world();
  const todos = [
    hecho('cartera_cargo', 10000, { clienteId: 'c1', monto: 0.10, motivo: 'a' }),
    hecho('cartera_cargo', 20000, { clienteId: 'c1', monto: 0.20, motivo: 'b' }),
    hecho('cartera_abono', 30000, { clienteId: 'c1', monto: 0.30, motivo: 'c' }),
  ];
  const r = AMG.Cartera.calcularSaldo(todos, 'c1', null);
  assert.equal(r.saldo, 0);
  assert.equal(r.movimientos.length, 3);
});

test('calcularSaldo: debt is negative, credit positive, credit "sin determinar" (no sale attached) counts', () => {
  // WHY: a general credit not tied to a product still reduces what the customer owes.
  const { AMG } = world();
  const todos = [
    hecho('cartera_cargo', 10000, { clienteId: 'c1', monto: 100, motivo: 'fiado' }),
    hecho('cartera_abono', 20000, { clienteId: 'c1', monto: 40.25 }),
  ];
  assert.equal(AMG.Cartera.calcularSaldo(todos, 'c1', null).saldo, -59.75);
  todos.push(hecho('cartera_abono', 30000, { clienteId: 'c1', monto: 70, motivo: 'extra' }));
  assert.equal(AMG.Cartera.calcularSaldo(todos, 'c1', null).saldo, 10.25, 'overpaying leaves a positive credit');
});

test('calcularSaldo: other customers, garbage amounts and an empty ledger never yield NaN or leak', () => {
  // WHY: a corrupt monto must not poison the whole balance with NaN.
  const { AMG } = world();
  const todos = [
    hecho('cartera_cargo', 10000, { clienteId: 'c1', monto: 'abc', motivo: 'x' }),
    hecho('cartera_cargo', 20000, { clienteId: 'c1', monto: undefined, motivo: 'y' }),
    hecho('cartera_cargo', 30000, { clienteId: 'c1', monto: 12.5, motivo: 'z' }),
    hecho('cartera_cargo', 40000, { clienteId: 'otro', monto: 999, motivo: 'z' }),
  ];
  const r = AMG.Cartera.calcularSaldo(todos, 'c1', null);
  assert.equal(r.saldo, -12.5);
  assert.ok(Number.isFinite(r.saldo));
  assert.equal(AMG.Cartera.calcularSaldo([], 'c1', null).saldo, 0);
});

/* ---------------- plan-pagos.js: saldoActual / anularPlan ---------------- */
test('saldoActual: after partial payments the plan sees the live balance (not paid off until balance reaches 0)', async () => {
  // WHY: saldoActual feeds the "paid off" decision; a partial payment must NOT mark the plan done.
  const { AMG } = world();
  await AMG.Cartera.registrarMovimiento('c1', 'cargo', 300, 'fiado');
  await AMG.PlanPagos.crearPlan('c1', plan);
  await AMG.Cartera.registrarMovimiento('c1', 'abono', 100, 'cuota 1');
  assert.equal((await AMG.Cartera.saldoDeCliente('c1')).saldo, -200);
  const e = await AMG.PlanPagos.estadoDelPlan('c1', new Date('2026-01-10T12:00:00Z').getTime());
  assert.equal(e.hayPlan, true);
  assert.notEqual(e.estado, 'cumplido', 'still owes 200: not paid off');
  await AMG.Cartera.registrarMovimiento('c1', 'abono', 200, 'cuota 2 y 3');
  assert.equal((await AMG.Cartera.saldoDeCliente('c1')).saldo, 0);
  const e2 = await AMG.PlanPagos.estadoDelPlan('c1', new Date('2026-01-10T12:00:00Z').getTime());
  assert.equal(e2.estado, 'cumplido', 'balance 0 means the plan is fulfilled');
});

test('anularPlan: voids the plan, keeps the plan fact in history, and the balance is untouched', async () => {
  // WHY: voiding an agreement must never forgive a debt nor delete history.
  const { L, AMG } = world();
  await AMG.Cartera.registrarMovimiento('c1', 'cargo', 300, 'fiado');
  await AMG.PlanPagos.crearPlan('c1', plan);
  await AMG.Cartera.registrarMovimiento('c1', 'abono', 50, 'cuota');
  assert.ok(await AMG.PlanPagos.planActivo('c1'));
  const antes = (await AMG.Cartera.saldoDeCliente('c1')).saldo;
  await AMG.PlanPagos.anularPlan('c1', 'renegociado');
  assert.equal(await AMG.PlanPagos.planActivo('c1'), null, 'no active plan after voiding');
  assert.equal((await AMG.Cartera.saldoDeCliente('c1')).saldo, antes);
  assert.equal(antes, -250);
  assert.deepEqual(L.facts.map(h => h.tipo), ['cartera_cargo', 'plan_pago_creado', 'cartera_abono', 'plan_pago_anulado']);
  assert.equal(L.facts[1].datos.payload.montoTotal, 300, 'the original plan fact is still there');
  assert.equal((await AMG.PlanPagos.estadoDelPlan('c1')).hayPlan, false);
});

test('anularPlan: voiding twice changes nothing more, a missing customer id is rejected, a new plan starts fresh', async () => {
  // WHY: a double tap must not corrupt the balance or resurrect a plan.
  const { AMG } = world();
  await AMG.Cartera.registrarMovimiento('c1', 'cargo', 90, 'fiado');
  await AMG.PlanPagos.crearPlan('c1', plan);
  await AMG.PlanPagos.anularPlan('c1', 'a');
  await AMG.PlanPagos.anularPlan('c1', 'b');
  assert.equal(await AMG.PlanPagos.planActivo('c1'), null);
  assert.equal((await AMG.Cartera.saldoDeCliente('c1')).saldo, -90);
  await assert.rejects(() => AMG.PlanPagos.anularPlan('', 'x'), /falta clienteId/);
  await AMG.PlanPagos.crearPlan('c1', plan);
  assert.ok(await AMG.PlanPagos.planActivo('c1'));
});

/* ---------------- plan-pagos-ui.js: modalAnular (real DOM) ---------------- */
test('modalAnular: asks first (nothing voided until confirmed), "Leave it as is" voids nothing, confirming twice voids once', async () => {
  // WHY: cancelling a customer agreement is deliberate and single-shot.
  const src = cut(planUiSrc, 'function modalAnular(clienteId) {', '// B3');
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage();
    await page.setContent('<body></body>');
    await page.addScriptTag({ content: planSrc });
    const r = await page.evaluate(async ({ src, plan }) => {
      const facts = []; let t = 1;
      window.AMG.Hechos = { todos: async () => facts.slice(), verificarCadenas: async () => ({ ok: true }),
        registrar: async (tipo, payload) => { const h = { id: 'h' + facts.length, tipo, ts: (t += 10000), datos: { payload } }; facts.push(h); return h; } };
      const salida = {};
      let anulaciones = 0;
      const orig = window.AMG.PlanPagos.anularPlan;
      window.AMG.PlanPagos.anularPlan = (...a) => { anulaciones++; return orig.apply(null, a); };
      const modalAnular = new Function('global', 'refrescarHoy', 'document', src + '; return modalAnular;')(window, () => {}, document);
      const n = () => facts.filter(h => h.tipo === 'plan_pago_anulado').length;
      await window.AMG.PlanPagos.crearPlan('c1', plan);
      modalAnular('c1');
      salida.pregunta = document.getElementById('pp-modal-anular').innerText;
      salida.anuladosAlAbrir = n();
      modalAnular('c1'); // opening twice must not stack two dialogs
      salida.modales = document.querySelectorAll('#pp-modal-anular').length;
      document.getElementById('pp-an-cancel').click();
      salida.cerroAlDejar = !document.getElementById('pp-modal-anular');
      salida.anuladosTrasDejar = n();
      modalAnular('c1');
      document.getElementById('pp-an-motivo').value = 'renegotiated';
      const ok = document.getElementById('pp-an-ok');
      ok.click(); ok.click();
      await new Promise(res => setTimeout(res, 50));
      salida.anuladosTrasConfirmar = n();
      salida.llamadasAnular = anulaciones;
      salida.motivo = facts.find(h => h.tipo === 'plan_pago_anulado').datos.payload.motivo;
      salida.cerroAlConfirmar = !document.getElementById('pp-modal-anular');
      salida.planActivo = await window.AMG.PlanPagos.planActivo('c1');
      return salida;
    }, { src, plan });
    assert.match(r.pregunta, /The debt is NOT forgiven/);
    assert.match(r.pregunta, /Cancel the agreement/);
    assert.match(r.pregunta, /Leave it as is/);
    assert.equal(r.anuladosAlAbrir, 0, 'opening the dialog voids nothing');
    assert.equal(r.modales, 1);
    assert.equal(r.cerroAlDejar, true);
    assert.equal(r.anuladosTrasDejar, 0, '"Leave it as is" voids nothing');
    assert.equal(r.llamadasAnular, 1, 'second click on the disabled button does nothing');
    assert.equal(r.anuladosTrasConfirmar, 1);
    assert.equal(r.motivo, 'renegotiated');
    assert.equal(r.cerroAlConfirmar, true);
    assert.equal(r.planActivo, null);
  } finally { await web.close(); }
});

/* ---------------- index.html: _textoSaldoCartera ---------------- */
function textoSaldo(locale) {
  const ctx = { window: { OCI18n: locale ? { locale: () => locale } : undefined }, Number, isFinite };
  vm.createContext(ctx);
  vm.runInContext(cut(indexSrc, 'function fmtMoney(n){', '\nfunction ') + '\n' +
    cut(indexSrc, 'function _textoSaldoCartera(saldo) {', 'function _refrescarTrasVinculo'), ctx);
  return ctx._textoSaldoCartera;
}
test('_textoSaldoCartera: debt / credit / zero use the right words in English and Spanish (es-US locale)', () => {
  // WHY: showing "Credit" for a debt (or the reverse) would tell the owner the opposite of the truth.
  const en = textoSaldo('en-US'), es = textoSaldo('es-US');
  assert.equal(en(-59.75), 'Debt $59.75');
  assert.equal(en(10.25), 'Credit $10.25');
  assert.equal(en(0), '$0.00');
  assert.equal(es(-1234.5), 'Deuda $1,234.50');
  assert.equal(es(10.25), 'Crédito $10.25');
  assert.equal(es(0), '$0.00');
  assert.equal(textoSaldo(null)(-5), 'Debt $5.00', 'no i18n module falls back to English');
});

/* ---------------- index.html: anularGasto ---------------- */
function gastosApp({ confirma = true } = {}) {
  const app = browser();
  app.OCAuth = { rolActual: () => 'dueno' };
  app.API = '/api';
  app.ocConfirm = async () => confirma;
  app.cargarGastos = () => {};
  vm.runInContext(cut(indexSrc, 'async function anularGasto(id){', '/* Etiqueta visible'), app);
  return app;
}
test('anularGasto: voids the expense, totals drop by exactly that amount, the voided row stays in the data', async () => {
  // WHY: a deleted expense must leave the books exactly lower by its amount, and stay auditable.
  const app = gastosApp();
  await app.request('/api/gastos', 'POST', { concepto: 'Rent', monto: 100.10, categoria: 'rent' });
  const g2 = await app.request('/api/gastos', 'POST', { concepto: 'Paint', monto: 20.20, categoria: 'maintenance' });
  const antes = await app.request('/api/gastos');
  assert.equal(antes.gastos.length, 2);
  assert.equal(+antes.total.toFixed(2), 120.30);
  await app.anularGasto(g2.id);
  const despues = await app.request('/api/gastos');
  assert.equal(despues.gastos.length, 1);
  assert.equal(+despues.total.toFixed(2), 100.10, 'dropped by exactly 20.20');
  assert.equal(despues.porCategoria.maintenance, undefined);
  assert.equal(despues.porCategoria.rent, 100.10);
  const respaldo = await app.request('/api/respaldo/exportar');
  const kept = respaldo.gastos.find(g => g.id === g2.id);
  assert.ok(kept && kept.borrado === true, 'voided expense stays in the data, flagged');
});

test('anularGasto: voiding twice is a no-op, and declining the confirmation voids nothing', async () => {
  // WHY: double taps and "Cancel" must never remove money from the books.
  const app = gastosApp();
  const a = await app.request('/api/gastos', 'POST', { concepto: 'A', monto: 10 });
  await app.request('/api/gastos', 'POST', { concepto: 'B', monto: 5.5 });
  await app.anularGasto(a.id);
  await app.anularGasto(a.id);
  const t = await app.request('/api/gastos');
  assert.equal(t.gastos.length, 1);
  assert.equal(t.total, 5.5);
  await assert.rejects(() => app.request(`/api/gastos/${a.id}`, 'DELETE'), /404/, 'second void is "not found"');
  const no = gastosApp({ confirma: false });
  const c = await no.request('/api/gastos', 'POST', { concepto: 'C', monto: 7 });
  await no.anularGasto(c.id);
  assert.equal((await no.request('/api/gastos')).total, 7, 'declined confirmation voids nothing');
});

/* ---------------- dashboard.html: filasComisiones / pintarComisiones vs backend ---------------- */
async function tienda(nombreSocio, nombreProducto) {
  const app = browser();
  app.OCAuth = { rolActual: () => 'dueno' };
  const socio = await app.request('/api/promotoras', 'POST', { nombre: nombreSocio, comisionBase: 40 });
  const shelf = await app.request('/api/ubicaciones', 'POST', { nombre: 'Rack ' + nombreSocio, tipo: 'socio', comisionSocio: 40, promotoraId: socio.id });
  await app.request(`/api/ubicaciones/${shelf.id}`, 'PUT', { promotoraId: socio.id }); // the rack names its associate only after this
  const prod = await app.request('/api/productos', 'POST', { nombre: nombreProducto, sku: 'S-' + nombreSocio, barcode: 'S-' + nombreSocio, precio: 33.33, costo: 10, stockInicial: 50, ubicacionId: shelf.id });
  for (let i = 0; i < 3; i++) await app.request(`/api/productos/${prod.id}/venta`, 'POST', { cantidad: 1 });
  // The mock backend seeds demo racks; keep only this tenant's own rack.
  const liquidaciones = (await app.request('/api/liquidaciones')).filter(l => l.ubicacionId === shelf.id);
  // /api/ventas/todas is the exact feed the dashboard receives from the team relay.
  const todas = await app.request('/api/ventas/todas');
  return { liquidaciones, ventas: (Array.isArray(todas) ? todas : todas.ventas).filter(v => v.productoNombre === nombreProducto) };
}

test('dashboard filasComisiones + pintarComisiones show the same per-person amounts as /api/liquidaciones, and only this owner data', async () => {
  // WHY: the big screen must never disagree with the app about what each person is owed, nor show another tenant.
  const A = await tienda('Belen', 'Alpha print');
  const B = await tienda('Zelda', 'Omega mug'); // a different tenant: must never appear
  const liqA = A.liquidaciones.filter(l => l.asociadoNombre === 'Belen');
  assert.equal(liqA.length, 1);
  const esperado = +liqA.reduce((s, l) => s + l.comisionSocio, 0).toFixed(2);
  assert.equal(esperado, 39.99, 'three sales of 33.33 at 40% = 3 x 13.33');
  const fn = cut(dashSrc, 'function filasComisiones() {', '/* ---------------------------------------------------------- COMMISSIONS');
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(pathToFileURL(path.join(docs, 'dashboard.html')).href, { waitUntil: 'load' });
    const datos = { resumen: { nombreNegocio: 'A shop' }, productos: [], clientes: [], movimientos: [], promotoras: [], gastos: [], transferencias: [], gastosMensuales: {}, ventas: A.ventas, liquidaciones: A.liquidaciones };
    const r = await page.evaluate(({ fn, datos }) => {
      const f = (por) => new Function('datos', 'agruparComisionesPor', fn + '; return filasComisiones();')(datos, por);
      window.OCDashComisiones.pintarConDatos(datos);
      const cm = document.getElementById('cm');
      const rank = cm.querySelector('details.cm-card');
      return { porPersona: f('persona'), porPercha: f('percha'), txt: cm.innerText, ranking: rank ? rank.innerText : '' };
    }, { fn, datos });
    assert.equal(r.porPersona.length, 1);
    assert.equal(r.porPersona[0].quien, 'Belen');
    assert.equal(r.porPersona[0].comision, esperado, 'by person = backend comisionSocio, exact');
    assert.equal(r.porPercha.length, 1);
    assert.equal(r.porPercha[0].comision, esperado, 'by rack = backend comisionSocio, exact');
    assert.equal(r.porPercha[0].ventasBrutas, liqA[0].ventasBrutas);
    assert.equal(r.porPercha[0].casa, liqA[0].netoDueno);
    assert.equal(r.porPercha[0].estado, liqA[0].estado);
    // pintarComisiones: headline totals and the ranking carry the same per-person amount.
    assert.match(r.txt, /Associates take\s*\$39\.99/);
    assert.match(r.txt, /Sales with commission\s*\$99\.99/);
    assert.match(r.ranking, /Belen[\s\S]*\$39\.99/);
    // Tenant isolation: nothing of B in the rendering or rows.
    assert.doesNotMatch(r.txt, /Zelda|Omega/);
    assert.doesNotMatch(JSON.stringify(r.porPersona) + JSON.stringify(r.porPercha), /Zelda|Omega/);
    assert.ok(B.liquidaciones.some(l => l.asociadoNombre === 'Zelda'), 'sanity: tenant B really has its own commission data');
  } finally { await web.close(); }
});
