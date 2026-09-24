/* Lista dinamica de licencias del panel (JFC 2026-09-24), escala 1.000-10.000.
   Logica pura de docs/panel-licencias.js: indexado, agrupado por licencia,
   filtros, orden, paginacion, stats, acciones masivas con concurrencia acotada
   y CSV. Feature nueva (no bug): se rotula como tal. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function cargar() {
  const ctx = { window: {}, document: { getElementById: () => null } };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/panel-licencias.js'), 'utf8'), ctx);
  return ctx.PanelLic;
}
const DIA = 86400000;
const AHORA = Date.parse('2026-09-24T12:00:00Z');
function filas(n, semilla = 1) {
  let s = semilla; const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
  const out = [];
  for (let i = 0; i < n; i++) {
    const cod = 'F123-XXXX-' + String(i).padStart(4, '0') + '-AAAA-BBBBB';
    const nDev = 1 + (i % 7 === 0 ? 2 : 0);
    for (let d = 0; d < nDev; d++) {
      out.push({ instanceId: 'inst-' + i + '-' + d, licenseCode: i % 50 === 0 ? '' : cod,
        nombreNegocio: d === 0 ? 'Tienda ' + i : '', nombre: 'Owner' + i, apellido: 'Test', email: d === 0 ? 'owner' + i + '@ejemplo.test' : '',
        whatsapp: '5939' + String(i).padStart(7, '0'), cedula: '01' + String(i).padStart(8, '0'),
        estado: ['minima', 'full', 'bloqueada'][i % 3], activatedAt: AHORA - (i % 400) * DIA,
        lastSeen: AHORA - Math.floor(rnd() * 120) * DIA,
        pagoResumen: i % 4 === 0 ? { n: 1, total: 399, moneda: 'USD', hasta: i % 8 === 0 ? '2020-01-01' : '2031-01-01' } : undefined });
    }
  }
  return out;
}

test('indexar agrupa por licencia (una fila por negocio), pliega aparatos y no mezcla demos sin codigo', () => {
  const P = cargar();
  const idx = P.indexar(filas(100), { ahora: AHORA });
  const conCodigo = idx.grupos.filter(g => g.cod);
  assert.equal(conCodigo.length, 98, '100 negocios menos 2 demos sin codigo');
  // i=0 (3 aparatos) e i=50 (1) no tienen codigo: 4 filas sueltas, nunca agrupadas bajo "".
  assert.equal(idx.grupos.filter(g => !g.cod).length, 4, 'las demos van sueltas, nunca agrupadas bajo ""');
  const g7 = idx.grupos.find(g => g.cod.endsWith('0007-AAAA-BBBBB'));
  assert.equal(g7.n, 3);
  assert.equal(g7.cabeza.nombreNegocio, 'Tienda 7', 'encabeza el aparato con identidad completa');
  assert.equal(g7.pago, null, 'i=7 no tiene pago');
  assert.equal(idx.grupos.find(g => g.cod.endsWith('0008-AAAA-BBBBB')).pago.total, 399, 'i=8 si');
});

test('el aparato de pruebas de JFC va al fondo del grupo y el cliente encabeza', () => {
  const P = cargar();
  const idx = P.indexar([
    { instanceId: 'a', licenseCode: 'F123-TEST-0001-AAAA-BBBBB', email: P.MI_CORREO, nombreNegocio: 'Mi prueba', nombre: 'JF', lastSeen: AHORA },
    { instanceId: 'b', licenseCode: 'F123-TEST-0001-AAAA-BBBBB', email: 'sarah@ejemplo.test', nombreNegocio: 'Galeria', nombre: 'Sarah', lastSeen: AHORA - 40 * DIA }
  ], { ahora: AHORA });
  assert.equal(idx.grupos[0].cabeza.instanceId, 'b');
  assert.equal(idx.grupos[0].nCliente, 1);
  assert.equal(idx.grupos[0].nMios, 1);
});

test('10.000 licencias: indexar en menos de 600 ms; filtrar + ordenar + paginar en menos de 150 ms', () => {
  const P = cargar();
  const rows = filas(10000);
  const t0 = Date.now();
  const idx = P.indexar(rows, { ahora: AHORA });
  const t1 = Date.now();
  const f = P.filtrar(idx.grupos, { q: 'tienda 99', estado: 'full' });
  const o = P.ordenar(f, 'lastSeen', 'desc');
  const pag = P.paginar(o, 1);
  const t2 = Date.now();
  assert.ok(rows.length > 10000);
  assert.ok(t1 - t0 < 600, 'indexar 10k tardo ' + (t1 - t0) + ' ms');
  assert.ok(t2 - t1 < 150, 'filtrar+ordenar+paginar tardo ' + (t2 - t1) + ' ms');
  assert.ok(pag.items.length <= P.TAM_PAGINA);
  assert.ok(f.length > 0 && f.every(g => g.estado === 'full' && g.q.includes('tienda') && g.q.includes('99')), 'cada palabra del buscador tiene que aparecer');
});

test('filtros: texto multipalabra sin acentos, estado, pago (con/sin/vencido), lote e inactividad', () => {
  const P = cargar();
  const rows = filas(200);
  rows[0].nombreNegocio = 'Café Ñandú';
  const lotes = [{ etiqueta: 'Gremio A', codigos: [...new Set(rows.filter(r => r.licenseCode).map(r => r.licenseCode))].slice(0, 10) }];
  const idx = P.indexar(rows, { ahora: AHORA, lotes });
  assert.equal(P.filtrar(idx.grupos, { q: 'nandu cafe' }).length, 1, 'busca sin acentos y en cualquier orden');
  assert.ok(P.filtrar(idx.grupos, { estado: 'bloqueada' }).every(g => g.estado === 'bloqueada'));
  const con = P.filtrar(idx.grupos, { pago: 'con' }), sin = P.filtrar(idx.grupos, { pago: 'sin' }), venc = P.filtrar(idx.grupos, { pago: 'vencido' });
  assert.equal(con.length + sin.length, idx.grupos.length);
  assert.ok(venc.length > 0 && venc.every(g => g.vencida));
  assert.ok(con.every(g => g.pago) && sin.every(g => !g.pago));
  const enLote = P.filtrar(idx.grupos, { lote: 'gremio a' });
  assert.ok(enLote.length === 10 && enLote.every(g => g.lote === 'Gremio A'), 'el lote se resuelve por codigo, sin importar mayusculas');
  assert.equal(P.filtrar(idx.grupos, { q: 'gremio a' }).length, enLote.length, 'la etiqueta del lote tambien se busca por texto');
  assert.ok(P.filtrar(idx.grupos, { inactivoDias: 90 }).every(g => g.diasInactivo >= 90));
});

test('ordenar es estable y respeta direccion; paginar acota la pagina', () => {
  const P = cargar();
  const idx = P.indexar(filas(250), { ahora: AHORA });
  const asc = P.ordenar(idx.grupos, 'negocio', 'asc'), desc = P.ordenar(idx.grupos, 'negocio', 'desc');
  assert.equal(asc[0].cabeza.nombreNegocio, desc[desc.length - 1].cabeza.nombreNegocio);
  const porPago = P.ordenar(idx.grupos, 'pago', 'desc');
  assert.ok(porPago[0].pago && !porPago[porPago.length - 1].pago);
  const p3 = P.paginar(asc, 3), pFuera = P.paginar(asc, 99), p0 = P.paginar(asc, 0);
  assert.equal(p3.items.length, asc.length - 200);
  assert.equal(pFuera.pagina, pFuera.paginas, 'una pagina fuera de rango cae a la ultima');
  assert.equal(p0.pagina, 1);
});

test('stats cuenta licencias (no aparatos), pagadas, vencidas e inactivas', () => {
  const P = cargar();
  const idx = P.indexar(filas(100), { ahora: AHORA });
  const s = P.stats(idx.grupos);
  assert.equal(s.licencias, 98);
  assert.equal(s.demos, 4);
  assert.ok(s.dispositivos > 100);
  assert.equal(s.full + s.minima + s.bloqueada, 102, '98 licencias + 4 demos sueltas');
  assert.equal(s.pagadas, idx.grupos.filter(g => g.pago).length);
  assert.equal(s.totalCobrado, s.pagadas * 399);
  assert.equal(s.vencidas, idx.grupos.filter(g => g.vencida).length);
});

test('ejecutarEnLotes: nunca mas de N a la vez, termina aunque fallen, reporta cada fallo con su item', async () => {
  const P = cargar();
  let activos = 0, pico = 0, progreso = [];
  const r = await P.ejecutarEnLotes(Array.from({ length: 37 }, (_, i) => i), async (i) => {
    activos++; pico = Math.max(pico, activos);
    await new Promise(res => setTimeout(res, 2));
    activos--;
    if (i % 10 === 3) throw new Error('boom ' + i);
    return i * 2;
  }, { concurrencia: 4, onProgreso: (h, t) => progreso.push(h + '/' + t) });
  assert.equal(pico, 4);
  assert.equal(r.ok.length, 33);
  assert.deepEqual(Array.from(r.fallos, f => f.item).sort((a, b) => a - b), [3, 13, 23, 33]);
  assert.equal(r.fallos[0].error.slice(0, 4), 'boom');
  assert.equal(progreso[progreso.length - 1], '37/37');
  const vacio = await P.ejecutarEnLotes([], async () => {});
  assert.equal(vacio.ok.length + vacio.fallos.length, 0);
});

test('csv exporta una fila por licencia con lote, pagos y comillas escapadas; csvCodigos para el lote', () => {
  const P = cargar();
  const rows = filas(12);
  rows[1].nombreNegocio = 'Tienda "La Esquina", Cuenca';
  const idx = P.indexar(rows, { ahora: AHORA, lotes: [{ etiqueta: 'G1', codigos: [rows[1].licenseCode] }] });
  const csv = P.csv(idx.grupos, t => t ? new Date(t).toISOString().slice(0, 10) : '');
  const lineas = csv.split('\n');
  assert.equal(lineas.length, idx.grupos.length + 1);
  assert.ok(lineas[0].startsWith('licenseCode,lote,estado,nombreNegocio'));
  assert.ok(csv.includes('"Tienda ""La Esquina"", Cuenca"'));
  assert.ok(csv.includes(',"G1",'));
  const lote = P.csvCodigos(['F123-TEST-AAAA-BBBB-CCCCC'], 'G1');
  assert.equal(lote, 'codigo,lote\n"F123-TEST-AAAA-BBBB-CCCCC","G1"');
});
