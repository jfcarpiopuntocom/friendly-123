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
const [base, head] = process.argv.slice(2);
const cambios = execFileSync('git', ['diff', '--name-only', `${base}..${head}`], { encoding: 'utf8' })
  .split('\n').map(s => s.trim()).filter(Boolean);
const elegidas = new Set(cambios.filter(f => /^test\/[^/]+\.test\.js$/.test(f) && fs.existsSync(f)));
// version.json, sw.js y el manifiesto cambian en todo release: no sirven para elegir area.
// index.html, dashboard.html y mock-backend.js son gigantes: casi todas las pruebas los
// nombran, asi que elegir por ellos seria correr media suite. Para esos mandan las pruebas
// nuevas del propio arreglo (rojo-verde obligatorio) + el humo fijo de abajo.
const IGNORAR = new Set(['version.json', 'sw.js', 'version-manifest.json', 'index.html', 'dashboard.html', 'mock-backend.js', 'i18n.js']);
// Humo fijo: dinero de Today, Sold, tablero en telefono, fronteras y release. Siempre corre.
for (const t of ['test/business-read-model.test.js', 'test/auditoria-v506-montos-desconocidos.test.js', 'test/sales-audit-browser.test.js', 'test/dashboard-embed.test.js', 'test/architecture-hexagonal.test.js', 'test/release-control.test.js']) if (fs.existsSync(t)) elegidas.add(t);
const nombres = cambios.filter(f => f.startsWith('docs/')).map(f => path.basename(f)).filter(n => !IGNORAR.has(n));
if (nombres.length) {
  for (const t of fs.readdirSync('test').filter(f => f.endsWith('.test.js'))) {
    const src = fs.readFileSync(path.join('test', t), 'utf8');
    if (nombres.some(n => src.includes(n))) elegidas.add('test/' + t);
  }
}
process.stdout.write([...elegidas].sort().join('\n') + (elegidas.size ? '\n' : ''));
