const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('hexagonal boundary: photo domain/application contain no browser or storage infrastructure', () => {
  const files = [
    'docs/core/shelf-photo-policy.js',
    'docs/application/recover-shelf-photo.js'
  ];
  const forbidden = [
    /\bwindow\b/, /\bdocument\b/, /\bfetch\s*\(/, /\bindexedDB\b/,
    /\blocalStorage\b/, /\bsessionStorage\b/, /\bWebSocket\b/,
    /\bOCFotos\b/, /\bOCYjs\b/, /\bcaches\b/
  ];
  for (const file of files) {
    // Architecture comments may NAME forbidden technologies to document the rule.
    // Enforcement applies to executable source, not prose.
    const src = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const re of forbidden) {
      assert.doesNotMatch(src, re, file + ' imports infrastructure into the core/application boundary: ' + re);
    }
  }
});

test('hexagonal boundary: UI adapter depends inward on application use case and load order is explicit', () => {
  const index = read('docs/index.html');
  const vista = read('docs/vista-perchas.js');
  const iCore = index.indexOf('./core/shelf-photo-policy.js');
  const iApp = index.indexOf('./application/recover-shelf-photo.js');
  const iVista = index.indexOf('./vista-perchas.js');
  assert.ok(iCore >= 0 && iApp > iCore && iVista > iApp, 'domain -> application -> adapter load order');
  assert.match(vista, /F123Application\.recoverShelfPhoto/);
  assert.match(vista, /const ports = \{/);
});

test('hexagonal boundary: service worker pins the new domain/application files offline', () => {
  const sw = read('docs/sw.js');
  assert.match(sw, /"\.\/core\/shelf-photo-policy\.js"/);
  assert.match(sw, /"\.\/application\/recover-shelf-photo\.js"/);
});
