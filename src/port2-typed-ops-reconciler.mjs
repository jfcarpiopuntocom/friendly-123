// PORT2 C16a: bounded, single-flight same-do-only reconciler for typed -ops commands.
// Preserves the C15 anti-duplication invariant: once a commercial opId has crossed
// the network (HTTP 202, 200 stored-for-application, timeout, 5xx or uncertain ACK),
// it is irreversibly latched to same-do-only reconciliation and can NEVER fall back
// to the legacy ledger. Zero secrets (PIN/tokens) are ever persisted in store.

const OP_ID = /^(?:customer-payment:)?[A-Za-z0-9_-]{8,96}$/;

function canonicalKey(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) return null;
  const keys = Object.keys(command).sort();
  const ordered = {};
  for (const k of keys) ordered[k] = command[k];
  return JSON.stringify(ordered);
}

function cloneCommand(command) {
  const keys = Object.keys(command).sort();
  const out = {};
  for (const k of keys) out[k] = command[k];
  return Object.freeze(out);
}

function makeOutcome(fields) {
  return Object.freeze({
    committed: false,
    duplicate: false,
    fallbackLegacy: false,
    reconcileRequired: false,
    quarantine: false,
    retryable: false,
    retryTarget: null,
    stage: 'commit-unverified',
    status: 0,
    receipt: null,
    ...fields
  });
}

function defaultMemoryStore() {
  const map = new Map();
  return {
    loadAll: () => Array.from(map.values()).map(v => JSON.parse(JSON.stringify(v))),
    save: (entry) => { map.set(entry.opId, JSON.parse(JSON.stringify(entry))); },
    remove: (opId) => { map.delete(opId); }
  };
}

export function createTypedOpsReconciler({
  dispatch,
  store = defaultMemoryStore(),
  isVisible = () => typeof document === 'undefined' || !document.hidden,
  maxAttempts = 5,
  maxPending = 64,
  baseDelayMs = 800,
  maxDelayMs = 15_000,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancelSchedule = (id) => clearTimeout(id),
  onSettled = null
} = {}) {
  if (typeof dispatch !== 'function') throw new TypeError('dispatch must be a function');
  if (!store || typeof store.loadAll !== 'function' || typeof store.save !== 'function' || typeof store.remove !== 'function') {
    throw new TypeError('store must implement loadAll, save and remove');
  }
  if (typeof isVisible !== 'function') throw new TypeError('isVisible must be a function');
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new RangeError('maxAttempts must be an integer between 1 and 10');
  }
  if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 256) {
    throw new RangeError('maxPending must be an integer between 1 and 256');
  }
  if (!Number.isSafeInteger(baseDelayMs) || baseDelayMs < 50 || baseDelayMs > 30_000) {
    throw new RangeError('baseDelayMs must be an integer between 50 and 30000');
  }
  if (!Number.isSafeInteger(maxDelayMs) || maxDelayMs < baseDelayMs || maxDelayMs > 300_000) {
    throw new RangeError('maxDelayMs must be >= baseDelayMs and <= 300000');
  }

  const entries = new Map();
  const inFlight = new Map();
  const timers = new Map();
  let paused = false;

  // Hydrate persisted same-do-only / quarantined entries on startup or reload.
  for (const raw of store.loadAll() || []) {
    if (!raw || typeof raw !== 'object' || !OP_ID.test(raw.opId || '') || !raw.command) continue;
    const payloadKey = canonicalKey(raw.command);
    if (!payloadKey) continue;
    entries.set(raw.opId, {
      opId: raw.opId,
      command: cloneCommand(raw.command),
      payloadKey,
      sameDoLocked: raw.sameDoLocked === true,
      attempts: Number.isSafeInteger(raw.attempts) && raw.attempts >= 0 ? raw.attempts : 0,
      state: typeof raw.state === 'string' ? raw.state : 'pending',
      createdAt: Number.isSafeInteger(raw.createdAt) ? raw.createdAt : now(),
      updatedAt: Number.isSafeInteger(raw.updatedAt) ? raw.updatedAt : now()
    });
  }

  function persist(entry) {
    store.save({
      opId: entry.opId,
      command: { ...entry.command },
      sameDoLocked: entry.sameDoLocked === true,
      attempts: entry.attempts,
      state: entry.state,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt
    });
  }

  function clearTimer(opId) {
    const id = timers.get(opId);
    if (id !== undefined) {
      timers.delete(opId);
      cancelSchedule(id);
    }
  }

  function clearAllTimers() {
    for (const [opId, id] of timers.entries()) {
      timers.delete(opId);
      cancelSchedule(id);
    }
  }

  function notifySettled(event) {
    if (typeof onSettled === 'function') {
      try { onSettled(Object.freeze(event)); } catch (_) {}
    }
  }

  function computeDelay(attempts) {
    const exp = Math.max(0, attempts - 1);
    const delay = baseDelayMs * Math.pow(2, exp);
    return Math.min(maxDelayMs, Math.round(delay));
  }

  function trackFlight(opId, payloadKey, fn) {
    const promise = (async () => {
      try {
        return await fn();
      } finally {
        inFlight.delete(opId);
      }
    })();
    inFlight.set(opId, { payloadKey, promise });
    return promise;
  }

  function scheduleRetry(entry) {
    clearTimer(entry.opId);
    if (paused || !isVisible()) return;
    if (entry.state !== 'pending') return;
    if (entry.attempts >= maxAttempts) {
      entry.state = 'paused-retry-exhausted';
      entry.updatedAt = now();
      persist(entry);
      return;
    }
    const delay = computeDelay(entry.attempts);
    const id = schedule(() => {
      timers.delete(entry.opId);
      if (paused || !isVisible()) return;
      const current = entries.get(entry.opId);
      if (!current || current.state !== 'pending' || inFlight.has(current.opId)) return;
      void trackFlight(current.opId, current.payloadKey, () => runAttempt(current.command, current, false));
    }, delay);
    timers.set(entry.opId, id);
  }

  async function runAttempt(command, existingEntry, isInitialSubmit) {
    const opId = command.opId;
    const payloadKey = canonicalKey(command);
    const lockedBefore = existingEntry?.sameDoLocked === true;

    let rawOutcome;
    try {
      rawOutcome = await dispatch(cloneCommand(command));
    } catch (_) {
      rawOutcome = makeOutcome({
        committed: false,
        stage: 'commit-unverified',
        fallbackLegacy: false,
        reconcileRequired: true,
        retryable: true,
        retryTarget: 'same-do-only'
      });
    }

    const res = rawOutcome && typeof rawOutcome === 'object' ? rawOutcome : makeOutcome({});

    // 1. Committed (first or idempotent duplicate=true) -> remove from queue & settle.
    if (res.committed === true) {
      clearTimer(opId);
      entries.delete(opId);
      store.remove(opId);
      const finalOut = makeOutcome({
        committed: true,
        duplicate: res.duplicate === true,
        fallbackLegacy: false,
        reconcileRequired: false,
        quarantine: false,
        retryable: false,
        retryTarget: null,
        stage: res.stage || 'business-committed',
        status: res.status || 200,
        receipt: res.receipt ? Object.freeze({ ...res.receipt }) : null
      });
      notifySettled({
        opId,
        status: 'committed',
        duplicate: finalOut.duplicate,
        receipt: finalOut.receipt
      });
      return finalOut;
    }

    // 2. Terminal conflict quarantine (HTTP 409) -> store quarantined, never retry or fallback.
    if (res.quarantine === true) {
      clearTimer(opId);
      const entry = existingEntry || {
        opId,
        command: cloneCommand(command),
        payloadKey,
        sameDoLocked: true,
        attempts: 0,
        state: 'quarantined',
        createdAt: now(),
        updatedAt: now()
      };
      entry.sameDoLocked = true;
      entry.attempts += 1;
      entry.state = 'quarantined';
      entry.updatedAt = now();
      entries.set(opId, entry);
      persist(entry);
      const finalOut = makeOutcome({
        committed: false,
        fallbackLegacy: false,
        reconcileRequired: false,
        quarantine: true,
        retryable: false,
        retryTarget: null,
        stage: res.stage || 'conflict-quarantine',
        status: res.status || 409
      });
      notifySettled({ opId, status: 'quarantined', statusCode: finalOut.status });
      return finalOut;
    }

    // 3. Pre-send failure BEFORE touching DO (never latched) -> clean legacy fallback, not queued.
    const needsSameDo = res.reconcileRequired === true || res.retryTarget === 'same-do-only';
    if (!lockedBefore && !needsSameDo && res.fallbackLegacy === true && isInitialSubmit) {
      return makeOutcome({
        committed: false,
        fallbackLegacy: true,
        reconcileRequired: false,
        quarantine: false,
        retryable: res.retryable === true,
        retryTarget: null,
        stage: res.stage || 'precondition-denied',
        status: res.status || 0
      });
    }

    // 4. Already latched same-do-only, and a retry hit auth/precondition failure -> pause, NEVER legacy fallback.
    if (lockedBefore && !needsSameDo && res.fallbackLegacy === true) {
      clearTimer(opId);
      existingEntry.sameDoLocked = true;
      existingEntry.state = 'paused-auth-required';
      existingEntry.updatedAt = now();
      persist(existingEntry);
      return makeOutcome({
        committed: false,
        fallbackLegacy: false,
        reconcileRequired: true,
        quarantine: false,
        retryable: false,
        retryTarget: 'same-do-only',
        stage: 'paused-auth-required',
        status: res.status || 0
      });
    }

    // 5. Network/202/5xx/uncertain ACK -> irreversibly latch same-do-only & schedule bounded retry.
    const entry = existingEntry || {
      opId,
      command: cloneCommand(command),
      payloadKey,
      sameDoLocked: true,
      attempts: 0,
      state: 'pending',
      createdAt: now(),
      updatedAt: now()
    };
    entry.sameDoLocked = true;
    entry.attempts += 1;
    entry.state = entry.attempts >= maxAttempts ? 'paused-retry-exhausted' : 'pending';
    entry.updatedAt = now();
    entries.set(opId, entry);
    persist(entry);
    scheduleRetry(entry);

    return makeOutcome({
      committed: false,
      duplicate: res.duplicate === true,
      fallbackLegacy: false,
      reconcileRequired: true,
      quarantine: false,
      retryable: entry.state === 'pending',
      retryTarget: 'same-do-only',
      stage: entry.state === 'paused-retry-exhausted' ? 'paused-retry-exhausted' : (res.stage || 'commit-unverified'),
      status: res.status || 0,
      receipt: res.receipt ? Object.freeze({ ...res.receipt }) : null
    });
  }

  async function submit(command) {
    if (!command || typeof command !== 'object' || Array.isArray(command) || !OP_ID.test(command.opId || '')) {
      return makeOutcome({ stage: 'invalid-command', fallbackLegacy: true });
    }
    const opId = command.opId;
    const payloadKey = canonicalKey(command);
    const active = inFlight.get(opId);
    if (active) {
      if (active.payloadKey !== payloadKey) {
        return makeOutcome({ stage: 'opid-payload-mismatch', fallbackLegacy: false });
      }
      return active.promise;
    }

    const existing = entries.get(opId);
    if (existing) {
      if (existing.payloadKey !== payloadKey) {
        return makeOutcome({ stage: 'opid-payload-mismatch', fallbackLegacy: false });
      }
      if (existing.state === 'quarantined') {
        return makeOutcome({ stage: 'conflict-quarantine', quarantine: true, fallbackLegacy: false, status: 409 });
      }
      if (paused || !isVisible()) {
        return makeOutcome({
          stage: 'paused-hidden',
          fallbackLegacy: false,
          reconcileRequired: true,
          retryTarget: 'same-do-only'
        });
      }
    } else {
      let inFlightUnpersisted = 0;
      for (const id of inFlight.keys()) {
        if (!entries.has(id)) inFlightUnpersisted++;
      }
      if (entries.size + inFlightUnpersisted >= maxPending) {
        return makeOutcome({ stage: 'reconciler-queue-full', fallbackLegacy: false });
      }
    }

    return trackFlight(opId, payloadKey, () => runAttempt(command, existing || null, !existing));
  }

  async function reconcileNow() {
    if (paused || !isVisible()) {
      return Object.freeze({ attempted: 0, results: Object.freeze([]) });
    }
    const candidates = Array.from(entries.values()).filter(
      e => e.state !== 'quarantined' && !inFlight.has(e.opId)
    );
    const results = [];
    for (const entry of candidates) {
      if (paused || !isVisible()) break;
      clearTimer(entry.opId);
      entry.state = 'pending';
      results.push(await trackFlight(entry.opId, entry.payloadKey, () => runAttempt(entry.command, entry, false)));
    }
    return Object.freeze({ attempted: results.length, results: Object.freeze(results) });
  }

  function pause() {
    paused = true;
    clearAllTimers();
  }

  async function resume() {
    paused = false;
    if (!isVisible()) return Object.freeze({ attempted: 0, results: Object.freeze([]) });
    return reconcileNow();
  }

  function pending() {
    return Object.freeze(
      Array.from(entries.values())
        .filter(e => e.state !== 'quarantined')
        .map(e => Object.freeze({
          opId: e.opId,
          sameDoLocked: e.sameDoLocked,
          attempts: e.attempts,
          state: e.state
        }))
    );
  }

  function quarantined() {
    return Object.freeze(
      Array.from(entries.values())
        .filter(e => e.state === 'quarantined')
        .map(e => Object.freeze({ opId: e.opId, attempts: e.attempts, state: e.state }))
    );
  }

  function destroy() {
    paused = true;
    clearAllTimers();
  }

  return Object.freeze({
    submit,
    reconcileNow,
    pause,
    resume,
    pending,
    quarantined,
    destroy
  });
}
