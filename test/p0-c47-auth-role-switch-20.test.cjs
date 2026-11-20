'use strict';
// C47: exact-source contract proving docs/sync-yjs.js wires oc-login and oc-logout
// to API.cambiarRolComercial20 and coordinadorCorte20.failbackToLegacy.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const syncSrc = fs.readFileSync(path.join(root, 'docs/sync-yjs.js'), 'utf8');

function mountRoleAuthRuntime() {
  const s = syncSrc.indexOf('    if (piloto && typeof piloto.crearClienteFotosShaCertificado === "function") {');
  const e = syncSrc.indexOf('    API.opsDoc.on("update"', s);
  assert.ok(s > 0 && e > s, 'C25/C31/C47 block must exist in docs/sync-yjs.js');
  const block = syncSrc.slice(s, e);

  const listeners = new Map();
  const failbackCalls = [];
  const roleCalls = [];

  const window = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(ev) {
      for (const fn of listeners.get(ev.type) || []) fn(ev);
      return true;
    },
    OCSync: {
      estado: () => 'apagado',
      salaActiva: () => null,
      durabilidadPendiente: () => false,
      onEstado: () => () => {}
    },
    OCAuth: { rolActual: () => 'dueno' }
  };

  const API = { doc: {} };
  window.OCYjs = API;

  const piloto = {
    crearClienteFotosShaCertificado: ({ role }) => {
      roleCalls.push(role);
      return { mode: role === 'dueno' ? 'owner-put-get' : 'team-get-only', role, get: async () => null };
    },
    crearCoordinadorCorte20: async () => API.coordinadorCorte20
  };

  const ctx = vm.createContext({
    window,
    API,
    piloto,
    codigo: 'F123-C47-TEST',
    headCongeladoQa: 'head-c47',
    CustomEvent: class CustomEvent { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    _instalarLectorFotoShaBajoDemanda: () => {},
    Promise,
    Error
  });

  vm.runInContext(block, ctx, { filename: 'sync-yjs-c47.js' });
  API.modoCorte20Activo = true;
  API.corteFotosShaActivo = true;
  API.rolComercial20Activo = 'dueno';
  API.fotoSha = { mode: 'owner-put-get' };
  API.coordinadorCorte20 = {
    failbackToLegacy: async (reason) => {
      failbackCalls.push(reason);
      return { ok: true, mode: 'failback-legacy-1.0' };
    }
  };
  return { window, API, failbackCalls, roleCalls };
}

test('C47: oc-login downgrades Owner 2.0 writer to Team empleado read-only and releases -cat lease', () => {
  assert.match(syncSrc, /addEventListener\(\s*["']oc-login["']/, 'docs/sync-yjs.js must listen to oc-login');
  assert.match(syncSrc, /addEventListener\(\s*["']oc-logout["']/, 'docs/sync-yjs.js must listen to oc-logout');

  const rt = mountRoleAuthRuntime();
  rt.window.dispatchEvent({ type: 'oc-login', detail: { rol: 'empleado', demo: false } });

  assert.equal(rt.API.rolComercial20Activo, 'empleado');
  assert.equal(rt.API.fotoSha?.mode, 'team-get-only');
  assert.equal(rt.API.corteFotosShaActivo, true);
  assert.equal(rt.API.modoCorte20Activo, false, 'empleado login must disarm Owner 2.0 commercial writer');
  assert.ok(rt.failbackCalls.includes('role-switch-empleado'), 'must release -cat lease on downgrade to empleado');
});

test('C47: oc-logout and demo/non-commercial oc-login disarm 2.0 writers and clear fotoSha', () => {
  const rt = mountRoleAuthRuntime();
  rt.window.dispatchEvent({ type: 'oc-logout' });

  assert.equal(rt.API.modoCorte20Activo, false);
  assert.equal(rt.API.corteFotosShaActivo, false);
  assert.equal(rt.API.fotoSha, null);
  assert.equal(rt.API.rolComercial20Activo, null);
  assert.ok(rt.failbackCalls.includes('oc-logout'));

  const rtDemo = mountRoleAuthRuntime();
  rtDemo.window.dispatchEvent({ type: 'oc-login', detail: { rol: 'dueno', demo: true } });
  assert.equal(rtDemo.API.modoCorte20Activo, false);
  assert.equal(rtDemo.API.fotoSha, null);
  assert.ok(rtDemo.failbackCalls.includes('oc-login-demo'));
});
