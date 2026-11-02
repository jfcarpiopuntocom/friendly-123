// C-03 · Independent proof verifier, never loaded by the published shell.
// A signed physical count is a proposal. Only a VERIFIED causal ancestor path
// through the immutable ledger may make a later count supersede an earlier one.
// This module cannot change inventory, PINs, outboxes or business collections.
const enc = new TextEncoder();
const pattern = /^[A-Za-z0-9_.:-]{1,160}$/;
const valid = (v, label) => {
  if (typeof v !== 'string' || !pattern.test(v)) throw new TypeError(label);
  return v;
};
const natural = (v, label) => {
  if (!Number.isSafeInteger(v) || v < 0) throw new TypeError(label);
  return v;
};
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
const b64 = bytes => btoa([...new Uint8Array(bytes)].map(b => String.fromCharCode(b)).join(''));
const un64 = value => Uint8Array.from(atob(value), s => s.charCodeAt(0));

export function normalizarConteo(input) {
  if (!input || typeof input !== 'object') throw new TypeError('count');
  const ids = input.frontierOpIds;
  if (!Array.isArray(ids) || ids.length > 50000) throw new TypeError('frontierOpIds');
  const frontierOpIds = [...new Set(ids.map(id => valid(id, 'opId')))].sort();
  const prevHash = input.prevHash == null ? '' : String(input.prevHash);
  if (prevHash && !/^[a-f0-9]{64}$/.test(prevHash)) throw new TypeError('prevHash');
  // ts is a logical, witnessed revision, NEVER Date.now() or wall-clock ordering.
  return Object.freeze({
    schema: 1,
    productId: valid(input.productId, 'productId'),
    deviceId: valid(input.deviceId, 'deviceId'),
    epochId: valid(input.epochId, 'epochId'),
    cantidad: natural(input.cantidad, 'cantidad'),
    ts: natural(input.ts, 'logical ts'),
    prevHash,
    frontierOpIds: Object.freeze(frontierOpIds)
  });
}
export async function snapshotFirmado(input, privateKey, subtle = crypto.subtle) {
  if (!privateKey || !privateKey.usages?.includes('sign')) throw new TypeError('signing key');
  const conteo = normalizarConteo(input);
  const body = enc.encode(JSON.stringify(conteo));
  const hash = hex(await subtle.digest('SHA-256', body));
  const signature = b64(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, body));
  return Object.freeze({ ...conteo, hash, signature });
}
export async function verificarConteo(candidate, publicKey, subtle = crypto.subtle) {
  if (!publicKey || !publicKey.usages?.includes('verify')) return false;
  try {
    const conteo = normalizarConteo(candidate);
    const bytes = enc.encode(JSON.stringify(conteo));
    const hash = hex(await subtle.digest('SHA-256', bytes));
    return hash === candidate.hash && typeof candidate.signature === 'string' &&
      await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, un64(candidate.signature), bytes);
  } catch (_) { return false; }
}
export async function ultimoConteoManda(left, right, { keys, causalProof, subtle = crypto.subtle } = {}) {
  // The authorised-device registry lives OUTSIDE this module and must itself be validated.
  // An arbitrary deviceId or SHA256 checksum is not identity or authorisation.
  const base = { status: 'conflicto-sin-prueba', winner: null, applied: false,
    preserved: [left, right].filter(Boolean) };
  if (!left || !right || left.productId !== right.productId) return { ...base, status: 'distinto-producto' };
  if (typeof keys?.get !== 'function' || typeof causalProof !== 'function')
    return { ...base, status: 'sin-autoridad-causal' };
  const verified = await Promise.all([left, right].map(x => verificarConteo(x, keys.get(x.deviceId), subtle)));
  if (!verified.every(Boolean)) return { ...base, status: 'firma-o-dispositivo-no-validado' };
  if (left.hash === right.hash) return { ...base, status: 'misma-prueba', winner: left };
  // No timestamp or majority vote is ever evidence of causal succession.
  const rightChild = right.prevHash === left.hash && await causalProof(right, left) === true;
  const leftChild = left.prevHash === right.hash && await causalProof(left, right) === true;
  if (rightChild === leftChild) return base;
  return { ...base, status: 'sucesor-causal-verificado', winner: rightChild ? right : left };
}
