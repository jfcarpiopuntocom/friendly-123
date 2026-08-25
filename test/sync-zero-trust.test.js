// sync-zero-trust.test.js — Blindaje del Hybrid Proxy Tunnel Sync Engine.
// Se corre con: npm test  (node --test).
//
// Garantiza lo que el relay NO debe poder hacer y lo que el cifrado SI debe
// garantizar, replicando la MISMA derivacion que docs/sync-realtime.js:
//   - Una sala equivocada NO descifra (aislamiento real).
//   - El id de sala depende del codigo (mismo codigo = misma sala).
//   - El relay no lee ni interpreta los cuerpos (bytes cifrados).
//   - Nadie pisa indexedDB.open / indexedDB.put (regla dura del spec).
//   - El stock viaja como operaciones con dedup, no como "ultima escritura".

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const SYNC = fs.readFileSync(path.join(RAIZ, 'docs', 'sync-realtime.js'), 'utf8');
const RELAY = fs.readFileSync(path.join(RAIZ, 'cloudflare-sync-relay', 'worker.js'), 'utf8');
const MOCK = fs.readFileSync(path.join(RAIZ, 'docs', 'mock-backend.js'), 'utf8');

// --- Replica EXACTA de la cripto de sync-realtime.js (no un juguete) ---
const SALT_FIJO = 'amigable-sync-v1';
const subtle = globalThis.crypto.subtle;
async function derivarClave(codigo) {
  const enc = new TextEncoder();
  const base = await subtle.importKey('raw', enc.encode(codigo), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(SALT_FIJO), iterations: 100000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}
async function idDeSala(codigo) {
  const enc = new TextEncoder();
  const hash = await subtle.digest('SHA-256', enc.encode('amigable-sala:' + codigo));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
async function cifrar(clave, objeto) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const datos = new TextEncoder().encode(JSON.stringify(objeto));
  const cif = await subtle.encrypt({ name: 'AES-GCM', iv }, clave, datos);
  const paquete = new Uint8Array(iv.length + cif.byteLength);
  paquete.set(iv, 0); paquete.set(new Uint8Array(cif), iv.length);
  return paquete.buffer;
}
async function descifrar(clave, buffer) {
  const bytes = new Uint8Array(buffer);
  const iv = bytes.slice(0, 12), cif = bytes.slice(12);
  const claro = await subtle.decrypt({ name: 'AES-GCM', iv }, clave, cif);
  return JSON.parse(new TextDecoder().decode(claro));
}

test('una sala equivocada NO descifra; la propia si', async () => {
  const claveA = await derivarClave('F123-AAAA-AAAA-AAAA-AAAAA');
  const claveB = await derivarClave('F123-BBBB-BBBB-BBBB-BBBBB');
  const paquete = await cifrar(claveA, { tipo: 'venta', delta: -1, opId: 'x1' });

  // La sala correcta lee el contenido tal cual.
  const claro = await descifrar(claveA, paquete);
  assert.equal(claro.opId, 'x1');
  assert.equal(claro.delta, -1);

  // Otra sala (otra licencia) NO puede: AES-GCM falla la autenticacion.
  await assert.rejects(descifrar(claveB, paquete));
});

test('el id de sala depende del codigo (mismo codigo = misma sala)', async () => {
  const a1 = await idDeSala('F123-AAAA-AAAA-AAAA-AAAAA');
  const a2 = await idDeSala('F123-AAAA-AAAA-AAAA-AAAAA');
  const b1 = await idDeSala('F123-BBBB-BBBB-BBBB-BBBBB');
  assert.equal(a1, a2, 'mismo codigo debe dar misma sala');
  assert.notEqual(a1, b1, 'codigos distintos deben caer en salas distintas');
  assert.match(a1, /^[0-9a-f]{40}$/);
});

test('el relay es zero-knowledge: guarda/mueve sobres pero NUNCA descifra', () => {
  // El relay puede parsear el SOBRE de metadatos (k/id/lam/c opaco) para saber
  // que hacer, pero NUNCA descifra ni lee el contenido de negocio.
  assert.ok(!/subtle|decrypt|descifrar/i.test(RELAY), 'el relay no debe descifrar nada');
  // El ciphertext `c` se guarda/reenvia tal cual (opaco): nunca se interpreta.
  assert.match(RELAY, /INSERT OR IGNORE INTO ops/); // se guarda cifrado
  assert.match(RELAY, /b64aBuf/);                    // se reenvia como bytes, sin abrir
  // Reenvia al RESTO de la sala, nunca al propio emisor (no eco).
  assert.ok(/s\s*===\s*servidor/.test(RELAY) && /continue/.test(RELAY), 'debe excluir al emisor');
  // Tiene topes de clientes, de tamano de frame y de operaciones por sala.
  assert.match(RELAY, /MAX_CLIENTES_SALA/);
  assert.match(RELAY, /MAX_FRAME_BYTES/);
  assert.match(RELAY, /MAX_OPS_SALA/);
  // Sin KV de negocio: solo SQLite del Durable Object para los sobres cifrados.
  assert.ok(!/env\.\w*KV/i.test(RELAY), 'el relay no debe usar KV de negocio');
});

test('nadie pisa indexedDB.open ni indexedDB.put (regla dura del spec)', () => {
  const prohibido = [/indexedDB\.open\s*=/, /indexedDB\.put\s*=/, /IDBObjectStore\.prototype\.put\s*=/, /IDBFactory\.prototype\.open\s*=/];
  for (const re of prohibido) {
    assert.ok(!re.test(SYNC), 'sync-realtime.js no debe reasignar ' + re);
    assert.ok(!re.test(RELAY), 'el relay no debe reasignar ' + re);
  }
});

test('el stock viaja como operaciones con dedup, no como ultima escritura', () => {
  // El cliente reenvia OPS con opId, y el backend deduplica por opId.
  assert.match(SYNC, /opId/);
  assert.match(MOCK, /_opsAplicadas/);
  // Existe el aplicador de op remota (delta de stock), no un "set stock = N".
  assert.match(MOCK, /aplicarOpRemota/);
});

// --- Red de seguridad "JAMAS quedemos mal": local-first + cola + catch-up ---
// (JFC 2026-08-25). Estos tests son guardarrailes: si alguien quita la cola o
// el catch-up, la garantia de "nunca se pierde una venta" se rompe en silencio.

test('una venta sin conexion se encola y nunca se pierde', () => {
  // Sin WebSocket abierto, la op se encola.
  assert.match(SYNC, /else\s*\{\s*\n\s*encolar\(op\);/);
  // Y si cifrar() falla con el socket abierto, tambien cae a la cola (no se pierde).
  assert.match(SYNC, /\.catch\(\(\)\s*=>\s*encolar\(op\)\)/);
});

test('al reconectar se vacia la cola y se pide lo que falto (catch-up)', () => {
  // onopen dispara el vaciado de la cola y el catch-up.
  assert.match(SYNC, /ws\.onopen\s*=/);
  assert.match(SYNC, /vaciarCola\(\)/);
  assert.match(SYNC, /pedirCatchup\(\)/);
  // El que responde el catch-up manda cada op como una Op normal (mismo dedup).
  assert.match(SYNC, /function responderCatchup/);
});

test('la reconexion usa backoff con tope (no martillea al relay)', () => {
  assert.match(SYNC, /Math\.min\(reintentoMs \* 2, 30000\)/);
});

test('idempotencia: aplicar la misma op dos veces = una sola (contrato de dedup)', () => {
  // Modelo del contrato que hace seguras la cola, el catch-up y cualquier
  // transporte redundante: se deduplica por opId. Replica la idea de
  // _opsAplicadas en mock-backend.js.
  const vistos = new Set();
  let stock = 5;
  const aplicar = (op) => { if (vistos.has(op.opId)) return; vistos.add(op.opId); stock += op.delta; };
  const venta = { opId: 'v1', delta: -1 };
  aplicar(venta); aplicar(venta); // llega dos veces (WS + catch-up)
  assert.equal(stock, 4, 'una op repetida no debe descontar dos veces');
  aplicar({ opId: 'v2', delta: -1 }); // otra venta distinta
  assert.equal(stock, 3, 'dos ventas distintas si descuentan las dos');
});

// --- Bitacora cifrada en el relay (checkpoint + oplog), JFC 2026-08-25 ---

test('el sobre de la bitacora (base64) va y vuelve, y solo la sala correcta lo abre', async () => {
  // Replica: el cliente cifra -> base64 (ab2b64) -> el relay guarda `c` -> al
  // hacer pull lo decodifica a bytes y lo reenvia -> el cliente lo descifra.
  const ab2b64 = (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return Buffer.from(s, 'binary').toString('base64'); };
  const b64ab = (b64) => { const bin = Buffer.from(b64, 'base64'); return bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength); };
  const claveA = await derivarClave('F123-CCCC-CCCC-CCCC-CCCCC');
  const claveB = await derivarClave('F123-DDDD-DDDD-DDDD-DDDDD');
  const buf = await cifrar(claveA, { tipo: '__checkpoint__', payload: { productos: [{ id: 'p1', stockActual: 7 }] } });
  const c = ab2b64(buf);                 // lo que guarda el relay (opaco)
  const reconstruido = b64ab(c);         // lo que reenvia el relay al hacer pull
  const claro = await descifrar(claveA, reconstruido);
  assert.equal(claro.tipo, '__checkpoint__');
  assert.equal(claro.payload.productos[0].stockActual, 7);
  await assert.rejects(descifrar(claveB, reconstruido)); // otra sala no lo abre
});

test('el cliente persiste ops, sube checkpoint y jala del relay al conectar', () => {
  assert.match(SYNC, /k:\s*"op"/);     // cada op tambien va a la bitacora
  assert.match(SYNC, /k:\s*"ckpt"/);   // sube checkpoints
  assert.match(SYNC, /k:\s*"pull"/);   // pide lo que le falta al conectar
  assert.match(SYNC, /subirCheckpoint\(true\)/);
  assert.match(SYNC, /pullDelRelay\(\)/);
});

test('el checkpoint solo se restaura en un dispositivo FRESCO (sin ventas propias)', () => {
  // La proteccion clave: nunca pisa el stock de una caja activa.
  assert.match(MOCK, /aplicarCheckpoint/);
  assert.match(MOCK, /ventas\.length > 0\) return \{ ok: false, motivo: "no-fresco" \}/);
});
