// Pruebas del relay HF con almacen en memoria y sockets reales en localhost. Sin red externa, sin datos reales.
// Ejecutar: node --test hf-relay/server.test.mjs   (desde la raiz del repo, con "npm ci" hecho dentro de hf-relay/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { crearServidor, almacenMemoria, almacenHF, firmarToken, MAX_CLIENTES_SALA } from './server.mjs';

const SALA = 'a'.repeat(40) + '-y';
async function arrancar(extra = {}) {
  const store = extra.store || almacenMemoria();
  const app = crearServidor({ store, loteMs: 3600000, ...extra });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  app.puerto = app.server.address().port; app.store = store;
  return app;
}
// Devuelve el socket abierto con la lista de mensajes recibidos; o {error} si el upgrade fue rechazado.
function conectar(app, sala = SALA, query = '') {
  return new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${app.puerto}/sala/${sala}${query}`);
    ws.recibidos = [];
    ws.on('message', (d, bin) => ws.recibidos.push(bin ? { bin: true, b64: d.toString('base64') } : JSON.parse(d.toString())));
    ws.on('open', () => resolve(ws));
    ws.on('unexpected-response', (_, res) => resolve({ error: res.statusCode }));
    ws.on('error', () => {});
  });
}
const esperar = async (f, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = f(); if (v) return v; await new Promise(r => setTimeout(r, 10)); } throw new Error('timeout'); };
const op = (id, c, ack = 1) => JSON.stringify({ k: 'op', id, lam: 1, c, ack });

test('/salud responde 200 {ok:true}', async () => {
  const app = await arrancar();
  const r = await fetch(`http://127.0.0.1:${app.puerto}/salud`);
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  await app.cerrar();
});

test('auth: con secreto y token obligatorio se rechaza sin token o con token ajeno; el valido entra', async () => {
  const secreto = 'x'.repeat(64);
  const app = await arrancar({ secreto, exigirToken: true });
  assert.equal((await conectar(app)).error, 401, 'sin token');
  assert.equal((await conectar(app, SALA, '?t=' + firmarToken(secreto, 'b'.repeat(40), Date.now() + 60000))).error, 401, 'token de otra sala');
  assert.equal((await conectar(app, SALA, '?t=' + firmarToken(secreto, SALA, Date.now() - 1000))).error, 401, 'token vencido');
  const ok = await conectar(app, SALA, '?t=' + firmarToken(secreto, SALA, Date.now() + 60000));
  assert.equal(ok.readyState, 1); ok.close();
  assert.equal((await conectar(app, 'sala/mala')).error, 404, 'ruta invalida');
  await app.cerrar();
});

test('dos clientes: la op se guarda con ACK y el binario en vivo llega al otro', async () => {
  const app = await arrancar();
  const a = await conectar(app), b = await conectar(app);
  await esperar(() => a.recibidos.some(m => m.k === 'peer-count' && m.n === 2));
  a.send(op('op-1', Buffer.from('hola').toString('base64')));
  const ack = await esperar(() => a.recibidos.find(m => m.k === 'persist-result'));
  assert.deepEqual(ack, { k: 'persist-result', kind: 'op', id: 'op-1', ok: true, conflict: false });
  a.send(Buffer.from([1, 2, 3]));
  const vivo = await esperar(() => b.recibidos.find(m => m.bin));
  assert.equal(vivo.b64, Buffer.from([1, 2, 3]).toString('base64'));
  assert.ok(!a.recibidos.some(m => m.bin), 'el emisor no recibe su eco');
  a.close(); b.close(); await app.cerrar();
});

test('reconexion: un cliente nuevo recibe checkpoint y ops con pull v2, tambien tras reiniciar desde el almacen', async () => {
  const store = almacenMemoria();
  let app = await arrancar({ store });
  const a = await conectar(app);
  a.send(op('o1', Buffer.from('uno').toString('base64')));
  a.send(JSON.stringify({ k: 'ckpt', id: 'c1', v: 2, rev: 0, seq: 1, lam: 5, c: Buffer.from('estado').toString('base64'), ack: 1 }));
  a.send(op('o2', Buffer.from('dos').toString('base64')));
  await esperar(() => a.recibidos.filter(m => m.k === 'persist-result').length === 3);
  assert.ok(a.recibidos.filter(m => m.k === 'persist-result').every(m => m.ok), 'ckpt v2 con rev 0 compacta y o2 sobrevive');
  a.close(); await app.cerrar(); // cerrar() hace el ultimo lote
  assert.equal(store.saves, 1); assert.ok(store.datos.has(SALA));
  app = await arrancar({ store }); // "Space reiniciado": sala cargada del almacen
  const b = await conectar(app);
  b.send(JSON.stringify({ k: 'pull', v: 2, rev: 0, seq: 0 }));
  const pagina = await esperar(() => b.recibidos.find(m => m.k === 'pull-page'));
  const bins = b.recibidos.filter(m => m.bin).map(m => Buffer.from(m.b64, 'base64').toString());
  assert.deepEqual(bins, ['estado', 'dos'], 'checkpoint primero y luego solo las ops posteriores');
  assert.equal(pagina.rev, 1); assert.equal(pagina.n, 1);
  b.send(JSON.stringify({ k: 'head', v: 2 }));
  const cab = await esperar(() => b.recibidos.find(m => m.k === 'head-result'));
  assert.equal(cab.rev, 1); assert.ok(cab.seq >= 2);
  b.close(); await app.cerrar();
});

test('lotes: solo se escribe si hubo cambios y un fallo del almacen se reintenta sin perder la sala', async () => {
  const store = almacenMemoria(); let falla = true; const guardar = store.save.bind(store);
  store.save = async lote => { if (falla) throw new Error('hf caido'); return guardar(lote); };
  const app = await arrancar({ store });
  assert.equal(await app.volcar(), undefined); assert.equal(store.saves, 0, 'sin cambios no escribe');
  const a = await conectar(app); a.send(op('o1', 'AQID')); await esperar(() => a.recibidos.find(m => m.k === 'persist-result'));
  await assert.rejects(app.volcar()); falla = false;
  await app.volcar(); assert.equal(store.saves, 1, 'el reintento escribe el lote que fallo');
  await app.volcar(); assert.equal(store.saves, 1, 'y no repite si nada cambio');
  a.close(); await app.cerrar();
});

test('si el almacen no responde al cargar, la sala se rechaza (503) en vez de crearse en blanco', async () => {
  const store = almacenMemoria(); store.load = async () => { throw new Error('hf caido'); };
  const app = await arrancar({ store });
  assert.equal((await conectar(app)).error, 503);
  await app.cerrar();
});

test('cupo: cupo de sala cierra con 1013 y rechaza reconexion; tope global al 70 % rechaza salas nuevas', async () => {
  const app = await arrancar({ topeGlobal: 600, cupoSubida: 400 }); // global: corta a 420 bytes
  const a = await conectar(app);
  a.send(op('o1', 'A'.repeat(200)));
  await esperar(() => a.recibidos.find(m => m.k === 'persist-result'));
  const cierre = new Promise(r => a.on('close', code => r(code)));
  a.send(op('o2', 'B'.repeat(300))); // la subida de la sala pasa de 400
  assert.equal(await cierre, 1013);
  assert.equal((await conectar(app)).error, 429, 'la sala ya agoto su cupo del dia');
  assert.equal((await conectar(app, 'c'.repeat(40) + '-y')).error, 429, 'el tope global tambien corta salas nuevas');
  assert.ok(app.estadoGlobal().bytes >= 420);
  await app.cerrar();
});

test('la sala llena (12 clientes) rechaza al siguiente con 429', async () => {
  const app = await arrancar();
  const socks = []; for (let i = 0; i < MAX_CLIENTES_SALA; i++) socks.push(await conectar(app));
  assert.equal((await conectar(app)).error, 429);
  socks.forEach(s => s.close()); await app.cerrar();
});

test('almacenHF: lee 404 como sala nueva y escribe un solo commit NDJSON por lote, sin filtrar el token al cuerpo', async () => {
  const llamadas = [];
  const fetchFn = async (url, init) => { llamadas.push({ url, init }); return url.includes('/resolve/') ? new Response('', { status: 404 }) : new Response('{}', { status: 200 }); };
  const s = almacenHF({ repo: 'o/r', token: 'tok-de-prueba', fetchFn });
  assert.equal(await s.load('s1'), null);
  await s.save(new Map([['s1', { v: 1 }], ['s2', { v: 1 }]]));
  const commit = llamadas[1];
  assert.match(commit.url, /api\/datasets\/o\/r\/commit\/main$/);
  const lineas = commit.init.body.split('\n').map(l => JSON.parse(l));
  assert.equal(lineas.length, 3); assert.equal(lineas[0].key, 'header'); assert.equal(lineas[1].value.path, 'rooms/s1.json');
  assert.ok(!commit.init.body.includes('tok-de-prueba'));
});
