// Contract tests for the independently deployed official friendly123.com Worker.
// No network, no Cloudflare API and no business/client data involved.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', 'sitio-friendly123');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const builder = read('build-cloud.mjs');
const sourceBuilder = read('build.mjs');
const wrangler = read('wrangler.jsonc');
const locked = read('website-source-lock.sha').trim();

test('friendly123-com never deploys a master, next, or stale stable checkout', () => {
  assert.match(builder, /refs\/heads\/estable/);
  assert.match(builder, /source !== remoteStable/);
  assert.match(builder, /latestStable !== source/);
  assert.match(builder, /fail\('checkout is not the current origin\/estable/);
});

test('marketing pages are pinned, not silently overwritten by website main', () => {
  assert.match(locked, /^[a-f\d]{40}$/);
  assert.match(builder, /website-source-lock\.sha/);
  assert.match(builder, /process\.env\.SITE_REF = websiteSha/);
  assert.match(sourceBuilder, /process\.env\.SITE_REF \|\| "origin\/main"/);
});

test('all committed PWA shell hashes are verified before SEO-only rewrites', () => {
  assert.match(builder, /sourceManifest\.files/);
  assert.match(builder, /sha\(join\(repo, 'docs', path\)\) !== expected/);
  assert.match(builder, /new Set\(\['\.\/index\.html', '\.\/manual\.html', '\.\/save\.html'\]\)/);
  assert.match(builder, /if \(!rewrites\.has\(rel\)\) fail/);
  assert.match(builder, /version\.cacheGeneration !== sourceVersion\.cacheGeneration/);
  assert.match(builder, /_release\.json/);
});

test('optional WebP does not cause missing old landing poster', () => {
  assert.match(sourceBuilder, /if \(sharp\) h = h\.replace/);
  assert.match(sourceBuilder, /if \(sharp\) raiz = raiz\.replace/);
});

test('Wrangler deploy target is static-only friendly123-com, not another Worker', () => {
  assert.match(wrangler, /"name": "friendly123-com"/);
  assert.match(wrangler, /"directory": "\.\/dist"/);
  assert.match(wrangler, /"html_handling": "none"/);
  assert.match(wrangler, /"pattern": "friendly123\.com"/);
  assert.doesNotMatch(wrangler, /"kv_namespaces"|"d1_databases"|"services"|"queues"/);
});

test('publication procedure maintains same-origin storage and protects live clients', () => {
  const doc = read('AUTO-DEPLOY.md');
  assert.match(doc, /Production branch: \*\*\`estable\`\*\*/);
  assert.match(doc, /indexe?dDB|IndexedDB/i);
  assert.match(doc, /rollback/i);
  assert.match(doc, /WebKit/);
  assert.match(doc, /NO CONECTADO A PRODUCCION/);
});
