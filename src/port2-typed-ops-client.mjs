// PORT2 C15: typed HTTP commercial command client for -ops Durable Object.
// Enforces strict client-side schema whitelist BEFORE calling /ws/ticket,
// requests least-privilege one-use HTTP scopes (ops:sale | ops:adjust | ops:payment),
// and distinguishes HTTP 200 business-committed from HTTP 202 stored-for-application,
// HTTP 409 conflict-quarantine, HTTP 401/403 auth-denied and network/5xx fallback.
const ISSUER = 'https://friendly123-licencias.jfcarpio.workers.dev/ws/ticket';
const HOST = 'friendly123-yparty-port2-canary-qa.jfcarpio.workers.dev';
const OPS_ROOM = /^[a-f0-9]{32}-ops$/;
const LICENSE = /^F123-[A-Z0-9*~$=-]{8,34}$/;
const INSTANCE = /^[A-Za-z0-9_-]{6,128}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const OP_ID = /^[A-Za-z0-9_-]{8,96}$/;
const CUSTOMER_PAYMENT_OP_ID = /^customer-payment:[A-Za-z0-9_-]{8,79}$/;
const RECEIPT_ID = /^[a-f0-9]{24}$/;
const MAX_AMOUNT = 10_000_000_000;
const OPS_SCOPES = Object.freeze(['sale', 'adjust', 'payment']);

// Mirrors server typed-commercial-ledger.mjs AND central ws-capability-issuer.mjs CEILING.
// expense.record is deliberately excluded until ops:expense is approved in issuer CEILING.
const SUPPORTED_KINDS = Object.freeze({
  'sale.record': {opsScope: 'sale', detail: 'productId', quantity: true},
  'stock.adjust': {opsScope: 'adjust', detail: 'productId', quantity: true, count: true},
  'credit.payment.record': {opsScope: 'payment', detail: 'receivableId', quantity: false},
  'credit.customer.payment.record': {opsScope: 'payment', detail: 'clienteId', quantity: false, customerPayment: true}
});

// Least-privilege one-use HTTP ticket for typed -ops commands (never mixes ops:read
// or cat/fotos/priv, never persists PIN, never reuses tokens across attempts).
export async function requestTypedOpsTicket({
  licenseCode,
  instanceId,
  room,
  opsScope,
  getCredentials,
  fetch: send = globalThis.fetch?.bind(globalThis)
} = {}) {
  const unavailable = () => new Error('WS authorization unavailable');
  if (!LICENSE.test(licenseCode || '') ||
      !INSTANCE.test(instanceId || '') ||
      !OPS_ROOM.test(room || '') ||
      !OPS_SCOPES.includes(opsScope) ||
      typeof getCredentials !== 'function' ||
      typeof send !== 'function') {
    throw unavailable();
  }
  const snapshot = () => {
    const c = getCredentials();
    if (c?.kind !== 'owner' || c.licenseCode !== licenseCode || c.instanceId !== instanceId ||
        typeof c.pin !== 'string' || !/^\d{3}$/.test(c.pin) || ['456', '789'].includes(c.pin)) {
      throw unavailable();
    }
    return {kind: 'owner', licenseCode, instanceId, pin: c.pin};
  };
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
      headers: {'content-type': 'application/json'},
      signal: controller.signal,
      body: JSON.stringify({credentials, room, scopes: ['ops:' + opsScope], ttlMs: 30000})
    });
    if (!response?.ok) throw unavailable();
    const data = await response.json();
    const current = snapshot();
    const now = Date.now();
    if (current.pin !== credentials.pin || data?.ok !== true ||
        typeof data.token !== 'string' || data.token.length > 3500 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data.token) ||
        !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= now || data.expiresAt > now + 60000) {
      throw unavailable();
    }
    return Object.freeze({licencia: licenseCode, instancia: instanceId, cap: data.token});
  } catch (_) {
    throw unavailable();
  } finally {
    clearTimeout(timer);
  }
}

export function validateTypedCommercialCommand(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    return {ok: false, reason: 'invalid-command'};
  }
  if (command.kind === 'expense.record') {
    return {ok: false, reason: 'unsupported-issuer-scope'};
  }
  const contract = SUPPORTED_KINDS[command.kind];
  if (!contract || !LICENSE.test(command.license || '')) {
    return {ok: false, reason: 'invalid-command'};
  }
  const validOpId = contract.customerPayment
    ? CUSTOMER_PAYMENT_OP_ID.test(command.opId || '')
    : OP_ID.test(command.opId || '');
  if (!validOpId) return {ok: false, reason: 'invalid-command'};

  const required = ['opId', 'license', 'kind', contract.detail, 'amountCents', ...(contract.quantity ? ['quantity'] : [])];
  const keys = Object.keys(command);
  if (keys.length !== required.length ||
      !keys.every(k => required.includes(k)) ||
      !ID.test(command[contract.detail] || '') ||
      !Number.isSafeInteger(command.amountCents) ||
      command.amountCents < 0 || command.amountCents > MAX_AMOUNT ||
      (contract.customerPayment && command.amountCents === 0) ||
      (contract.count && command.amountCents !== 0) ||
      (contract.quantity && (!Number.isSafeInteger(command.quantity) ||
        command.quantity < (contract.count ? 0 : 1) ||
        command.quantity > (contract.count ? 1_000_000 : 10_000)))) {
    return {ok: false, reason: 'invalid-command'};
  }
  return {
    ok: true,
    opsScope: contract.opsScope,
    canonical: Object.freeze({
      license: command.license,
      opId: command.opId,
      kind: command.kind,
      [contract.detail]: command[contract.detail],
      ...(contract.quantity ? {quantity: command.quantity} : {}),
      amountCents: command.amountCents
    })
  };
}

function outcome(fields) {
  return Object.freeze({
    committed: false,
    duplicate: false,
    fallbackLegacy: false,
    retryable: false,
    quarantine: false,
    status: 0,
    receipt: null,
    ...fields
  });
}

async function expectedReceiptId(canonical) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

function validReceipt(receipt, cmd, expectedStage, expectedId) {
  return !!receipt && typeof receipt === 'object' &&
    receipt.opId === cmd.opId &&
    receipt.license === cmd.license &&
    receipt.kind === cmd.kind &&
    RECEIPT_ID.test(receipt.receiptId || '') &&
    receipt.receiptId === expectedId &&
    Number.isSafeInteger(receipt.acceptedAt) && receipt.acceptedAt >= 0 &&
    receipt.stage === expectedStage;
}

export async function dispatchTypedCommercialCommand({
  room,
  licenseCode,
  instanceId,
  command,
  getCredentials,
  fetch: send = globalThis.fetch?.bind(globalThis),
  isVisible = () => globalThis.document?.hidden !== true,
  timeoutMs = 4500,
  host = HOST
} = {}) {
  const checked = validateTypedCommercialCommand(command);
  if (!checked.ok) {
    return outcome({stage: checked.reason, fallbackLegacy: checked.reason === 'unsupported-issuer-scope'});
  }
  if (!OPS_ROOM.test(room || '') ||
      !LICENSE.test(licenseCode || '') ||
      checked.canonical.license !== licenseCode ||
      !INSTANCE.test(instanceId || '') ||
      typeof getCredentials !== 'function' ||
      typeof send !== 'function' ||
      typeof isVisible !== 'function' ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 200 || timeoutMs > 10_000 ||
      !/^[a-z0-9.-]+$/i.test(host || '') ||
      !isVisible()) {
    return outcome({stage: 'precondition-denied', fallbackLegacy: true});
  }

  let ticketParams;
  try {
    ticketParams = await requestTypedOpsTicket({
      licenseCode,
      instanceId,
      room,
      opsScope: checked.opsScope,
      getCredentials,
      fetch: send
    });
  } catch (_) {
    return outcome({stage: 'auth-denied', fallbackLegacy: true, retryable: false});
  }
  if (!isVisible() || typeof ticketParams?.cap !== 'string' || !ticketParams.cap) {
    return outcome({stage: 'unavailable-fallback', fallbackLegacy: true, retryable: true});
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response, body;
  try {
    response = await send('https://' + host + '/parties/tienda/' + room, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + ticketParams.cap,
        'x-f123-license': licenseCode,
        'x-f123-instance': instanceId
      },
      body: JSON.stringify(checked.canonical)
    });
    body = await response.json().catch(() => null);
  } catch (_) {
    return outcome({stage: 'unavailable-fallback', fallbackLegacy: true, retryable: true});
  } finally {
    clearTimeout(timer);
  }

  const status = Number(response?.status || 0);
  const receiptId = await expectedReceiptId(checked.canonical);
  if (status === 200 && body?.ok === true && validReceipt(body.receipt, checked.canonical, 'business-committed', receiptId)) {
    return outcome({
      committed: true,
      duplicate: body.duplicate === true,
      stage: 'business-committed',
      status: 200,
      receipt: Object.freeze({...body.receipt})
    });
  }
  if (status === 202 && body?.ok === true && validReceipt(body.receipt, checked.canonical, 'stored-for-application', receiptId)) {
    return outcome({
      committed: false,
      duplicate: body.duplicate === true,
      stage: 'queued-not-committed',
      fallbackLegacy: true,
      retryable: true,
      status: 202,
      receipt: Object.freeze({...body.receipt})
    });
  }
  if (status === 409) {
    return outcome({
      committed: false,
      stage: 'conflict-quarantine',
      quarantine: true,
      fallbackLegacy: false,
      retryable: false,
      status: 409
    });
  }
  if (status === 401 || status === 403) {
    return outcome({
      committed: false,
      stage: 'auth-denied',
      fallbackLegacy: true,
      retryable: false,
      status
    });
  }
  if (status === 400 || status === 413 || status === 415) {
    return outcome({
      committed: false,
      stage: 'invalid-command',
      fallbackLegacy: false,
      retryable: false,
      status
    });
  }
  return outcome({
    committed: false,
    stage: 'unavailable-fallback',
    fallbackLegacy: true,
    retryable: true,
    status
  });
}
