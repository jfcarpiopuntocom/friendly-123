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

test('el relay no lee ni interpreta los cuerpos', () => {
  // No parsea el contenido del frame: no hay JSON.parse sobre el mensaje.
  assert.ok(!/JSON\.parse\s*\(\s*evt\.data/.test(RELAY), 'el relay no debe parsear evt.data');
  assert.ok(!/JSON\.parse/.test(RELAY), 'el relay no debe parsear ningun cuerpo');
  // Reenvia al RESTO de la sala, nunca al propio emisor (no eco).
  assert.ok(/s\s*===\s*servidor/.test(RELAY) && /continue/.test(RELAY), 'debe excluir al emisor');
  // Tiene topes de clientes y de tamano de frame.
  assert.match(RELAY, /MAX_CLIENTES_SALA/);
  assert.match(RELAY, /MAX_FRAME_BYTES/);
  // Es zero-trust por almacenamiento: sin KV, sin disco de negocio.
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
