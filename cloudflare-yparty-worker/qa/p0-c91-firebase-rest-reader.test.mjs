// C91 RED->GREEN: Authenticated read-only paginated Firebase RTDB reader with ETag freeze verification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { webcrypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import * as Y from 'yjs';
import {
  deriveFirebaseCertifierBindings
} from '../tools/firebase-frozen-certifier.mjs';
import {
  normalizeCheckpointMap,
  fetchFirebaseChannelSnapshot,
  fetchAndPackFirebaseStore
} from '../tools/firebase-rest-reader.mjs';

const TEST_LICENSE = 'JFC-QA-C91-SAFE-LICENSE-9100';
const SECRET_TOKEN = 'secret-oauth-token-do-not-leak';

function tagFrame(tag, payload) {
  const out = new Uint8Array(1 + payload.byteLength);
  out[0] = tag;
  out.set(payload, 1);
  return out;
}

async function encryptMirror(codigo, framed) {
  const normalized = String(codigo || '').trim().toUpperCase();
  const enc = new TextEncoder();
  const base = await webcrypto.subtle.importKey('raw', enc.encode(normalized), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('amigable-sync-v1'), iterations: 100000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, framed));
  const combined = new Uint8Array(12 + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(cipher, 12);
  return Buffer.from(combined).toString('base64');
}

async function buildSignedFixture(codigo) {
  const bindings = await deriveFirebaseCertifierBindings(codigo);
  const yDoc = new Y.Doc();
  yDoc.clientID = 911;
  yDoc.getMap('productos').set('p01', {
    id: 'p01',
    nombre: 'Cuaderno C91',
    precio: 4.5,
    stockActual: 9
  });
  yDoc.getMap('ubicaciones').set('u01', { id: 'u01', nombre: 'Percha A' });
  const yFull = Y.encodeStateAsUpdate(yDoc);
  const yVec = Y.encodeStateVector(yDoc);
  yDoc.getMap('productos').set('p02', {
    id: 'p02',
    nombre: 'Lapiz C91',
    precio: 1.25,
    stockActual: 20
  });
  const yTail = Y.encodeStateAsUpdate(yDoc, yVec);

  const opsDoc = new Y.Doc();
  opsDoc.clientID = 912;
  opsDoc.getMap('eventos').set('e1', {
    kind: 'sale.record', opId: 'op-c91-1', productId: 'p01', quantity: 1, amountCents: 450
  });
  const o1 = Y.encodeStateAsUpdate(opsDoc);
  const v1 = Y.encodeStateVector(opsDoc);
  const tails = [];
  let prevV = v1;
  for (let i = 2; i <= 5; i++) {
    opsDoc.getMap('eventos').set('e' + i, {
      kind: 'abono', opId: 'op-c91-' + i, monto: 2.5 * i, clienteId: 'c1'
    });
    tails.push(Y.encodeStateAsUpdate(opsDoc, prevV));
    prevV = Y.encodeStateVector(opsDoc);
  }

  const yDb = {
    k: [null, { s: 100, c: await encryptMirror(codigo, tagFrame(7, gzipSync(yFull))) }],
    o: { '-O_y_001': { s: 200, c: await encryptMirror(codigo, tagFrame(0, yTail)) } }
  };
  const opsDb = {
    k: [null, { s: 100, c: await encryptMirror(codigo, tagFrame(7, gzipSync(o1))) }],
    o: {}
  };
  for (let i = 0; i < tails.length; i++) {
    opsDb.o[`-O_op_00${i + 2}`] = {
      s: 200 + i * 10,
      c: await encryptMirror(codigo, tagFrame(0, tails[i]))
    };
  }
  const yState = Y.encodeStateAsUpdate(yDoc);
  const opsState = Y.encodeStateAsUpdate(opsDoc);
  yDoc.destroy();
  opsDoc.destroy();
  return { bindings, yDb, opsDb, yState, opsState };
}

function createMockFirebaseServer({ channels, etags, onRequest }) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${SECRET_TOKEN}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    const cleanPath = url.pathname.replace(/\.json$/, '');
    requests.push({
      path: cleanPath,
      shallow: url.searchParams.get('shallow'),
      orderBy: url.searchParams.get('orderBy'),
      startAt: url.searchParams.get('startAt'),
      limitToFirst: url.searchParams.get('limitToFirst'),
      wantEtag: req.headers['x-firebase-etag'] || null
    });
    if (onRequest) onRequest({ url, cleanPath, req, res, requests });

    const parts = cleanPath.split('/').filter(Boolean); // ['f123', '<room>-y', ('k'|'o')]
    if (parts.length < 2 || parts[0] !== 'f123' || !channels[parts[1]]) {
      res.writeHead(200, { 'content-type': 'application/json', etag: 'null_etag' });
      res.end('null');
      return;
    }
    const channelName = parts[1];
    const chData = channels[channelName];
    const sub = parts[2];
    const etag = typeof etags[channelName] === 'function' ? etags[channelName](requests.length, cleanPath, url) : etags[channelName];
    const headers = { 'content-type': 'application/json' };
    if (req.headers['x-firebase-etag'] === 'true' && etag) {
      headers.etag = etag;
    }

    const node = sub ? chData[sub] : chData;
    if (url.searchParams.get('shallow') === 'true') {
      if (node == null) {
        res.writeHead(200, headers);
        res.end('null');
        return;
      }
      if (Array.isArray(node)) {
        res.writeHead(200, headers);
        res.end(JSON.stringify(node.map((v) => (v == null ? null : true))));
        return;
      }
      const shallowObj = {};
      for (const k of Object.keys(node)) shallowObj[k] = true;
      res.writeHead(200, headers);
      res.end(JSON.stringify(shallowObj));
      return;
    }

    if (sub === 'o' && url.searchParams.get('orderBy') === '"$key"') {
      const startAt = url.searchParams.get('startAt') ? JSON.parse(url.searchParams.get('startAt')) : null;
      const limit = Number(url.searchParams.get('limitToFirst') || '0');
      const keys = Object.keys(node || {}).sort();
      const filtered = startAt == null ? keys : keys.filter((k) => k >= startAt);
      const sliced = limit > 0 ? filtered.slice(0, limit) : filtered;
      const page = {};
      for (const k of sliced) page[k] = node[k];
      res.writeHead(200, headers);
      res.end(JSON.stringify(page));
      return;
    }

    res.writeHead(200, headers);
    res.end(JSON.stringify(node ?? null));
  });
  return { server, requests };
}

async function withMockServer(opts, fn) {
  const { server, requests } = createMockFirebaseServer(opts);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    return await fn({ baseUrl, requests });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('C91: normalizeCheckpointMap handles RTDB Array [null,...] and rejects malformed arrays', () => {
  const k1 = { s: 100, c: 'abc' };
  const k2 = { s: 200, c: 'def' };
  assert.deepEqual(normalizeCheckpointMap([null, k1, null, k2]), { '1': k1, '3': k2 });
  assert.equal(normalizeCheckpointMap(null), undefined);
  assert.throws(() => normalizeCheckpointMap([k1]), /invalid checkpoint/i);
});

test('C91: paginated read-only fetch + pack verifies -y and -ops with ETag freeze and zero unbounded root GET', async () => {
  const { bindings, yDb, opsDb } = await buildSignedFixture(TEST_LICENSE);
  const channels = {
    [bindings.firebaseRoom40 + '-y']: yDb,
    [bindings.firebaseRoom40 + '-ops']: opsDb
  };
  const fixedEtags = {
    [bindings.firebaseRoom40 + '-y']: '"etag-y-fixed"',
    [bindings.firebaseRoom40 + '-ops']: '"etag-ops-fixed"'
  };
  const etags = {
    [bindings.firebaseRoom40 + '-y']: '"etag-y-fixed-01"',
    [bindings.firebaseRoom40 + '-ops']: '"etag-ops-fixed-02"'
  };

  await withMockServer({ channels, etags }, async ({ baseUrl, requests }) => {
    const packed = await fetchAndPackFirebaseStore({
      codigo: TEST_LICENSE,
      authToken: SECRET_TOKEN,
      baseUrl,
      pageSize: 2
    });
    assert.equal(packed.ops.externalProof.completeToHead, true);
    assert.equal(packed.cat.externalProof.completeToHead, true);
    assert.equal(packed.ops.certification.opIdsCount, 5);
    assert.equal(packed.ops.certification.unsafeEconomicPayloads, 0);
    assert.ok(packed.ops.certification.expectedStateSha256);
    assert.ok(packed.cat.certification.expectedStateSha256);
    assert.equal(packed.sourceProof.independentServerEtags, true);
    assert.equal(packed.sourceProof.completeToHead, true);
    assert.equal(packed.sourceProof.yRecords, 2);
    assert.equal(packed.sourceProof.opsRecords, 5);
    assert.ok(packed.ops.archive.objects.length >= 2);
    assert.ok(packed.cat.archive.objects.length >= 2);
    assert.ok(packed.ops.archive.manifestSha256);
    assert.ok(packed.cat.archive.manifestSha256);

    // Must NEVER issue an unbounded root GET without shallow=true.
    const channelRootReads = requests.filter((r) => r.path.split('/').filter(Boolean).length === 2);
    assert.ok(channelRootReads.length >= 4);
    for (const r of channelRootReads) {
      assert.equal(r.shallow, 'true');
      assert.equal(r.wantEtag, 'true');
    }
    // Must paginate /o (5 records @ pageSize=2 => multiple /o requests).
    const opsPaginated = requests.filter((r) => r.path.endsWith('-ops/o') && r.orderBy === '"$key"');
    assert.ok(opsPaginated.length >= 2);
    // Secret leak check on returned proof metadata.
    const serialized = JSON.stringify(packed.sourceProof);
    assert.equal(serialized.includes(SECRET_TOKEN), false);
    assert.equal(serialized.includes(TEST_LICENSE), false);
    assert.equal(serialized.includes(bindings.firebaseRoom40), false);
  });
});

test('C91: fails closed on concurrent ETag mutation, missing ETag, missing ops key, extra root key, or remote HTTP', async () => {
  const { bindings, yDb, opsDb } = await buildSignedFixture(TEST_LICENSE);
  let yCalls = 0;
  const channels = {
    [bindings.firebaseRoom40 + '-y']: yDb,
    [bindings.firebaseRoom40 + '-ops']: opsDb
  };
  const fixedEtags = {
    [bindings.firebaseRoom40 + '-y']: '"etag-y-fixed"',
    [bindings.firebaseRoom40 + '-ops']: '"etag-ops-fixed"'
  };
  await withMockServer({
    channels,
    etags: {
      [bindings.firebaseRoom40 + '-y']: () => (++yCalls >= 4 ? '"etag-mutated"' : '"etag-initial"'),
      [bindings.firebaseRoom40 + '-ops']: '"etag-ops"'
    }
  }, async ({ baseUrl }) => {
    await assert.rejects(
      fetchAndPackFirebaseStore({ codigo: TEST_LICENSE, authToken: SECRET_TOKEN, baseUrl, pageSize: 2 }),
      /concurrent Firebase channel mutation/i
    );
  });

  // Missing ETag header fails closed.
  await withMockServer({
    channels,
    etags: { [bindings.firebaseRoom40 + '-y']: null, [bindings.firebaseRoom40 + '-ops']: '"etag-ops"' }
  }, async ({ baseUrl }) => {
    await assert.rejects(
      fetchFirebaseChannelSnapshot({
        baseUrl,
        channelPath: bindings.firebasePaths.y,
        authToken: SECRET_TOKEN
      }),
      /ETag/i
    );
  });

  // Unexpected child key in root shallow census fails closed without exposing token or path.
  await withMockServer({
    channels: { [bindings.firebaseRoom40 + '-y']: { ...yDb, rogue: { x: 1 } } },
    etags: { [bindings.firebaseRoom40 + '-y']: '"etag-rogue"' }
  }, async ({ baseUrl }) => {
    let err;
    try {
      await fetchFirebaseChannelSnapshot({
        baseUrl,
        channelPath: bindings.firebasePaths.y,
        authToken: SECRET_TOKEN
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.match(err.message, /unexpected Firebase channel key/i);
    assert.equal(err.message.includes(SECRET_TOKEN), false);
    assert.equal(err.message.includes(bindings.firebaseRoom40), false);
  });

  // Non-HTTPS remote URL must be rejected fail-closed.
  await assert.rejects(
    fetchFirebaseChannelSnapshot({
      baseUrl: 'http://evil.example.com',
      channelPath: bindings.firebasePaths.y,
      authToken: SECRET_TOKEN
    }),
    /https/i
  );

  // Record budget check happens via shallow census BEFORE downloading ciphertexts.
  await withMockServer({ channels, etags: fixedEtags }, async ({ baseUrl, requests }) => {
    await assert.rejects(
      fetchFirebaseChannelSnapshot({
        baseUrl,
        channelPath: bindings.firebasePaths.ops,
        authToken: SECRET_TOKEN,
        maxRecords: 3
      }),
      /record count out of safe budget/i
    );
    const nonShallow = requests.filter((r) => r.shallow !== 'true');
    assert.equal(nonShallow.length, 0);
  });

  // Missing -ops channel fails closed even when -y exists.
  await withMockServer({
    channels: { [bindings.firebaseRoom40 + '-y']: yDb },
    etags: { [bindings.firebaseRoom40 + '-y']: '"etag-y-only"' }
  }, async ({ baseUrl }) => {
    await assert.rejects(
      fetchAndPackFirebaseStore({ codigo: TEST_LICENSE, authToken: SECRET_TOKEN, baseUrl }),
      /missing Firebase channel/i
    );
  });

  // Simulated pagination stall / truncated response fails closed as incomplete read.
  let opsGets = 0;
  await withMockServer({
    channels,
    etags: fixedEtags,
    onRequest: ({ cleanPath, url, res }) => {
      if (cleanPath.endsWith('-ops/o') && url.searchParams.get('shallow') !== 'true') {
        opsGets++;
      }
    }
  }, async ({ baseUrl }) => {
    const customFetch = async (u, init) => {
      const resp = await fetch(u, init);
      if (opsGets >= 2 && String(u).includes('-ops/o.json') && !String(u).includes('shallow=true')) {
        // Return truncated empty page even though ETag stayed constant.
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return resp;
    };
    await assert.rejects(
      fetchFirebaseChannelSnapshot({
        baseUrl,
        channelPath: bindings.firebasePaths.ops,
        authToken: SECRET_TOKEN,
        pageSize: 2,
        fetchFn: customFetch
      }),
      /incomplete Firebase channel read/i
    );
  });
});
