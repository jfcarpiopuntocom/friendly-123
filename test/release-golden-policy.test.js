const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('v448 GOLDEN separa release visible, build canario y CacheStorage', () => {
  const v = JSON.parse(read('docs/version.json'));
  const sw = read('docs/sw.js');

  assert.equal(v.shell, 'f123-shell-v448');
  assert.equal(v.releaseName, 'v448 GOLDEN');
  assert.match(v.cacheGeneration, /^golden([1-9]|[1-9][0-9])$/);
  assert.match(v.canaryBuild, /^f123-shell-v448\d{2}$/);

  const n = Number(v.cacheGeneration.replace('golden', ''));
  assert.equal(v.canaryBuild, 'f123-shell-v448' + String(n).padStart(2, '0'),
    'cada goldenN debe tener build canario 448NN');
  assert.match(sw, /const CACHE = "f123-shell-v448"/);
  assert.match(sw, new RegExp('const CACHE_GENERACION = "-' + v.cacheGeneration + '"'));
  assert.match(sw, /const CACHE_LOCAL = CACHE \+ CACHE_GENERACION \+ CANAL/);
});

test('salud y canarios reportan el build unico, Advanced sigue mostrando v448 GOLDEN', () => {
  const salud = read('docs/salud-app.js');
  const canarios = read('docs/canarios.js');
  const avanzado = read('docs/avanzado-extra.js');

  assert.match(salud, /v\.canaryBuild \|\| v\.shell/);
  assert.match(salud, /releaseName: function \(\) \{ return releaseName; \}/);
  assert.match(salud, /data\.cacheGeneration/);
  assert.match(salud, /genSirviendo !== genEsperada/);
  assert.match(salud, /navigator\.serviceWorker\.addEventListener\("message", fallbackGlobal\)/,
    'A4 debe oir la respuesta directa de un SW golden1 viejo');
  assert.match(canarios, /v\.canaryBuild \|\| v\.shell/);
  assert.match(avanzado, /OCSalud\.releaseName/);
  assert.match(avanzado, /"v448 GOLDEN"/);
  assert.doesNotMatch(avanzado, /"This device: " \+ nombreCanal \+ " · " \+ \(r\.shell \|\| "\?"\)/,
    'la franja visible no debe convertir el build interno en una falsa version publica');
});

test('promover usa witness exacto y CAS atomico contra master/estable/previo', () => {
  const y = read('.github/workflows/promover.yml');

  assert.match(y, /\.canaryBuild \/\/ \.shell \/\/ empty/);
  assert.match(y, /\[ "\$AT" -ge "\$COMMIT_AT_MS" \]/,
    'un PUSH viejo no puede autorizar un commit nuevo');
  assert.match(y, /if \[ "\$MASTER" != "\$GITHUB_SHA" \]/,
    'un workflow viejo debe morir si ya no es master');
  assert.match(y, /git push --atomic/);
  assert.match(y, /--force-with-lease=refs\/heads\/master:\$GITHUB_SHA/);
  assert.match(y, /--force-with-lease=refs\/heads\/estable:\$ESTABLE/);
  assert.match(y, /--force-with-lease=refs\/heads\/previo:/);
  assert.match(y, /"\$GITHUB_SHA:refs\/heads\/master"/,
    'master entra como no-op en la transaccion para cerrar la carrera fetch->push');
  assert.match(y, /CAS final \+ mover previo\/estable atomicamente/);
  assert.match(y, /needs\.ventana\.outputs\.hecho == 'si'/,
    'Pages solo se republica si realmente cambiaron las ramas');
  assert.doesNotMatch(y, /git push origin "\$ESTABLE:refs\/heads\/previo" --force/);
});

test('sonar manual PUSH ya no bypassa el canario y REWIND usa lease', () => {
  const y = read('.github/workflows/sonar.yml');

  assert.match(y, /MASTER_AT_MS=/);
  assert.match(y, /if \[ "\$AT" -lt "\$MASTER_AT_MS" \]/);
  assert.match(y, /\.canaryBuild \/\/ \.shell \/\/ empty/);
  assert.match(y, /\[ "\$ULT" -lt "\$MASTER_AT_MS" \]/);
  assert.match(y, /\[ "\$NEXT" -lt "\$MASTER_AT_MS" \]/);
  assert.match(y, /PUSH retenido: \$BUILD no tiene testigo lord \/next verde y fresco/);
  assert.match(y, /git push --atomic/);
  assert.match(y, /--force-with-lease=refs\/heads\/master:\$MASTER/);
  assert.match(y, /--force-with-lease=refs\/heads\/estable:\$ESTABLE/);
  assert.match(y, /--force-with-lease=refs\/heads\/previo:/);
  assert.match(y, /--force-with-lease=refs\/heads\/estable:\$ESTABLE"[\s\S]*origin "\$PREVIO:refs\/heads\/estable"/,
    'REWIND no puede pisar un estable que cambio despues del fetch');
});

test('A4 recibe por MessageChannel y compara la generacion interna, no solo v448', () => {
  const sw = read('docs/sw.js');
  const salud = read('docs/salud-app.js');
  assert.match(sw, /const puerto = ev\.ports && ev\.ports\[0\]/);
  assert.match(sw, /puerto\.postMessage\(respuesta\)/);
  assert.match(sw, /cacheGeneration: CACHE_GENERACION\.replace/);
  assert.match(salud, /var genEsperada = String\(v\.cacheGeneration \|\| ""\)/);
  assert.match(salud, /var genMal = !!genEsperada && genSirviendo !== genEsperada/);
});
