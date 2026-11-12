'use strict';
// P0 v737 (JFC 2026-11-11): "Maximo 60 s y se reinicia a las 24 h".
// El candado del PIN nunca pasa de 60 s y el contador de fallos vuelve a cero
// solo, 24 h despues del ultimo fallo (ademas del reinicio por acierto).
// El PIN tiene 3 digitos: el freno (10 fallos) se conserva. Datos sinteticos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { browser } = require('./helpers/browser.cjs');

const H = 3600 * 1000;
const cryptoSrc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'crypto-store.js'), 'utf8');
const authSrc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'auth-ui.js'), 'utf8');

// Reloj simulado: Date.now() lo manda el test.
function conReloj(w, inicio) {
  w.__reloj = inicio;
  vm.runInContext('Date.now = function () { return globalThis.__reloj; }', w);
}

function aparato(reloj, ls) {
  const w = browser(ls);
  w.crypto = webcrypto; w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  conReloj(w, reloj);
  vm.runInContext(cryptoSrc, w);
  return w;
}
const fallar = (w, n) => { for (let i = 0; i < n; i++) w.OCSecure.anotarFalloLogin(); };

test('crypto-store: 10 fallos bloquean y ninguna ronda pasa de 60 s', () => {
  const t0 = Date.UTC(2026, 10, 11, 12);
  const w = aparato(t0);
  fallar(w, 9);
  assert.equal(w.OCSecure.segundosBloqueo('login'), 0, 'con 9 fallos aun no hay candado');
  fallar(w, 1);
  const r1 = w.OCSecure.segundosBloqueo('login');
  assert.ok(r1 > 0 && r1 <= 60, 'el 10o fallo bloquea (' + r1 + ' s)');
  // Rondas siguientes, dejando pasar el candado: jamas mas de 60 s.
  for (let ronda = 2; ronda <= 6; ronda++) {
    w.__reloj += 61 * 1000;
    fallar(w, 10);
    const s = w.OCSecure.segundosBloqueo('login');
    assert.ok(s > 0 && s <= 60, 'ronda ' + ronda + ' bloquea como maximo 60 s (' + s + ' s)');
  }
});

test('crypto-store: el contador se reinicia solo a las 24 h del ultimo fallo', () => {
  const t0 = Date.UTC(2026, 10, 11, 12);
  const w = aparato(t0);
  fallar(w, 9);
  w.__reloj += 25 * H;
  fallar(w, 1);
  assert.equal(w.OCSecure.segundosBloqueo('login'), 0, 'el fallo 10 del dia anterior ya no cuenta: sin candado');
  assert.equal(w.OCSecure.intentosRestantes('login'), 9, 'queda como el primer fallo del dia');
});

test('crypto-store: antes de 24 h el contador sigue (el freno no se quita)', () => {
  const t0 = Date.UTC(2026, 10, 11, 12);
  const w = aparato(t0);
  fallar(w, 5);
  w.__reloj += 23 * H;
  fallar(w, 5);
  assert.ok(w.OCSecure.segundosBloqueo('login') > 0, '5 + 5 fallos en menos de 24 h bloquean');
});

test('crypto-store: tras 24 h la escalada tambien vuelve al principio (persistido en el aparato)', () => {
  const t0 = Date.UTC(2026, 10, 11, 12);
  const ls = browser().localStorage;
  const a = aparato(t0, ls);
  fallar(a, 10);
  a.__reloj += 61 * 1000;
  fallar(a, 10);
  // Dia siguiente, pagina nueva (memoria vacia), mismo almacenamiento.
  const b = aparato(a.__reloj + 25 * H, ls);
  assert.equal(b.OCSecure.segundosBloqueo('login'), 0);
  assert.equal(b.OCSecure.intentosRestantes('login'), 10, 'contador en cero al abrir al dia siguiente');
  fallar(b, 10);
  const s = b.OCSecure.segundosBloqueo('login');
  assert.ok(s > 0 && s <= 30, 'primera ronda del nuevo dia = candado corto (' + s + ' s)');
});

test('crypto-store: un acierto sigue reiniciando todo', () => {
  const w = aparato(Date.UTC(2026, 10, 11, 12));
  fallar(w, 7);
  w.OCSecure.anotarExitoLogin();
  assert.equal(w.OCSecure.intentosRestantes('login'), 10);
});

// ---- auth-ui.js: candado del teclado (sessionStorage "oc_intentos") ----
function candadoTeclado(reloj) {
  const ini = authSrc.indexOf('const BLOQUEO_TRAS_INTENTOS');
  const fin = authSrc.indexOf('// ---------- CSS ----------');
  assert.ok(ini > 0 && fin > ini, 'limites del bloque de candado encontrados');
  const bloque = authSrc.slice(ini, fin);
  const mem = new Map();
  const ctx = { Date: { now: () => ctx.__reloj }, JSON, Math, __reloj: reloj,
    sessionStorage: { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) } };
  vm.createContext(ctx);
  vm.runInContext(bloque + ';this.api={registrarFallo,registrarExito,msRestantesBloqueo,leerIntentos};', ctx);
  return ctx;
}

test('auth-ui: 10 fallos bloquean 60 s como maximo', () => {
  const c = candadoTeclado(Date.UTC(2026, 10, 11, 12));
  for (let i = 0; i < 9; i++) c.api.registrarFallo();
  assert.equal(c.api.msRestantesBloqueo(), 0);
  c.api.registrarFallo();
  const ms = c.api.msRestantesBloqueo();
  assert.ok(ms > 0 && ms <= 60000, 'candado de ' + ms + ' ms');
});

test('auth-ui: los fallos se reinician solos a las 24 h del ultimo fallo', () => {
  const c = candadoTeclado(Date.UTC(2026, 10, 11, 12));
  for (let i = 0; i < 9; i++) c.api.registrarFallo();
  c.__reloj += 25 * H;
  c.api.registrarFallo();
  assert.equal(c.api.msRestantesBloqueo(), 0, 'el fallo 10 de ayer no cuenta');
  assert.equal(c.api.leerIntentos().fallos, 1);
});

test('auth-ui: antes de 24 h los fallos se acumulan', () => {
  const c = candadoTeclado(Date.UTC(2026, 10, 11, 12));
  for (let i = 0; i < 5; i++) c.api.registrarFallo();
  c.__reloj += 23 * H;
  for (let i = 0; i < 5; i++) c.api.registrarFallo();
  assert.ok(c.api.msRestantesBloqueo() > 0);
});
