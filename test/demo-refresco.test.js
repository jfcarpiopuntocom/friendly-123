/* Refresco del demo (JFC 2026-09-24, shell 375). Un visitante que vuelve con la
   semilla VIEJA guardada recibe la nueva una vez. Un negocio real (aparato
   activado) o un estado sin ventas semilla JAMAS se toca. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function demoViejo(extra) {
  const a = browser();
  const b = await a.request('/api/respaldo/exportar');
  b.ventas.forEach(v => { v.split = null; });              // asi era la semilla antes de v372
  if (extra) extra(b);
  await a.request('/api/respaldo/importar', 'POST', b);
  a.localStorage.setItem('f123_demo_seed_v', '0');
  return a.localStorage;
}
const conSplit = async (app) => (await app.request('/api/respaldo/exportar')).ventas.filter(v => v.split).length;

test('a returning demo visitor gets the new seed once', async () => {
  const ls = await demoViejo();
  const b = browser(ls);
  assert.ok(await conSplit(b) >= 10, 'el demo viejo vuelve con comisiones');
  assert.equal(ls.getItem('f123_demo_seed_v'), '375');
});

test('an activated device is never refreshed', async () => {
  const ls = await demoViejo();
  ls.setItem('f123_owned', JSON.stringify({ instanceId: 'fixture' }));
  const b = browser(ls);
  assert.equal(await conSplit(b), 0, 'un aparato activado conserva lo suyo');
});

test('saved state without demo seed sales is never refreshed', async () => {
  const ls = await demoViejo(b => { b.ventas = b.ventas.map(v => ({ ...v, id: 'real-' + v.id })); });
  const b = browser(ls);
  assert.equal(await conSplit(b), 0, 'sin ventas vs- no se toca');
});
