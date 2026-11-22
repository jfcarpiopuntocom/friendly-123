// Safe transport selection: only definitive pre-send failure permits next route.
// The caller persists each opId before invoking this selector. All routes MUST
// reach the same authoritative, idempotent ledger.
export function createSilentTransportCascade({routes, timeoutMs = 5000}={}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 20 || timeoutMs > 15000)
    throw new TypeError('timeoutMs must be 20..15000 milliseconds');
  if (!Array.isArray(routes) || !routes.length ||
      routes.some(r => !r || typeof r.name !== 'string' || typeof r.send !== 'function' ||
        typeof r.authority !== 'string' || !r.authority))
    throw new TypeError('explicit shared authority required');
  const authority = routes[0].authority;
  if (routes.some(r => r.authority !== authority)) throw new Error('routes must share authority');
  if (new Set(routes.map(r => r.name)).size !== routes.length) throw new Error('duplicate route');
  return Object.freeze({
    async publish(operation) {
      if (!operation || typeof operation.opId !== 'string' ||
          !/^(?:customer-payment:)?[A-Za-z0-9_-]{8,96}$/.test(operation.opId))
        throw new TypeError('valid opId required');
      for (const route of routes) {
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
          return Object.freeze({confirmed:false, route:null, opId:operation.opId,
            stage:'commit-unverified', retryTarget:'same-authority-only'});
        } finally {
          clearTimeout(timer);
        }
        if (timedOut) return Object.freeze({confirmed:false, route:null, opId:operation.opId,
          stage:'commit-unverified', retryTarget:'same-authority-only'});
        if (receipt?.ack === true && receipt.opId === operation.opId &&
            receipt.authority === authority && receipt.durable === true)
          return Object.freeze({confirmed:true, route:route.name, opId:operation.opId, receipt});
        if (receipt?.stage !== 'definitively-not-sent')
          return Object.freeze({confirmed:false, route:null, opId:operation.opId,
            stage:'commit-unverified', retryTarget:'same-authority-only'});
      }
      return Object.freeze({confirmed:false, route:null, opId:operation.opId, stage:'all-routes-unavailable'});
    }
  });
}
