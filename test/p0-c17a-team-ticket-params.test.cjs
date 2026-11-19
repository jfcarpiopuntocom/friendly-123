'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULE_URL = pathToFileURL(
  path.join(__dirname, '..', 'src', 'ws-team-ticket-params.mjs')
).href;

const LICENSE = 'F123-SYNT-TEAM-01';
const INSTANCE = 'synthetic-team-dev-01';
const ROOM = 'b'.repeat(32);

function makeFakeIssuerFetch(records = []) {
  let seq = 0;
  return async (url, opts) => {
    const parsed = JSON.parse(opts.body);
    records.push({ url: String(url), opts, body: parsed });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          token: `teamtok${++seq}.sig${seq}`,
          expiresAt: Date.now() + 30_000
        };
      }
    };
  };
}

test('1. admin requests exact one-use single-scope tickets for ops:sale, ops:adjust, ops:payment and fotos:read', async () => {
  const { createTeamTicketParams } = await import(MODULE_URL);
  const calls = [];
  const fetch = makeFakeIssuerFetch(calls);
  const getCredentials = () => ({
    kind: 'team',
    licenseCode: LICENSE,
    instanceId: INSTANCE,
    subject: 'admin_ana_01',
    role: 'admin',
    pin: '321'
  });

  const cases = [
    [ROOM + '-ops', 'ops:sale'],
    [ROOM + '-ops', 'ops:adjust'],
    [ROOM + '-ops', 'ops:payment'],
    [ROOM + '-fotos', 'fotos:read']
  ];

  for (const [room, scope] of cases) {
    const fresh = createTeamTicketParams({
      licenseCode: LICENSE,
      instanceId: INSTANCE,
      room,
      scope,
      getCredentials,
      fetch
    });
    const p1 = await fresh();
    const p2 = await fresh();
    assert.equal(p1.licencia, LICENSE);
    assert.equal(p1.instancia, INSTANCE);
    assert.notEqual(p1.cap, p2.cap, 'every call must mint a fresh one-use ticket');
    assert.equal(p1.pin, undefined);
    assert.equal(p1.subject, undefined);
  }

  assert.equal(calls.length, 8);
  assert.ok(calls.every(c => c.url === 'https://friendly123-licencias.jfcarpio.workers.dev/ws/ticket'));
  assert.deepEqual(calls[0].body.scopes, ['ops:sale']);
  assert.deepEqual(calls[2].body.scopes, ['ops:adjust']);
  assert.deepEqual(calls[4].body.scopes, ['ops:payment']);
  assert.deepEqual(calls[6].body.scopes, ['fotos:read']);
  assert.equal(calls[0].body.credentials.kind, 'team');
  assert.equal(calls[0].body.credentials.role, 'admin');
  assert.equal(calls[0].body.credentials.subject, 'admin_ana_01');
  assert.equal(calls[0].opts.credentials, 'omit');
  assert.equal(calls[0].opts.redirect, 'error');
});

test('2. empleado can mint ops:sale, ops:payment, fotos:read, and is denied ops:adjust locally with ZERO network', async () => {
  const { createTeamTicketParams } = await import(MODULE_URL);
  const calls = [];
  const fetch = makeFakeIssuerFetch(calls);
  const getCredentials = () => ({
    kind: 'team',
    licenseCode: LICENSE,
    instanceId: INSTANCE,
    subject: 'emp_luis_02',
    role: 'empleado',
    pin: '654'
  });

  for (const [room, scope] of [[ROOM + '-ops', 'ops:sale'], [ROOM + '-ops', 'ops:payment'], [ROOM + '-fotos', 'fotos:read']]) {
    const fresh = createTeamTicketParams({ licenseCode: LICENSE, instanceId: INSTANCE, room, scope, getCredentials, fetch });
    const out = await fresh();
    assert.equal(out.licencia, LICENSE);
  }
  assert.equal(calls.length, 3);

  // empleado + ops:adjust MUST fail closed BEFORE any fetch call
  const deniedAdjust = createTeamTicketParams({
    licenseCode: LICENSE,
    instanceId: INSTANCE,
    room: ROOM + '-ops',
    scope: 'ops:adjust',
    getCredentials,
    fetch
  });
  await assert.rejects(deniedAdjust(), /WS authorization unavailable/);
  assert.equal(calls.length, 3, 'forbidden empleado ops:adjust must emit ZERO network requests');
});

test('3. raw Yjs rooms (-cat, -priv), ops:read, fotos:write and ops:expense are rejected synchronously at construction', async () => {
  const { createTeamTicketParams } = await import(MODULE_URL);
  const getCredentials = () => ({
    kind: 'team',
    licenseCode: LICENSE,
    instanceId: INSTANCE,
    subject: 'admin_ana_01',
    role: 'admin',
    pin: '321'
  });
  const badPairs = [
    [ROOM + '-cat', 'cat:read'],
    [ROOM + '-cat', 'cat:write'],
    [ROOM + '-priv', 'priv:read'],
    [ROOM + '-ops', 'ops:read'],
    [ROOM + '-ops', 'ops:expense'],
    [ROOM + '-fotos', 'fotos:write'],
    [ROOM + '-fotos', 'ops:sale'],
    [ROOM + '-ops', 'fotos:read']
  ];
  for (const [room, scope] of badPairs) {
    assert.throws(
      () => createTeamTicketParams({ licenseCode: LICENSE, instanceId: INSTANCE, room, scope, getCredentials, fetch: async () => { throw new Error('must not fetch'); } }),
      /WS authorization unavailable/,
      `expected sync rejection for ${room} / ${scope}`
    );
  }
});

test('4. contador, artista, demo, owner and default PINs (456/789) are rejected with ZERO network', async () => {
  const { createTeamTicketParams } = await import(MODULE_URL);
  let netCalls = 0;
  const fetch = async () => { netCalls++; throw new Error('must not call network'); };
  const badCreds = [
    { kind: 'team', licenseCode: LICENSE, instanceId: INSTANCE, subject: 'cnt_01', role: 'contador', pin: '321' },
    { kind: 'team', licenseCode: LICENSE, instanceId: INSTANCE, subject: 'art_01', role: 'artista', pin: '321' },
    { kind: 'team', licenseCode: LICENSE, instanceId: INSTANCE, subject: 'dem_01', role: 'demo', pin: '321' },
    { kind: 'owner', licenseCode: LICENSE, instanceId: INSTANCE, subject: 'owner-account', role: 'dueno', pin: '321' },
    { kind: 'team', licenseCode: LICENSE, instanceId: INSTANCE, subject: 'emp_01', role: 'empleado', pin: '456' },
    { kind: 'team', licenseCode: LICENSE, instanceId: INSTANCE, subject: 'emp_01', role: 'empleado', pin: '789' },
    { kind: 'team', licenseCode: LICENSE, instanceId: INSTANCE, subject: 'bad', role: 'empleado', pin: '321' }
  ];
  for (const c of badCreds) {
    const fresh = createTeamTicketParams({
      licenseCode: LICENSE,
      instanceId: INSTANCE,
      room: ROOM + '-ops',
      scope: 'ops:sale',
      getCredentials: () => c,
      fetch
    });
    await assert.rejects(fresh(), /WS authorization unavailable/);
  }
  assert.equal(netCalls, 0);
});

test('5. mid-flight credential mutation (PIN, subject or role change) invalidates minted token', async () => {
  const { createTeamTicketParams } = await import(MODULE_URL);
  let pin = '321';
  const fresh = createTeamTicketParams({
    licenseCode: LICENSE,
    instanceId: INSTANCE,
    room: ROOM + '-ops',
    scope: 'ops:sale',
    getCredentials: () => ({
      kind: 'team',
      licenseCode: LICENSE,
      instanceId: INSTANCE,
      subject: 'emp_luis_02',
      role: 'empleado',
      pin
    }),
    fetch: async () => {
      pin = '999';
      return {
        ok: true,
        status: 200,
        async json() { return { ok: true, token: 'changed.sig', expiresAt: Date.now() + 20_000 }; }
      };
    }
  });
  await assert.rejects(fresh(), /WS authorization unavailable/);
});

test('6. expired, over-TTL or malformed issuer tokens fail closed', async () => {
  const { createTeamTicketParams } = await import(MODULE_URL);
  const getCredentials = () => ({
    kind: 'team',
    licenseCode: LICENSE,
    instanceId: INSTANCE,
    subject: 'emp_luis_02',
    role: 'empleado',
    pin: '654'
  });
  const badResponses = [
    { ok: true, token: 'ok.sig', expiresAt: Date.now() - 10 },
    { ok: true, token: 'ok.sig', expiresAt: Date.now() + 120_000 },
    { ok: true, token: 'not-a-jwt-pair', expiresAt: Date.now() + 15_000 },
    { ok: false, reason: 'team-not-verified' }
  ];
  for (const payload of badResponses) {
    const fresh = createTeamTicketParams({
      licenseCode: LICENSE,
      instanceId: INSTANCE,
      room: ROOM + '-ops',
      scope: 'ops:sale',
      getCredentials,
      fetch: async () => ({ ok: true, status: 200, async json() { return payload; } })
    });
    await assert.rejects(fresh(), /WS authorization unavailable/);
  }
});

test('7. real central ws-capability-issuer + team-authority end-to-end issuance & revocation', async () => {
  const { createTeamTicketParams } = await import(MODULE_URL);
  const { pinAuthority } = await import(pathToFileURL(path.join(__dirname, '..', 'cloudflare-worker', 'pin-authority.mjs')).href);
  const { teamAuthority } = await import(pathToFileURL(path.join(__dirname, '..', 'cloudflare-worker', 'team-authority.mjs')).href);
  const { wsCapabilityAuthority, roomForLicense } = await import(pathToFileURL(path.join(__dirname, '..', 'cloudflare-worker', 'ws-capability-issuer.mjs')).href);

  // Transactional DO storage harness matching cloudflare-worker authorities
  let data = new Map();
  let tail = Promise.resolve();
  const storage = {
    get: async (k) => structuredClone(data.get(k)),
    transaction: async (fn) => {
      let release;
      const prior = tail;
      tail = new Promise(r => { release = r; });
      await prior;
      const next = new Map([...data].map(([k, v]) => [k, structuredClone(v)]));
      const tx = {
        get: async (k) => structuredClone(next.get(k)),
        put: async (k, v) => next.set(k, structuredClone(v)),
        delete: async (k) => next.delete(k),
        list: async ({ prefix = '', limit = 128 } = {}) => new Map(
          [...next].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)
        )
      };
      try {
        const res = await fn(tx);
        data = next;
        return res;
      } finally {
        release();
      }
    }
  };

  const clock = () => Date.now();
  const ownerSecret = 'synthetic-owner-secret-more-than-32-bytes';
  const teamSecret = 'synthetic-team-secret-separate-32bytes';
  const wsSecret = 'synthetic-ws-secret-separate-more-than-32bytes';

  await storage.transaction(tx => tx.put('inst:' + INSTANCE, { licenseCode: LICENSE, instanceId: INSTANCE }));
  const ownerAuth = pinAuthority(storage, ownerSecret, clock);
  await ownerAuth.masterSet(LICENSE, '123', 0, [INSTANCE]);
  await ownerAuth.masterActivate(LICENSE, '123', 0, [INSTANCE]);

  const teamAuth = teamAuthority({ storage, ownerAuthority: ownerAuth, secret: teamSecret, clock });
  const addRes = await teamAuth.update({
    licenseCode: LICENSE,
    instanceId: INSTANCE,
    ownerPin: '123',
    subject: 'emp_real_01',
    role: 'empleado',
    pin: '654',
    active: true,
    expectedRevision: 0,
    opId: 'add-emp-1'
  });
  assert.equal(addRes.ok, true);

  const realOpsRoom = (await roomForLicense(LICENSE)) + '-ops';
  const issuer = wsCapabilityAuthority({
    storage,
    ownerAuthority: ownerAuth,
    teamAuthority: teamAuth,
    secret: wsSecret,
    forbiddenSecrets: [ownerSecret, teamSecret],
    grants: { empleado: ['ops:sale', 'ops:payment', 'fotos:read'] },
    clock
  });

  const liveFetch = async (_url, opts) => {
    const res = await issuer.issue(JSON.parse(opts.body));
    return { ok: res.ok, status: res.ok ? 200 : 403, async json() { return res; } };
  };

  const freshSale = createTeamTicketParams({
    licenseCode: LICENSE,
    instanceId: INSTANCE,
    room: realOpsRoom,
    scope: 'ops:sale',
    getCredentials: () => ({
      kind: 'team',
      licenseCode: LICENSE,
      instanceId: INSTANCE,
      subject: 'emp_real_01',
      role: 'empleado',
      pin: '654'
    }),
    fetch: liveFetch
  });

  const params = await freshSale();
  const consumed = await issuer.consume({
    token: params.cap,
    licenseCode: LICENSE,
    instanceId: INSTANCE,
    room: realOpsRoom,
    requiredScope: 'ops:sale'
  });
  assert.equal(consumed.ok, true);
  assert.equal(consumed.principal.role, 'empleado');
  assert.equal(consumed.principal.subject, 'emp_real_01');
  assert.deepEqual(consumed.principal.scopes, ['ops:sale']);

  // Revoke employee on server -> subsequent ticket request must fail closed
  const rev = await teamAuth.update({
    licenseCode: LICENSE,
    instanceId: INSTANCE,
    ownerPin: '123',
    subject: 'emp_real_01',
    active: false,
    expectedRevision: 1,
    opId: 'revoke-emp-1'
  });
  assert.equal(rev.ok, true);
  await assert.rejects(freshSale(), /WS authorization unavailable/);
});
