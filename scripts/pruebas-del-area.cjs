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
for (const t of ['test/business-read-model.test.js', 'test/auditoria-v506-montos-desconocidos.test.js', 'test/sales-audit-browser.test.js', 'test/dashboard-embed.test.js', 'test/architecture-hexagonal.test.js', 'test/release-control.test.js', 'test/cuadre-hugo-paco-luis.test.js', 'test/dashboard-identidad-version.test.js']) if (fs.existsSync(t)) elegidas.add(t);
const nombres = cambios.filter(f => f.startsWith('docs/')).map(f => path.basename(f)).filter(n => !IGNORAR.has(n));
if (nombres.length) {
  for (const t of fs.readdirSync('test').filter(f => f.endsWith('.test.js'))) {
    const src = fs.readFileSync(path.join('test', t), 'utf8');
    if (nombres.some(n => src.includes(n))) elegidas.add('test/' + t);
  }
}
// Risk-oriented micro-regressions: when a large UI/backend file changes, name-only
// dependency selection is insufficient (index.html and mock-backend.js are excluded).
// Inspect only diff hunks, never the full giant file, to keep the hotfix fast.
const docsTocados = cambios.some(f => f.startsWith('docs/'));
if (docsTocados) {
  const hunks = execFileSync('git', [
    'diff', '--no-ext-diff', '--unified=0', `${base}..${head}`, '--', 'docs/'
  ], { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 })
    .split('\n')
    .filter(line => /^[+-](?![+-])/.test(line))
    .join('\n');
  // Use precise domain keywords to avoid running the entire suite for one hotfix.
  const grupos = [
    {
      cambio: /direccionComision|montoComision|payout|liquidaci[oó]n|comisionista|promotora|comisi[oó]n/i,
      pruebas: ['test/flecha-comision-v521.test.js', 'test/flecha-comision-ui-v521.test.js',
        'test/cuadre-hugo-paco-luis.test.js'],
    },
    {
      cambio: /fiadoAtomico|restauracionDe|cartera|ventaEfectiva|recibo|saldoCliente/i,
      pruebas: ['test/fiado-durable-venta-v519.test.js', 'test/cuadre-hugo-paco-luis.test.js'],
    },
    {
      cambio: /f123_owned|licen[cs]|trial|demo|instanceId|sesion|sesi[oó]n|OCAuth|pinValidado/i,
      pruebas: ['test/demo-history-isolation.test.js', 'test/dashboard-identidad-version.test.js'],
    },
    {
      cambio: /Tabulator|editable|ventasRemotas|renderTabla|dashboard/i,
      pruebas: ['test/dashboard-embed.test.js', 'test/dashboard-identidad-version.test.js'],
    },
  ];
  for (const grupo of grupos) {
    if (grupo.cambio.test(hunks)) {
      for (const prueba of grupo.pruebas) if (fs.existsSync(prueba)) elegidas.add(prueba);
    }
  }
}
process.stdout.write([...elegidas].sort().join('\n') + (elegidas.size ? '\n' : ''));
