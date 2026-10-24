'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../cloudflare-worker/worker.js'), 'utf8');
const start = source.indexOf('const MEDIOS_PAGO = '), end = source.indexOf('/* ===== SONAR', start);
assert.ok(start > 0 && end > start, 'load actual published payment handler');
async function pay(body) {
  const rows = new Map([['inst:fixture', JSON.stringify({ licenseCode: 'FIXTURE' })]]);
  const env = { LICENCIAS: { get: async k => rows.get(k), put: async (k,v) => { rows.set(k,v); } } };
  const ctx = { json: (obj,status=200) => ({obj,status}), requireMasterKey: () => true,
    normCodigoLic: v => v, trozoAleatorio: () => 'FIXT', guardarConHistorial: async () => {} };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start,end) + '\nthis.pay=handleRegistrarPago;', ctx);
  return {response: await ctx.pay({json: async () => body}, env, 'fixture'), rows};
}
test('impossible payment and coverage dates reject without KV writes', async () => {
  for (const body of [{monto:10,fecha:'2026-99-99'}, {monto:10,fecha:'2026-02-30'},
    {monto:10,fecha:'2025-02-29'}, {monto:10,hasta:'2026-04-31'}]) {
    const x=await pay(body); assert.equal(x.response.status,400,JSON.stringify(body));
    assert.equal(x.rows.has('pagos:FIXTURE'),false);
  }
});
test('a sub-cent amount cannot be recorded as zero', async () => {
  for (const monto of [0.004,-0.004]) {
    const x=await pay({monto,fecha:'2026-10-24'});
    assert.equal(x.response.status,400); assert.equal(x.rows.has('pagos:FIXTURE'),false);
  }
});
test('real dates and nonzero cents remain valid, corrections stay negative', async () => {
  for (const [monto, expected] of [[2.35,2.35],[-2.35,-2.35],[0.005,0.01]]) {
    const x=await pay({monto,fecha:'2024-02-29',hasta:'2031-10-24'});
    assert.equal(x.response.status,200); assert.equal(x.response.obj.asiento.monto,expected);
    assert.equal(JSON.parse(x.rows.get('pagos:FIXTURE'))[0].monto,expected);
  }
});