'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sw = fs.readFileSync(path.join(__dirname, '../docs/sw.js'), 'utf8');

test('SW installation awaits bounded manifest verification before skipWaiting', () => {
  const start = sw.indexOf('/* VERIFICACIÓN SRI-STYLE');
  const end = sw.indexOf('}).then(() => {', start);
  assert.ok(start > 0 && end > start, 'integrity chain precedes activation');
  const chain = sw.slice(start, end);
  const activation = sw.slice(end, sw.indexOf('}).catch((e)', end));
  assert.match(activation, /if \(sriEssentialFailures\.size\) throw new Error/);
  assert.ok(activation.indexOf('sriEssentialFailures.size') < activation.indexOf('self.skipWaiting()'),
    'SRI fail-closed essential gate must run before activation');
  assert.match(chain, /return caches\.open\(CACHE_LOCAL\)/);
  assert.match(chain, /return res\.json\(\)\.then/);
  assert.match(chain, /return Promise\.allSettled\(workers\)/);
  assert.match(chain, /return cache\.put\(rel, fresca\)/, 'retain verified replacement behavior');
});
