const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sw = fs.readFileSync(path.join(__dirname, '../../docs/sw.js'), 'utf8');
test('SW installation awaits manifest verification before skipWaiting', () => {
  const start = sw.indexOf('/* VERIFICACIÓN SRI-STYLE');
  const end = sw.indexOf('}).then(() => self.skipWaiting()', start);
  assert.ok(start > 0 && end > start, 'integrity chain precedes activation');
  const chain = sw.slice(start, end);
  assert.match(chain, /return caches\.open\(CACHE_LOCAL\)/);
  assert.match(chain, /return res\.json\(\)\.then/);
  assert.match(chain, /return Promise\.allSettled\(promesas\)/);
  assert.doesNotMatch(chain, /cache\.delete\(rel\)/, 'keep fail-open existing shell');
});
