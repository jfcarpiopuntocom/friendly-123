'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../cloudflare-worker/worker.js'), 'utf8');
const start = source.indexOf('const MEDIOS_PAGO = '), end = source.indexOf('/* ===== SONAR', start);
assert.ok(start > 0 && end > start, 'load actual published payment handler');
async function pay(body) {
  const rows = new Map([['inst:fixture', JSON.stringify({ licenseCode: 'FIXTURE' })]]);
  const writes = [];
  const env = { LICENCIAS: { get: async k => rows.get(k), put: async (k,v) => { writes.push(k); rows.set(k,v); } } };
  const ctx = { json: (obj,status=200) => ({obj,status}), requireMasterKey: () => true,
    normCodigoLic: v => v, trozoAleatorio: () => 'FIXT', guardarConHistorial: async () => { writes.push('history'); } };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start,end) + '\nthis.pay=handleRegistrarPago;', ctx);
  return {response: await ctx.pay({json: async () => body}, env, 'fixture'), rows, writes};
}
test('impossible payment and coverage dates reject without KV writes', async () => {
  for (const body of [{monto:10,fecha:'2026-99-99'}, {monto:10,fecha:'2026-02-30'},
    {monto:10,fecha:'2025-02-29'}, {monto:10,hasta:'2026-04-31'},
    {monto:10,fecha:0}, {monto:10,fecha:false}, {monto:10,hasta:0},
    {monto:10,hasta:false}, {monto:10,fecha:null}, {monto:10,hasta:null},
    {monto:10,fecha:['2024-02-29']}, {monto:10,hasta:['2024-02-29']}]) {
    const x=await pay(body); assert.equal(x.response.status,400,JSON.stringify(body));
    assert.deepEqual(x.writes, [], JSON.stringify(body));
  }
});
test('a sub-cent amount cannot be recorded as zero', async () => {
  for (const monto of [0.004,-0.004]) {
    const x=await pay({monto,fecha:'2026-10-24'});
    assert.equal(x.response.status,400); assert.deepEqual(x.writes, []);
  }
});
test('real dates and nonzero cents remain valid, corrections stay negative', async () => {
  for (const [monto, expected] of [[2.35,2.35],[-2.35,-2.35],[0.005,0.01],[1.005,1.01],[-1.005,-1.01],[1.015,1.02]]) {
    const x=await pay({monto,fecha:'2024-02-29',hasta:'2031-10-24'});
    assert.equal(x.response.status,200); assert.equal(x.response.obj.asiento.monto,expected);
    assert.equal(JSON.parse(x.rows.get('pagos:FIXTURE'))[0].monto,expected);
  }
});
test('blank optional dates retain panel form defaults', async () => {
  const x=await pay({monto:1,fecha:'',hasta:''});
  assert.equal(x.response.status,200);
  assert.match(x.response.obj.asiento.fecha, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(x.response.obj.asiento.hasta,null);
});
