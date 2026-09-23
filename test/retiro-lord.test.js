/* v358 — #14 (JFC 2026-09-23): retiro del lord. Un aparato de JFC es uno más
   de su licencia principal. Fixtures sintéticos (licencias ficticias). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
function ls(init) {
  const m = new Map(Object.entries(init));
  return { get length() { return m.size; }, key: i => [...m.keys()][i], getItem: k => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const CAN = 'F123-SYNT-MAIN-0000-00001', OTRA = 'F123-SYNT-OTRA-0000-00002';

test('a marked JFC device is aligned to his main license, keeps a copy, and loses the mark', () => {
  const s = ls({ f123_lord: '1', f123_lord_licencia_canonica: CAN, f123_notebook_unificado_v2: '1',
    f123_owned: JSON.stringify({ instanceId: 'fixture-jfc', licenseCode: OTRA, syncCode: OTRA }) });
  const w = browser(s);
  const o = JSON.parse(s.getItem('f123_owned'));
  assert.equal(o.licenseCode, CAN); assert.equal(o.syncCode, CAN);
  assert.equal(JSON.parse(s.getItem('f123_owned_pre_lord_v1')).licenseCode, OTRA, 'copia de la anterior');
  assert.equal(s.getItem('f123_lord'), null, 'la marca se retira');
  assert.equal(w.OCTienda.licenciaActual(), CAN);
});

test('a customer device (never marked) is not touched', () => {
  const owned = JSON.stringify({ instanceId: 'fixture-cliente', licenseCode: OTRA });
  const s = ls({ f123_owned: owned, f123_notebook_unificado_v2: '1' });
  browser(s);
  assert.equal(s.getItem('f123_owned'), owned);
  assert.equal(s.getItem('f123_owned_pre_lord_v1'), null);
});
