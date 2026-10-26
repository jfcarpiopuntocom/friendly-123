#!/usr/bin/env node
// pruebas-del-area.cjs (JFC 2026-10-14, regla dura "hotfix a la velocidad de JFC").
// Elige SOLO las pruebas del area tocada entre dos commits:
//  - toda prueba test/*.test.js cambiada en el lote;
//  - toda prueba que nombra (por nombre de archivo) un archivo de docs/ cambiado.
// La suite completa la sigue corriendo release-control.yml en paralelo, como aviso.
// Uso: node scripts/pruebas-del-area.cjs <baseSha> <headSha>  -> imprime rutas, una por linea.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const sourceAreas = require('./test-source-areas.cjs');
function selectTests(cambios, root = process.cwd()) {
const exists = f => fs.existsSync(path.join(root, f));
const elegidas = new Set(cambios.filter(f => /^test\/[^/]+\.test\.(?:js|cjs)$/.test(f) && exists(f)));
for (const file of cambios) if (sourceAreas[file]) for (const test of sourceAreas[file]) {
  if (!exists(test)) throw Error(`Missing mapped regression: ${test}`);
  elegidas.add(test);
}
// version.json, sw.js y el manifiesto cambian en todo release: no sirven para elegir area.
// index.html, dashboard.html y mock-backend.js son gigantes: casi todas las pruebas los
// nombran, asi que elegir por ellos seria correr media suite. Para esos mandan las pruebas
// nuevas del propio arreglo (rojo-verde obligatorio) + el humo fijo de abajo.
const IGNORAR = new Set(['version.json', 'sw.js', 'version-manifest.json', 'index.html', 'dashboard.html', 'mock-backend.js', 'i18n.js']);
// Humo fijo: dinero de Today, Sold, tablero en telefono, fronteras y release. Siempre corre.
for (const t of ['test/business-read-model.test.js', 'test/auditoria-v506-montos-desconocidos.test.js', 'test/sales-audit-browser.test.js', 'test/dashboard-embed.test.js', 'test/architecture-hexagonal.test.js', 'test/release-control.test.js', 'test/cuadre-hugo-paco-luis.test.js', 'test/dashboard-identidad-version.test.js', 'test/fast-track-pipeline.test.js']) if (exists(t)) elegidas.add(t);
const nombres = cambios.filter(f => f.startsWith('docs/') && !sourceAreas[f]).map(f => path.basename(f)).filter(n => !IGNORAR.has(n));
if (nombres.length) {
  for (const t of fs.readdirSync(path.join(root, 'test')).filter(f => f.endsWith('.test.js'))) {
    const src = fs.readFileSync(path.join(root, 'test', t), 'utf8');
    if (nombres.some(n => src.includes(n))) elegidas.add('test/' + t);
  }
}
// Explicit areas cover adapters outside docs/ that the basename scan missed.
const areas = [
 ['supabase-relay/', ['test/supabase-relay-transport.test.js', 'test/supabase-relay-gateway.test.js']],
 ['cloudflare-sync-relay/', ['test/relay-durable-quota.test.js', 'test/relay-export.test.js', 'test/supabase-relay-gateway.test.js']],
 ['.github/workflows/', ['test/fast-track-pipeline.test.js', 'test/release-control.test.js']]
];
for (const [prefix, tests] of areas) if (cambios.some(f => f.startsWith(prefix))) {
 for (const file of tests) {
  if (!exists(file)) throw Error(`Missing mapped regression: ${file}`);
  elegidas.add(file);
 }
}
const helpers = new Set(cambios.filter(f => f.startsWith('test/helpers/')));
if (helpers.size) for (const test of fs.readdirSync(path.join(root, 'test')).filter(f => f.endsWith('.test.js'))) {
 const seen = new Set();
 function depends(file) {
  if (helpers.has(file)) return true;
  if (seen.has(file) || !exists(file)) return false;
  seen.add(file);
  for (const match of fs.readFileSync(path.join(root, file), 'utf8').matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
   const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
   if ([resolved, resolved + '.js', resolved + '.cjs'].some(depends)) return true;
  }
  return false;
 }
 if (depends('test/' + test)) elegidas.add('test/' + test);
}
return [...elegidas].sort();
}
if (require.main === module) {
 const [base, head] = process.argv.slice(2);
 if (!base || !head) throw Error('Usage: pruebas-del-area.cjs <baseSha> <headSha>');
 const changed = execFileSync('git', ['diff', '--name-only', `${base}..${head}`], { encoding: 'utf8' }).split('\n').map(s => s.trim()).filter(Boolean);
 const tests = selectTests(changed);
 if (!tests.length) throw Error('No focused regressions selected');
 process.stdout.write(tests.join('\n') + '\n');
}
module.exports = { selectTests };
