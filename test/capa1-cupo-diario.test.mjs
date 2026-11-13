// capa1: the daily budget closes the layer before the account can saturate (JFC 13 nov 2026: «NO PUEDE SATURARSE»).
// Runs the REAL CupoDiario class from cloudflare-relay-capa1/worker.js with an in-memory storage. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CupoDiario } from '../cloudflare-relay-capa1/worker.js';

function cupo() {
  const m = new Map();
  const o = new CupoDiario({ storage: { get: async k => m.get(k), put: async (k, v) => { m.set(k, v); } } });
  return { m, add: async d => (await o.fetch(new Request('https://x/', { method: 'POST', body: JSON.stringify(d) }))).json() };
}

test('under the caps the layer stays open', async () => {
  const c = cupo();
  const r = await c.add({ req: 1, w: 10, r: 100 });
  assert.equal(r.lleno, false);
});

test('each cap closes the layer once passed', async () => {
  for (const [campo, tope] of [['req', 30000], ['w', 30000], ['r', 1500000]]) {
    const c = cupo();
    assert.equal((await c.add({ [campo]: tope })).lleno, false, campo + ' at the cap');
    assert.equal((await c.add({ [campo]: 1 })).lleno, true, campo + ' past the cap');
  }
});

test('the counter calls themselves are capped too (Durable Object requests)', async () => {
  const c = cupo();
  c.m.set('c', { dia: new Date().toISOString().slice(0, 10), req: 0, w: 0, r: 0, q: 30000 });
  assert.equal((await c.add({})).lleno, true);
});

test('a new UTC day starts from zero', async () => {
  const c = cupo();
  c.m.set('c', { dia: '2000-01-01', req: 99999, w: 99999, r: 9999999, q: 99999 });
  assert.equal((await c.add({ req: 1 })).lleno, false);
});
