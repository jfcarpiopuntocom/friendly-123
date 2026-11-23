// PORT2 C17a: least-privilege one-use HTTP ticket client for Team roles (admin / empleado).
// Mirrors server ws-authority-client.js & ws-capability-issuer.mjs CEILING:
// Team NEVER accesses raw Yjs rooms (-cat, -priv, or -ops WS) and NEVER gets fotos:write.
// Reads transient credentials on every attempt; retains no PIN, subject, or token.

const ISSUER = 'https://friendly123-licencias.jfcarpio.workers.dev/ws/ticket';
const LICENSE = /^F123-[A-Z0-9*~$=-]{8,34}$/;
const INSTANCE = /^[A-Za-z0-9_-]{6,120}$/;
const SUBJECT = /^[A-Za-z0-9_-]{5,120}$/;
const CAT_ROOM = /^[a-f0-9]{32}-cat$/;
const OPS_ROOM = /^[a-f0-9]{32}-ops$/;
const FOTOS_ROOM = /^[a-f0-9]{32}-fotos$/;
const PIN = /^\d{3}$/;

// Single-scope permissions matching server ws-capability-issuer.mjs CEILING (Sync4 C16).
// Team gets read-only -cat (cat:read), never cat:write, priv:*, or fotos:write.
const TEAM_ROLE_SCOPES = Object.freeze({
  admin: Object.freeze(['cat:read', 'ops:sale', 'ops:adjust', 'ops:payment', 'fotos:read']),
  empleado: Object.freeze(['cat:read', 'ops:sale', 'ops:payment', 'fotos:read'])
});

const SCOPE_ROOM_MATCH = Object.freeze({
  'cat:read': CAT_ROOM,
  'ops:sale': OPS_ROOM,
  'ops:adjust': OPS_ROOM,
  'ops:payment': OPS_ROOM,
  'fotos:read': FOTOS_ROOM
});

const unavailable = () => new Error('WS authorization unavailable');

export function createTeamTicketParams({
  licenseCode,
  instanceId,
  room,
  scope,
  getCredentials,
  fetch: send = globalThis.fetch?.bind(globalThis)
} = {}) {
  const roomPattern = Object.hasOwn(SCOPE_ROOM_MATCH, scope) ? SCOPE_ROOM_MATCH[scope] : null;
  if (!LICENSE.test(licenseCode || '') ||
      !INSTANCE.test(instanceId || '') ||
      !roomPattern ||
      !roomPattern.test(room || '') ||
      typeof getCredentials !== 'function' ||
      typeof send !== 'function') {
    throw unavailable();
  }

  function snapshot() {
    const c = getCredentials();
    if (!c || c.kind !== 'team' ||
        c.licenseCode !== licenseCode ||
        c.instanceId !== instanceId ||
        !SUBJECT.test(c.subject || '') ||
        !Object.hasOwn(TEAM_ROLE_SCOPES, c.role) ||
        !TEAM_ROLE_SCOPES[c.role].includes(scope) ||
        typeof c.pin !== 'string' || !PIN.test(c.pin) ||
        c.pin === '456' || c.pin === '789') {
      throw unavailable();
    }
    return {
      kind: 'team',
      licenseCode,
      instanceId,
      subject: c.subject,
      role: c.role,
      pin: c.pin
    };
  }

  return async function freshTeamParams() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2400);
    try {
      const credentials = snapshot();
      const response = await send(ISSUER, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ credentials, room, scopes: [scope], ttlMs: 30_000 })
      });
      if (!response?.ok) throw unavailable();
      const data = await response.json();
      const current = snapshot();
      const now = Date.now();
      if (current.pin !== credentials.pin ||
          current.subject !== credentials.subject ||
          current.role !== credentials.role ||
          data?.ok !== true ||
          typeof data.token !== 'string' ||
          data.token.length > 3500 ||
          !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data.token) ||
          !Number.isSafeInteger(data.expiresAt) ||
          data.expiresAt <= now ||
          data.expiresAt > now + 60_000) {
        throw unavailable();
      }
      return Object.freeze({ licencia: licenseCode, instancia: instanceId, cap: data.token });
    } catch (_) {
      throw unavailable();
    } finally {
      clearTimeout(timer);
    }
  };
}
