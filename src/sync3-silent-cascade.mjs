// Sync3 transport-only failover. Each route MUST reach the same idempotent,
// authoritative ledger. A transport receipt alone does not authorize a second
// business execution or count as a durable ACK.
const OP_ID = /^(?:customer-payment:)?[A-Za-z0-9_-]{8,96}$/;
const LICENSE = /^F123-[A-Z0-9*~$=-]{8,34}$/;
export function createSilentTransportCascade({
  routes, timeoutMs = 5000, cooldownMs = 30000, now = () => Date.now()
} = {}) {
  if (!Array.isArray(routes) || !routes.length ||
      routes.some(r => !r || typeof r.name !== 'string' || !r.name ||
        typeof r.send !== 'function' || typeof r.authority !== 'string' || !r.authority))
    throw new TypeError('explicit routes and shared authority required');
  const authority = routes[0].authority;
  if (routes.some(r => r.authority !== authority)) throw new Error('routes must share authority');
  if (new Set(routes.map(r => r.name)).size !== routes.length) throw new Error('duplicate route');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 20 || timeoutMs > 15000)
    throw new TypeError('timeoutMs must be 20..15000 milliseconds');
  if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > 300000 ||
      typeof now !== 'function') throw new TypeError('invalid cooldown or clock');

  const retryAfter = new Map();
  const available = route => now() >= (retryAfter.get(route.name) || 0);
  const defer = route => retryAfter.set(route.name, now() + cooldownMs);
  const unknown = opId => Object.freeze({confirmed:false,route:null,opId,
    stage:'commit-unverified',retryTarget:'same-authority-only'});

  return Object.freeze({
    status() {
      return Object.freeze({
        active: routes.find(available)?.name || null,
        available: Object.freeze(routes.filter(available).map(r => r.name))
      });
    },
    async publish(operation) {
      if (!operation || typeof operation.opId !== 'string' || !OP_ID.test(operation.opId) ||
          typeof operation.license !== 'string' || !LICENSE.test(operation.license))
        throw new TypeError('valid license and opId required');
      for (const route of routes) {
        if (!available(route)) continue;
        let receipt;
        let timedOut = false;
        const controller = new AbortController();
        let timer;
        try {
          receipt = await Promise.race([
            Promise.resolve().then(() => route.send(operation, controller.signal)),
            new Promise(resolve => {
              timer = setTimeout(() => {
                timedOut = true;
                resolve({stage:'commit-unverified'});
                controller.abort();
              }, timeoutMs);
            })
          ]);
        } catch (_) {
          defer(route);
          return unknown(operation.opId);
        } finally {
          clearTimeout(timer);
        }
        // Abort handlers can resolve a pending request before Promise.race
        // propagates our timeout. That is STILL an ambiguous send.
        if (timedOut) {
          defer(route);
          return unknown(operation.opId);
        }
        if (receipt?.ack === true && receipt.opId === operation.opId &&
            receipt.authority === authority && receipt.durable === true) {
          retryAfter.delete(route.name);
          return Object.freeze({confirmed:true, route:route.name, opId:operation.opId, receipt});
        }
        defer(route);
        if (receipt?.stage !== 'definitively-not-sent') return unknown(operation.opId);
      }
      return Object.freeze({confirmed:false, route:null,opId:operation.opId,
        stage:'all-routes-unavailable'});
    }
  });
}
