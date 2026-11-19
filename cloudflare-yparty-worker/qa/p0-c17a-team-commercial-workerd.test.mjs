// PORT2 C17a: REAL Workerd integration between src/ws-team-ticket-params.mjs
// and real Tienda DO (seeded-real-yparty-business-worker).
// Proves admin (sale/adjust/payment), empleado (sale/payment; denied adjust),
// denial of raw Yjs WS upgrade with Team ticket, and server-side revocation.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {createTeamTicketParams} from '../../src/ws-team-ticket-params.mjs';

const ROOM = 'a'.repeat(32);
const OPS_ROOM = ROOM + '-ops';
const CAT_ROOM = ROOM + '-cat';
const LICENSE = 'F123-SYNT-BUSINESS';
const INSTANCE = 'synthetic-device-123';
const ORIGIN = 'https://synthetic-shop.test';

test('C17a Team ticket client <-> real Workerd Tienda: admin/empleado commercial HTTP ops, WS denied, revocation enforced', {timeout: 60000}, async () => {
  const entry = path.join(import.meta.dirname, 'fixtures/seeded-real-yparty-business-worker.mjs');
  const built = await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral',
    conditions: ['workerd', 'worker', 'browser'], mainFields: ['module', 'main'],
    external: ['cloudflare:*'], write: false
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-c17a-team-workerd-'));
  const seen = new Set();
  const tokens = new Map();
  const revoked = new Set();
  let seq = 0;

  const mf = new Miniflare({
    modules: true,
    script: built.outputFiles[0].text,
    compatibilityDate: '2026-06-01',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: {Tienda: {className: 'Tienda', useSQLite: true}},
    durableObjectsPersist: path.join(dir, 'sqlite'),
    bindings: {
      SALA_PILOTO: ROOM,
      WS_AUTHORITY_QA: '1',
      WS_SEPARATE_ROOMS_QA: '1',
      WS_TYPED_COMMANDS_QA: '1',
      WS_TYPED_ORIGIN_QA: ORIGIN,
      WS_BUSINESS_EXECUTOR_QA: '1',
      WS_TEST_ONLY_INTERNAL_SEED: '1',
      WS_SERVICE_KEY: 'synthetic-authority-service-key-32-bytes'
    },
    serviceBindings: {
      WS_AUTHORITY: async request => {
        const action = new URL(request.url).pathname;
        const ask = await request.json();
        const meta = tokens.get(ask.token);
        const valid = action === '/ws/consume' &&
          !!meta &&
          !revoked.has(meta.subject) &&
          Array.isArray(meta.scopes) &&
          meta.scopes.includes(ask.requiredScope) &&
          !seen.has(ask.token) &&
          ask.licenseCode === LICENSE &&
          ask.instanceId === INSTANCE &&
          ask.room === meta.room;
        if (!valid) return Response.json({ok: false}, {status: 403});
        seen.add(ask.token);
        const now = Date.now();
        return Response.json({
          ok: true,
          principal: {
            license: LICENSE, instance: INSTANCE, room: meta.room,
            subject: meta.subject, role: meta.role,
            scopes: meta.scopes, iat: now - 1000, exp: now + 60000
          }
        });
      }
    }
  });

  const base = await mf.ready;

  const issuerFetch = async (_url, opts) => {
    const req = JSON.parse(opts.body);
    if (revoked.has(req.credentials.subject)) {
      return new Response(JSON.stringify({ok: false, reason: 'team-not-verified'}), {status: 403});
    }
    const token = `c17tok${++seq}.sig`;
    tokens.set(token, {
      subject: req.credentials.subject,
      role: req.credentials.role,
      room: req.room,
      scopes: req.scopes
    });
    return new Response(JSON.stringify({ok: true, token, expiresAt: Date.now() + 30000}), {
      status: 200, headers: {'content-type': 'application/json'}
    });
  };

  async function postTypedOp(creds, scope, command) {
    const fresh = createTeamTicketParams({
      licenseCode: LICENSE, instanceId: INSTANCE, room: OPS_ROOM, scope,
      getCredentials: () => creds, fetch: issuerFetch
    });
    const auth = await fresh();
    return fetch(new URL('/parties/tienda/' + OPS_ROOM, base), {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        authorization: 'Bearer ' + auth.cap,
        'x-f123-license': auth.licencia,
        'x-f123-instance': auth.instancia
      },
      body: JSON.stringify(command)
    });
  }

  const adminCreds = {kind: 'team', licenseCode: LICENSE, instanceId: INSTANCE, subject: 'admin_ana_01', role: 'admin', pin: '321'};
  const empCreds = {kind: 'team', licenseCode: LICENSE, instanceId: INSTANCE, subject: 'emp_luis_02', role: 'empleado', pin: '654'};

  try {
    // 1. Empleado executes sale.record (authoritative sku_1 price 1500) -> 200 business-committed
    const saleRes = await postTypedOp(empCreds, 'ops:sale', {
      license: LICENSE, opId: 'c17a-emp-sale-01', kind: 'sale.record',
      productId: 'sku_1', quantity: 1, amountCents: 1500
    });
    assert.equal(saleRes.status, 200);
    const saleBody = await saleRes.json();
    assert.equal(saleBody.ok, true);
    assert.equal(saleBody.receipt.stage, 'business-committed');

    // 1b. Empleado executes credit.payment.record (ops:payment) on fiado_1 -> 200 business-committed
    const payRes = await postTypedOp(empCreds, 'ops:payment', {
      license: LICENSE, opId: 'c17a-emp-pay-01', kind: 'credit.payment.record',
      receivableId: 'fiado_1', amountCents: 500
    });
    assert.equal(payRes.status, 200);
    const payBody = await payRes.json();
    assert.equal(payBody.ok, true);
    assert.equal(payBody.receipt.stage, 'business-committed');

    // 2. Empleado cannot mint ops:adjust (denied locally before hitting network)
    await assert.rejects(
      postTypedOp(empCreds, 'ops:adjust', {
        license: LICENSE, opId: 'c17a-emp-adj-01', kind: 'stock.adjust',
        productId: 'sku_1', quantity: 9, amountCents: 0
      }),
      /WS authorization unavailable/
    );

    // 3. Admin executes stock.adjust -> 200 business-committed
    const adjRes = await postTypedOp(adminCreds, 'ops:adjust', {
      license: LICENSE, opId: 'c17a-admin-adj-01', kind: 'stock.adjust',
      productId: 'sku_1', quantity: 10, amountCents: 0
    });
    assert.equal(adjRes.status, 200);
    const adjBody = await adjRes.json();
    assert.equal(adjBody.ok, true);
    assert.equal(adjBody.receipt.stage, 'business-committed');

    // 4. Empleado ops:sale ticket CANNOT open raw Yjs WebSocket on -ops or -cat
    const empWsTicket = await createTeamTicketParams({
      licenseCode: LICENSE, instanceId: INSTANCE, room: OPS_ROOM, scope: 'ops:sale',
      getCredentials: () => empCreds, fetch: issuerFetch
    })();
    for (const targetRoom of [OPS_ROOM, CAT_ROOM]) {
      const wsUrl = new URL('/parties/tienda/' + targetRoom, base);
      wsUrl.searchParams.set('licencia', empWsTicket.licencia);
      wsUrl.searchParams.set('instancia', empWsTicket.instancia);
      wsUrl.searchParams.set('cap', empWsTicket.cap);
      const wsAttempt = await mf.dispatchFetch(wsUrl, {headers: {upgrade: 'websocket'}});
      assert.equal(wsAttempt.status, 403, `Team ticket must NEVER open raw WS on ${targetRoom}`);
    }

    // 5. Revoked empleado fails closed on issuer
    revoked.add(empCreds.subject);
    await assert.rejects(
      postTypedOp(empCreds, 'ops:sale', {
        license: LICENSE, opId: 'c17a-emp-sale-revoked', kind: 'sale.record',
        productId: 'sku_1', quantity: 1, amountCents: 500
      }),
      /WS authorization unavailable/
    );
  } finally {
    await mf.dispose();
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
