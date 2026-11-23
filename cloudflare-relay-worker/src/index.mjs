import { DurableObject } from 'cloudflare:workers';
import {
  ROOM_RE,
  MAX_CKPT_B64,
  MAX_OP_B64,
  isOriginAllowed,
  exchangeTicketForSession,
  verifySessionToken,
  initRelaySchema,
  createRelayStore,
  readBoundedJson
} from './priv-relay-core.mjs';

const ROUTE_RE = /^\/f123\/([a-f0-9]{40}(?:-y|-ops|-fotos)?)\/(session|head|pull|op|ckpt|ts)$/;
const ALLOWED_HEADERS = new Set([
  'authorization',
  'content-type',
  'x-f123-license',
  'x-f123-instance',
  'x-f123-role'
]);

function corsHeaders(origin) {
  const base = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (!origin) return base;
  return { ...base, 'access-control-allow-origin': origin, 'vary': 'Origin' };
}

function jsonReply(body, status, origin, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin), ...extra }
  });
}

export class RelayPrivado extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = null;
    this.doSecret = null;
    ctx.blockConcurrencyWhile(async () => {
      initRelaySchema(this.ctx.storage.sql);
      this.store = createRelayStore(this.ctx.storage);
      this.doSecret = this.store.getOrCreateDoSecret();
    });
  }

  async fetch(req) {
    const url = new URL(req.url);
    const m = ROUTE_RE.exec(url.pathname);
    if (!m) return jsonReply({ ok: false, reason: 'not-found' }, 404, null);
    const room = m[1];
    const action = m[2];
    if (!this.store.checkRate()) {
      return jsonReply({ ok: false, reason: 'rate-limited' }, 429, null, { 'retry-after': '5' });
    }
    const authHeader = req.headers.get('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    try {
      if (action === 'session') {
        if (req.method !== 'POST') return jsonReply({ ok: false, reason: 'method-not-allowed' }, 405, null);
        let body = null;
        if (req.headers.get('content-type')?.includes('application/json')) {
          body = await readBoundedJson(req, 4096).catch(() => null);
        }
        const res = await exchangeTicketForSession({
          env: this.env,
          room,
          licenseCode: req.headers.get('x-f123-license') || body?.credentials?.licenseCode,
          instanceId: req.headers.get('x-f123-instance') || body?.credentials?.instanceId,
          roleHint: req.headers.get('x-f123-role') || body?.role,
          ticket: bearer,
          credentials: body?.credentials || null,
          fallbackSecret: this.doSecret
        });
        if (!res.ok) return jsonReply({ ok: false, reason: res.reason }, res.status, null);
        return jsonReply({ ok: true, token: res.token, expiresAt: res.expiresAt, role: res.role }, 200, null);
      }

      const verified = await verifySessionToken(this.env, bearer, room, Date.now, this.doSecret);
      if (!verified.ok) {
        return jsonReply({ ok: false, reason: verified.reason }, 401, null);
      }

      if (action === 'ts') {
        if (req.method !== 'GET') return jsonReply({ ok: false, reason: 'method-not-allowed' }, 405, null);
        return jsonReply({ ok: true, t1: Date.now() }, 200, null);
      }
      if (action === 'head') {
        if (req.method !== 'GET') return jsonReply({ ok: false, reason: 'method-not-allowed' }, 405, null);
        const h = this.store.head();
        return jsonReply({ ok: true, v: 2, rev: h.rev, seq: h.seq }, 200, null);
      }
      if (action === 'pull') {
        if (req.method !== 'GET') return jsonReply({ ok: false, reason: 'method-not-allowed' }, 405, null);
        const rev = url.searchParams.get('rev');
        const seq = url.searchParams.get('seq');
        const limit = url.searchParams.get('limit');
        const res = this.store.pull({ rev, seq, limit });
        return jsonReply(res, 200, null);
      }
      if (action === 'op') {
        if (req.method !== 'POST') return jsonReply({ ok: false, reason: 'method-not-allowed' }, 405, null);
        const body = await readBoundedJson(req, MAX_OP_B64 + 16384);
        const res = await this.store.putOp({ id: body.id, c: body.c });
        return jsonReply(res, res.status || (res.ok ? 200 : 400), null);
      }
      if (action === 'ckpt') {
        if (req.method !== 'POST') return jsonReply({ ok: false, reason: 'method-not-allowed' }, 405, null);
        const body = await readBoundedJson(req, MAX_CKPT_B64 + 16384);
        const res = await this.store.putCkpt({ rev: body.rev, seq: body.seq, lam: body.lam, c: body.c });
        return jsonReply(res, res.status || (res.ok ? 200 : 400), null);
      }
      return jsonReply({ ok: false, reason: 'not-found' }, 404, null);
    } catch (err) {
      const status = Number.isInteger(err?.status) ? err.status : 500;
      const reason = status < 500 && err?.message ? err.message : 'relay-error';
      return jsonReply({ ok: false, reason }, status, null);
    }
  }
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('origin');
    if (origin && !isOriginAllowed(origin, env)) {
      return jsonReply({ ok: false, reason: 'origin-denied' }, 403, null);
    }
    const url = new URL(req.url);
    const m = ROUTE_RE.exec(url.pathname);
    if (!m) {
      return jsonReply({ ok: false, reason: 'not-found' }, 404, origin);
    }
    const room = m[1];
    const action = m[2];
    if (!ROOM_RE.test(room)) {
      return jsonReply({ ok: false, reason: 'invalid-room' }, 400, origin);
    }

    if (req.method === 'OPTIONS') {
      const reqMethod = (req.headers.get('access-control-request-method') || '').toUpperCase();
      const reqHeaders = (req.headers.get('access-control-request-headers') || '')
        .split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
      if (!origin || !['GET', 'POST'].includes(reqMethod) || reqHeaders.some(h => !ALLOWED_HEADERS.has(h))) {
        return new Response('Acceso no autorizado', { status: 403, headers: { 'cache-control': 'no-store' } });
      }
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(origin),
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'Authorization, Content-Type, X-F123-License, X-F123-Instance, X-F123-Role',
          'access-control-max-age': '600'
        }
      });
    }

    // Fast fail-closed before waking the DO if a data route has no Bearer token at all
    if (action !== 'session') {
      const authHeader = req.headers.get('authorization') || '';
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!bearer || !bearer.includes('.')) {
        return jsonReply({ ok: false, reason: 'unauthorized' }, 401, origin);
      }
    }

    const stub = env.RELAY_PRIVADO.getByName(room);
    const doRes = await stub.fetch(req);
    const headers = new Headers(doRes.headers);
    for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
    return new Response(doRes.body, { status: doRes.status, statusText: doRes.statusText, headers });
  }
};
