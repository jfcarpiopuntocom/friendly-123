// Core logic for friendly123-relay-privado (Durable Object SQLite encrypted vault).
// Stores ONLY opaque AES-256-GCM ciphertext frames identical to Firebase relay (/o and /k).
// Zero plaintext business data ever exists on the server.
const ENC = new TextEncoder();
const DEC = new TextDecoder('utf-8', { fatal: true });

export const ROOM_RE = /^([a-f0-9]{40})(-y|-ops|-fotos)?$/;
export const LICENSE_RE = /^F123-[A-Z0-9*~$=-]{8,34}$/;
export const INSTANCE_RE = /^[A-Za-z0-9_-]{6,120}$/;
export const OP_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
export const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;

export const MAX_OP_B64 = 360 * 1024;
export const MAX_CKPT_B64 = 2800 * 1024;
export const CKPT_BLOCK_CHARS = 512 * 1024;
export const MAX_STORE_BYTES = 64 * 1024 * 1024;
export const PAGE_BUDGET_BYTES = 1024 * 1024;
export const MAX_PULL_LIMIT = 192;
export const SESSION_TTL_MS = 10 * 60 * 1000;
export const CLOCK_SKEW_MS = 60 * 1000;
export const RATE_WINDOW_MS = 60 * 1000;
export const RATE_LIMIT_PER_MIN = 240;

const ALLOWED_ROLES = new Set(['dueno', 'admin', 'empleado']);
const AUTH_CHANNELS = Object.freeze({
  dueno: Object.freeze({ suffix: '-priv', scope: 'priv:write' }),
  admin: Object.freeze({ suffix: '-cat', scope: 'cat:read' }),
  empleado: Object.freeze({ suffix: '-cat', scope: 'cat:read' })
});

function toHex(buf) {
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

function b64urlEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 32768) {
    s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  if (typeof str !== 'string' || !str || str.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(str)) {
    throw new Error('malformed-token');
  }
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  if (b64urlEncode(out) !== str) throw new Error('noncanonical-token');
  return out;
}

export async function legacyRoomHexForLicense(licenseCode) {
  const norm = String(licenseCode || '').trim().toUpperCase();
  if (!LICENSE_RE.test(norm)) throw new Error('invalid-license');
  const hash = await crypto.subtle.digest('SHA-256', ENC.encode('amigable-sala:' + norm));
  return toHex(hash).slice(0, 40);
}

export async function ypartyBaseForLicense(licenseCode) {
  const norm = String(licenseCode || '').trim().toUpperCase();
  if (!LICENSE_RE.test(norm)) throw new Error('invalid-license');
  const hash = await crypto.subtle.digest('SHA-256', ENC.encode('f123-yparty-v1:' + norm));
  return toHex(hash).slice(0, 32);
}

export function validateCipherBase64(c, maxChars) {
  if (typeof c !== 'string' || c.length < 36 || c.length > maxChars) return { ok: false, reason: 'cipher-size-invalid' };
  if (c.length % 4 !== 0 || !BASE64_RE.test(c)) return { ok: false, reason: 'cipher-not-base64' };
  let prefix;
  try {
    prefix = atob(c.slice(0, 40));
  } catch (_) {
    return { ok: false, reason: 'cipher-decode-failed' };
  }
  if (prefix.length < 28) return { ok: false, reason: 'cipher-too-short' };
  const trimmed = prefix.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return { ok: false, reason: 'plaintext-rejected' };
  }
  const approxBytes = Math.floor((c.length * 3) / 4) - (c.endsWith('==') ? 2 : c.endsWith('=') ? 1 : 0);
  return { ok: true, bytes: approxBytes };
}

export function parseAllowedOrigins(env) {
  const raw = String(env?.ALLOWED_ORIGINS || 'https://jfcarpiopuntocom.github.io,https://friendly-123.jfcarpio.workers.dev');
  const out = new Set();
  for (const part of raw.split(',')) {
    const s = part.trim();
    if (!s) continue;
    try {
      const u = new URL(s);
      if (u.protocol === 'https:' && !u.pathname.replace('/', '') && !u.search && !u.hash) out.add(u.origin);
    } catch (_) {}
  }
  return out;
}

export function isOriginAllowed(origin, env) {
  if (origin === null || origin === undefined) return true;
  return parseAllowedOrigins(env).has(origin);
}

async function importSessionKey(env, fallbackSecret) {
  const raw = env?.RELAY_SESSION_SECRET || env?.WS_SERVICE_KEY || fallbackSecret;
  if (typeof raw !== 'string' || ENC.encode(raw).length < 32) return null;
  const material = await crypto.subtle.digest('SHA-256', ENC.encode('f123-priv-relay-session-v1:' + raw));
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function mintSessionToken(env, claims, clock = Date.now, fallbackSecret = null) {
  const key = await importSessionKey(env, fallbackSecret);
  if (!key) return null;
  const now = clock();
  const payload = {
    v: 1,
    room: claims.room,
    lic: claims.licenseCode,
    inst: claims.instanceId,
    role: claims.role,
    rev: claims.roleRevision,
    iat: now,
    exp: now + SESSION_TTL_MS
  };
  const body = b64urlEncode(ENC.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, ENC.encode(body)));
  return { token: body + '.' + b64urlEncode(sig), expiresAt: payload.exp };
}

export async function verifySessionToken(env, token, expectedRoom, clock = Date.now, fallbackSecret = null) {
  try {
    const key = await importSessionKey(env, fallbackSecret);
    if (!key || typeof token !== 'string' || token.length > 3500) return { ok: false, reason: 'unauthorized' };
    const parts = token.split('.');
    if (parts.length !== 2) return { ok: false, reason: 'unauthorized' };
    const bodyBytes = b64urlDecode(parts[0]);
    const sigBytes = b64urlDecode(parts[1]);
    if (sigBytes.length !== 32) return { ok: false, reason: 'unauthorized' };
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, ENC.encode(parts[0]));
    if (!valid) return { ok: false, reason: 'unauthorized' };
    const p = JSON.parse(DEC.decode(bodyBytes));
    const now = clock();
    // G03: allow ±60s clock skew tolerance on iat across isolates
    if (!p || p.v !== 1 || p.room !== expectedRoom || !ALLOWED_ROLES.has(p.role) ||
        !LICENSE_RE.test(p.lic || '') || !INSTANCE_RE.test(p.inst || '') ||
        !Number.isSafeInteger(p.iat) || !Number.isSafeInteger(p.exp) ||
        now + CLOCK_SKEW_MS < p.iat || now >= p.exp) {
      return { ok: false, reason: 'session-expired-or-mismatch' };
    }
    return { ok: true, principal: Object.freeze(p) };
  } catch (_) {
    return { ok: false, reason: 'unauthorized' };
  }
}

export async function exchangeTicketForSession({
  env,
  room,
  licenseCode,
  instanceId,
  ticket,
  credentials,
  roleHint,
  clock = Date.now,
  fallbackSecret = null
}) {
  const m = ROOM_RE.exec(String(room || ''));
  if (!m) return { ok: false, status: 400, reason: 'invalid-room' };
  const lic = String(licenseCode || '').trim().toUpperCase();
  const inst = String(instanceId || '').trim();
  const role = String(roleHint || 'dueno').trim().toLowerCase();
  if (!LICENSE_RE.test(lic) || !INSTANCE_RE.test(inst) || !ALLOWED_ROLES.has(role)) {
    return { ok: false, status: 400, reason: 'invalid-credentials' };
  }
  if ((typeof ticket !== 'string' || !ticket) && (!credentials || typeof credentials !== 'object')) {
    return { ok: false, status: 400, reason: 'invalid-credentials' };
  }
  const expected40 = await legacyRoomHexForLicense(lic);
  if (m[1] !== expected40) {
    return { ok: false, status: 403, reason: 'room-license-mismatch' };
  }
  if (!env?.WS_AUTHORITY?.fetch) {
    return { ok: false, status: 503, reason: 'authority-unavailable' };
  }
  const authSpec = AUTH_CHANNELS[role];
  const ypartyBase = await ypartyBaseForLicense(lic);
  const hasServiceKey = typeof env?.WS_SERVICE_KEY === 'string' && ENC.encode(env.WS_SERVICE_KEY).length >= 32;

  let verifiedRole = role;
  let verifiedRevision = 1;

  if (hasServiceKey && typeof ticket === 'string' && ticket) {
    // Path A: Consume one-use ticket via /ws/consume when WS_SERVICE_KEY is configured
    const consumeReq = {
      token: ticket,
      licenseCode: lic,
      instanceId: inst,
      room: ypartyBase + authSpec.suffix,
      requiredScope: authSpec.scope
    };
    let authRes;
    try {
      authRes = await env.WS_AUTHORITY.fetch('https://authority.invalid/ws/consume', {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'authorization': 'Bearer ' + env.WS_SERVICE_KEY
        },
        body: JSON.stringify(consumeReq)
      });
    } catch (_) {
      return { ok: false, status: 503, reason: 'authority-unavailable' };
    }
    const authBody = await authRes.json().catch(() => null);
    if (!authRes.ok || !authBody || authBody.ok !== true || !authBody.principal) {
      const status = authRes.status === 429 ? 429 : authRes.status === 503 ? 503 : 403;
      return { ok: false, status, reason: authBody?.reason || 'ticket-rejected' };
    }
    const p = authBody.principal;
    if (p.license !== lic || p.instance !== inst || p.role !== role) {
      return { ok: false, status: 403, reason: 'principal-mismatch' };
    }
    verifiedRole = p.role;
    verifiedRevision = p.roleRevision || 1;
  } else if (credentials && typeof credentials === 'object') {
    // Path B: Direct Service-Binding verification via /ws/ticket (or /pin/verify fallback for non-pilot stores)
    // Requires ZERO WS_SERVICE_KEY secret on friendly123-relay-privado!
    let issueRes;
    try {
      issueRes = await env.WS_AUTHORITY.fetch('https://authority.invalid/ws/ticket', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          credentials,
          room: ypartyBase + authSpec.suffix,
          scopes: [authSpec.scope]
        })
      });
    } catch (_) {
      return { ok: false, status: 503, reason: 'authority-unavailable' };
    }
    const issueBody = await issueRes.json().catch(() => null);
    if (issueRes.ok && issueBody && issueBody.ok === true && typeof issueBody.token === 'string') {
      try {
        const claims = JSON.parse(DEC.decode(b64urlDecode(issueBody.token.split('.')[0])));
        if (claims.license !== lic || claims.instance !== inst || claims.role !== role) {
          return { ok: false, status: 403, reason: 'principal-mismatch' };
        }
        verifiedRole = claims.role;
        verifiedRevision = claims.roleRevision || 1;
      } catch (_) {}
    } else if (issueRes.status === 404 && role === 'dueno' && typeof credentials.pin === 'string') {
      // Non-pilot client store not yet in TEAM_AUTHORITY_LICENSES: verify central Owner PIN via /pin/verify
      let pinRes;
      try {
        pinRes = await env.WS_AUTHORITY.fetch('https://authority.invalid/pin/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ licenseCode: lic, instanceId: inst, pin: credentials.pin })
        });
      } catch (_) {
        return { ok: false, status: 503, reason: 'authority-unavailable' };
      }
      const pinBody = await pinRes.json().catch(() => null);
      if (!pinRes.ok || !pinBody || pinBody.ok !== true) {
        const status = pinRes.status === 429 ? 429 : 403;
        return { ok: false, status, reason: pinBody?.reason || 'pin-not-verified' };
      }
      verifiedRole = 'dueno';
      verifiedRevision = Number(pinBody.revision) || 1;
    } else {
      const status = issueRes.status === 429 ? 429 : issueRes.status === 503 ? 503 : 403;
      return { ok: false, status, reason: issueBody?.reason || 'ticket-rejected' };
    }
  } else {
    return { ok: false, status: 503, reason: 'authority-unavailable' };
  }

  const minted = await mintSessionToken(env, {
    room,
    licenseCode: lic,
    instanceId: inst,
    role: verifiedRole,
    roleRevision: verifiedRevision
  }, clock, fallbackSecret);
  if (!minted) return { ok: false, status: 503, reason: 'session-key-unavailable' };
  return { ok: true, status: 200, token: minted.token, expiresAt: minted.expiresAt, role: verifiedRole };
}

export function initRelaySchema(sql) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS relay_meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS relay_ops (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      op_id TEXT UNIQUE NOT NULL,
      bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      cipher TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS relay_ckpt_meta (
      rev INTEGER PRIMARY KEY,
      seq INTEGER NOT NULL,
      lam INTEGER NOT NULL,
      bytes INTEGER NOT NULL,
      bloques INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS relay_ckpt_blocks (
      rev INTEGER NOT NULL,
      n INTEGER NOT NULL,
      chunk TEXT NOT NULL,
      PRIMARY KEY (rev, n)
    );
  `);
}

export function createRelayStore(storage, clock = Date.now) {
  const sql = storage?.sql;
  const transactionSync = storage?.transactionSync?.bind(storage);
  if (!sql || typeof sql.exec !== 'function' || typeof transactionSync !== 'function') {
    throw new TypeError('Durable Object SQLite storage is required');
  }
  let rateWindow = { start: 0, count: 0 };

  function getOrCreateDoSecret() {
    const row = sql.exec("SELECT v FROM relay_meta WHERE k = 'session_secret'").toArray()[0];
    if (row && typeof row.v === 'string' && row.v.length >= 64) return row.v;
    const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
    sql.exec("INSERT INTO relay_meta(k,v) VALUES ('session_secret',?) ON CONFLICT(k) DO NOTHING", secret);
    const saved = sql.exec("SELECT v FROM relay_meta WHERE k = 'session_secret'").toArray()[0];
    return saved ? saved.v : secret;
  }

  function checkRate() {
    const now = clock();
    if (now - rateWindow.start >= RATE_WINDOW_MS) {
      rateWindow = { start: now, count: 1 };
      return true;
    }
    if (rateWindow.count >= RATE_LIMIT_PER_MIN) return false;
    rateWindow.count++;
    return true;
  }

  function getIntMeta(k, def = 0) {
    const row = sql.exec('SELECT v FROM relay_meta WHERE k = ?', k).toArray()[0];
    if (!row) return def;
    const n = Number(row.v);
    return Number.isSafeInteger(n) && n >= 0 ? n : def;
  }

  function setIntMeta(k, val) {
    sql.exec('INSERT INTO relay_meta(k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, String(val));
  }

  function readHeadSync() {
    const rev = getIntMeta('rev', 0);
    const lastOp = sql.exec('SELECT seq FROM relay_ops ORDER BY seq DESC LIMIT 1').toArray()[0];
    const seq = lastOp ? Number(lastOp.seq) : 0;
    return { rev, seq };
  }

  function readCkptSync(rev) {
    const meta = sql.exec('SELECT rev, seq, lam, bytes, bloques FROM relay_ckpt_meta WHERE rev = ?', rev).toArray()[0];
    if (!meta) return null;
    const parts = sql.exec('SELECT n, chunk FROM relay_ckpt_blocks WHERE rev = ? ORDER BY n', rev).toArray();
    if (parts.length !== meta.bloques) throw new Error('ckpt-blocks-incomplete');
    let joined = '';
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].n !== i) throw new Error('ckpt-block-order');
      joined += parts[i].chunk;
    }
    return { rev: Number(meta.rev), seq: Number(meta.seq), lam: Number(meta.lam), c: joined, bytes: Number(meta.bytes) };
  }

  return Object.freeze({
    checkRate,
    getOrCreateDoSecret,
    head() {
      return readHeadSync();
    },
    async putOp({ id, c }) {
      if (typeof id !== 'string' || !OP_ID_RE.test(id)) return { ok: false, status: 400, reason: 'invalid-op-id' };
      const check = validateCipherBase64(c, MAX_OP_B64);
      if (!check.ok) return { ok: false, status: check.reason === 'cipher-size-invalid' ? 413 : 400, reason: check.reason };
      let result;
      transactionSync(() => {
        const existing = sql.exec('SELECT seq FROM relay_ops WHERE op_id = ?', id).toArray()[0];
        if (existing) {
          result = { ok: true, status: 200, seq: Number(existing.seq), duplicate: true };
          return;
        }
        const total = getIntMeta('total_bytes', 0);
        if (total + check.bytes > MAX_STORE_BYTES) {
          result = { ok: false, status: 507, reason: 'store-quota-exceeded' };
          return;
        }
        const now = clock();
        const inserted = sql.exec(
          'INSERT INTO relay_ops(op_id, bytes, created_at, cipher) VALUES (?,?,?,?) RETURNING seq',
          id, check.bytes, now, c
        ).toArray()[0];
        setIntMeta('total_bytes', total + check.bytes);
        result = { ok: true, status: 201, seq: Number(inserted.seq), duplicate: false };
      });
      if (result.ok && !result.duplicate && typeof storage.sync === 'function') {
        await storage.sync();
      }
      return result;
    },
    async putCkpt({ rev: expectedRev, seq, lam, c }) {
      const check = validateCipherBase64(c, MAX_CKPT_B64);
      if (!check.ok) return { ok: false, status: check.reason === 'cipher-size-invalid' ? 413 : 400, reason: check.reason };
      const exp = expectedRev === undefined || expectedRev === null ? null : Number(expectedRev);
      if (exp !== null && (!Number.isSafeInteger(exp) || exp < 0)) {
        return { ok: false, status: 400, reason: 'invalid-rev' };
      }
      const seqNum = Math.max(0, Number(seq) || 0);
      const lamNum = Math.max(0, Number(lam) || 0);
      let result;
      transactionSync(() => {
        const curRev = getIntMeta('rev', 0);
        if (exp !== null && exp !== curRev) {
          result = { ok: false, status: 409, conflict: true, rev: curRev };
          return;
        }
        const total = getIntMeta('total_bytes', 0);
        if (total + check.bytes > MAX_STORE_BYTES) {
          result = { ok: false, status: 507, conflict: false, reason: 'store-quota-exceeded' };
          return;
        }
        const nextRev = curRev + 1;
        const blocks = Math.ceil(c.length / CKPT_BLOCK_CHARS);
        const now = clock();
        sql.exec(
          'INSERT INTO relay_ckpt_meta(rev, seq, lam, bytes, bloques, created_at) VALUES (?,?,?,?,?,?)',
          nextRev, seqNum, lamNum, check.bytes, blocks, now
        );
        for (let n = 0; n < blocks; n++) {
          sql.exec(
            'INSERT INTO relay_ckpt_blocks(rev, n, chunk) VALUES (?,?,?)',
            nextRev, n, c.slice(n * CKPT_BLOCK_CHARS, (n + 1) * CKPT_BLOCK_CHARS)
          );
        }
        // Retain every recovery point. The quota rejects new writes before changing stored history.
        setIntMeta('rev', nextRev);
        setIntMeta('total_bytes', total + check.bytes);
        result = { ok: true, status: 201, conflict: false, rev: nextRev };
      });
      if (result.ok && typeof storage.sync === 'function') {
        await storage.sync();
      }
      return result;
    },
    pull({ rev: clientRev, seq: clientSeq, limit }) {
      const curRev = getIntMeta('rev', 0);
      const reqRev = Number(clientRev);
      const reqLimit = Math.min(MAX_PULL_LIMIT, Math.max(1, Number(limit) || 64));
      let cursor = Math.max(0, Number(clientSeq) || 0);
      let budget = PAGE_BUDGET_BYTES;
      const frames = [];
      let includedCkpt = false;
      if (!Number.isSafeInteger(reqRev) || reqRev !== curRev) {
        const prevCursor = cursor;
        cursor = 0;
        if (curRev > 0) {
          const ckpt = readCkptSync(curRev);
          if (ckpt && ckpt.c) {
            frames.push(ckpt.c);
            includedCkpt = true;
            budget = Math.max(0, budget - ckpt.bytes);
            cursor = Math.max(ckpt.seq, prevCursor);
          }
        }
      }
      const rows = sql.exec(
        'SELECT seq, bytes, cipher FROM relay_ops WHERE seq > ? ORDER BY seq ASC LIMIT ?',
        cursor, reqLimit + 1
      ).toArray();
      const hasExtraRow = rows.length > reqLimit;
      const pageRows = hasExtraRow ? rows.slice(0, reqLimit) : rows;
      let used = 0;
      let newSeq = cursor;
      let opCount = 0;
      let more = hasExtraRow;
      for (const row of pageRows) {
        const b = Number(row.bytes) || Math.floor((row.cipher.length * 3) / 4);
        if ((opCount > 0 || includedCkpt) && used + b > budget) {
          more = true;
          break;
        }
        frames.push(row.cipher);
        used += b;
        newSeq = Number(row.seq);
        opCount++;
      }
      return {
        ok: true,
        rev: curRev,
        seq: newSeq,
        n: opCount,
        more,
        frames
      };
    }
  });
}

export async function readBoundedJson(req, maxBytes) {
  const len = req.headers.get('content-length');
  if (len !== null && (!/^\d+$/.test(len) || Number(len) > maxBytes)) {
    throw Object.assign(new Error('body-too-large'), { status: 413 });
  }
  if (!req.body || typeof req.body.getReader !== 'function') {
    throw Object.assign(new Error('body-required'), { status: 400 });
  }
  const reader = req.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += part.byteLength;
      if (total > maxBytes) throw Object.assign(new Error('body-too-large'), { status: 413 });
      chunks.push(part);
    }
  } catch (err) {
    try { await reader.cancel(); } catch (_) {}
    throw err;
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const part of chunks) { buf.set(part, off); off += part.byteLength; }
  try {
    const parsed = JSON.parse(DEC.decode(buf));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw Object.assign(new Error('invalid-json'), { status: 400 });
    }
    return parsed;
  } catch (err) {
    if (err.status) throw err;
    throw Object.assign(new Error('invalid-json'), { status: 400 });
  }
}
