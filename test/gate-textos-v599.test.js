// v599: textos del candado en ES, teclado sin emoji, etiqueta "Join a shared notebook".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const docs = path.join(__dirname, '../docs');
const auth = fs.readFileSync(path.join(docs, 'auth-ui.js'), 'utf8');
const i18nSrc = fs.readFileSync(path.join(docs, 'i18n.js'), 'utf8');

function cargarI18n(navLang, previo) {
  const store = Object.assign({}, previo || {});
  const win = { addEventListener() {}, dispatchEvent() {}, CustomEvent: function () {} };
  const ctx = {
    window: win, navigator: { language: navLang }, CustomEvent: function () {},
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; },
      get length() { return Object.keys(store).length; }, key: i => Object.keys(store)[i] ?? null },
    document: { addEventListener() {}, documentElement: {}, querySelectorAll: () => [], querySelector: () => null },
  };
  vm.createContext(ctx);
  vm.runInContext(i18nSrc, ctx);
  return ctx.window.OCI18n;
}

test('ES: textos del candado, de la bifurcacion y de la activacion estan en espanol', () => {
  const i = cargarI18n('en-US');
  i.setLang('es');
  const claves = ['auth.gate.subtitle', 'auth.gate.joinTeam', 'auth.gate.tryTitle', 'auth.gate.clear', 'auth.gate.forgot',
    'auth.choice.title', 'auth.choice.newBtn', 'auth.choice.otherBtn', 'auth.choice.never',
    'auth.act.confirmBtn', 'auth.act.cancelBtn', 'auth.act.enterBtn'];
  for (const k of claves) assert.notEqual(i.t(k), i.DICT.en[k], k + ' sigue en ingles');
  assert.equal(i.t('auth.gate.joinTeam'), 'Unirme a un cuaderno compartido');
});

test('navegador es-EC sin eleccion guardada arranca en ES', () => {
  assert.equal(cargarI18n('es-EC').getLang(), 'es');
  assert.equal(cargarI18n('en-US').getLang(), 'en');
});

test('aparato con cuaderno previo y sin eleccion guardada sigue en EN aunque el navegador sea es-EC', () => {
  assert.equal(cargarI18n('es-EC', { f123_owned: '{}' }).getLang(), 'en');
  assert.equal(cargarI18n('en-US', { f123_lang: 'es' }).getLang(), 'es', 'la eleccion guardada siempre gana');
});

test('EN: etiqueta "Join a shared notebook" y sin jerga', () => {
  const i = cargarI18n('en-US');
  assert.equal(i.t('auth.gate.joinTeam'), 'Join a shared notebook');
  assert.equal(i.t('auth.join.title'), 'Join a shared notebook');
  assert.doesNotMatch(i.t('auth.gate.tryCodes'), /instance/i);
  assert.doesNotMatch(i.t('auth.act.dataPromise'), /program license/i);
});

test('teclado del PIN: solo digito, sin emoji', () => {
  assert.doesNotMatch(auth, /class="emo"/);
  assert.match(auth, /b\.innerHTML = `<span class="dig">\$\{d\}<\/span>`;/);
});
