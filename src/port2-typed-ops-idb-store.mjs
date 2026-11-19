// PORT2 C16b-store: durable IndexedDB store for the C16a same-do-only -ops reconciler.
// Resolves ONLY after real IndexedDB tx.oncomplete, isolates businesses by SHA-256
// namespace (never plaintext license keys), enforces immutable command payloads per opId,
// and refuses to persist PINs, bearer tokens or secrets.

const DB_NAME = 'f123_port2_typed_ops_v1';
const STORE = 'pending_ops';
const NAMESPACE = /^[a-f0-9]{64}$/;
const OP_ID = /^(?:customer-payment:)?[A-Za-z0-9_-]{8,96}$/;
const MAX_ENTRY_BYTES = 32 * 1024;
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
  const clean = {
    opId: entry.opId,
    command: cloneJson(entry.command),
    sameDoLocked: true,
    attempts: Number.isSafeInteger(entry.attempts) && entry.attempts >= 0 ? entry.attempts : 0,
    state: typeof entry.state === 'string' && entry.state.length > 0 && entry.state.length <= 64
      ? entry.state : 'pending',
    createdAt: Number.isSafeInteger(entry.createdAt) ? entry.createdAt : Date.now(),
    updatedAt: Number.isSafeInteger(entry.updatedAt) ? entry.updatedAt : Date.now()
  };
  const encoded = JSON.stringify(entry);
  if (!encoded || new TextEncoder().encode(encoded).byteLength > MAX_ENTRY_BYTES) {
    throw new TypeError('Typed-ops durable entry exceeds size budget');
  }
  return clean;
}

export function createTypedOpsIdbStore({ indexedDB, namespace } = {}) {
  if (!indexedDB || typeof indexedDB.open !== 'function') {
    throw new TypeError('IndexedDB is required for durable typed-ops reconciliation');
  }
  if (!NAMESPACE.test(namespace || '')) {
    throw new TypeError('SHA-256 64-hex business namespace required');
  }

  function storageKey(opId) {
    if (!OP_ID.test(opId || '')) throw new TypeError('Invalid typed-ops opId');
    return JSON.stringify([namespace, opId]);
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (err) {
        reject(err);
        return;
      }
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Typed-ops IndexedDB unavailable'));
      req.onblocked = () => reject(new Error('Typed-ops IndexedDB blocked'));
    });
  }

  async function transact(mode, run) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        let tx;
        let output = null;
        let failure = null;
        try {
          tx = db.transaction(STORE, mode);
        } catch (err) {
          reject(err);
          return;
        }
        // Only resolve once the real IndexedDB transaction commits cleanly.
        tx.oncomplete = () => resolve(cloneJson(output));
        tx.onabort = () => reject(failure || tx.error || new Error('Typed-ops IndexedDB transaction aborted'));
        tx.onerror = () => {};
        try {
          const objectStore = tx.objectStore(STORE);
          run(
            objectStore,
            (result) => { output = result; },
            (err) => {
              failure = err;
              try { tx.abort(); } catch (abortErr) { reject(abortErr); }
            }
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
          const mine = all
            .filter(r => r && r.namespace === namespace && r.value)
            .map(r => r.value);
          done(mine);
        };
        req.onerror = () => fail(req.error || new Error('Typed-ops IndexedDB loadAll failed'));
      });
      return Array.isArray(rows) ? rows : [];
    },

    async save(entry) {
      const clean = validateEntry(entry);
      const key = storageKey(clean.opId);
      const nextCanonical = canonicalPayload(clean.command);
      await transact('readwrite', (objectStore, done, fail) => {
        const getReq = objectStore.get(key);
        getReq.onsuccess = () => {
          const existing = getReq.result;
          if (existing?.value) {
            if (canonicalPayload(existing.value.command) !== nextCanonical) {
              fail(new Error('Persisted opId command payload mismatch'));
              return;
            }
          }
          const putReq = objectStore.put({ key, namespace, value: clean });
          putReq.onsuccess = () => done(true);
          putReq.onerror = () => fail(putReq.error || new Error('Typed-ops IndexedDB save failed'));
        };
        getReq.onerror = () => fail(getReq.error || new Error('Typed-ops IndexedDB read before save failed'));
      });
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
