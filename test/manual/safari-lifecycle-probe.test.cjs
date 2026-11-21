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
  assert.deepEqual(Array.from(window.__f123SafariProbe.snapshot(), x => x.type), ['probe-installed', 'pagehide', 'controllerchange']);
  assert.equal(window.__f123SafariProbe.snapshot()[1].persisted, true);
  assert.equal(logs.length, 3);
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|fetch\(|sendBeacon|XMLHttpRequest/);
});


test('adversarial error messages cannot leak PIN, license, customer URLs or stack into snapshot and console', () => {
  const listeners = new Map(), logs = [];
  const window = { addEventListener: (k, f) => listeners.set(k, f) };
  const navigator = {};
  const document = { visibilityState: 'visible', addEventListener: () => {} };
  const sandbox = { window, navigator, document, performance: { now: () => 2, getEntriesByType: () => [] }, console: { info: (...x) => logs.push(x) } };
  vm.runInNewContext(src, sandbox);
  const sensitive = 'https://example.invalid/login?license=SECRET&pin=123456&customer=Sensitive';
  listeners.get('error')({ message: sensitive, error: { name: 'TypeError', stack: sensitive } });
  listeners.get('error')({ message: sensitive, error: { name: sensitive } });
  const events = JSON.stringify(window.__f123SafariProbe.snapshot());
  const log = JSON.stringify(logs);
  for (const raw of ['SECRET', '123456', 'Sensitive', 'example.invalid', 'license=', 'pin=']) {
    assert.equal(events.includes(raw), false, 'private data must never enter memory probe: ' + raw);
    assert.equal(log.includes(raw), false, 'private data must never be logged: ' + raw);
  }
  assert.equal(window.__f123SafariProbe.snapshot()[1].category, 'TypeError');
  assert.equal(window.__f123SafariProbe.snapshot()[2].category, 'other');
});
