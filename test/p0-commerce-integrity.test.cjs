'use strict';
// P0 integridad comercial (Bloque 1, acciones 1-21). Solo datos sinteticos; sin red.
// Cubre el codigo real de docs/hechos.js, docs/cartera.js, docs/caja-chica.js, docs/plan-pagos-ui.js
// y src/app/app-inline-01.js (tarjeta de cliente). Navegador nativo: Chromium y WebKit con IndexedDB real.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium, webkit } = require('playwright');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const cartera = (() => { const w = {}; vm.runInNewContext(read('docs/cartera.js'), { window: w }); return w.AMG.Cartera; })();

const T0 = 1790000000000;
const fact = (id, tipo, monto, opId, ts, extra = {}) => ({ id, tipo, ts, datos: { clienteId: 'syn', monto, motivo: tipo, opId, ...extra } });
const fiadoSale = (id, extra = {}) => ({ id, clienteId: 'syn', fecha: '2026-11-25', cantidad: 1, precioUnit: 108, info: { formaPago: 'fiado', fiadoAtomico: true }, ...extra });

test('A01-A10: proyeccion de saldo conserva hechos y no colapsa obligaciones validas (acciones 7-9, 12-13)', () => {
  const charge = fact('a-1', 'cartera_cargo', 35, 'charge-x', T0), p = fact('a-2', 'cartera_abono', 10, 'customer-payment:same-0001', T0 + 1000);
  const q = fact('b-1', 'cartera_abono', 10, 'customer-payment:same-0001', T0 + 1000), q2 = fact('b-1', 'cartera_abono', 10, 'customer-payment:diff-0002', T0 + 1000);
  const nested = { ...q2, datos: { payload: q2.datos } };
  const v = fiadoSale('sale-synthetic'), c1 = fact('a-3', 'cartera_cargo', 108, 'sale-a', T0, { ventaId: v.id }), c2 = fact('b-2', 'cartera_cargo', 108, 'sale-b', T0 + 1, { ventaId: v.id });
  const cases = [
    ['A01 abono parcial 10 sobre 35 -> saldo 25', [charge, p], [], -25],
    ['A02 mismo opId, dos hechos legitimos -> un solo pago', [charge, p, q], [], -25],
    ['A03 opIds distintos, mismo valor -> dos pagos', [charge, p, q2], [], -15],
    ['A04 opIds distintos, plano y anidado -> dos pagos', [charge, p, nested], [], -15],
    ['A05 una venta, dos recibos -> un solo cargo', [c1, c2], [v], -108],
    ['A06 recibo no duplicado por venta atomica', [c1], [v], -108],
  ];
  for (const [name, fs_, vs, expected] of cases) {
    const before = JSON.stringify({ fs_, vs });
    assert.equal(cartera.calcularSaldo(fs_, 'syn', vs).saldo, expected, name);
    assert.equal(JSON.stringify({ fs_, vs }), before, name + ': ningun hecho ni venta se reescribe');
  }
  // A02 conserva ambas identidades: el segundo hecho sigue en la lista original (el alias solo se proyecta).
  assert.equal([charge, p, q].filter(h => h.datos.opId === 'customer-payment:same-0001').length, 2);
});

test('compras fiadas y abonos por consumo: asignacion duplicada no cambia el saldo (acciones 12, 17)', () => {
  const cs = [350, 1500, 10800, 1800, 300].map((n, i) => ({ id: 'c' + i, tipo: 'cartera_cargo', ts: Date.UTC(2026, 8, 22 + i), datos: { clienteId: 'syn', monto: n / 100, motivo: 'fixture ' + i } }));
  const pay = fact('p', 'cartera_abono', 39.5, 'customer-payment:synthetic-0001', Date.UTC(2026, 9, 6));
  const sales = [fiadoSale('sale-last', { fecha: '2026-11-25T21:12:42Z', precioUnit: 18 })];
  const alloc = { id: 'alloc', tipo: 'cartera_aplicacion', ts: Date.UTC(2026, 10, 25), datos: { clienteId: 'syn', abonoId: 'p', accion: 'aplicar', opId: 'customer-allocation:synthetic-0001', partes: [0, 1, 3, 4].map(i => ({ cargoKey: 'cargo:c' + i, monto: cs[i].datos.monto })) } };
  const unassigned = (r) => r.movimientos.filter(m => m.tipo === 'abono').reduce((n, m) => n + m.sinAsignar, 0);
  const base = cartera.calcularSaldo([...cs, pay], 'syn', sales);
  assert.equal(base.saldo, -126); assert.equal(unassigned(base), 39.5);
  const one = cartera.calcularSaldo([...cs, pay, alloc], 'syn', sales), two = cartera.calcularSaldo([...cs, pay, alloc, { ...alloc, id: 'alloc-replay' }], 'syn', sales);
  assert.equal(one.saldo, -126); assert.equal(unassigned(one), 0);
  assert.equal(two.saldo, -126); assert.equal(unassigned(two), 0);
});

test('fiado, efectivo, transferencia y cobros posteriores (acciones 15-17)', () => {
  const sale = (id, formaPago) => ({ id, clienteId: 'syn', fecha: '2026-11-25', cantidad: 1, precioUnit: 20, info: { formaPago } });
  const stock = { id: 's1', tipo: 'ajuste_stock:completado', ts: T0, datos: { productoId: 'p', delta: -3, motivo: 'conteo fisico' } };
  // Efectivo y transferencia no generan deuda; un ajuste fisico de inventario tampoco mueve dinero.
  assert.equal(cartera.calcularSaldo([stock], 'syn', [sale('e', 'efectivo'), sale('t', 'transferencia')]).saldo, 0);
  // Fiado: deuda; cobro posterior parcial y total.
  const cargo = fact('f1', 'cartera_cargo', 20, 'sale-fiado', T0, { ventaId: 'f' });
  const fiado = sale('f', 'fiado'); fiado.info.fiadoAtomico = true;
  assert.equal(cartera.calcularSaldo([cargo], 'syn', [fiado]).saldo, -20);
  assert.equal(cartera.calcularSaldo([cargo, stock], 'syn', [fiado]).saldo, -20, 'solo cambia inventario: el dinero no cambia');
  assert.equal(cartera.calcularSaldo([cargo, fact('a1', 'cartera_abono', 5, 'pay-1', T0 + 1)], 'syn', [fiado]).saldo, -15);
  assert.equal(cartera.calcularSaldo([cargo, fact('a1', 'cartera_abono', 5, 'pay-1', T0 + 1), fact('a2', 'cartera_abono', 15, 'pay-2', T0 + 2)], 'syn', [fiado]).saldo, 0);
});

test('reasignacion historica de cliente: contrato existente = no reescribir, saldo provisional fail-closed (accion 14)', () => {
  // Contrato (test/sale-credit-corrections-v489 y mock-backend _vistaCarteraConVinculos): la deuda historica
  // nunca se duplica ni se reasigna; una restauracion hacia OTRO cliente es ambigua y queda en revision.
  const charge = fact('c', 'cartera_cargo', 108, 'sale-old', T0, { clienteId: 'X', ventaId: 'old' });
  const sales = [fiadoSale('old', { clienteId: 'X', anulada: true }), fiadoSale('new', { clienteId: 'Y', restauracionDe: 'old' })];
  const before = JSON.stringify({ charge, sales });
  const r = cartera.calcularSaldo([charge], 'X', sales);
  assert.ok(r.conflictosIdentidadExperimental > 0);
  assert.equal(JSON.stringify({ charge, sales }), before);
  const vista = cartera.vistaCarteraSegunRol({ ...r, integridad: { ok: true } }, 'dueno');
  assert.equal(vista.saldoProvisional, true);
  assert.equal(vista.consumosPendientes.length, 0, 'no se ofrece cobrar consumos con identidad en conflicto');
});

// ---- navegador nativo -------------------------------------------------------------------------
const sources = ['docs/hechos.js', 'docs/cartera.js', 'docs/caja-chica.js'].map(read);
for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${engineName}: abort nativo, reintento con opId original, restauracion y reinicio (acciones 2-6, 9, 18)`, { timeout: 120000 }, async () => {
    let browser;
    try {
      browser = await engine.launch();
      const page = await browser.newPage();
      // Origen https sintetico servido por la propia prueba: IndexedDB real, cero red.
      const url = 'https://ledger.synthetic.test';
      await page.route('**/*', r => (r.request().url().startsWith(url + '/') ? r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>isolated synthetic ledger</title>' }) : r.abort()));
      await page.goto(url);
      await page.evaluate(() => { localStorage.setItem('f123_hechos_migrado_v1', '1'); localStorage.setItem('f123_owned', JSON.stringify({ instanceId: 'synthetic-device' })); });
      for (const content of sources) await page.addScriptTag({ content });
      const result = await page.evaluate(async () => {
        const H = AMG.Hechos, C = AMG.Cartera, K = AMG.CajaChica;
        const add = async (t, d) => { const h = await H.registrar('cartera_' + t, d); if (!h) throw Error('synthetic append failed'); return h; };
        const charge = (c, n, op, ventaId) => add('cargo', { clienteId: c, monto: n, opId: op, motivo: 'fixture', ...(ventaId ? { ventaId } : {}) });
        const pay = (c, op, nested = false) => { const d = { clienteId: c, monto: 10, opId: op, motivo: 'fixture' }; return add('abono', nested ? { payload: d } : d); };
        await charge('A02', 35, 'c02'); await pay('A02', 'p02'); await pay('A02', 'p02');
        await charge('A04', 35, 'c04'); await pay('A04', 'p04a'); await pay('A04', 'p04b', true);
        await charge('A05', 108, 'c05a', 'old'); await charge('A05', 108, 'c05b', 'new'); const p = await pay('A05', 'p05');
        const sales = [{ id: 'old', clienteId: 'A05', precioUnit: 108, cantidad: 1, anulada: true, info: { formaPago: 'fiado', fiadoAtomico: true } },
          { id: 'new', clienteId: 'A05', precioUnit: 108, cantidad: 1, restauracionDe: 'old', info: { formaPago: 'fiado', fiadoAtomico: true } }];
        const before = await H.todos();
        const base = ['A02', 'A04', 'A05'].map(c => C.calcularSaldo(before, c, sales).saldo);
        const r1 = await C.aplicarAbono('A05', p.id, [{ cargoKey: 'venta:new', monto: 10 }], sales, 'apply-05');
        const r2 = await C.aplicarAbono('A05', p.id, [{ cargoKey: 'venta:old', monto: 10 }], sales, 'apply-05');
        // Caja chica independiente: movimientos de cartera/inventario no crean ingreso de caja.
        const cajaAntes = (await K.saldoDePercha('shelf')).saldo;
        let abortCount = 0, abortNext = true; const original = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function (...args) { const req = original.apply(this, args); if (abortNext && this.name === 'hechos') { abortNext = false; const tx = this.transaction; req.addEventListener('success', () => { abortCount++; tx.abort(); }); } return req; };
        let rejected = null;
        try { await C.registrarMovimiento('abort', 'abono', 10, 'fixture', { opId: 'retry-original' }); } catch (e) { rejected = e && e.name; } finally { IDBObjectStore.prototype.add = original; }
        const afterAbort = await H.todos();
        const noFalseSuccess = afterAbort.filter(h => h.datos && h.datos.opId === 'retry-original').length; // 0: el abort no dejo un recibo
        const retry = await C.registrarMovimiento('abort', 'abono', 10, 'fixture', { opId: 'retry-original' });
        const replay = await C.registrarMovimiento('abort', 'abono', 10, 'fixture', { opId: 'retry-original' });
        const all = await H.todos(), after = C.calcularSaldo(all, 'A05', sales);
        return { base, applied: after.movimientos.find(m => m.tipo === 'cargo').aplicado, sameAllocation: r1.id === r2.id, storedKey: r1.datos.partes[0].cargoKey,
          abortCount, rejected, noFalseSuccess, samePayment: retry.id === replay.id, receipts: all.filter(h => h.datos.opId === 'retry-original').length, count: all.length,
          cajaAntes, cajaDespues: (await K.saldoDePercha('shelf')).saldo, sales };
      });
      assert.deepEqual(result.base, [-25, -15, -98]);
      assert.equal(result.applied, 10); assert.equal(result.sameAllocation, true); assert.equal(result.storedKey, 'venta:new');
      assert.equal(result.abortCount, 1); assert.ok(result.rejected, 'el abort rechaza el registro comercial (el AbortError de guardar() lo fija p0-fact-abort-recovery)'); assert.equal(result.noFalseSuccess, 0);
      assert.equal(result.samePayment, true); assert.equal(result.receipts, 1);
      assert.equal(result.cajaAntes, 0); assert.equal(result.cajaDespues, 0);
      await page.reload(); for (const content of sources) await page.addScriptTag({ content });
      const after = await page.evaluate(async (sales) => {
        const all = await AMG.Hechos.todos(); const a = AMG.Cartera.calcularSaldo(all, 'A05', sales);
        return { count: all.length, saldo: a.saldo, aplicado: a.movimientos.find(m => m.tipo === 'cargo').aplicado, abort: AMG.Cartera.calcularSaldo(all, 'abort', sales).saldo, caja: (await AMG.CajaChica.saldoDePercha('shelf')).saldo };
      }, result.sales);
      assert.deepEqual(after, { count: result.count, saldo: -98, aplicado: 10, abort: 10, caja: 0 });
    } finally { if (browser) await browser.close(); }
  });
}

// ---- estados comerciales visibles ES/EN (acciones 19-20) ----------------------------------------------
test('estados de cobro ES/EN: sin ACK falso y 409 conservado (acciones 19-20)', () => {
  const code = read('docs/plan-pagos-ui.js');
  const a = code.indexOf('      var errorAsignacion = function (e) {'), b = code.indexOf('\n      function finalizar()', a);
  assert.ok(a > 0 && b > a);
  const block = code.slice(a, b);
  const say = (es, pendienteAsignacion, e) => { const msg = { style: {} }; new Function('msg', 'es', 'pendienteAsignacion', 'e', block + '\nerrorAsignacion(e);')(msg, es, pendienteAsignacion, e); return msg.textContent; };
  const states = [
    ['unconfirmed', null, new Error('network'), 'Pago sin confirmar', 'Payment unconfirmed'],
    ['reference', null, { codigo: 'F123_REFERENCIA_PAGO_NO_GUARDADA' }, 'Referencia no guardada', 'Reference not saved'],
    ['confirmed', { abonoId: 'receipt' }, new Error('network'), 'Pago confirmado; asignación pendiente', 'Payment confirmed; allocation pending'],
    ['conflict-confirmed', { abonoId: 'receipt' }, { status: 409 }, 'Pago confirmado; asignación en conflicto', 'Payment confirmed; allocation conflict'],
    ['conflict-unknown', null, { status: 409 }, 'Conflicto de pago; recibo sin confirmar', 'Payment conflict; receipt unconfirmed'],
  ];
  for (const [name, pend, e, es, en] of states) {
    assert.ok(say(true, pend, e).startsWith(es), name + ' ES');
    assert.ok(say(false, pend, e).startsWith(en), name + ' EN');
  }
  // El estado "sin confirmar" nunca afirma que el cobro quedo registrado.
  assert.ok(!/confirmado/i.test(say(true, null, new Error('network'))) && !/confirmed/i.test(say(false, null, new Error('network')).replace(/unconfirmed/i, '')));
  // Los 409 de red conservan su estado HTTP para que la UI distinga conflicto de fallo (backend /abonar y /aplicar).
  assert.match(code, /e\.status = response\.status; throw e;/);
  assert.match(code, /e\.status = res\.status; throw e;/);
  // Saldo provisional: el modal no sugiere cobro ni afirma ACK.
  assert.match(code, /info\.saldoProvisional[\s\S]{0,260}Saldo pendiente de verificación[\s\S]{0,200}Balance pending verification/);
});

test('tarjeta de cliente: saldo provisional visible ES/EN sin afirmar liquidacion (accion 20)', async () => {
  const src = read('src/app/app-inline-01.js'), a = src.indexOf('async function pintarSaldoCartera(');
  assert.ok(a > 0);
  let depth = 0, i = src.indexOf('{', a), end = -1;
  for (let k = i; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) { end = k + 1; break; } }
  const fn = src.slice(a, end);
  for (const [locale, text] of [['es-EC', 'Saldo pendiente de verificar'], ['en-US', 'Balance pending verification']]) {
    const el = { __carteraLectura: 0, innerHTML: '' };
    const document = { getElementById: () => el };
    const info = { saldo: -25, saldoProvisional: true, historial: [], integridad: { ok: true } };
    const run = new Function('document', 'fetch', 'API', 'window', 'escHtml', 'argHtml', 't', 'fmtMoney', 'esDueno', fn + '\nreturn pintarSaldoCartera;')(
      document, async () => ({ json: async () => info }), '/api', { OCI18n: { locale: () => locale } }, (s) => String(s), (s) => JSON.stringify(String(s)), (k) => k, (n) => '$' + Number(n).toFixed(2), true);
    await run('c1');
    assert.ok(el.innerHTML.includes(text), locale + ': ' + el.innerHTML.slice(0, 200));
    assert.ok(!/Cuenta saldada|Account settled/.test(el.innerHTML), 'no afirma cuenta saldada');
  }
});

test('dashboard: exporta hechos financieros sin derivar saldos propios (accion 21)', () => {
  const dash = read('src/dashboard/dashboard-main.js');
  assert.ok(!/calcularSaldo|saldoDeCliente/.test(dash), 'el dashboard no recalcula cartera');
  assert.match(dash, /datos\.hechosFinancieros = rows\.filter\(function \(h\) \{ return \/\^\(cartera_\|caja_chica_\)\/\.test\(h\.tipo \|\| ""\); \}\);/);
  // docs/dashboard.html carga el mismo ledger de solo lectura; la paridad de bytes la fija build-dashboard-entry --check.
  assert.ok(read('docs/dashboard.html').includes('core/hechos-chain-readonly.js'));
});
