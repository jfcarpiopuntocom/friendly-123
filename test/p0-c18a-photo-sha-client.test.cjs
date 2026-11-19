'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const MODULE_URL = pathToFileURL(
  path.join(__dirname, '..', 'src', 'port2-photo-sha-client.mjs')
).href;

const HOST = 'friendly123-yparty-port2-canary-qa.jfcarpio.workers.dev';
const LICENSE = 'F123-SYNT-PHOTO-1';
const INSTANCE = 'synthetic-photo-dev';
const ROOM = 'd'.repeat(32);

async function makePngDataUrl(bytes) {
  const digest = await crypto.webcrypto.subtle.digest('SHA-256', bytes);
  const sha = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  return {
    sha,
    bytes,
    dataUrl: 'data:image/png;base64,' + Buffer.from(bytes).toString('base64')
  };
}

const ownerCreds = () => ({ kind: 'owner', licenseCode: LICENSE, instanceId: INSTANCE, pin: '123' });
const empCreds = () => ({ kind: 'team', licenseCode: LICENSE, instanceId: INSTANCE, subject: 'emp_photo_1', role: 'empleado', pin: '654' });

test('1. rejects arbitrary/exfiltration hosts, invalid timeouts and invalid room/license at construction', async () => {
  const { createOwnerPhotoShaClient, createTeamPhotoShaReader } = await import(MODULE_URL);
  const noopFetch = async () => { throw new Error('must not fetch'); };
  for (const badHost of ['evil.jfcarpio.workers.dev', 'attacker.test', '', null]) {
    assert.throws(
      () => createOwnerPhotoShaClient({ host: badHost, licenseCode: LICENSE, instanceId: INSTANCE, room: ROOM, getCredentials: ownerCreds, fetch: noopFetch }),
      /Photo SHA client unavailable/
    );
    assert.throws(
      () => createTeamPhotoShaReader({ host: badHost, licenseCode: LICENSE, instanceId: INSTANCE, room: ROOM, getCredentials: empCreds, fetch: noopFetch }),
      /Photo SHA client unavailable/
    );
  }
  assert.throws(
    () => createOwnerPhotoShaClient({ host: HOST, licenseCode: LICENSE, instanceId: INSTANCE, room: ROOM, timeoutMs: 100, getCredentials: ownerCreds, fetch: noopFetch }),
    /Photo SHA client unavailable/
  );
  assert.throws(
    () => createOwnerPhotoShaClient({ host: HOST, licenseCode: LICENSE, instanceId: INSTANCE, room: ROOM, timeoutMs: 60_000, getCredentials: ownerCreds, fetch: noopFetch }),
    /Photo SHA client unavailable/
  );
});

test('2. Owner PUT verifies SHA-256 pre-send, checks server receipt, and GET verifies returned bytes SHA-256', async () => {
  const { createOwnerPhotoShaClient } = await import(MODULE_URL);
  const sample = await makePngDataUrl(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]));
  const stored = new Map();
  let seq = 0;

  const mockFetch = async (url, opts) => {
    const s = String(url);
    if (s === 'https://friendly123-licencias.jfcarpio.workers.dev/ws/ticket') {
      return {
        ok: true,
        status: 200,
        async json() { return { ok: true, token: `ptok${++seq}.sig`, expiresAt: Date.now() + 25_000 }; }
      };
    }
    assert.ok(s.startsWith(`https://${HOST}/parties/tienda/${ROOM}-fotos?sha=`));
    assert.ok(!s.includes('cap='), 'bearer token must never be in URL');
    const sha = new URL(s).searchParams.get('sha');
    if (opts.method === 'PUT') {
      stored.set(sha, { bytes: new Uint8Array(opts.body), tipo: opts.headers['content-type'] });
      return {
        ok: true,
        status: 201,
        async json() { return { sha, bytes: opts.body.byteLength, tipo: opts.headers['content-type'] }; }
      };
    }
    const item = stored.get(sha);
    return {
      ok: true,
      status: 200,
      headers: {
        get: (h) => h.toLowerCase() === 'content-type' ? item.tipo : h.toLowerCase() === 'content-length' ? String(item.bytes.length) : null
      },
      async arrayBuffer() { return item.bytes.buffer.slice(item.bytes.byteOffset, item.bytes.byteOffset + item.bytes.byteLength); }
    };
  };

  const client = createOwnerPhotoShaClient({
    host: HOST, licenseCode: LICENSE, instanceId: INSTANCE, room: ROOM,
    getCredentials: ownerCreds, isVisible: () => true, fetch: mockFetch
  });

  const receipt = await client.put(sample.sha, sample.dataUrl);
  assert.deepEqual(receipt, { sha: sample.sha, bytes: sample.bytes.length, tipo: 'image/png' });

  const recovered = await client.get(sample.sha);
  assert.equal(recovered, sample.dataUrl);

  // Tampered SHA fails before hitting network
  const beforeSeq = seq;
  await assert.rejects(client.put('f'.repeat(64), sample.dataUrl), /Photo SHA client unavailable/);
  assert.equal(seq, beforeSeq, 'SHA mismatch must fail before requesting ticket');
});

test('3. hidden tab fails closed with ZERO network and corrupted GET bytes fail SHA-256 verification', async () => {
  const { createOwnerPhotoShaClient } = await import(MODULE_URL);
  const sample = await makePngDataUrl(new Uint8Array([137, 80, 78, 71, 9, 8, 7, 6]));
  let netCalls = 0;

  const hiddenClient = createOwnerPhotoShaClient({
    host: HOST, licenseCode: LICENSE, instanceId: INSTANCE, room: ROOM,
    getCredentials: ownerCreds, isVisible: () => false,
    fetch: async () => { netCalls++; throw new Error('must not fetch'); }
  });
  await assert.rejects(hiddenClient.put(sample.sha, sample.dataUrl), /Photo SHA client unavailable/);
  await assert.rejects(hiddenClient.get(sample.sha), /Photo SHA client unavailable/);
  assert.equal(netCalls, 0);

  // Corrupted response bytes from network MUST be rejected
  const corruptClient = createOwnerPhotoShaClient({
    host: HOST, licenseCode: LICENSE, instanceId: INSTANCE, room: ROOM,
    getCredentials: ownerCreds, isVisible: () => true,
    fetch: async (url) => {
      if (String(url).endsWith('/ws/ticket')) {
        return { ok: true, status: 200, async json() { return { ok: true, token: 'tok.sig', expiresAt: Date.now() + 20_000 }; } };
      }
      const bad = new Uint8Array([137, 80, 78, 71, 0, 0, 0, 0]);
      return {
        ok: true,
        status: 200,
        headers: { get: (h) => h.toLowerCase() === 'content-type' ? 'image/png' : String(bad.length) },
        async arrayBuffer() { return bad.buffer; }
      };
    }
  });
  await assert.rejects(corruptClient.get(sample.sha), /Photo SHA client unavailable/);
});

test('4. single-flight deduplicates concurrent GETs and PUTs for the same SHA', async () => {
  const { createOwnerPhotoShaClient } = await import(MODULE_URL);
  const sample = await makePngDataUrl(new Uint8Array([137, 80, 78, 71, 4, 3, 2, 1]));
  let ticketCalls = 0;
  let getCalls = 0;
  let releaseGet;

  const client = createOwnerPhotoShaClient({
    host: HOST, licenseCode: LICENSE, instanceId: INSTANCE, room: ROOM,
    getCredentials: ownerCreds, isVisible: () => true,
    fetch: async (url) => {
      if (String(url).endsWith('/ws/ticket')) {
        ticketCalls++;
        return { ok: true, status: 200, async json() { return { ok: true, token: `sf${ticketCalls}.sig`, expiresAt: Date.now() + 20_000 }; } };
      }
      getCalls++;
      return new Promise((resolve) => {
        releaseGet = () => resolve({
          ok: true,
          status: 200,
          headers: { get: (h) => h.toLowerCase() === 'content-type' ? 'image/png' : String(sample.bytes.length) },
          async arrayBuffer() { return sample.bytes.buffer.slice(0); }
        });
      });
    }
  });

  const p1 = client.get(sample.sha);
  const p2 = client.get(sample.sha);
  await new Promise(r => setTimeout(r, 15));
  assert.equal(ticketCalls, 1, 'concurrent GETs for same SHA must share single ticket + fetch');
  assert.equal(getCalls, 1);
  releaseGet();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, sample.dataUrl);
  assert.equal(r2, sample.dataUrl);
});

test('5. createTeamPhotoShaReader is strictly read-only (no put method), uses fotos:read for empleado/admin, and rejects contador with ZERO network', async () => {
  const { createTeamPhotoShaReader } = await import(MODULE_URL);
  const sample = await makePngDataUrl(new Uint8Array([137, 80, 78, 71, 11, 22, 33, 44]));
  let ticketCalls = 0;

  const mockFetch = async (url, opts) => {
    if (String(url).endsWith('/ws/ticket')) {
      ticketCalls++;
      const req = JSON.parse(opts.body);
      assert.deepEqual(req.scopes, ['fotos:read']);
      assert.equal(req.credentials.kind, 'team');
      return { ok: true, status: 200, async json() { return { ok: true, token: `teamf${ticketCalls}.sig`, expiresAt: Date.now() + 25_000 }; } };
    }
    assert.equal(opts.method, 'GET');
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => h.toLowerCase() === 'content-type' ? 'image/png' : String(sample.bytes.length) },
      async arrayBuffer() { return sample.bytes.buffer.slice(0); }
    };
  };

  const reader = createTeamPhotoShaReader({
    host: HOST, licenseCode: LICENSE, instanceId: INSTANCE, room: ROOM,
    getCredentials: empCreds, isVisible: () => true, fetch: mockFetch
  });
  assert.equal(reader.put, undefined, 'Team photo reader must NEVER expose put');
  assert.equal(await reader.get(sample.sha), sample.dataUrl);
  assert.equal(ticketCalls, 1);

  // contador denied locally with 0 network
  const contadorReader = createTeamPhotoShaReader({
    host: HOST, licenseCode: LICENSE, instanceId: INSTANCE, room: ROOM,
    getCredentials: () => ({ kind: 'team', licenseCode: LICENSE, instanceId: INSTANCE, subject: 'cnt_01', role: 'contador', pin: '321' }),
    isVisible: () => true, fetch: mockFetch
  });
  await assert.rejects(contadorReader.get(sample.sha), /Photo SHA client unavailable/);
  assert.equal(ticketCalls, 1);
});

test('6. hung photo transfer aborts via AbortController timeout', async () => {
  const { createOwnerPhotoShaClient } = await import(MODULE_URL);
  const sample = await makePngDataUrl(new Uint8Array([137, 80, 78, 71, 5, 6, 7, 8]));
  let sawAbort = false;

  const client = createOwnerPhotoShaClient({
    host: HOST, licenseCode: LICENSE, instanceId: INSTANCE, room: ROOM,
    timeoutMs: 500,
    getCredentials: ownerCreds, isVisible: () => true,
    fetch: (url, opts) => {
      if (String(url).endsWith('/ws/ticket')) {
        return Promise.resolve({ ok: true, status: 200, async json() { return { ok: true, token: 't1.sig', expiresAt: Date.now() + 20_000 }; } });
      }
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          sawAbort = true;
          reject(new Error('aborted'));
        });
      });
    }
  });

  await assert.rejects(client.get(sample.sha), /Photo SHA client unavailable/);
  assert.equal(sawAbort, true, 'hung transfer must trigger AbortController signal');
});
