// PORT2 C21a: verified cross-device cutover and reversible 2.0 <-> 1.0 failback coordinator.
// Guarantees:
// 1. 2.0 activation requires BOTH durable IndexedDB readiness (reconciler.ready()) AND a
//    certified -cat catalog session (frozenHead verified).
// 2. Any commercial opId that has entered the durable 2.0 queue (sameDoLocked:true) or
//    committed via 2.0 is PERMANENTLY blocked from legacy 1.0 dispatch across failbacks
//    and reloads, eliminating cross-engine duplicate sales.
// 3. Failing back to legacy 1.0 immediately closes the -cat session (releasing any C10
//    single-writer lock so another device can take over immediately) while preserving
//    same-do-only background drain for any already-latched opIds.

const OP_ID = /^(?:customer-payment:)?[A-Za-z0-9_-]{8,96}$/;
const HEAD = /^[A-Za-z0-9_.:-]{3,128}$/;

// Shared per-store custody barrier closes TOCTOU between concurrent
// coordinators/tabs probing canDispatchOnLegacy() vs submitCommercial().
const STORE_CUSTODY = new WeakMap();
function getStoreCustody(store) {
  let entry = STORE_CUSTODY.get(store);
  if (!entry) {
    entry = { chains: new Map(), reserved20: new Set() };
    STORE_CUSTODY.set(store, entry);
  }
  return entry;
}
function withOpCustodyLock(store, opId, fn) {
  const custody = getStoreCustody(store);
  const prev = custody.chains.get(opId) || Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {});
  custody.chains.set(opId, tail);
  tail.finally(() => { if (custody.chains.get(opId) === tail) custody.chains.delete(opId); });
  return next;
}

function taggedError(message, code) {
  const err = new Error(code + ': ' + message);
  err.code = code;
  return err;
}

export function createVerifiedCrossDeviceFailbackCoordinator({
  store,
  reconciler,
  openCatalogSession,
  isVisible = () => typeof document === 'undefined' || !document.hidden,
  onModeChange = null
} = {}) {
  if (!store || typeof store.loadAll !== 'function' || typeof store.save !== 'function' || typeof store.remove !== 'function') {
    throw new TypeError('durable store required for cross-device failback coordinator');
  }
  if (!reconciler || typeof reconciler.ready !== 'function' || typeof reconciler.submit !== 'function' ||
      typeof reconciler.reconcileNow !== 'function' || typeof reconciler.pending !== 'function' ||
      typeof reconciler.quarantined !== 'function') {
    throw new TypeError('typed-ops reconciler required for cross-device failback coordinator');
  }
  if (typeof openCatalogSession !== 'function') {
    throw new TypeError('openCatalogSession callback required');
  }
  if (typeof isVisible !== 'function') {
    throw new TypeError('isVisible must be a function');
  }
  if (onModeChange !== null && typeof onModeChange !== 'function') {
    throw new TypeError('onModeChange must be a function or null');
  }

  let currentMode = 'failback-legacy-1.0';
  let lastFailbackReason = 'uninitialized';
  let catalogSession = null;
  let destroyed = false;
  let activationEpoch = 0;
  // Session-level memory of every opId that touched or committed on 2.0 in this lifecycle,
  // complementing durable store.loadAll() so even after an opId commits and is removed from
  // pending_ops, a late legacy caller in the same session still cannot re-send it.
  const latchedOrCommittedOpIds = new Set();

  function setMode(nextMode, reason) {
    const prev = currentMode;
    currentMode = nextMode;
    if (reason) lastFailbackReason = reason;
    if (prev !== nextMode && typeof onModeChange === 'function') {
      try {
        onModeChange(Object.freeze({ mode: currentMode, reason: lastFailbackReason }));
      } catch (_) {}
    }
  }

  function closeCatalog() {
    const session = catalogSession;
    catalogSession = null;
    if (session && typeof session.close === 'function') {
      try { session.close(); } catch (_) {}
    }
  }

  async function refreshDurableLatches() {
    await reconciler.ready();
    for (const p of reconciler.pending()) {
      if (p?.opId) latchedOrCommittedOpIds.add(p.opId);
    }
    for (const q of reconciler.quarantined()) {
      if (q?.opId) latchedOrCommittedOpIds.add(q.opId);
    }
    const rows = await store.loadAll();
    if (!Array.isArray(rows)) throw new Error('durable store loadAll must return an array');
    for (const row of rows) {
      if (!row || typeof row !== 'object' || !OP_ID.test(row.opId || '') || row.sameDoLocked !== true) {
        throw new Error('corrupted durable typed-ops entry');
      }
      latchedOrCommittedOpIds.add(row.opId);
    }
    // C21b: once DO confirms a commercial opId, C16a retires its *pending*
    // row. Its independent, durable terminal tombstone MUST survive the next
    // Safari/PWA reload. A missing/unreadable marker store blocks legacy.
    if (typeof store.loadCommittedOpIds !== 'function')
      throw new Error('committed opId durable store unavailable');
    const settled = await store.loadCommittedOpIds();
    if (!Array.isArray(settled))
      throw new Error('committed opId durable store unreadable');
    for (const opId of settled) {
      if (!OP_ID.test(opId || '')) throw new Error('corrupted committed opId');
      latchedOrCommittedOpIds.add(opId);
    }
  }

  // A transport outage must not change the business authority for an opId.
  // Keep same-DO reconciliation and its durable latch intact during silent recovery.
  async function failbackToLegacy(reason = 'manual-failback') {
    activationEpoch++;
    closeCatalog();
    setMode('failback-legacy-1.0', String(reason || 'manual-failback'));
    return Object.freeze({
      mode: currentMode,
      reason: lastFailbackReason
    });
  }

  async function activate20() {
    if (!destroyed && isVisible() && currentMode === 'active-2.0' && catalogSession &&
        typeof catalogSession.isActive === 'function' && catalogSession.isActive() &&
        (typeof catalogSession.isClosed !== 'function' || !catalogSession.isClosed())) {
      return Object.freeze({
        ok: true,
        mode: currentMode,
        reason: 'certified',
        frozenHead: catalogSession.frozenHead,
        readOnly: catalogSession.readOnly === true
      });
    }
    const epoch = ++activationEpoch;
    if (destroyed || !isVisible()) {
      await failbackToLegacy('hidden-or-destroyed');
      return Object.freeze({ ok: false, mode: currentMode, reason: lastFailbackReason, frozenHead: null });
    }
    try {
      await refreshDurableLatches();
      if (destroyed || !isVisible() || activationEpoch !== epoch) {
        return Object.freeze({ ok: false, mode: currentMode, reason: 'activation-superseded', frozenHead: null });
      }
    } catch (_) {
      if (activationEpoch === epoch) await failbackToLegacy('durable-store-unavailable');
      return Object.freeze({ ok: false, mode: currentMode, reason: lastFailbackReason, frozenHead: null });
    }
    closeCatalog();
    let session = null;
    try {
      session = await openCatalogSession({
        onWriterConflict: () => {
          if (activationEpoch === epoch && !destroyed) void failbackToLegacy('writer-conflict');
        }
      });
      if (!session || typeof session !== 'object' || typeof session.close !== 'function' ||
          !HEAD.test(session.frozenHead || '') || !isVisible() || destroyed || activationEpoch !== epoch) {
        throw new Error('certified catalog session unavailable');
      }
      catalogSession = session;
      setMode('active-2.0', 'certified');
      return Object.freeze({
        ok: true,
        mode: currentMode,
        reason: 'certified',
        frozenHead: session.frozenHead,
        readOnly: session.readOnly === true
      });
    } catch (_) {
      try { session?.close?.(); } catch (_) {}
      if (activationEpoch === epoch) await failbackToLegacy('catalog-certification-failed');
      return Object.freeze({ ok: false, mode: currentMode, reason: lastFailbackReason, frozenHead: null });
    }
  }

  async function isLatchedToSameDo(opId) {
    if (!OP_ID.test(opId || '')) throw new TypeError('invalid opId');
    await refreshDurableLatches();
    return latchedOrCommittedOpIds.has(opId);
  }

  async function canDispatchOnLegacy(opId) {
    if (!OP_ID.test(opId || '')) return false;
    const custody = getStoreCustody(store);
    if (custody.reserved20.has(opId) || latchedOrCommittedOpIds.has(opId)) return false;
    return withOpCustodyLock(store, opId, async () => {
      if (custody.reserved20.has(opId) || latchedOrCommittedOpIds.has(opId)) return false;
      try {
        const latched = await isLatchedToSameDo(opId);
        return !latched;
      } catch (_) {
        // Fail-closed: if durable IDB cannot be read, NEVER authorize a legacy send
        // that could duplicate an already-latched 2.0 sale.
        return false;
      }
    });
  }

  async function assertLegacyAllowed(opId) {
    if (!OP_ID.test(opId || '')) {
      throw taggedError('invalid opId for legacy dispatch', 'invalid-opid');
    }
    const custody = getStoreCustody(store);
    return withOpCustodyLock(store, opId, async () => {
      let latched = custody.reserved20.has(opId) || latchedOrCommittedOpIds.has(opId);
      if (!latched) {
        try {
          latched = await isLatchedToSameDo(opId);
        } catch (_) {
          throw taggedError('durable store unavailable; legacy dispatch blocked fail-closed', 'durable-store-unavailable');
        }
      }
      if (latched) {
        throw taggedError('opId is irreversibly latched to same-do-only reconciliation and forbidden on legacy 1.0', 'latched-same-do-only');
      }
      return Object.freeze({ allowed: true, opId });
    });
  }

  async function submitCommercial(command) {
    if (destroyed) {
      return Object.freeze({ committed: false, fallbackLegacy: false, stage: 'coordinator-destroyed' });
    }
    const opId = command?.opId;
    if (!OP_ID.test(opId || '')) {
      return Object.freeze({ committed: false, fallbackLegacy: true, stage: 'invalid-command' });
    }
    const custody = getStoreCustody(store);
    const shouldClaim20 = currentMode === 'active-2.0';
    let claimedHere = false;
    if (shouldClaim20 && !custody.reserved20.has(opId)) {
      custody.reserved20.add(opId);
      claimedHere = true;
    }
    return withOpCustodyLock(store, opId, async () => {
      if (destroyed) {
        if (claimedHere && !latchedOrCommittedOpIds.has(opId)) custody.reserved20.delete(opId);
        return Object.freeze({ committed: false, fallbackLegacy: false, stage: 'coordinator-destroyed' });
      }
      try {
        await refreshDurableLatches();
      } catch (_) {
        if (claimedHere && !latchedOrCommittedOpIds.has(opId)) custody.reserved20.delete(opId);
        return Object.freeze({ committed: false, fallbackLegacy: false, stage: 'durable-store-unavailable' });
      }

      // If we already failed back to legacy 1.0, only already-latched opIds must go to the SAME DO;
      // fresh opIds created after failback are directed to legacy 1.0.
      if (currentMode !== 'active-2.0') {
        if (latchedOrCommittedOpIds.has(opId)) {
          const res = await reconciler.submit(command);
          if (res?.committed || res?.reconcileRequired || res?.quarantine || res?.retryTarget === 'same-do-only') {
            latchedOrCommittedOpIds.add(opId);
            custody.reserved20.add(opId);
          }
          return res;
        }
        if (claimedHere) custody.reserved20.delete(opId);
        return Object.freeze({
          committed: false,
          duplicate: false,
          fallbackLegacy: true,
          reconcileRequired: false,
          quarantine: false,
          retryable: false,
          retryTarget: null,
          stage: 'failback-legacy-active',
          status: 0,
          receipt: null
        });
      }

      // Close the window between choosing 2.0 and committing its IDB intent.
      // A concurrent failback must not authorize legacy for the same opId.
      const previouslyLatched = latchedOrCommittedOpIds.has(opId);
      latchedOrCommittedOpIds.add(opId);
      custody.reserved20.add(opId);
      let res;
      try {
        res = await reconciler.submit(command);
      } catch (_) {
        return Object.freeze({ committed: false, fallbackLegacy: false,
          reconcileRequired: true, retryTarget: 'same-do-only', stage: 'dispatch-rejected' });
      }
      if (res?.fallbackLegacy === true && !res?.reconcileRequired &&
          !res?.committed && !res?.quarantine && res?.retryTarget !== 'same-do-only') {
        // C16a resolves pre-send fallback only AFTER durable prepared-row deletion.
        if (!previouslyLatched) {
          latchedOrCommittedOpIds.delete(opId);
          custody.reserved20.delete(opId);
        } else return Object.freeze({ ...res, fallbackLegacy: false,
          reconcileRequired: true, retryTarget: 'same-do-only', stage: 'already-latched' });
      }
      return res;
    });
  }

  async function drainLatchedSameDo() {
    if (destroyed || !isVisible()) {
      return Object.freeze({ attempted: 0, results: Object.freeze([]) });
    }
    try {
      await refreshDurableLatches();
    } catch (_) {
      return Object.freeze({ attempted: 0, results: Object.freeze([]), stage: 'durable-store-unavailable' });
    }
    return reconciler.reconcileNow();
  }

  function applyCatalogDelta(delta) {
    if (destroyed || currentMode !== 'active-2.0' || !catalogSession) {
      throw new Error('catalog writer not in active-2.0 mode');
    }
    if (!isVisible()) {
      throw new Error('catalog writer hidden; delta refused');
    }
    if (typeof catalogSession.isActive === 'function' && !catalogSession.isActive()) {
      void failbackToLegacy('writer-inactive');
      throw new Error('catalog writer inactive');
    }
    if (typeof catalogSession.applyDelta !== 'function') {
      throw new Error('catalog session is read-only');
    }
    return catalogSession.applyDelta(delta);
  }

  function destroy() {
    activationEpoch++;
    destroyed = true;
    closeCatalog();
    currentMode = 'failback-legacy-1.0';
    lastFailbackReason = 'destroyed';
    try { reconciler.destroy?.(); } catch (_) {}
  }

  return Object.freeze({
    mode: () => currentMode,
    lastReason: () => lastFailbackReason,
    activate20,
    failbackToLegacy,
    isLatchedToSameDo,
    canDispatchOnLegacy,
    assertLegacyAllowed,
    submitCommercial,
    drainLatchedSameDo,
    applyCatalogDelta,
    destroy
  });
}
