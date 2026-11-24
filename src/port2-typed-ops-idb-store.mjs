// PORT2 C16b-store: durable IndexedDB store for the C16a same-do-only -ops reconciler.
// Resolves ONLY after real IndexedDB tx.oncomplete, isolates businesses by SHA-256
// namespace (never plaintext license keys), enforces immutable command payloads per opId,
// and refuses to persist PINs, bearer tokens or secrets.
import {validateTypedCommercialCommand} from './port2-typed-ops-client.mjs';

const DB_NAME = 'f123_port2_typed_ops_v1';
const STORE = 'pending_ops';
// C21b: non-expiring compact tombstones of business-committed opIds.
// Pending cleanup and terminal marker MUST share one IndexedDB transaction.
const SETTLED = 'settled_ops';
const NAMESPACE = /^[a-f0-9]{64}$/;
const OP_ID = /^(?:customer-payment:)?[A-Za-z0-9_-]{8,96}$/;
const MAX_ENTRY_BYTES = 32 * 1024;
const STATES = new Set(['prepared','pending','paused-auth-required','paused-retry-exhausted','quarantined']);
const FORBIDDEN_SECRET_KEYS = new Set([
  'pin',
  'ownerpin',
  'teampin',
  'token',
  'cap',
  'authorization',
  'bearer',
  'password',
  'secret'
]);

function hasForbiddenSecretKey(value, depth = 0) {
  if (depth > 8 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(item => hasForbiddenSecretKey(item, depth + 1));
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_SECRET_KEYS.has(key.toLowerCase())) return true;
    if (hasForbiddenSecretKey(value[key], depth + 1)) return true;
  }
  return false;
}

function canonicalPayload(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) return null;
  const ordered = {};
  for (const k of Object.keys(command).sort()) ordered[k] = command[k];
  return JSON.stringify(ordered);
}

function cloneJson(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function validateEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError('Invalid typed-ops durable entry');
  }
  if (!OP_ID.test(entry.opId || '')) {
    throw new TypeError('Invalid typed-ops opId');
  }
  if (entry.sameDoLocked !== true) {
    throw new TypeError('Typed-ops durable entry requires sameDoLocked === true');
  }
  if (!entry.command || typeof entry.command !== 'object' || Array.isArray(entry.command) ||
      entry.command.opId !== entry.opId) {
    throw new TypeError('Invalid typed-ops command payload');
  }
  if (hasForbiddenSecretKey(entry)) {
    throw new TypeError('Secret credentials cannot be persisted in typed-ops store');
  }
  // A blacklist alone cannot exclude arbitrary private business fields.
  // C15 is the already-audited exact command allowlist used by the real DO.
  const checked = validateTypedCommercialCommand(entry.command);
  if (!checked.ok) throw new TypeError('Invalid typed-ops commercial command schema');
  if (Object.keys(entry).sort().join(',') !==
      'attempts,command,createdAt,opId,sameDoLocked,state,updatedAt' ||
      !Number.isSafeInteger(entry.attempts) || entry.attempts < 0 || entry.attempts > 10 ||
      !STATES.has(entry.state) ||
      !Number.isSafeInteger(entry.createdAt) || !Number.isSafeInteger(entry.updatedAt))
    throw new TypeError('Invalid typed-ops durable entry schema');
  const clean = {
    opId: entry.opId,
    command: cloneJson(checked.canonical),
    sameDoLocked: true,
    attempts: entry.attempts,
    state: entry.state,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
  const encoded = JSON.stringify(entry);
  if (!encoded || new TextEncoder().encode(encoded).byteLength > MAX_ENTRY_BYTES) {
    throw new TypeError('Typed-ops durable entry exceeds size budget');
  }
  return clean;
}

export function createTypedOpsIdbStore({ indexedDB, namespace, openTimeoutMs = 2500 } = {}) {
  if (!indexedDB || typeof indexedDB.open !== 'function') {
    throw new TypeError('IndexedDB is required for durable typed-ops reconciliation');
  }
  if (!NAMESPACE.test(namespace || '')) {
    throw new TypeError('SHA-256 64-hex business namespace required');
  }
  if (!Number.isSafeInteger(openTimeoutMs) || openTimeoutMs < 100 || openTimeoutMs > 10000) {
    throw new TypeError('IndexedDB open timeout must be 100..10000 ms');
  }

  function storageKey(opId) {
    if (!OP_ID.test(opId || '')) throw new TypeError('Invalid typed-ops opId');
    return JSON.stringify([namespace, opId]);
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      let req, finished = false, timer;
      const finish = (error, db) => {
        // Safari can resolve an abandoned IDB.open long after timeout/blocked.
        // Never leave that late connection alive or promote it to an ACK.
        if (finished) { try { db?.close(); } catch (_) {} return; }
        finished = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(db);
      };
      try {
        req = indexedDB.open(DB_NAME, 2);
      } catch (err) { finish(err); return; }
      timer = setTimeout(() =>
        finish(new Error('Typed-ops IndexedDB open timeout')), openTimeoutMs);
      req.onupgradeneeded = () => {
        try {
          if (!req.result.objectStoreNames.contains(STORE)) {
            req.result.createObjectStore(STORE, { keyPath: 'key' });
          }
          if (!req.result.objectStoreNames.contains(SETTLED)) {
            req.result.createObjectStore(SETTLED, { keyPath: 'key' });
          }
        } catch (err) {
          try { req.transaction?.abort(); } catch (_) {}
          finish(err);
        }
      };
      req.onsuccess = () => finish(null, req.result);
      req.onerror = () => finish(req.error || new Error('Typed-ops IndexedDB unavailable'));
      req.onblocked = () => finish(new Error('Typed-ops IndexedDB blocked'));
    });
  }

  async function transact(mode, run, stores = [STORE]) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        let tx;
        let output = null;
        let failure = null;
        try {
          tx = db.transaction(stores.length === 1 ? stores[0] : stores, mode);
        } catch (err) {
          reject(err);
          return;
        }
        // Only resolve once the real IndexedDB transaction commits cleanly.
        tx.oncomplete = () => resolve(cloneJson(output));
        tx.onabort = () => reject(failure || tx.error || new Error('Typed-ops IndexedDB transaction aborted'));
        tx.onerror = () => {};
        try {
          const objectStore = tx.objectStore(stores[0]);
          run(
            objectStore,
            (result) => { output = result; },
            (err) => {
              failure = err;
              try { tx.abort(); } catch (abortErr) { reject(abortErr); }
            },
            tx
          );
        } catch (err) {
          failure = err;
          try { tx.abort(); } catch (_) { reject(err); }
        }
      });
    } finally {
      db.close();
    }
  }

  return Object.freeze({
    async loadAll() {
      const rows = await transact('readonly', (objectStore, done, fail) => {
        const req = objectStore.getAll();
        req.onsuccess = () => {
          const all = Array.isArray(req.result) ? req.result : [];
          const mine = [];
          // A damaged row belonging to THIS business is not "no pending
          // sales". Silently dropping it would lose an opId after Safari
          // reload, potentially allowing a second sale in the old ledger.
          // The key prefix also catches a corrupted/missing namespace field.
          const ownKeyPrefix = JSON.stringify([namespace, '']).slice(0, -2);
          try {
            for (const row of all) {
              const ownKey = typeof row?.key === 'string' &&
                row.key.startsWith(ownKeyPrefix);
              if (!ownKey && row?.namespace !== namespace) continue;
              if (!row?.value || row.namespace !== namespace) {
                throw new Error('Corrupt own-business pending opId row');
              }
              const clean = validateEntry(row.value);
              if (row.key !== storageKey(clean.opId)) {
                throw new Error('Corrupt own-business pending opId key mismatch');
              }
              mine.push(clean);
            }
            done(mine);
          } catch (error) { fail(error); }
        };
        req.onerror = () => fail(req.error || new Error('Typed-ops IndexedDB loadAll failed'));
      });
      return Array.isArray(rows) ? rows : [];
    },

    async save(entry) {
      const clean = validateEntry(entry);
      const key = storageKey(clean.opId);
      const nextCanonical = canonicalPayload(clean.command);
      await transact('readwrite', (objectStore, done, fail, tx) => {
        const settledStore = tx.objectStore(SETTLED);
        const settledReq = settledStore.get(key);
        settledReq.onsuccess = () => {
          const settled = settledReq.result;
          if (settled) {
            if (Object.keys(settled).sort().join(',') !== 'key,namespace,opId' ||
                settled.namespace !== namespace || settled.opId !== clean.opId || settled.key !== key) {
              fail(new Error('Corrupt own-business committed opId tombstone'));
              return;
            }
            const err = new Error('Persisted opId already committed');
            err.code = 'TYPED_OPS_ALREADY_SETTLED';
            fail(err);
            return;
          }
          const getReq = objectStore.get(key);
          getReq.onsuccess = () => {
            const existing = getReq.result;
            if (existing?.value && canonicalPayload(existing.value.command) !== nextCanonical) {
              fail(new Error('Persisted opId command payload mismatch'));
              return;
            }
            const putReq = objectStore.put({ key, namespace, value: clean });
            putReq.onsuccess = () => done(true);
            putReq.onerror = () => fail(putReq.error || new Error('Typed-ops IndexedDB save failed'));
          };
          getReq.onerror = () => fail(getReq.error || new Error('Typed-ops IndexedDB read before save failed'));
        };
        settledReq.onerror = () => fail(settledReq.error || new Error('Committed opId check before save failed'));
      }, [STORE, SETTLED]);
    },

    // Read separately from the queue: a committed operation no longer needs
    // retrying, but MUST remain blocked from a second legacy sale after reload.
    async loadCommittedOpIds() {
      const result = await transact('readonly', (objectStore, done, fail) => {
        const req = objectStore.getAll();
        req.onsuccess = () => {
          try {
            const values = Array.isArray(req.result) ? req.result : [];
            const mine = [];
            const ownKeyPrefix = JSON.stringify([namespace, '']).slice(0, -2);
            for (const row of values) {
              const ownKey = typeof row?.key === 'string' &&
                row.key.startsWith(ownKeyPrefix);
              if (!ownKey && row?.namespace !== namespace) continue;
              if (!row || typeof row !== 'object' ||
                  Object.keys(row).sort().join(',') !== 'key,namespace,opId' ||
                  row.namespace !== namespace || !OP_ID.test(row.opId || '') ||
                  row.key !== storageKey(row.opId)) {
                throw new Error('Corrupt own-business committed opId tombstone');
              }
              mine.push(row.opId);
            }
            done(mine);
          } catch (error) { fail(error); }
        };
        req.onerror = () => fail(req.error || new Error('Committed opId read failed'));
      }, [SETTLED]);
      if (!Array.isArray(result)) throw new Error('Committed opId store unavailable');
      return result;
    },

    // C21b: one real readwrite IDB transaction atomically puts a compact
    // terminal tombstone and deletes the original pending operation.
    // A failed transaction leaves the old pending record intact.
    async markCommitted(opId) {
      const key = storageKey(opId);
      await transact('readwrite', (pendingStore, done, fail, tx) => {
        const settledStore = tx.objectStore(SETTLED);
        const getPending = pendingStore.get(key);
        getPending.onsuccess = () => {
          try {
            const original = getPending.result;
            if (!original || original.namespace !== namespace ||
                !original.value || original.key !== key ||
                validateEntry(original.value).opId !== opId) {
              // Idempotent re-ack is permitted only if the prior committed
              // tombstone is already trustworthy. Never mint a marker
              // for a non-existent operation.
              const existing = settledStore.get(key);
              existing.onsuccess = () => {
                const row = existing.result;
                if (!row || row.namespace !== namespace ||
                    row.opId !== opId || row.key !== key ||
                    Object.keys(row).sort().join(',') !== 'key,namespace,opId') {
                  fail(new Error('Cannot confirm missing pending opId'));
                  return;
                }
                done(true);
              };
              existing.onerror = () => fail(existing.error || new Error('Committed opId lookup failed'));
              return;
            }
            const put = settledStore.put({key, namespace, opId});
            put.onsuccess = () => {
              const del = pendingStore.delete(key);
              del.onsuccess = () => done(true);
              del.onerror = () => fail(del.error || new Error('Pending deletion failed'));
            };
            put.onerror = () => fail(put.error || new Error('Committed opId write failed'));
          } catch (error) { fail(error); }
        };
        getPending.onerror = () => fail(getPending.error || new Error('Pending opId lookup failed'));
      }, [STORE, SETTLED]);
    },

    async remove(opId) {
      const key = storageKey(opId);
      await transact('readwrite', (objectStore, done, fail) => {
        const delReq = objectStore.delete(key);
        delReq.onsuccess = () => done(true);
        delReq.onerror = () => fail(delReq.error || new Error('Typed-ops IndexedDB remove failed'));
      });
    }
  });
}
