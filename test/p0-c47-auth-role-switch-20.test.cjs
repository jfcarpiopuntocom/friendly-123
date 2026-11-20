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

function mountRoleAuthRuntime({failPhotoFor = null} = {}) {
  const s = syncSrc.indexOf('    if (piloto && typeof piloto.crearClienteFotosShaCertificado === "function") {');
  const e = syncSrc.indexOf('    API.opsDoc.on("update"', s);
  assert.ok(s > 0 && e > s, 'C25/C31/C47 block must exist in docs/sync-yjs.js');
  const block = syncSrc.slice(s, e);

  const listeners = new Map();
  const failbackCalls = [];
  const roleCalls = [];
  let liveRole = 'dueno';
  let liveDemo = false;

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
    OCAuth: { rolActual: () => liveRole, esDemo: () => liveDemo }
  };

  const API = { doc: {} };
  window.OCYjs = API;

  const piloto = {
    crearClienteFotosShaCertificado: ({ role }) => {
      roleCalls.push(role);
      if (role === failPhotoFor) throw new Error('test-only Team credential unavailable');
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
  return { window, API, failbackCalls, roleCalls, setSession: (role, demo = false) => { liveRole = role; liveDemo = demo; } };
}

test('C47: oc-login downgrades Owner 2.0 writer to Team empleado read-only and releases -cat lease', () => {
  assert.match(syncSrc, /addEventListener\(\s*["']oc-login["']/, 'docs/sync-yjs.js must listen to oc-login');
  assert.match(syncSrc, /addEventListener\(\s*["']oc-logout["']/, 'docs/sync-yjs.js must listen to oc-logout');

  const rt = mountRoleAuthRuntime();
  rt.setSession('empleado');
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

test('C47 RED: forged oc-login role cannot promote current empleado session to Owner photo PUT/GET', () => {
  const rt = mountRoleAuthRuntime();
  rt.setSession('empleado');
  rt.window.dispatchEvent({type:'oc-login',detail:{rol:'dueno',demo:false}});
  assert.equal(rt.API.modoCorte20Activo,false,'untrusted event cannot preserve a 2.0 Owner writer');
  assert.equal(rt.API.rolComercial20Activo,null,'a mismatched role event must disarm the client');
  assert.equal(rt.API.fotoSha,null,'a forged Owner event must not get Owner photo credentials');
  assert.ok(rt.failbackCalls.includes('oc-login-role-mismatch'));
});

test('C47 RED: live demo session cannot promote to owner via forged non-demo login detail', () => {
  const rt = mountRoleAuthRuntime();
  rt.setSession('dueno',true);
  rt.window.dispatchEvent({type:'oc-login',detail:{rol:'dueno',demo:false}});
  assert.equal(rt.API.modoCorte20Activo,false);
  assert.equal(rt.API.fotoSha,null);
  assert.equal(rt.API.rolComercial20Activo,null);
});

test('C47 RED: logout during in-flight activate20 prevents a late Owner writer resurrection', async () => {
  const rt = mountRoleAuthRuntime();
  let resolveActivation, notifyEntered;
  const entered = new Promise(resolve => {notifyEntered=resolve;});
  const pending = new Promise(resolve => {resolveActivation=resolve;});
  rt.API.coordinadorCorte20 = {
    activate20() {notifyEntered();return pending;},
    failbackToLegacy: async reason => {rt.failbackCalls.push(reason);return {ok:true,mode:'failback-legacy-1.0'};}
  };
  rt.API.crearCoordinadorCorte20=async()=>rt.API.coordinadorCorte20;
  rt.API.modoCorte20Activo=false;
  rt.API.rolComercial20Activo=null;
  rt.API.corteFotosShaActivo=false;
  rt.API.fotoSha=null;
  const activation=rt.API.activarCorte20Runtime({headCongelado:'head-c47',rol:'dueno',activarDespachoComercial:true});
  await entered;
  rt.window.dispatchEvent({type:'oc-logout'});
  resolveActivation({ok:true,mode:'active-2.0'});
  await assert.rejects(activation,/auth changed during certified cutover activation/);
  assert.equal(rt.API.modoCorte20Activo,false);
  assert.equal(rt.API.rolComercial20Activo,null);
  assert.ok(rt.failbackCalls.includes('auth-changed-during-activation'));
});

test('C58 RED: real Owner -> admin login revokes previous -cat coordinator lease before retaining Team GET-only photo role', () => {
  const rt = mountRoleAuthRuntime();
  rt.setSession('admin');
  rt.window.dispatchEvent({type:'oc-login',detail:{rol:'admin',demo:false}});
  assert.equal(rt.API.modoCorte20Activo,false,'admin must not inherit commercial Owner writer');
  assert.equal(rt.API.rolComercial20Activo,'admin');
  assert.equal(rt.API.fotoSha?.mode,'team-get-only','admin must not retain owner photo PUT rights');
  assert.ok(rt.failbackCalls.includes('oc-login-session-change'),'auth role change MUST release old certified -cat lease');
});

test('C58 RED: re-authenticated Owner cannot keep stale 2.0 writer lease from previous Owner login', () => {
  const rt = mountRoleAuthRuntime();
  rt.setSession('dueno');
  rt.window.dispatchEvent({type:'oc-login',detail:{rol:'dueno',demo:false}});
  assert.equal(rt.API.modoCorte20Activo,false,'even same role gets a new auth epoch and MUST re-arm explicitly');
  assert.ok(rt.failbackCalls.includes('oc-login-session-change'),'same-role login must revoke previous -cat writer');
  assert.equal(rt.API.fotoSha?.mode,'owner-put-get','fresh verified Owner may use owner photo client only after login');
});

test('C58 RED: failed Team credential construction cannot expose old Owner PUT photo client', () => {
  const rt = mountRoleAuthRuntime({failPhotoFor:'admin'});
  rt.setSession('admin');
  rt.window.dispatchEvent({type:'oc-login',detail:{rol:'admin',demo:false}});
  assert.equal(rt.API.modoCorte20Activo,false);
  assert.equal(rt.API.rolComercial20Activo,null,'fail-closed role state on Team photo factory error');
  assert.equal(rt.API.fotoSha,null,'prior Owner PUT client cannot survive failed Team reauth');
  assert.equal(rt.API.corteFotosShaActivo,false);
  assert.ok(rt.failbackCalls.includes('oc-login-session-change'));
});
