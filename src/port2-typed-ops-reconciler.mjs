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

export function createTypedOpsReconciler({
  dispatch,
  store,
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
    throw new TypeError('durable store must implement loadAll, save and remove; no volatile-memory fallback for business operations');
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
  const settledOpIds = new Set();
  const settledPayloads = new Map();
  const settledReceipts = new Map();
  const inFlight = new Map();
  const flightVersions = new WeakMap();
  const timers = new Map();
  let paused = false;
  let destroyed = false;
  let reconcilerEpoch = 0;

  // IDB may load asynchronously; no command may be sent before hydration.
  // An unreadable/corrupt durable queue blocks the entire dispatcher, while a
  // transient failure during ready() resets so the caller can retry safely.
  let initialized = null;
  async function hydrate() {
    const rows = await store.loadAll();
    if (!Array.isArray(rows)) throw new Error('durable store loadAll must return an array');
    const stagedEntries = new Map();
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object' || !OP_ID.test(raw.opId || '') ||
          !raw.command || raw.sameDoLocked !== true) {
        throw new Error('unreadable persisted opId or unsafe same-do-only lock');
      }
      const payloadKey = canonicalKey(raw.command);
      if (!payloadKey || raw.command.opId !== raw.opId || stagedEntries.has(raw.opId)) {
        throw new Error('invalid or duplicate durable commercial command');
      }
      stagedEntries.set(raw.opId, {
        opId: raw.opId,
        command: cloneCommand(raw.command),
        payloadKey,
        sameDoLocked: true,
        attempts: Number.isSafeInteger(raw.attempts) && raw.attempts >= 0 ? raw.attempts : 0,
        state: typeof raw.state === 'string' ? raw.state : 'pending',
        createdAt: Number.isSafeInteger(raw.createdAt) ? raw.createdAt : now(),
        updatedAt: Number.isSafeInteger(raw.updatedAt) ? raw.updatedAt : now()
      });
    }
    const stagedSettled = [];
    if (typeof store.loadCommittedOpIds === 'function') {
      const committedIds = await store.loadCommittedOpIds();
      if (Array.isArray(committedIds)) {
        for (const id of committedIds) {
          if (OP_ID.test(id || '')) stagedSettled.push(id);
        }
      }
    }
    for (const [id, row] of stagedEntries) entries.set(id, row);
    for (const id of stagedSettled) settledOpIds.add(id);
  }

  async function ready() {
    const attempt = initialized || (initialized = hydrate());
    try {
      await attempt;
    } catch (_) {
      if (initialized === attempt) initialized = null;
      throw new Error('durable store unavailable');
    }
    return true;
  }

  async function persist(entry) {
    // store.save must resolve only after its REAL transaction commits. A write
    // rejection means no HTTP request is allowed (even if the write partly ran).
    try {
      await store.save({
        opId: entry.opId,
        command: { ...entry.command },
        sameDoLocked: entry.sameDoLocked === true,
        attempts: entry.attempts,
        state: entry.state,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt
      });
    } catch (err) {
      if (err?.code === 'TYPED_OPS_ALREADY_QUARANTINED') {
        entry.state = 'quarantined';
        entries.set(entry.opId, entry);
        clearTimer(entry.opId);
      }
      throw err;
    }
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
    const current = entries.get(opId);
    if (current) flightVersions.set(current, {});
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
    if (destroyed || paused || !isVisible()) return;
    if (entry.state !== 'pending') return;
    if (entry.attempts >= Math.min(maxAttempts, 10)) {
      entry.state = 'paused-retry-exhausted';
      entry.updatedAt = now();
      // The record already exists with sameDoLocked:true; a failed update
      // does not authorize legacy fallback or remove the original opId.
      void persist(entry).catch(() => {});
      return;
    }
    const delay = computeDelay(entry.attempts);
    const id = schedule(() => {
      timers.delete(entry.opId);
      if (destroyed || paused || !isVisible()) return;
      const current = entries.get(entry.opId);
      if (!current || current.state !== 'pending' || inFlight.has(current.opId)) return;
      void trackFlight(current.opId, current.payloadKey, () => runAttempt(current.command, current, false));
    }, delay);
    timers.set(entry.opId, id);
  }

  async function runAttempt(command, existingEntry, isInitialSubmit) {
    const attemptEpoch = reconcilerEpoch;
    const opId = command.opId;
    const payloadKey = canonicalKey(command);
    const lockedBefore = existingEntry?.sameDoLocked === true;
    const maxAllowed = Math.min(maxAttempts, 10);

    // P0: ALWAYS commit original opId to durable storage BEFORE POSTing to DO.
    // Even a crash while the first HTTP request is in flight therefore leaves
    // a same-do-only pending command for recovery, not a duplicate legacy sale.
    const prepared = existingEntry || {
      opId,
      command: cloneCommand(command),
      payloadKey,
      sameDoLocked: true,
      attempts: 0,
      state: 'prepared',
      createdAt: now(),
      updatedAt: now()
    };
    try {
      prepared.sameDoLocked = true;
      if (!prepared.verifiedAck) await persist(prepared);
      entries.set(opId, prepared);
    } catch (err) {
      if (err?.code === 'TYPED_OPS_ALREADY_QUARANTINED') {
        return makeOutcome({stage:'conflict-quarantine', quarantine:true, status:409,
          fallbackLegacy:false, reconcileRequired:false});
      }
      if (err && err.code === 'TYPED_OPS_ALREADY_SETTLED') {
        settledOpIds.add(opId);
        const knownKey = settledPayloads.get(opId);
        if (knownKey && knownKey === payloadKey) {
          return makeOutcome({
            committed: true, duplicate: true, fallbackLegacy: false,
            reconcileRequired: false, stage: 'already-committed',
            receipt: settledReceipts.get(opId) || null
          });
        }
        return makeOutcome({
          committed: false, fallbackLegacy: false,
          reconcileRequired: true, retryTarget: 'same-do-only',
          stage: knownKey ? 'opid-payload-mismatch' : 'already-committed-unverified-payload',
          status: knownKey ? 409 : 0
        });
      }
      return makeOutcome({stage: 'durable-store-unavailable', fallbackLegacy: false,
        reconcileRequired: false, retryable: false, retryTarget: null});
    }
    if (destroyed || attemptEpoch !== reconcilerEpoch || paused || !isVisible()) {
      return makeOutcome({
        committed: false, fallbackLegacy: false,
        reconcileRequired: true, retryTarget: 'same-do-only',
        stage: destroyed || attemptEpoch !== reconcilerEpoch ? 'reconciler-destroyed' : 'paused-hidden'
      });
    }

    let rawOutcome;
    try {
      rawOutcome = prepared.verifiedAck || await dispatch(cloneCommand(command));
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
      prepared.verifiedAck = res;
      // Cleanup must be durable too. If removal fails the stored opId stays
      // pinned in IDB, and RAM caches the verified ACK to retry local cleanup
      // without issuing a second commercial HTTP POST.
      try {
        // C21b: an ACK is not durable if cleanup deletes the only same-do
        // evidence. On real C16b IDB, markCommitted atomically stores a
        // permanent terminal opId before removing the pending row.
        if (typeof store.markCommitted === 'function')
          await store.markCommitted(opId);
        else
          await store.remove(opId); // Legacy synthetic in-memory test stores.
        settledOpIds.add(opId);
        settledPayloads.set(opId, payloadKey);
        if (res.receipt) settledReceipts.set(opId, Object.freeze({ ...res.receipt }));
        entries.delete(opId);
      } catch (_) {
        prepared.cleanupAttempts = (prepared.cleanupAttempts || 0) + 1;
        if (!destroyed && attemptEpoch === reconcilerEpoch && !paused && isVisible() &&
            prepared.cleanupAttempts < Math.min(maxAttempts, 10)) {
          const id = schedule(() => {
            timers.delete(opId);
            if (destroyed || attemptEpoch !== reconcilerEpoch || paused || !isVisible() ||
                inFlight.has(opId) || entries.get(opId) !== prepared) return;
            void trackFlight(opId, payloadKey, () => runAttempt(prepared.command, prepared, false));
          }, computeDelay(prepared.cleanupAttempts));
          timers.set(opId, id);
        }
        return makeOutcome({stage: 'durable-cleanup-pending', fallbackLegacy: false,
          reconcileRequired: true, retryTarget: 'same-do-only',
          receipt: res.receipt ? Object.freeze({ ...res.receipt }) : null});
      }
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
        receipt: finalOut.receipt,
        command: cloneCommand(command)
      });
      return finalOut;
    }

    // 2. Terminal conflict quarantine (HTTP 409 or rejected 400/413/415 command) -> never retry or fallback.
    if (res.quarantine === true || (res.stage === 'invalid-command' && [400, 413, 415].includes(res.status))) {
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
      entry.attempts = Math.min(10, entry.attempts + 1);
      entry.state = 'quarantined';
      entry.updatedAt = now();
      entries.set(opId, entry);
      try { await persist(entry); }
      catch (_) { return makeOutcome({stage:'durable-store-unavailable',
        fallbackLegacy:false, retryTarget:'same-do-only',reconcileRequired:true}); }
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
      // A genuine pre-send denial may use legacy ONLY once the prepared record
      // has been removed durably; otherwise later replays could duplicate it.
      try {
        await store.remove(opId);
        entries.delete(opId);
      } catch (_) {
        return makeOutcome({stage:'durable-store-unavailable',fallbackLegacy:false,
          reconcileRequired:true,retryTarget:'same-do-only'});
      }
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
      try { await persist(existingEntry); }
      catch (_) { return makeOutcome({stage:'durable-store-unavailable',
        fallbackLegacy:false,reconcileRequired:true,retryTarget:'same-do-only'}); }
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
    entry.attempts = Math.min(10, entry.attempts + 1);
    entry.state = entry.attempts >= Math.min(maxAttempts, 10) ? 'paused-retry-exhausted' : 'pending';
    entry.updatedAt = now();
    entries.set(opId, entry);
    try { await persist(entry); }
    catch (_) { return makeOutcome({stage:'durable-store-unavailable',
      fallbackLegacy:false,reconcileRequired:true,retryTarget:'same-do-only'}); }
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
    if (destroyed) return makeOutcome({ stage: 'reconciler-destroyed', fallbackLegacy: false });
    try { await ready(); }
    catch (_) { return makeOutcome({stage:'durable-store-unavailable',fallbackLegacy:false}); }
    if (destroyed) return makeOutcome({ stage: 'reconciler-destroyed', fallbackLegacy: false });
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
    if (!existing && settledOpIds.has(opId)) {
      const knownKey = settledPayloads.get(opId);
      if (knownKey && knownKey === payloadKey) {
        return makeOutcome({
          committed: true, duplicate: true, fallbackLegacy: false,
          reconcileRequired: false, stage: 'already-committed',
          receipt: settledReceipts.get(opId) || null
        });
      }
      return makeOutcome({
        committed: false, fallbackLegacy: false,
        reconcileRequired: true, retryTarget: 'same-do-only',
        stage: knownKey ? 'opid-payload-mismatch' : 'already-committed-unverified-payload',
        status: knownKey ? 409 : 0
      });
    }
    if (existing) {
      if (existing.payloadKey !== payloadKey) {
        return makeOutcome({ stage: 'opid-payload-mismatch', fallbackLegacy: false });
      }
      if (existing.state === 'quarantined') {
        return makeOutcome({ stage: 'conflict-quarantine', quarantine: true, fallbackLegacy: false, status: 409 });
      }
      if (existing.state === 'paused-auth-required' || existing.state === 'paused-retry-exhausted' ||
          timers.has(opId) || existing.attempts >= Math.min(maxAttempts, 10)) {
        const pausedStage = existing.attempts >= Math.min(maxAttempts, 10)
          ? 'paused-retry-exhausted' : existing.state;
        return makeOutcome({
          committed: false, fallbackLegacy: false,
          reconcileRequired: true, retryable: pausedStage !== 'paused-retry-exhausted',
          retryTarget: 'same-do-only', stage: pausedStage
        });
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
      if (paused || !isVisible()) {
        // Nothing was persisted to IDB or sent to DO yet; permit clean legacy fallback
        // instead of stranding the fresh opId under coordinator custody reservations.
        return makeOutcome({
          stage: 'paused-hidden',
          fallbackLegacy: true
        });
      }
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
    if (destroyed) return Object.freeze({ attempted: 0, results: Object.freeze([]), stage: 'reconciler-destroyed' });
    try { await ready(); }
    catch (_) { return Object.freeze({attempted:0,results:Object.freeze([]),stage:'durable-store-unavailable'}); }
    if (destroyed || paused || !isVisible()) {
      return Object.freeze({ attempted: 0, results: Object.freeze([]) });
    }
    const candidates = Array.from(entries.values()).filter(
      e => e.state !== 'quarantined' && !inFlight.has(e.opId)
    ).map(entry => ({ entry, flightVersion: flightVersions.get(entry) }));
    const results = [];
    for (const { entry, flightVersion } of candidates) {
      if (destroyed || paused || !isVisible()) break;
      if (entries.get(entry.opId) !== entry || inFlight.has(entry.opId) ||
          entry.state === 'quarantined' || flightVersions.get(entry) !== flightVersion) continue;
      clearTimer(entry.opId);
      if (entry.state === 'paused-retry-exhausted' || entry.attempts >= Math.min(maxAttempts, 10)) {
        entry.attempts = 0;
      }
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
    if (destroyed) return Object.freeze({ attempted: 0, results: Object.freeze([]), stage: 'reconciler-destroyed' });
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
    destroyed = true;
    paused = true;
    reconcilerEpoch++;
    clearAllTimers();
  }

  return Object.freeze({
    ready,
    submit,
    reconcileNow,
    pause,
    resume,
    pending,
    quarantined,
    destroy
  });
}
