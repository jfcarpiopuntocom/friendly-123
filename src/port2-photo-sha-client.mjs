// PORT2 C18a: hardened HTTP SHA photo client (Owner PUT/GET + Team read-only GET).
// Pins bearer destination strictly to the authorized QA Worker, enforces bounded
// AbortController timeouts, visibility guards, single-flight deduplication per
// (method, sha), and end-to-end SHA-256 byte verification. Uses existing DO SQLite
// (zero R2, zero new paid services).

import {createOwnerTicketParams} from './ws-owner-ticket-params.mjs';
import {createTeamTicketParams} from './ws-team-ticket-params.mjs';

const APPROVED_HOST = 'friendly123-yparty-port2-canary-qa.jfcarpio.workers.dev';
const SHA = /^[a-f0-9]{64}$/;
const ROOM = /^[a-f0-9]{32}$/;
const LICENSE = /^F123-[A-Z0-9*~$=-]{8,34}$/;
const INSTANCE = /^[A-Za-z0-9_-]{6,120}$/;
const MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 6 * 1024 * 1024;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 15_000;

const deny = () => new Error('Photo SHA client unavailable');

async function hashBytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function bytesFromDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl || '');
  if (!m || !MIME.has(m[1]) || m[2].length > Math.ceil(MAX_BYTES / 3) * 4 + 4) throw deny();
  let binary;
  try { binary = atob(m[2]); } catch (_) { throw deny(); }
  if (binary.length < 1 || binary.length > MAX_BYTES) throw deny();
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { tipo: m[1], bytes };
}

function toDataUrl(mime, bytes) {
  const parts = [];
  for (let at = 0; at < bytes.length; at += 32768) {
    parts.push(String.fromCharCode(...bytes.subarray(at, at + 32768)));
  }
  return 'data:' + mime + ';base64,' + btoa(parts.join(''));
}

function validateCommon({ host, licenseCode, instanceId, room, getCredentials, isVisible, timeoutMs, send }) {
  if (host !== APPROVED_HOST ||
      !LICENSE.test(licenseCode || '') ||
      !INSTANCE.test(instanceId || '') ||
      !ROOM.test(room || '') ||
      typeof getCredentials !== 'function' ||
      typeof isVisible !== 'function' ||
      typeof send !== 'function' ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw deny();
  }
}

function createRunner({ host, licenseCode, instanceId, room, isVisible, timeoutMs, send, mintTicket }) {
  const endpoint = 'https://' + host + '/parties/tienda/' + room + '-fotos';
  const inFlight = new Map();

  function singleFlight(key, fn) {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = (async () => {
      try {
        return await fn();
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, promise);
    return promise;
  }

  async function request(kind, sha, bytes, tipo) {
    if (!isVisible()) throw deny();
    let params;
    try {
      params = await mintTicket(kind);
    } catch (_) {
      throw deny();
    }
    if (!isVisible() || typeof params?.cap !== 'string' || !params.cap) throw deny();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        authorization: 'Bearer ' + params.cap,
        'x-f123-license': licenseCode,
        'x-f123-instance': instanceId,
        ...(kind === 'write' ? { 'content-type': tipo } : {})
      };
      const response = await send(endpoint + '?sha=' + sha, {
        method: kind === 'write' ? 'PUT' : 'GET',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
        headers,
        ...(kind === 'write' ? { body: bytes } : {})
      });
      if (!response?.ok) throw deny();
      // The fetch promise resolves after HEADERS, not after response.body.
      // Keep AbortController alive until the SHA-256 verified body/receipt
      // has been consumed; otherwise Safari can stall forever after HTTP 200.
      return { response, finish: () => clearTimeout(timer) };
    } catch (_) {
      clearTimeout(timer);
      throw deny();
    }
  }

  async function get(sha) {
    if (!SHA.test(sha || '') || !isVisible()) throw deny();
    return singleFlight('GET:' + sha, async () => {
      const { response, finish } = await request('read', sha);
      try {
        const tipo = response.headers.get('content-type');
        const declared = response.headers.get('content-length');
        if (!MIME.has(tipo) ||
            (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES))) {
          throw deny();
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length || bytes.length > MAX_BYTES ||
            (declared !== null && Number(declared) !== bytes.length) ||
            await hashBytes(bytes) !== sha) {
          throw deny();
        }
        return toDataUrl(tipo, bytes);
      } catch (_) {
        throw deny();
      } finally {
        finish();
      }
    });
  }

  async function put(sha, dataUrl) {
    if (!SHA.test(sha || '') || !isVisible()) throw deny();
    const { bytes, tipo } = bytesFromDataUrl(dataUrl);
    if (await hashBytes(bytes) !== sha) throw deny();
    return singleFlight('PUT:' + sha, async () => {
      const { response, finish } = await request('write', sha, bytes, tipo);
      try {
        if (![200, 201].includes(response.status)) throw deny();
        const receipt = await response.json();
        if (receipt?.sha !== sha || receipt.bytes !== bytes.length || receipt.tipo !== tipo) {
          throw deny();
        }
        return Object.freeze({ sha, bytes: bytes.length, tipo });
      } catch (_) {
        throw deny();
      } finally {
        finish();
      }
    });
  }

  return { get, put };
}

export function createOwnerPhotoShaClient({
  host = APPROVED_HOST,
  licenseCode,
  instanceId,
  room,
  getCredentials,
  isVisible = () => typeof document === 'undefined' || !document.hidden,
  timeoutMs = 8000,
  fetch: send = globalThis.fetch?.bind(globalThis)
} = {}) {
  validateCommon({ host, licenseCode, instanceId, room, getCredentials, isVisible, timeoutMs, send });
  const fotosRoom = room + '-fotos';
  const mintTicket = (kind) => createOwnerTicketParams({
    licenseCode,
    instanceId,
    room: fotosRoom,
    photoScope: kind,
    getCredentials,
    fetch: send
  })();
  const { get, put } = createRunner({
    host, licenseCode, instanceId, room, isVisible, timeoutMs, send, mintTicket
  });
  return Object.freeze({ get, put });
}

export function createTeamPhotoShaReader({
  host = APPROVED_HOST,
  licenseCode,
  instanceId,
  room,
  getCredentials,
  isVisible = () => typeof document === 'undefined' || !document.hidden,
  timeoutMs = 8000,
  fetch: send = globalThis.fetch?.bind(globalThis)
} = {}) {
  validateCommon({ host, licenseCode, instanceId, room, getCredentials, isVisible, timeoutMs, send });
  const fotosRoom = room + '-fotos';
  const mintTicket = (kind) => {
    if (kind !== 'read') throw deny();
    return createTeamTicketParams({
      licenseCode,
      instanceId,
      room: fotosRoom,
      scope: 'fotos:read',
      getCredentials,
      fetch: send
    })();
  };
  const { get } = createRunner({
    host, licenseCode, instanceId, room, isVisible, timeoutMs, send, mintTicket
  });
  // Strictly read-only: put is intentionally absent for Team roles.
  return Object.freeze({ get });
}
