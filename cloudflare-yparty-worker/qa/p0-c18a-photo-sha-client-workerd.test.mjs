// PORT2 C18a: REAL Workerd SQLite integration for src/port2-photo-sha-client.mjs.
// Proves multi-chunk (>512 KiB) Owner PUT -> DO cold restart -> Team empleado GET
// with exact SHA-256 verification, zero R2 usage, and fail-closed when WS_PHOTO_BLOBS_QA=0.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {createOwnerPhotoShaClient, createTeamPhotoShaReader} from '../../src/port2-photo-sha-client.mjs';

const HOST = 'friendly123-yparty-port2-canary-qa.jfcarpio.workers.dev';
const ROOM = 'e'.repeat(32);
const FOTOS_ROOM = ROOM + '-fotos';
const LICENSE = 'F123-SYNT-PHOTO';
const INSTANCE = 'synthetic-photo-dev-1';
const ORIGIN = 'https://synthetic-photo.test';

async function makeMultiChunkPng() {
  // 600 KiB > 512 KiB chunk size -> exercises real SQLite multi-block persistence
  const bytes = new Uint8Array(600 * 1024 + 137);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  for (let i = 8; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const sha = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  return { sha, bytes, dataUrl: 'data:image/png;base64,' + Buffer.from(bytes).toString('base64') };
}

test('C18a Owner PUT multi-chunk (>512 KiB) -> DO cold restart -> Team empleado GET SHA-256 exact; flag OFF fail-closed', {timeout: 60000}, async () => {
  const entry = path.join(import.meta.dirname, '../src/index.js');
  const built = await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral',
    conditions: ['workerd', 'worker', 'browser'], mainFields: ['module', 'main'],
    external: ['cloudflare:*'], write: false
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-c18a-photo-workerd-'));
  const seen = new Set();
  const tokens = new Map();
  let mf = null, base = null, photoFlag = true, seq = 0;

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
        WS_PHOTO_BLOBS_QA: photoFlag ? '1' : '0',
        WS_PHOTO_ORIGIN_QA: ORIGIN,
        WS_SERVICE_KEY: 'synthetic-authority-service-key-32-bytes'
      },
      serviceBindings: {
        WS_AUTHORITY: async request => {
          const action = new URL(request.url).pathname;
          const ask = await request.json();
          const meta = tokens.get(ask.token);
          const valid = action === '/ws/consume' &&
            !!meta &&
            Array.isArray(meta.scopes) &&
            meta.scopes.includes(ask.requiredScope) &&
            !seen.has(ask.token) &&
            ask.licenseCode === LICENSE &&
            ask.instanceId === INSTANCE &&
            ask.room === FOTOS_ROOM;
          if (!valid) return Response.json({ok: false}, {status: 403});
          seen.add(ask.token);
          const now = Date.now();
          return Response.json({
            ok: true,
            principal: {
              license: LICENSE, instance: INSTANCE, room: FOTOS_ROOM,
              subject: meta.subject, role: meta.role,
              scopes: meta.scopes, iat: now - 1000, exp: now + 60000
            }
          });
        }
      }
    });
    base = await mf.ready;
  };

  const bridgeFetch = async (url, opts) => {
    const s = String(url);
    if (s.endsWith('/ws/ticket')) {
      const req = JSON.parse(opts.body);
      const token = `c18tok${++seq}.sig`;
      const isTeam = req.credentials.kind === 'team';
      tokens.set(token, {
        subject: isTeam ? req.credentials.subject : 'owner-account',
        role: isTeam ? req.credentials.role : 'dueno',
        scopes: req.scopes
      });
      return new Response(JSON.stringify({ok: true, token, expiresAt: Date.now() + 30000}), {
        status: 200, headers: {'content-type': 'application/json'}
      });
    }
    const parsed = new URL(s);
    assert.equal(parsed.host, HOST);
    const target = new URL(parsed.pathname + parsed.search, base);
    const headers = Object.assign({}, opts.headers, {origin: ORIGIN});
    return fetch(target, {method: opts.method, headers, body: opts.body, signal: opts.signal});
  };

  const ownerClient = createOwnerPhotoShaClient({
    host: HOST, licenseCode: LICENSE, instanceId: INSTANCE, room: ROOM,
    getCredentials: () => ({kind: 'owner', licenseCode: LICENSE, instanceId: INSTANCE, pin: '123'}),
    isVisible: () => true, fetch: bridgeFetch
  });

  const empReader = createTeamPhotoShaReader({
    host: HOST, licenseCode: LICENSE, instanceId: INSTANCE, room: ROOM,
    getCredentials: () => ({kind: 'team', licenseCode: LICENSE, instanceId: INSTANCE, subject: 'emp_photo_1', role: 'empleado', pin: '654'}),
    isVisible: () => true, fetch: bridgeFetch
  });

  const photo = await makeMultiChunkPng();

  try {
    // 1. Owner uploads 600 KiB multi-chunk PNG -> DO SQLite persists 2 blocks
    await start();
    const receipt = await ownerClient.put(photo.sha, photo.dataUrl);
    assert.deepEqual(receipt, {sha: photo.sha, bytes: photo.bytes.length, tipo: 'image/png'});

    // 2. Full Durable Object cold restart -> Team empleado retrieves exact SHA-verified dataUrl
    await mf.dispose(); mf = null; await start();
    const teamDataUrl = await empReader.get(photo.sha);
    assert.equal(teamDataUrl, photo.dataUrl);

    // 3. Flag OFF -> fails closed cleanly
    await mf.dispose(); mf = null; photoFlag = false; await start();
    await assert.rejects(empReader.get(photo.sha), /Photo SHA client unavailable/);
    await assert.rejects(ownerClient.put(photo.sha, photo.dataUrl), /Photo SHA client unavailable/);
  } finally {
    if (mf) await mf.dispose();
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
