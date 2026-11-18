'use strict';
// RED->GREEN: actual sync-yjs.js lifecycle block; synthetic DOM events only.
// No browser launched and no network, PIN, license or real user data.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8').replace(/\r\n/g, '\n');
const begin = source.indexOf('    function sincronizarVisibilidad() {');
const end = source.indexOf('    API.canal.conectar();', begin);
assert.ok(begin >= 0 && end > begin, 'real Yjs lifecycle block must remain detectable');
const actualLifecycle = source.slice(begin, end);

function fixture() {
  const events = [];
  const dom = Object.create(null), win = Object.create(null);
  const channel = name => ({
    pausar() { events.push(name + ':pause'); },
    reanudar() { events.push(name + ':resume'); }
  });
  const API = {
    canal: channel('catalogo'),
    fotosCanal: channel('fotos'),
    opsCanal: channel('ops')
  };
  const document = {hidden: false, addEventListener(name, fn) {
    (dom[name] ||= []).push(fn);
  }};
  const window = {addEventListener(name, fn) {
    (win[name] ||= []).push(fn);
  }};
  vm.runInNewContext(actualLifecycle, {
    document, window, API
  });
  return {
    events, document,
    listeners: {dom, win},
    fire(target, name, payload) {
      for (const listener of (target === 'window' ? win[name] : dom[name]) || []) listener(payload);
    }
  };
}

test('BFCache pageshow.persisted reconnects all three real Yjs channels, not only catalog', () => {
  const f = fixture();
  assert.equal(f.listeners.win.pageshow?.length, 1, 'iPhone Safari BFCache restore must have an explicit handler');
  f.fire('window', 'pageshow', {persisted: true});
  assert.deepEqual(f.events, [
    'catalogo:pause', 'fotos:pause', 'ops:pause',
    'catalogo:resume', 'fotos:resume', 'ops:resume'
  ], 'replace stale sockets before restarting without touching durable queues');
});

test('ordinary pageshow must not force reconnect or a second socket', () => {
  const f = fixture();
  f.fire('window', 'pageshow', {persisted: false});
  assert.deepEqual(f.events, []);
});

test('hidden BFCache page must not reconnect Yjs', () => {
  const f = fixture();
  f.document.hidden = true;
  f.fire('window', 'pageshow', {persisted: true});
  assert.deepEqual(f.events, []);
});

test('existing visibilitychange background/foreground behavior remains intact', () => {
  const f = fixture();
  f.document.hidden = true;
  f.fire('document', 'visibilitychange');
  assert.deepEqual(f.events, ['catalogo:pause','fotos:pause','ops:pause']);
  f.document.hidden = false;
  f.fire('document', 'visibilitychange');
  assert.deepEqual(f.events.slice(3), ['catalogo:resume','fotos:resume','ops:resume']);
});

test('tab-session change continues using the same fail-closed visibility guard', () => {
  const f = fixture();
  f.document.hidden = true;
  f.fire('window', 'oc-tab-session-changed');
  assert.deepEqual(f.events, ['catalogo:pause','fotos:pause','ops:pause']);
});
