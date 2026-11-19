// PORT2 C15: REAL Workerd integration between src/port2-typed-ops-client.mjs,
// src/ws-owner-ticket-params.mjs and real Tienda DO (seeded-real-yparty-business-worker).
// Synthetic licences/data only; proves 202 queued != committed, 200 business-committed,
// idempotency across DO restart, 409 quarantine and 503 fail-closed fallback.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {dispatchTypedCommercialCommand} from '../../src/port2-typed-ops-client.mjs';

const ROOM = 'a'.repeat(32);
const OPS_ROOM = ROOM + '-ops';
const LICENSE = 'F123-SYNT-BUSINESS';
const INSTANCE = 'synthetic-device-123';
const ORIGIN = 'https://synthetic-shop.test';

test('C15 real client <-> real Workerd Tienda: 202 fallback, 200 business-committed + restart idempotency, 409 quarantine, 503 fail-closed', {timeout: 60000}, async () => {
  const entry = path.join(import.meta.dirname, 'fixtures/seeded-real-yparty-business-worker.mjs');
  const built = await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral',
    conditions: ['workerd', 'worker', 'browser'], mainFields: ['module', 'main'],
    external: ['cloudflare:*'], write: false
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-c15-typed-client-'));
  const seen = new Set();
  const issuedScopes = new Map();
  let mf = null, base = null, executorOn = false, seq = 0;

  const start = async () => {
    mf = new Miniflare({
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
        WS_BUSINESS_EXECUTOR_QA: executorOn ? '1' : '0',
        WS_TEST_ONLY_INTERNAL_SEED: '1',
        WS_SERVICE_KEY: 'synthetic-authority-service-key-32-bytes'
      },
      serviceBindings: {
        WS_AUTHORITY: async request => {
          const action = new URL(request.url).pathname;
          const ask = await request.json();
          const granted = issuedScopes.get(ask.token);
          const valid = action === '/ws/consume' &&
            Array.isArray(granted) && granted.includes(ask.requiredScope) &&
            !seen.has(ask.token) &&
            ask.licenseCode === LICENSE && ask.instanceId === INSTANCE &&
            ask.room === OPS_ROOM;
          if (!valid) return Response.json({ok: false}, {status: 403});
          seen.add(ask.token);
          const now = Date.now();
          return Response.json({
            ok: true,
            principal: {
              license: LICENSE, instance: INSTANCE, room: OPS_ROOM,
              subject: 'owner-account', role: 'dueno',
              scopes: granted, iat: now - 1000, exp: now + 60000
            }
          });
        }
      }
    });
    base = await mf.ready;
  };

  // Bridge client fetch to synthetic issuer + real local Miniflare Tienda worker.
  const bridgeFetch = async (url, opts) => {
    const s = String(url);
    if (s.endsWith('/ws/ticket')) {
      const req = JSON.parse(opts.body);
      const token = `c15tok${++seq}.sig`;
      issuedScopes.set(token, req.scopes);
      return new Response(JSON.stringify({ok: true, token, expiresAt: Date.now() + 30000}), {
        status: 200, headers: {'content-type': 'application/json'}
      });
    }
    const target = new URL('/parties/tienda/' + OPS_ROOM, base);
    const headers = Object.assign({}, opts.headers, {origin: ORIGIN});
    return fetch(target, {method: opts.method, headers, body: opts.body, signal: opts.signal});
  };

  const stats = async () => {
    const r = await fetch(new URL('/parties/tienda/' + OPS_ROOM, base), {
      method: 'POST', headers: {origin: ORIGIN, 'x-f123-synthetic-inspect': '1'}
    });
    assert.equal(r.status, 200);
    return r.json();
  };

  const creds = () => ({kind: 'owner', licenseCode: LICENSE, instanceId: INSTANCE, pin: '123'});
  const sendCmd = command => dispatchTypedCommercialCommand({
    room: OPS_ROOM, licenseCode: LICENSE, instanceId: INSTANCE, command,
    getCredentials: creds, fetch: bridgeFetch, isVisible: () => true, timeoutMs: 4000
  });

  try {
    // 1. Executor OFF: Worker returns 202 stored-for-application; client MUST NOT mark committed.
    await start();
    const sale1 = {license: LICENSE, opId: 'c15-workerd-sale-01', kind: 'sale.record', productId: 'sku_1', quantity: 1, amountCents: 1500};
    let r = await sendCmd(sale1);
    assert.equal(r.committed, false);
    assert.equal(r.stage, 'queued-not-committed');
    assert.equal(r.fallbackLegacy, false);
    assert.equal(r.reconcileRequired, true);
    assert.equal(r.retryTarget, 'same-do-only');
    assert.deepEqual(await stats(), {stock: 5, cash: 500, effects: 0, receipts: 1});

    // 2. Restart DO with executor ON: same opId upgrades to true 200 business-committed.
    await mf.dispose(); mf = null; executorOn = true; await start();
    r = await sendCmd(sale1);
    assert.equal(r.committed, true);
    assert.equal(r.stage, 'business-committed');
    assert.equal(r.fallbackLegacy, false);
    assert.equal(r.receipt.opId, sale1.opId);
    assert.deepEqual(await stats(), {stock: 4, cash: 2000, effects: 1, receipts: 1});

    // 3. Idempotent replay after DO cold restart: committed:true, ZERO double stock/cash deduction.
    await mf.dispose(); mf = null; await start();
    r = await sendCmd(sale1);
    assert.equal(r.committed, true);
    assert.equal(r.duplicate, true);
    assert.deepEqual(await stats(), {stock: 4, cash: 2000, effects: 1, receipts: 1});

    // 4. stock.adjust using least-privilege ops:adjust scope commits cleanly.
    const adj1 = {license: LICENSE, opId: 'c15-workerd-adj-01', kind: 'stock.adjust', productId: 'sku_1', quantity: 9, amountCents: 0};
    r = await sendCmd(adj1);
    assert.equal(r.committed, true);
    assert.equal(r.stage, 'business-committed');
    assert.deepEqual(await stats(), {stock: 9, cash: 2000, effects: 2, receipts: 2});

    // 5. Conflicting payload on existing opId -> HTTP 409 quarantine (no retry, no silent fallback).
    r = await sendCmd({...sale1, amountCents: 1600});
    assert.equal(r.committed, false);
    assert.equal(r.stage, 'conflict-quarantine');
    assert.equal(r.quarantine, true);
    assert.equal(r.retryable, false);
    assert.equal(r.fallbackLegacy, false);
    assert.deepEqual(await stats(), {stock: 9, cash: 2000, effects: 2, receipts: 2});

    // 6. Business rule rejection (wrong price -> 503) is not a proven no-commit ACK; reconcile, state intact.
    r = await sendCmd({license: LICENSE, opId: 'c15-workerd-bad-price', kind: 'sale.record', productId: 'sku_1', quantity: 1, amountCents: 100});
    assert.equal(r.committed, false);
    assert.equal(r.stage, 'commit-unverified');
    assert.equal(r.fallbackLegacy, false);
    assert.equal(r.reconcileRequired, true);
    assert.deepEqual(await stats(), {stock: 9, cash: 2000, effects: 2, receipts: 2});
  } finally {
    await mf?.dispose();
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
