'use strict';
// Self-test for #434's READ-ONLY v585 release gate. Uses temporary fake docs only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const gate = fs.readFileSync(path.join(__dirname, 'ab-v585-shell-wiring-434-red.test.cjs'), 'utf8');
const digest = text => 'sha256-' + crypto.createHash('sha256').update(text).digest('hex');
const checked = ['estado-ab.js','index.html','dashboard.html','mock-backend.js','auth-ui.js','aislamiento.js'];
const fixture = {
  'estado-ab.js': '(function(){ function crear(){} window.OCEstadoAB = { crear }; })();',
  'index.html': '<script src="./estado-idb.js"></script>\n<script src="./estado-ab.js"></script>\n<script src="./mock-backend.js"></script>\n',
  'dashboard.html': '<script src="./estado-idb.js"></script>\n<script src="./estado-ab.js"></script>\n<script>function leerEstadoLocal(){}</script>\n',
  'sw.js': 'const SHELL = ["./index.html", "./estado-ab.js", "./estado-idb.js"];\nconst esenciales = new Set(["./index.html", "./estado-ab.js"]);',
  'mock-backend.js': '// fake application backend',
  'auth-ui.js': '// fake session UI',
  'aislamiento.js': '// fake localStorage shim',
  'version.json': JSON.stringify({releaseName:'v585',shell:'f123-shell-v585',cacheGeneration:'golden131'})
};
const cases = [
  ['valid', true],
  ['missing-helper', false],
  ['helper-only-essentials', false],
  ['commented-script', false],
  ['wrong-order', false],
  ['tampered-helper', false],
  ['duplicate-script', false],
  ['comment-only-export', false]
];
test('1AAA v585 release gate: one synthetic GREEN and seven rejected faults', async t => {
  for (const [name, shouldPass] of cases) {
    await t.test(name, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-v585-gate-'));
      try {
        const docs = path.join(root, 'docs'), tests = path.join(root, 'test');
        fs.mkdirSync(docs); fs.mkdirSync(tests);
        const files = {...fixture};
        if (name === 'missing-helper') delete files['estado-ab.js'];
        if (name === 'helper-only-essentials') {
          files['sw.js'] = files['sw.js'].replace('"./estado-ab.js", ', '');
        }
        if (name === 'commented-script') {
          files['index.html'] = files['index.html'].replace(
            '<script src="./estado-ab.js"></script>',
            '<!-- <script src="./estado-ab.js"></script> -->');
        }
        if (name === 'wrong-order') {
          files['dashboard.html'] = files['dashboard.html'].replace(
            '<script src="./estado-idb.js"></script>\n<script src="./estado-ab.js"></script>',
            '<script src="./estado-ab.js"></script>\n<script src="./estado-idb.js"></script>');
        }
        if (name === 'duplicate-script') {
          files['index.html'] = files['index.html'].replace(
            '<script src="./estado-ab.js"></script>',
            '<script src="./estado-ab.js"></script>\n<script src="./estado-ab.js"></script>');
        }
        if (name === 'comment-only-export') {
          files['estado-ab.js'] = '// window.OCEstadoAB = { crear };\nfunction crear(){}';
        }
        // Generate an honestly matching baseline manifest; mutate AFTER it
        // when testing tampering, so only integrity validation detects it.
        const manifest = {shell:'f123-shell-v585',files:{}};
        for (const file of checked) manifest.files['./' + file] = digest(files[file] || '');
        files['version-manifest.json'] = JSON.stringify(manifest);
        if (name === 'tampered-helper') files['estado-ab.js'] += '\n// altered after manifest';
        for (const [file, value] of Object.entries(files)) fs.writeFileSync(path.join(docs,file),value);
        const gatePath = path.join(tests,'ab-v585-shell-wiring-434-red.test.cjs');
        fs.writeFileSync(gatePath,gate);
        const env = {...process.env};
        delete env.NODE_TEST_CONTEXT; // child must execute, not inherit parent runner's test context
        const result = spawnSync(process.execPath, ['--test',gatePath], {encoding:'utf8',timeout:10000,env});
        assert.match(result.stdout || '',/TAP version|# tests/, 'child must actually execute tests');
        assert.equal(result.error,undefined,result.error && result.error.message);
        assert.equal(result.status,shouldPass?0:1,
          name+' must '+(shouldPass?'accept':'reject')+' fake inputs: '+(result.stdout||'').slice(-1000));
      } finally {
        fs.rmSync(root,{recursive:true,force:true});
      }
    });
  }
});
