const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync(require('node:path').join(__dirname, 'safari-lifecycle-probe.js'), 'utf8');
test('probe records lifecycle but never writes storage or network', () => {
  const listeners = new Map(), swListeners = new Map(), logs = [];
  const window = { addEventListener: (k, f) => listeners.set(k, f) };
  const navigator = { serviceWorker: { controller: {}, addEventListener: (k, f) => swListeners.set(k, f) } };
  const document = { visibilityState: 'visible', addEventListener: (k, f) => listeners.set(k, f) };
  const sandbox = { window, navigator, document, performance: { now: () => 123, getEntriesByType: () => [{type:'navigate'}] }, console: { info: (...x) => logs.push(x) } };
  vm.runInNewContext(src, sandbox);
  listeners.get('pagehide')({ persisted: true });
  swListeners.get('controllerchange')();
  assert.deepEqual(window.__f123SafariProbe.snapshot().map(x => x.type), ['probe-installed', 'pagehide', 'controllerchange']);
  assert.equal(window.__f123SafariProbe.snapshot()[1].persisted, true);
  assert.equal(logs.length, 3);
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|fetch\(|sendBeacon|XMLHttpRequest/);
});
