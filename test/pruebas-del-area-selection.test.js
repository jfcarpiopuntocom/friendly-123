'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const selector = path.resolve(__dirname, '../scripts/pruebas-del-area.cjs');

test('fast-track selection detects financial and license changes inside large files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-area-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const write = (p, v) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), v); };
  try {
    git('init', '-q');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'user.name', 'Synthetic Fixture');
    for (const filename of ['flecha-comision-v521.test.js', 'flecha-comision-ui-v521.test.js',
      'fiado-durable-venta-v519.test.js', 'demo-history-isolation.test.js']) {
      write('test/' + filename, '// synthetic test fixture only\n');
    }
    write('docs/index.html', '<body>unchanged</body>\n');
    write('docs/auth-ui.js', '// fixture auth\n');
    git('add', '.'); git('commit', '-qm', 'baseline');
    const before = git('rev-parse', 'HEAD');
    write('docs/index.html', '<body>direccionComision = asociadoPaga</body>\n');
    git('add', '.'); git('commit', '-qm', 'commissions');
    const commissionHead = git('rev-parse', 'HEAD');
    let selected = execFileSync(process.execPath, [selector, before, commissionHead], { cwd: dir, encoding: 'utf8' });
    assert.match(selected, /test\/flecha-comision-v521\.test\.js/);
    assert.match(selected, /test\/flecha-comision-ui-v521\.test\.js/);
    assert.doesNotMatch(selected, /test\/fiado-durable-venta-v519\.test\.js/);
    write('docs/auth-ui.js', 'const owned = localStorage.getItem("f123_owned");\n');
    git('add', '.'); git('commit', '-qm', 'license guard');
    selected = execFileSync(process.execPath, [selector, commissionHead, git('rev-parse', 'HEAD')], { cwd: dir, encoding: 'utf8' });
    assert.match(selected, /test\/demo-history-isolation\.test\.js/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
