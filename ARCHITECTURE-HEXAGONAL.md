# Hexagonal Architecture Guard — friendly-123

## Why this exists

v448 GOLDEN exposed the cost of letting UI code also decide data-recovery policy. Shelf-photo recovery had accumulated DOM rendering, IndexedDB access, Yjs state, HTTP writes and business rules in one file. That made a visual refresh capable of becoming a data-loss path.

The architecture is now a constraint, not a preference.

## Dependency direction

```
Browser / UI adapters
  docs/vista-perchas.js
  docs/idb-fotos.js
  docs/sync-yjs.js
  docs/mock-backend.js
          |
          v
Application use cases
  docs/application/recover-shelf-photo.js
          |
          v
Domain core
  docs/core/shelf-photo-policy.js
```

Dependencies point inward only.

### Domain core

May contain:
- invariants;
- ordering and conflict policy;
- pure decisions;
- value normalization.

May **not** contain:
- DOM;
- `fetch`;
- IndexedDB / localStorage;
- Yjs;
- Service Worker / CacheStorage;
- network protocols;
- UI strings or layout.

### Application layer

Orchestrates a use case through injected ports. It may ask for capabilities such as:

- `readByHash(hash)`
- `readPerId(shelfId)`
- `historyHashes(shelfId)`
- `setPointer(shelfId, hash)`
- `preserveByHash(hash, bytes)`
- `preserveById(shelfId, bytes)`

It must not know whether a port is implemented by IndexedDB, Yjs, HTTP, memory, a batch script or a future database.

### Adapters

Technology belongs here. For the current app, `vista-perchas.js` wires browser implementations to the ports. Tests can wire in-memory implementations instead.

## Prime Directive 1AAA as a domain invariant

Shelf-photo evidence is non-destructive by default.

- render never deletes bytes;
- sync never deletes bytes;
- recovery never deletes bytes;
- a valid current pointer cannot be replaced by a local fallback;
- a missing pointer may be repaired only from exact evidence tied to the same shelf ID;
- a same-shelf local photo may be displayed while a newer hash blob is in transit, but it does not rewrite that pointer.

The domain core deliberately exposes no destructive photo operation.

## Enforcement

`test/architecture-hexagonal.test.js` fails the build if domain/application code imports browser/storage infrastructure. Domain and application tests run entirely with in-memory ports.

This is intentionally incremental. Other risky areas should move behind ports only when touched by a substantive hotfix; v448 GOLDEN is not the place for a rewrite.
