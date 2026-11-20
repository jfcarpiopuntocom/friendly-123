// C95: Deterministic, fail-closed bridge from a verified present-device union (C93)
// and sanitized current catalog snapshot into immutable -ops and -cat R2 archives.
// Never reads live browser storage, Firebase, or customer data, and never creates
// archives unless authenticatedSealProof + readyForAuthenticatedSeal + digest match.
import * as Y from 'yjs';
import { Sha256Sync } from '../src/sha256-sync.mjs';
import { verifyForwardCurrentUnionPlan } from '../src/current-state-union.mjs';
import { prepareImportedOpsBaseline } from '../src/frozen-ops-baseline.mjs';
import {
  F123_PUBLIC_PROJECTION_VERSION,
  projectPublicCatalog
} from '../src/catalog-safe-projection.mjs';
import { packFrozenR2Archive } from './frozen-r2-packager.mjs';

const ROOM_HEX = /^[a-f0-9]{32}$/;
const HEAD_RE = /^[A-Za-z0-9_.:-]{3,128}$/;
const HASH_HEX = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();

function fail(reason) {
  throw new TypeError(`present-union R2 seal refused: ${reason}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function shaBytes(bytes) {
  const h = new Sha256Sync();
  h.update(bytes);
  return h.hex();
}

function framesDigest(frames) {
  const h = new Sha256Sync();
  for (const frame of frames) {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, frame.byteLength, false);
    h.update(len);
    h.update(frame);
  }
  return h.hex();
}

function validateSealInputs({ room, frozenHead, authenticatedSealProof, unionPlan }) {
  if (typeof room !== 'string' || !ROOM_HEX.test(room)) fail('invalid room hex');
  if (typeof frozenHead !== 'string' || !HEAD_RE.test(frozenHead)) fail('invalid frozenHead');
  if (!isPlainObject(unionPlan)) fail('unionPlan object required');
  if (unionPlan.sealed !== false) fail('unionPlan already marked sealed');
  if (Array.isArray(unionPlan.quarantined) && unionPlan.quarantined.length > 0) {
    fail('quarantined conflicting facts present');
  }
  if (Array.isArray(unionPlan.viewDifferences) && unionPlan.viewDifferences.length > 0) {
    fail('stock or view differences present');
  }
  if (unionPlan.readyForAuthenticatedSeal !== true) {
    fail('unionPlan is not ready for seal');
  }
  if (!Number.isSafeInteger(unionPlan.sourceCount) || unionPlan.sourceCount < 2) {
    fail('at least two verified present sources required');
  }
  if (!Array.isArray(unionPlan.facts) || unionPlan.facts.length < 1) {
    fail('at least one accepted fact required');
  }
  if (typeof unionPlan.manifestCanonical !== 'string' || !HASH_HEX.test(unionPlan.digest || '')) {
    fail('missing unionPlan canonical digest');
  }
  if (shaBytes(encoder.encode(unionPlan.manifestCanonical)) !== unionPlan.digest) {
    fail('unionPlan digest mismatch');
  }
  if (!isPlainObject(authenticatedSealProof)) fail('authenticatedSealProof required');
  if (typeof authenticatedSealProof.issuer !== 'string' || authenticatedSealProof.issuer.trim().length < 3) {
    fail('authenticatedSealProof issuer required');
  }
  if (!Number.isSafeInteger(authenticatedSealProof.verifiedSources) ||
      authenticatedSealProof.verifiedSources !== unionPlan.sourceCount) {
    fail('authenticatedSealProof source count mismatch');
  }
  if (authenticatedSealProof.unionDigest !== unionPlan.digest) {
    fail('authenticatedSealProof digest mismatch');
  }
  if (authenticatedSealProof.businessScope !== unionPlan.businessScope) {
    fail('authenticatedSealProof businessScope mismatch');
  }
}

function buildOpsStateFromUnion(unionPlan) {
  const opsDoc = new Y.Doc();
  opsDoc.clientID = 1;
  try {
    const eventos = opsDoc.getMap('eventos');
    const sortedFacts = [...unionPlan.facts].sort((a, b) => (a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0));
    for (const fact of sortedFacts) {
      if (!isPlainObject(fact) || typeof fact.opId !== 'string' || !isPlainObject(fact.payload)) {
        fail('malformed accepted fact');
      }
      if (fact.payload.opId !== undefined && fact.payload.opId !== fact.opId) {
        fail(`payload opId mismatch for ${fact.opId}`);
      }
      eventos.set(fact.opId, { ...fact.payload, opId: fact.opId });
    }
    const baseline = prepareImportedOpsBaseline(opsDoc);
    const frame = Y.encodeStateAsUpdate(opsDoc);
    const vector = Y.encodeStateVector(opsDoc);
    return {
      frame,
      vector,
      baseline,
      factCount: sortedFacts.length
    };
  } finally {
    opsDoc.destroy();
  }
}

function buildProjectedCatalogFrame({ room, frozenHead, publicCatalogSnapshot }) {
  const rawDoc = new Y.Doc();
  rawDoc.clientID = 1;
  try {
    if (publicCatalogSnapshot instanceof Uint8Array) {
      Y.applyUpdate(rawDoc, publicCatalogSnapshot, 'c95-catalog-snapshot');
    } else if (isPlainObject(publicCatalogSnapshot)) {
      for (const rootKey of Object.keys(publicCatalogSnapshot)) {
        if (rootKey !== 'productos' && rootKey !== 'ubicaciones') {
          fail(`unexpected catalog root key: ${rootKey}`);
        }
      }
      for (const mapName of ['productos', 'ubicaciones']) {
        const srcMap = publicCatalogSnapshot[mapName];
        if (srcMap === undefined) continue;
        if (!isPlainObject(srcMap)) fail(`invalid catalog map ${mapName}`);
        const yMap = rawDoc.getMap(mapName);
        for (const key of Object.keys(srcMap).sort()) {
          yMap.set(key, srcMap[key]);
        }
      }
    } else {
      fail('publicCatalogSnapshot must be a plain catalog object or Yjs update');
    }
    rawDoc.getMap('productos');
    rawDoc.getMap('ubicaciones');
    const projected = projectPublicCatalog({
      sourceDoc: rawDoc,
      Y,
      room: `${room}-cat`,
      channel: 'cat',
      frozenHead
    });
    try {
      const vector = Y.encodeStateVector(projected.doc);
      return {
        frame: new Uint8Array(projected.bytes),
        vector
      };
    } finally {
      projected.doc.destroy();
    }
  } finally {
    rawDoc.destroy();
  }
}

/**
 * Seals a C93 present-device union and sanitized catalog snapshot into immutable R2 archives.
 */
export async function sealPresentUnionToR2({
  room,
  frozenHead,
  authenticatedSealProof,
  unionPlan,
  publicCatalogSnapshot,
  limits
} = {}) {
  validateSealInputs({ room, frozenHead, authenticatedSealProof, unionPlan });
  verifyForwardCurrentUnionPlan(unionPlan);
  const opsData = buildOpsStateFromUnion(unionPlan);
  const catData = buildProjectedCatalogFrame({ room, frozenHead, publicCatalogSnapshot });

  const opsArchive = await packFrozenR2Archive({
    room: `${room}-ops`,
    channel: 'ops',
    frozenHead,
    frames: [opsData.frame],
    externalProof: {
      sourceHead: frozenHead,
      completeToHead: true,
      sourceFramesSha256: framesDigest([opsData.frame]),
      expectedStateSha256: shaBytes(opsData.frame),
      expectedVectorSha256: shaBytes(opsData.vector),
      expectedOpIds: opsData.factCount
    },
    limits
  });

  const catArchive = await packFrozenR2Archive({
    room: `${room}-cat`,
    channel: 'cat',
    frozenHead,
    frames: [catData.frame],
    externalProof: {
      sourceHead: frozenHead,
      completeToHead: true,
      sourceFramesSha256: framesDigest([catData.frame]),
      expectedStateSha256: shaBytes(catData.frame),
      expectedVectorSha256: shaBytes(catData.vector),
      expectedProjectedSha256: shaBytes(catData.frame),
      projectionVersion: F123_PUBLIC_PROJECTION_VERSION
    },
    limits
  });

  return Object.freeze({
    ops: opsArchive,
    cat: catArchive,
    summary: Object.freeze({
      protocol: 'f123-present-seal-v1',
      room,
      frozenHead,
      businessScope: unionPlan.businessScope,
      unionDigest: unionPlan.digest,
      sourceCount: unionPlan.sourceCount,
      acceptedFacts: opsData.factCount,
      opsBaselineSha256: opsData.baseline.sha256,
      opsManifestSha256: opsArchive.manifestSha256,
      catManifestSha256: catArchive.manifestSha256
    })
  });
}
