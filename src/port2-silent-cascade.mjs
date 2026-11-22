// Transport selection only. The caller must durably persist the op before publish.
// All routes MUST reach the same idempotent commercial authority; this module
// cannot manufacture a shared ledger or turn transport receipt into business commit.
export function createSilentTransportCascade({routes}={}) {
  if (!Array.isArray(routes) || !routes.length || routes.some(r=>!r || typeof r.name!=='string' || typeof r.send!=='function')) {
    throw new TypeError('routes required');
  }
  const authority=routes[0].authority ?? 'shared';
  if (routes.some(r=>(r.authority ?? 'shared')!==authority)) throw new Error('routes must share authority');
  const names=new Set(routes.map(r=>r.name));
  if (names.size!==routes.length) throw new Error('duplicate route');
  return Object.freeze({
    async publish(operation) {
      if (!operation || typeof operation.opId!=='string' || !/^[A-Za-z0-9_:-]{8,100}$/.test(operation.opId)) {
        throw new TypeError('valid opId required');
      }
      for (const route of routes) {
        try {
          const receipt=await route.send(operation);
          if (receipt?.ack===true && receipt.opId===operation.opId) {
            return Object.freeze({confirmed:true,route:route.name,opId:operation.opId,receipt});
          }
        } catch (_) { /* next route, same opId */ }
      }
      return Object.freeze({confirmed:false,route:null,opId:operation.opId});
    }
  });
}
