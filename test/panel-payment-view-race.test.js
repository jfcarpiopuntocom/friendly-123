const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../docs/panel.html'), 'utf8');
const start = source.indexOf('/* ── PAGOS (asientos append-only por licencia)');
const end = source.indexOf('/* ── LOTES', start);
assert(start > 0 && end > start);

function panel() {
  const nodes = new Map(), calls = [], timers = [];
  let reindexed = 0, focused = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', innerHTML: '', disabled: false,
      style: { display: 'none' }, focus: () => focused++ });
    return nodes.get(id);
  };
  const records = [{ instanceId: 'synthetic-a', licenseCode: 'fixture-a' },
    { instanceId: 'synthetic-b', licenseCode: 'fixture-b' }];
  const context = vm.createContext({
    _licData: records, document: { getElementById: node },
    licWorkerUrl: () => 'https://invalid.example', licMasterKey: () => 'synthetic-not-a-key',
    licEsc: value => String(value ?? ''), mostrarConfirmacion: () => {},
    licReindexar: () => reindexed++, setTimeout: callback => timers.push(callback),
    fetch: (url, options) => new Promise((resolve, reject) => calls.push({ url, options, resolve, reject })),
  });
  vm.runInContext(source.match(/^let _licIndice[^\n]+/m)[0] + '\n' + source.slice(start, end), context);
  return { context, node, calls, records, timers, reindexed: () => reindexed, focused: () => focused,
    open: iid => context.licAbrirPago(iid), close: () => context.licCerrarPago(),
    load: iid => context.licVerPagos(iid, true), save: () => context.licGuardarPago() };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const payment = monto => ({ monto, moneda: 'USD', fecha: '2026-10-24', medio: 'synthetic' });
async function reply(call, body, ok = true) { call.resolve({ ok, status: ok ? 200 : 503, json: async () => body }); await tick(); }
const history = h => h.node('lic-pago-historial').innerHTML;

for (const kind of ['success', 'empty', 'failure']) test(`late ${kind} for A preserves B history`, async () => {
  const h = panel(); h.open('synthetic-a'); h.open('synthetic-b');
  await reply(h.calls[1], { pagos: [payment(22)] });
  const before = history(h);
  if (kind === 'failure') { h.calls[0].reject(new Error('synthetic-network')); await tick(); }
  else await reply(h.calls[0], { pagos: kind === 'empty' ? [] : [payment(11)] });
  assert.equal(history(h), before);
});

test('latest read wins within the same license', async () => {
  const h = panel(); h.open('synthetic-a'); const fresh = h.load('synthetic-a');
  await reply(h.calls[1], { pagos: [payment(22)] }); await fresh;
  const before = history(h); await reply(h.calls[0], { pagos: [payment(11)] });
  assert.equal(history(h), before);
});

test('selection changing while JSON is pending also preserves the selected history', async () => {
  const h = panel(); h.open('synthetic-a'); let finishJson;
  h.calls[0].resolve({ ok: true, json: () => new Promise(resolve => { finishJson = resolve; }) });
  await tick(); h.open('synthetic-b'); await reply(h.calls[1], { pagos: [payment(22)] });
  const before = history(h); finishJson({ pagos: [payment(11)] }); await tick();
  assert.equal(history(h), before);
});

test('closing invalidates reads and delayed focus, including reopening the same license', async () => {
  const h = panel(); h.open('synthetic-a'); h.close();
  const before = history(h); await reply(h.calls[0], { pagos: [payment(11)] });
  assert.equal(history(h), before); h.timers[0](); assert.equal(h.focused(), 0);
  h.open('synthetic-a'); h.close(); h.open('synthetic-a');
  await reply(h.calls[2], { pagos: [payment(33)] });
  const reopened = history(h); await reply(h.calls[1], { pagos: [] });
  assert.equal(history(h), reopened);
});

async function saving() {
  const h = panel(); h.open('synthetic-a'); await reply(h.calls[0], { pagos: [] });
  h.node('lic-pago-monto').value = '-12.50'; h.node('lic-pago-moneda').value = 'USD';
  h.node('lic-pago-medio').value = 'synthetic';
  const done = h.save();
  assert.equal(JSON.parse(h.calls[1].options.body).monto, -12.5);
  assert.equal(h.calls[1].options.method, 'POST');
  return { h, done };
}

test('late saved payment updates A but preserves B draft, message and license restriction', async () => {
  const { h, done } = await saving(); h.records[1].licenseCode = ''; h.open('synthetic-b');
  await reply(h.calls[2], { pagos: [payment(22)] });
  h.node('lic-pago-monto').value = '42';
  const before = history(h), msg = h.node('lic-pago-msg').textContent;
  await reply(h.calls[1], { resumen: { total: 12.5, moneda: 'USD', n: 1 } }); await done;
  assert.equal(h.records[0].pagoResumen.total, 12.5); assert.equal(h.records[0].estado, 'full');
  assert.equal(h.reindexed(), 1); assert.equal(h.node('lic-pago-monto').value, '42');
  assert.equal(h.node('lic-pago-msg').textContent, msg); assert.equal(history(h), before);
  assert.equal(h.node('lic-pago-guardar').disabled, true); assert.equal(h.calls.length, 3);
});

test('late failed payment cannot replace B status or enable its disabled button', async () => {
  const { h, done } = await saving(); h.records[1].licenseCode = ''; h.open('synthetic-b');
  const before = h.node('lic-pago-msg').textContent;
  await reply(h.calls[1], { error: 'synthetic-rejection' }, false); await done;
  assert.equal(h.node('lic-pago-msg').textContent, before);
  assert.equal(h.node('lic-pago-guardar').disabled, true); assert.equal(h.reindexed(), 0);
});

test('old save refreshes reopened same-license history while preserving its new draft', async () => {
  const { h, done } = await saving(); h.close(); h.open('synthetic-a');
  await reply(h.calls[2], { pagos: [] });
  h.node('lic-pago-monto').value = '42';
  await reply(h.calls[1], { resumen: { total: 12.5, moneda: 'USD', n: 1 } }); await done;
  assert.equal(h.node('lic-pago-monto').value, '42'); assert.equal(h.calls.length, 4);
  await reply(h.calls[3], { pagos: [payment(12.5)] });
  assert.match(history(h), /12\.50/); assert.equal(h.node('lic-pago-monto').value, '42');
});

test('current successful save preserves its normal confirmation and refresh', async () => {
  const { h, done } = await saving();
  await reply(h.calls[1], { resumen: { total: 12.5, moneda: 'USD', n: 1 } }); await done;
  assert.match(h.node('lic-pago-msg').textContent, /Asiento guardado/);
  assert.equal(h.node('lic-pago-monto').value, ''); assert.equal(h.node('lic-pago-guardar').disabled, false);
  await reply(h.calls[2], { pagos: [payment(12.5)] }); assert.match(history(h), /12\.50/);
});

test('current rejected save keeps draft and displays the rejection', async () => {
  const { h, done } = await saving();
  await reply(h.calls[1], { error: 'synthetic-rejection' }, false); await done;
  assert.equal(h.node('lic-pago-monto').value, '-12.50');
  assert.match(h.node('lic-pago-msg').textContent, /synthetic-rejection/);
  assert.equal(h.node('lic-pago-guardar').disabled, false); assert.equal(h.reindexed(), 0);
});

test('external open loads once and stale refresh does not invalidate the selected license', async () => {
  const h = panel(); h.context.licVerPagos('synthetic-a', false);
  assert.equal(h.calls.length, 1); h.open('synthetic-b');
  const pending = h.calls[1]; await h.load('synthetic-a'); assert.equal(h.calls.length, 2);
  await reply(pending, { pagos: [payment(22)] }); assert.match(history(h), /22\.00/);
});
