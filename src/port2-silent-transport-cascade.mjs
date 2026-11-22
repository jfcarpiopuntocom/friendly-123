// Architecture 2.0 transport failover. Pure control plane: transports retain their own
// authentication, durable opId ledger and ciphertext. This module never creates an ACK.
const VALID = new Set(['A', 'B', 'C']);
export function createSilentTransportCascade({routes, now = () => Date.now(),
  initial = 'A', failureThreshold = 2, cooldownMs = 30000, onTransition = () => {}} = {}) {
  if (!routes || typeof routes !== 'object' || !VALID.has(initial) ||
      !Number.isInteger(failureThreshold) || failureThreshold < 1 ||
      !Number.isFinite(cooldownMs) || cooldownMs < 0 ||
      typeof now !== 'function' || typeof onTransition !== 'function') {
    throw new TypeError('invalid transport cascade configuration');
  }
  const order = ['A', 'B', 'C'];
  const health = Object.fromEntries(order.map(id => [id, {failures: 0, until: 0}]));
  for (const id of order) {
    if (routes[id] !== undefined && (typeof routes[id]?.send !== 'function' ||
        typeof routes[id]?.verify !== 'function')) {
      throw new TypeError('route needs send and durable verification');
    }
  }
  if (!routes[initial]) throw new TypeError('initial route unavailable');
  let active = initial;
  let inFlight = false;
  function eligible(id) { return !!routes[id] && now() >= health[id].until; }
  function nextRoute() {
    return order.find(id => eligible(id)) || null;
  }
  function select() {
    const preferred = nextRoute();
    if (preferred !== active && preferred) {
      const previous = active;
      active = preferred;
      onTransition(Object.freeze({previous, active}));
    }
    return preferred;
  }
  async function publish(envelope) {
    if (inFlight) return Object.freeze({accepted: false, reason: 'busy'});
    if (!envelope || typeof envelope.opId !== 'string' || !envelope.opId ||
        typeof envelope.license !== 'string' || !envelope.license) {
      throw new TypeError('durable envelope with license and opId required');
    }
    inFlight = true;
    try {
      // A missing ACK is not failure permission to execute on another business
      // authority. Each route is only a transport of the SAME durable ledger.
      for (let attempt = 0; attempt < order.length; attempt++) {
        const id = select();
        if (!id) return Object.freeze({accepted: false, reason: 'all-routes-unavailable'});
        try {
          const result = await routes[id].send(envelope);
          if (result?.ambiguous === true) {
            return Object.freeze({accepted: false, reason: 'commit-unverified', route: id});
          }
          if (result?.ok === true && await routes[id].verify(envelope, result) === true) {
            health[id].failures = 0;
            return Object.freeze({accepted: true, route: id, opId: envelope.opId});
          }
          // A delivered but unverified write may have committed; retry ONLY when
          // the route explicitly proves rejection before any business execution.
          if (result?.definitelyNotCommitted !== true) {
            return Object.freeze({accepted: false, reason: 'commit-unverified', route: id});
          }
        } catch (_) {
          // Network errors are ambiguous after the request is sent.
          return Object.freeze({accepted: false, reason: 'commit-unverified', route: id});
        }
        health[id].failures++;
        if (health[id].failures >= failureThreshold) {
          health[id].until = now() + cooldownMs;
          health[id].failures = 0;
        } else {
          // Select the next route for this cycle, without punishing a healthy
          // primary across independent publications.
          health[id].until = now() + cooldownMs;
          health[id].failures = 0;
        }
      }
      return Object.freeze({accepted: false, reason: 'all-routes-unavailable'});
    } finally { inFlight = false; }
  }
  return Object.freeze({
    publish,
    status: () => Object.freeze({active, available: order.filter(eligible)}),
    reset: id => {
      if (!VALID.has(id)) throw new TypeError('invalid route');
      health[id].failures = 0;
      health[id].until = 0;
    }
  });
}
