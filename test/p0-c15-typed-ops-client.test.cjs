'use strict';
// PORT2 C15: RED->GREEN for typed commercial HTTP client (sale.record, stock.adjust,
// credit.payment.record, credit.customer.payment.record) + least-privilege opsScope.
// Synthetic licences/data only; no network, no PIN persistence, no real store.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const clientUrl = pathToFileURL(path.join(__dirname, '../src/port2-typed-ops-client.mjs')).href;
const ticketUrl = pathToFileURL(path.join(__dirname, '../src/ws-owner-ticket-params.mjs')).href;

const ROOM = 'a'.repeat(32) + '-ops';
const LICENSE = 'F123-SYNT-C150-STORE';
const INSTANCE = 'synthetic-c15-device';
const SHA = 'b'.repeat(64);
const creds = () => ({kind: 'owner', licenseCode: LICENSE, instanceId: INSTANCE, pin: '123'});

function makeFetch({status = 200, body, delayMs = 0, throwErr = null} = {}) {
  const calls = [];
  let issued = 0;
  const send = async (url, opts) => {
    calls.push({url, opts});
    if (String(url).endsWith('/ws/ticket')) {
      const reqBody = JSON.parse(opts.body);
      return {
        ok: true, status: 200,
        json: async () => ({ok: true, token: `t${++issued}.sig`, expiresAt: Date.now() + 30000}),
        _reqScopes: reqBody.scopes
      };
    }
    if (delayMs > 0) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, delayMs);
        opts?.signal?.addEventListener?.('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
      });
    }
    if (throwErr) throw throwErr;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    };
  };
  return {send, calls};
}

test('C15 requestTypedOpsTicket supports least-privilege opsScope ONLY on -ops rooms', async () => {
  const {requestTypedOpsTicket} = await import(clientUrl);
  const seen = [];
  const send = async (url, opts) => {
    seen.push(JSON.parse(opts.body));
    return {ok: true, json: async () => ({ok: true, token: 'tok.sig', expiresAt: Date.now() + 30000})};
  };
  for (const opsScope of ['sale', 'adjust', 'payment']) {
    const out = await requestTypedOpsTicket({
      licenseCode: LICENSE, instanceId: INSTANCE, room: ROOM, opsScope,
      getCredentials: creds, fetch: send
    });
    assert.equal(out.cap, 'tok.sig');
  }
  assert.deepEqual(seen.map(s => s.scopes), [['ops:sale'], ['ops:adjust'], ['ops:payment']]);
  await assert.rejects(requestTypedOpsTicket({
    licenseCode: LICENSE, instanceId: INSTANCE, room: 'a'.repeat(32) + '-cat', opsScope: 'sale',
    getCredentials: creds, fetch: send
  }));
  await assert.rejects(requestTypedOpsTicket({
    licenseCode: LICENSE, instanceId: INSTANCE, room: ROOM, opsScope: 'expense',
    getCredentials: creds, fetch: send
  }), 'ops:expense is not in central issuer CEILING and must fail closed');
});

test('C15 HTTP 202 stored-for-application is NEVER treated as business-committed (fallbackLegacy:true)', async () => {
  const {dispatchTypedCommercialCommand} = await import(clientUrl);
  const cmd = {license: LICENSE, opId: 'c15-sale-0001', kind: 'sale.record', productId: 'sku_1', quantity: 1, amountCents: 1500};
  const {send, calls} = makeFetch({
    status: 202,
    body: {ok: true, status: 200, duplicate: false, receipt: {
      opId: cmd.opId, license: LICENSE, kind: cmd.kind, payloadHash: SHA, stage: 'stored-for-application'
    }}
  });
  const res = await dispatchTypedCommercialCommand({
    room: ROOM, licenseCode: LICENSE, instanceId: INSTANCE, command: cmd,
    getCredentials: creds, fetch: send, isVisible: () => true
  });
  assert.equal(res.committed, false, 'HTTP 202 queued inbox is NOT a commercial commit');
  assert.equal(res.stage, 'queued-not-committed');
  assert.equal(res.fallbackLegacy, true, 'must keep encrypted legacy -ops fallback with same opId');
  assert.equal(res.retryable, true);
  assert.equal(res.quarantine, false);
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[0].opts.body).scopes, ['ops:sale']);
  assert.equal(calls[1].opts.headers.authorization, 'Bearer t1.sig');
});

test('C15 HTTP 200 business-committed with exact matching receipt confirms commit without legacy fallback', async () => {
  const {dispatchTypedCommercialCommand} = await import(clientUrl);
  const cmd = {license: LICENSE, opId: 'c15-adj-0001', kind: 'stock.adjust', productId: 'sku_1', quantity: 7, amountCents: 0};
  const {send, calls} = makeFetch({
    status: 200,
    body: {ok: true, status: 200, duplicate: false, receipt: {
      opId: cmd.opId, license: LICENSE, kind: cmd.kind, payloadHash: SHA, stage: 'business-committed'
    }}
  });
  const res = await dispatchTypedCommercialCommand({
    room: ROOM, licenseCode: LICENSE, instanceId: INSTANCE, command: cmd,
    getCredentials: creds, fetch: send, isVisible: () => true
  });
  assert.equal(res.committed, true);
  assert.equal(res.stage, 'business-committed');
  assert.equal(res.fallbackLegacy, false);
  assert.equal(res.quarantine, false);
  assert.deepEqual(JSON.parse(calls[0].opts.body).scopes, ['ops:adjust']);
});

test('C15 tampered 200 receipt (mismatched opId/kind/license/hash) fails closed and preserves fallback', async () => {
  const {dispatchTypedCommercialCommand} = await import(clientUrl);
  const cmd = {license: LICENSE, opId: 'c15-pay-0001', kind: 'credit.payment.record', receivableId: 'rec_1', amountCents: 500};
  for (const badReceipt of [
    {opId: 'other-op-id-9', license: LICENSE, kind: cmd.kind, payloadHash: SHA, stage: 'business-committed'},
    {opId: cmd.opId, license: LICENSE, kind: 'sale.record', payloadHash: SHA, stage: 'business-committed'},
    {opId: cmd.opId, license: LICENSE, kind: cmd.kind, payloadHash: 'not-a-sha', stage: 'business-committed'},
    {opId: cmd.opId, license: LICENSE, kind: cmd.kind, payloadHash: SHA, stage: 'unknown-stage'}
  ]) {
    const {send} = makeFetch({status: 200, body: {ok: true, receipt: badReceipt}});
    const res = await dispatchTypedCommercialCommand({
      room: ROOM, licenseCode: LICENSE, instanceId: INSTANCE, command: cmd,
      getCredentials: creds, fetch: send, isVisible: () => true
    });
    assert.equal(res.committed, false);
    assert.equal(res.fallbackLegacy, true);
  }
});

test('C15 HTTP 409 conflict enters hard quarantine (no retry, no silent fallback)', async () => {
  const {dispatchTypedCommercialCommand} = await import(clientUrl);
  const cmd = {license: LICENSE, opId: 'c15-sale-409', kind: 'sale.record', productId: 'sku_1', quantity: 1, amountCents: 1800};
  const {send} = makeFetch({status: 409, body: {ok: false, reason: 'op-conflict'}});
  const res = await dispatchTypedCommercialCommand({
    room: ROOM, licenseCode: LICENSE, instanceId: INSTANCE, command: cmd,
    getCredentials: creds, fetch: send, isVisible: () => true
  });
  assert.equal(res.committed, false);
  assert.equal(res.stage, 'conflict-quarantine');
  assert.equal(res.quarantine, true);
  assert.equal(res.retryable, false);
  assert.equal(res.fallbackLegacy, false);
});

test('C15 HTTP 401/403 stops retrying ticket issuer while preserving legacy fallback', async () => {
  const {dispatchTypedCommercialCommand} = await import(clientUrl);
  const cmd = {license: LICENSE, opId: 'c15-sale-403', kind: 'sale.record', productId: 'sku_1', quantity: 1, amountCents: 1500};
  for (const status of [401, 403]) {
    const {send} = makeFetch({status, body: {ok: false, reason: 'not-authorized'}});
    const res = await dispatchTypedCommercialCommand({
      room: ROOM, licenseCode: LICENSE, instanceId: INSTANCE, command: cmd,
      getCredentials: creds, fetch: send, isVisible: () => true
    });
    assert.equal(res.committed, false);
    assert.equal(res.stage, 'auth-denied');
    assert.equal(res.retryable, false);
    assert.equal(res.fallbackLegacy, true);
  }
});

test('C15 rejects secret/extra keys, expense.record, hidden tab and wrong room BEFORE calling /ws/ticket', async () => {
  const {dispatchTypedCommercialCommand} = await import(clientUrl);
  const {send, calls} = makeFetch({status: 200, body: {ok: true}});
  const badCases = [
    {command: {license: LICENSE, opId: 'c15-sale-pin', kind: 'sale.record', productId: 'sku_1', quantity: 1, amountCents: 1500, pin: '123'}},
    {command: {license: LICENSE, opId: 'c15-exp-0001', kind: 'expense.record', categoryId: 'cat_1', amountCents: 500}},
    {command: {license: LICENSE, opId: 'c15-adj-cash', kind: 'stock.adjust', productId: 'sku_1', quantity: 5, amountCents: 100}},
    {command: {license: LICENSE, opId: 'c15-sale-hid', kind: 'sale.record', productId: 'sku_1', quantity: 1, amountCents: 1500}, isVisible: () => false},
    {command: {license: LICENSE, opId: 'c15-sale-cat', kind: 'sale.record', productId: 'sku_1', quantity: 1, amountCents: 1500}, room: 'a'.repeat(32) + '-cat'}
  ];
  for (const c of badCases) {
    const res = await dispatchTypedCommercialCommand({
      room: c.room || ROOM, licenseCode: LICENSE, instanceId: INSTANCE, command: c.command,
      getCredentials: creds, fetch: send, isVisible: c.isVisible || (() => true)
    });
    assert.equal(res.committed, false);
    assert.equal(calls.length, 0, 'invalid/hidden/unsupported request must NEVER hit /ws/ticket');
  }
});

test('C15 timeout aborts cleanly and falls back to legacy without hanging checkout', async () => {
  const {dispatchTypedCommercialCommand} = await import(clientUrl);
  const cmd = {license: LICENSE, opId: 'c15-sale-slow', kind: 'sale.record', productId: 'sku_1', quantity: 1, amountCents: 1500};
  const {send} = makeFetch({delayMs: 2000});
  const res = await dispatchTypedCommercialCommand({
    room: ROOM, licenseCode: LICENSE, instanceId: INSTANCE, command: cmd,
    getCredentials: creds, fetch: send, isVisible: () => true, timeoutMs: 250
  });
  assert.equal(res.committed, false);
  assert.equal(res.stage, 'unavailable-fallback');
  assert.equal(res.fallbackLegacy, true);
  assert.equal(res.retryable, true);
});
