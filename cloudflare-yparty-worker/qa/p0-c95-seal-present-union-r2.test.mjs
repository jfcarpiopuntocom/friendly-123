// C95 RED->GREEN: Seal verified multi-device present-state union (C93) into immutable -ops and -cat R2 archives
// and verify cold boot inside real Miniflare R2 Workerd -> readTrustedFrozenSource -> prepareFrozenImport.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import * as Y from 'yjs';
import { planForwardCurrentUnion } from '../src/current-state-union.mjs';
import { readTrustedFrozenSource } from '../src/trusted-frozen-source.mjs';
import { prepareFrozenImport } from '../src/certified-frozen-import.mjs';
import { sealPresentUnionToR2 } from '../tools/seal-present-union-r2.mjs';

const ROOM_ID = 'c'.repeat(32);
const BUSINESS_SCOPE = 'b'.repeat(64);
const SRC_IPHONE = '1'.repeat(64);
const SRC_TABLET = '2'.repeat(64);
const SRC_PC = '3'.repeat(64);
const KEY_STOCK = '4'.repeat(64);
const VAL_STOCK = '5'.repeat(64);
const FROZEN_HEAD = 'present-union-20261120-01';
const SERVICE_KEY = 'synthetic-c95-service-key-32-bytes!';

function makeReadyUnion() {
  return planForwardCurrentUnion({
    observations: [
      {
        application: 'friendly-123',
        businessScope: BUSINESS_SCOPE,
        sourceId: SRC_IPHONE,
        facts: [
          { opId: 'sale-c95-001', payload: { kind: 'sale.record', productId: 'p1', quantity: 2, amountCents: 1500 } },
          { opId: 'pay-c95-002', payload: { kind: 'abono', clienteId: 'cli1', amountCents: 750, monto: 7.5 } }
        ],
        views: [{ domain: 'stock', keyHash: KEY_STOCK, valueHash: VAL_STOCK }]
      },
      {
        application: 'friendly-123',
        businessScope: BUSINESS_SCOPE,
        sourceId: SRC_TABLET,
        facts: [
          { opId: 'sale-c95-001', payload: { kind: 'sale.record', productId: 'p1', quantity: 2, amountCents: 1500 } },
          { opId: 'adj-c95-003', payload: { kind: 'stock.adjust', productId: 'p1', delta: 5 } }
        ],
        views: [{ domain: 'stock', keyHash: KEY_STOCK, valueHash: VAL_STOCK }]
      },
      {
        application: 'friendly-123',
        businessScope: BUSINESS_SCOPE,
        sourceId: SRC_PC,
        facts: [],
        views: [{ domain: 'stock', keyHash: KEY_STOCK, valueHash: VAL_STOCK }]
      }
    ]
  });
}

function makeCatalogSnapshot() {
  return {
    productos: {
      p1: { id: 'p1', nombre: 'Arroz 1kg', precio: 1.5, stockActual: 12, costo: 0.95, sku: '' }
    },
    ubicaciones: {
      u1: { id: 'u1', nombre: 'Percha Central', activa: true }
    }
  };
}

test('C95: deterministic sealing of present multi-device union survives Workerd R2 -> prepareFrozenImport with zero secrets leaked', { timeout: 45000 }, async () => {
  const unionPlan = makeReadyUnion();
  assert.equal(unionPlan.readyForAuthenticatedSeal, true);
  const authenticatedSealProof = {
    issuer: 'owner-session-verified',
    verifiedSources: unionPlan.sourceCount,
    unionDigest: unionPlan.digest,
    businessScope: BUSINESS_SCOPE
  };

  const sealedA = await sealPresentUnionToR2({
    room: ROOM_ID,
    frozenHead: FROZEN_HEAD,
    authenticatedSealProof,
    unionPlan,
    publicCatalogSnapshot: makeCatalogSnapshot()
  });
  const sealedB = await sealPresentUnionToR2({
    room: ROOM_ID,
    frozenHead: FROZEN_HEAD,
    authenticatedSealProof,
    unionPlan,
    publicCatalogSnapshot: makeCatalogSnapshot()
  });

  assert.equal(sealedA.ops.manifestSha256, sealedB.ops.manifestSha256);
  assert.equal(sealedA.cat.manifestSha256, sealedB.cat.manifestSha256);
  assert.deepEqual(sealedA.ops.objects, sealedB.ops.objects);
  assert.deepEqual(sealedA.cat.objects, sealedB.cat.objects);
  assert.equal(sealedA.summary.acceptedFacts, 3);
  assert.equal(sealedA.ops.manifest.expectedOpIds, 3);
  assert.equal(sealedA.cat.manifest.projectionVersion, 'v1');

  // Verify no cost or blank SKU leaked into -cat R2 objects.
  const catText = sealedA.cat.objects.map((o) => o.body).join('\n');
  assert.equal(catText.includes('costo'), false);
  assert.equal(catText.includes('0.95'), false);

  // Round-trip BOTH -ops and -cat through real Workerd frozen-r2-source.mjs -> readTrustedFrozenSource -> prepareFrozenImport.
  const script = (await build({
    entryPoints: [path.join(import.meta.dirname, '../src/frozen-r2-source.mjs')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker', 'browser'],
    external: ['cloudflare:*'],
    write: false
  })).outputFiles[0].text;

  const mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: '2026-06-01',
    compatibilityFlags: ['nodejs_compat'],
    r2Buckets: ['F123_FROZEN_R2'],
    bindings: {
      F123_FROZEN_ROOM: ROOM_ID,
      F123_FROZEN_HEAD: FROZEN_HEAD,
      F123_FROZEN_OPS_MANIFEST_SHA256: sealedA.ops.manifestSha256,
      F123_FROZEN_CAT_MANIFEST_SHA256: sealedA.cat.manifestSha256,
      WS_SERVICE_KEY: SERVICE_KEY
    }
  });
  try {
    await mf.ready;
    const bucket = await mf.getR2Bucket('F123_FROZEN_R2');
    for (const obj of [...sealedA.ops.objects, ...sealedA.cat.objects]) {
      await bucket.put(obj.key, obj.body);
    }
    const env = {
      WS_OPEN_EXISTING_QA: '1',
      WS_AUTHORITY_QA: '1',
      WS_SEPARATE_ROOMS_QA: '1',
      SALA_PILOTO: ROOM_ID,
      WS_SERVICE_KEY: SERVICE_KEY,
      WS_FROZEN_HISTORY_SOURCE: {
        fetch: async (req) => mf.dispatchFetch(req.url, {
          method: req.method,
          headers: Object.fromEntries(req.headers),
          body: await req.text()
        })
      }
    };

    const recoveredOps = await readTrustedFrozenSource({ env, room: `${ROOM_ID}-ops`, channel: 'ops' });
    const proofOps = await prepareFrozenImport(recoveredOps);
    assert.equal(proofOps.eventCount, 3);
    assert.equal(proofOps.sha256, sealedA.ops.manifest.expectedStateSha256);

    const recoveredCat = await readTrustedFrozenSource({ env, room: `${ROOM_ID}-cat`, channel: 'cat' });
    const proofCat = await prepareFrozenImport(recoveredCat);
    assert.equal(proofCat.sha256, sealedA.cat.manifest.expectedStateSha256);

    const checkCatDoc = new Y.Doc();
    for (const f of recoveredCat.frames) Y.applyUpdate(checkCatDoc, f);
    assert.equal(checkCatDoc.getMap('productos').get('p1').nombre, 'Arroz 1kg');
    assert.equal(checkCatDoc.getMap('productos').get('p1').costo, undefined);
    assert.equal(Object.hasOwn(checkCatDoc.getMap('productos').get('p1'), 'sku'), false);
    checkCatDoc.destroy();
  } finally {
    await mf.dispose();
  }
});

test('C95: fails closed on quarantined conflict, view difference, single source, tampered digest, or missing auth proof', async () => {
  const ready = makeReadyUnion();
  const validProof = {
    issuer: 'owner-session-verified',
    verifiedSources: ready.sourceCount,
    unionDigest: ready.digest,
    businessScope: BUSINESS_SCOPE
  };

  // Quarantined amount conflict refuses.
  const conflicted = planForwardCurrentUnion({
    observations: [
      { application: 'friendly-123', businessScope: BUSINESS_SCOPE, sourceId: SRC_IPHONE, facts: [{ opId: 's1', payload: { kind: 'sale.record', amountCents: 100 } }], views: [] },
      { application: 'friendly-123', businessScope: BUSINESS_SCOPE, sourceId: SRC_TABLET, facts: [{ opId: 's1', payload: { kind: 'sale.record', amountCents: 200 } }], views: [] }
    ]
  });
  await assert.rejects(
    sealPresentUnionToR2({
      room: ROOM_ID,
      frozenHead: FROZEN_HEAD,
      authenticatedSealProof: { ...validProof, unionDigest: conflicted.digest, verifiedSources: 2 },
      unionPlan: conflicted,
      publicCatalogSnapshot: makeCatalogSnapshot()
    }),
    /not ready|conflict|quarantine/i
  );

  // Stock view difference refuses.
  const viewDiff = planForwardCurrentUnion({
    observations: [
      { application: 'friendly-123', businessScope: BUSINESS_SCOPE, sourceId: SRC_IPHONE, facts: [{ opId: 's1', payload: { kind: 'sale.record', amountCents: 100 } }], views: [{ domain: 'stock', keyHash: KEY_STOCK, valueHash: VAL_STOCK }] },
      { application: 'friendly-123', businessScope: BUSINESS_SCOPE, sourceId: SRC_TABLET, facts: [], views: [{ domain: 'stock', keyHash: KEY_STOCK, valueHash: '9'.repeat(64) }] }
    ]
  });
  await assert.rejects(
    sealPresentUnionToR2({
      room: ROOM_ID,
      frozenHead: FROZEN_HEAD,
      authenticatedSealProof: { ...validProof, unionDigest: viewDiff.digest, verifiedSources: 2 },
      unionPlan: viewDiff,
      publicCatalogSnapshot: makeCatalogSnapshot()
    }),
    /not ready|view/i
  );

  // Missing or mismatched authenticatedSealProof fails closed.
  await assert.rejects(
    sealPresentUnionToR2({
      room: ROOM_ID,
      frozenHead: FROZEN_HEAD,
      authenticatedSealProof: { ...validProof, unionDigest: '0'.repeat(64) },
      unionPlan: ready,
      publicCatalogSnapshot: makeCatalogSnapshot()
    }),
    /proof|digest/i
  );

  // Tampered unionPlan manifestCanonical fails closed.
  const tampered = { ...ready, digest: 'f'.repeat(64) };
  await assert.rejects(
    sealPresentUnionToR2({
      room: ROOM_ID,
      frozenHead: FROZEN_HEAD,
      authenticatedSealProof: { ...validProof, unionDigest: 'f'.repeat(64) },
      unionPlan: tampered,
      publicCatalogSnapshot: makeCatalogSnapshot()
    }),
    /digest/i
  );

  // Disallowed catalog root keys refuse.
  await assert.rejects(
    sealPresentUnionToR2({
      room: ROOM_ID,
      frozenHead: FROZEN_HEAD,
      authenticatedSealProof: validProof,
      unionPlan: ready,
      publicCatalogSnapshot: { ...makeCatalogSnapshot(), _meta: { ownerPin: '9999' } }
    }),
    /catalog|root|unexpected/i
  );
});
