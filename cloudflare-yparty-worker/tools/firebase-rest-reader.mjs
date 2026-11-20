// Authenticated read-only paginated Firebase RTDB reader for PORT 2.0 frozen certifier.
// Enforces ?shallow=true key census, bounded /o key pagination, pre/post server ETag check,
// REST array /k normalization, and zero PII/room/token exposure in outputs or errors.
import { createHash } from 'node:crypto';
import {
  deriveFirebaseCertifierBindings,
  packFirebaseFrozenR2Bundle
} from './firebase-frozen-certifier.mjs';

export const DEFAULT_FIREBASE_RTDB_URL = 'https://friendly-123-ab7b3-default-rtdb.firebaseio.com';
const SAFE_CHANNEL_PATH = /^\/f123\/[a-f0-9]{40}(?:-[a-z0-9-]+)?-(?:y|ops)$/;
const REV_KEY = /^[1-9][0-9]{0,8}$/;
const DEFAULT_MAX_RECORDS = 16384;
const DEFAULT_PAGE_SIZE = 2500;
const DEFAULT_MAX_PAGES = 64;

function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

function parseSafeBaseUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    throw new TypeError('invalid Firebase baseUrl');
  }
  const isLoopbackHttp =
    parsed.protocol === 'http:' &&
    (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  if (parsed.protocol !== 'https:' && !isLoopbackHttp) {
    throw new TypeError('Firebase baseUrl must use https');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError('Firebase baseUrl must not include credentials or query params');
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

function normalizeEtagHeader(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : '';
}

function isPlainObject(val) {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

export function normalizeCheckpointMap(rawK) {
  if (rawK == null) return undefined;
  if (typeof rawK !== 'object') {
    throw new TypeError('invalid checkpoint map');
  }
  const out = {};
  if (Array.isArray(rawK)) {
    if (rawK.length > 0 && rawK[0] != null) {
      throw new TypeError('invalid checkpoint map');
    }
    for (let i = 1; i < rawK.length; i++) {
      if (rawK[i] !== null && rawK[i] !== undefined) {
        const key = String(i);
        if (!REV_KEY.test(key)) throw new TypeError('invalid checkpoint revision key');
        out[key] = rawK[i];
      }
    }
    return out;
  }
  for (const [revKey, val] of Object.entries(rawK)) {
    if (!REV_KEY.test(revKey)) throw new TypeError('invalid checkpoint revision key');
    if (val !== null && val !== undefined) out[revKey] = val;
  }
  return out;
}

async function firebaseRestGet({
  fetchFn,
  baseUrl,
  relPath,
  query = {},
  authToken,
  authMode = 'bearer',
  wantEtag = false
}) {
  const url = new URL(`${baseUrl}${relPath}.json`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const headers = { Accept: 'application/json' };
  if (wantEtag) headers['X-Firebase-ETag'] = 'true';
  if (authMode === 'query') {
    url.searchParams.set('access_token', authToken);
  } else if (authMode === 'bearer') {
    headers.Authorization = `Bearer ${authToken}`;
  } else {
    throw new TypeError('unsupported Firebase authMode');
  }

  let res;
  try {
    res = await fetchFn(url.toString(), { method: 'GET', headers });
  } catch {
    throw new Error('Firebase REST transport failure');
  }
  if (!res || !res.ok) {
    throw new Error(`Firebase GET failed (HTTP ${res?.status ?? 'unknown'})`);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('invalid Firebase JSON response');
  }
  const etag = normalizeEtagHeader(res.headers?.get?.('etag'));
  return { data, etag };
}

function sameKeySet(expectedSorted, actualKeys) {
  if (expectedSorted.length !== actualKeys.length) return false;
  const actualSet = new Set(actualKeys);
  if (actualSet.size !== expectedSorted.length) return false;
  for (const k of expectedSorted) {
    if (!actualSet.has(k)) return false;
  }
  return true;
}

export async function fetchFirebaseChannelSnapshot({
  baseUrl = DEFAULT_FIREBASE_RTDB_URL,
  channelPath,
  authToken,
  authMode = 'bearer',
  fetchFn = globalThis.fetch,
  pageSize = DEFAULT_PAGE_SIZE,
  maxRecords = DEFAULT_MAX_RECORDS,
  maxPages = DEFAULT_MAX_PAGES
}) {
  const cleanBase = parseSafeBaseUrl(baseUrl);
  if (typeof channelPath !== 'string' || !SAFE_CHANNEL_PATH.test(channelPath)) {
    throw new TypeError('invalid Firebase channelPath');
  }
  if (typeof authToken !== 'string' || !authToken.trim()) {
    throw new TypeError('missing Firebase authToken');
  }
  if (typeof fetchFn !== 'function') {
    throw new TypeError('missing fetchFn');
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > DEFAULT_MAX_RECORDS) {
    throw new TypeError('invalid pageSize');
  }
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > DEFAULT_MAX_RECORDS) {
    throw new TypeError('invalid maxRecords');
  }
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 256) {
    throw new TypeError('invalid maxPages');
  }

  const pre = await firebaseRestGet({
    fetchFn,
    baseUrl: cleanBase,
    relPath: channelPath,
    query: { shallow: 'true' },
    authToken,
    authMode,
    wantEtag: true
  });
  if (!pre.etag) {
    throw new Error('missing Firebase server ETag');
  }
  if (pre.data === null) {
    throw new Error('missing Firebase channel');
  }
  if (!isPlainObject(pre.data)) {
    throw new Error('invalid Firebase channel root');
  }
  for (const rootKey of Object.keys(pre.data)) {
    if (rootKey !== 'k' && rootKey !== 'o') {
      throw new Error(`unexpected Firebase channel key: ${rootKey}`);
    }
  }

  let kKeys = [];
  if (pre.data.k === true) {
    const kShallow = await firebaseRestGet({
      fetchFn,
      baseUrl: cleanBase,
      relPath: `${channelPath}/k`,
      query: { shallow: 'true' },
      authToken,
      authMode
    });
    const normShallow = normalizeCheckpointMap(kShallow.data);
    kKeys = normShallow ? Object.keys(normShallow).sort((a, b) => Number(a) - Number(b)) : [];
  }

  let oKeys = [];
  if (pre.data.o === true) {
    const oShallow = await firebaseRestGet({
      fetchFn,
      baseUrl: cleanBase,
      relPath: `${channelPath}/o`,
      query: { shallow: 'true' },
      authToken,
      authMode
    });
    if (!isPlainObject(oShallow.data)) {
      throw new Error('invalid Firebase ops census');
    }
    oKeys = Object.keys(oShallow.data).sort();
  }

  const totalCensus = kKeys.length + oKeys.length;
  if (totalCensus < 1 || totalCensus > maxRecords) {
    throw new Error('Firebase channel record count out of safe budget');
  }

  let kMap;
  if (kKeys.length > 0) {
    const kFull = await firebaseRestGet({
      fetchFn,
      baseUrl: cleanBase,
      relPath: `${channelPath}/k`,
      authToken,
      authMode
    });
    kMap = normalizeCheckpointMap(kFull.data) || {};
    if (!sameKeySet(kKeys, Object.keys(kMap))) {
      throw new Error('incomplete Firebase channel read');
    }
  }

  const oMap = {};
  if (oKeys.length > 0) {
    let cursor = null;
    let pages = 0;
    const downloadedKeys = new Set();
    while (downloadedKeys.size < oKeys.length) {
      if (pages >= maxPages) {
        throw new Error('Firebase pagination exceeded maxPages');
      }
      const isFirst = cursor === null;
      const limit = isFirst ? pageSize : pageSize + 1;
      const query = isFirst
        ? { orderBy: '"$key"', limitToFirst: String(limit) }
        : { orderBy: '"$key"', startAt: JSON.stringify(cursor), limitToFirst: String(limit) };
      const pageRes = await firebaseRestGet({
        fetchFn,
        baseUrl: cleanBase,
        relPath: `${channelPath}/o`,
        query,
        authToken,
        authMode
      });
      if (!isPlainObject(pageRes.data)) {
        throw new Error('incomplete Firebase channel read');
      }
      const keys = Object.keys(pageRes.data).sort();
      if (!keys.length) break;
      let added = 0;
      for (const k of keys) {
        if (!isFirst && k <= cursor) continue;
        oMap[k] = pageRes.data[k];
        downloadedKeys.add(k);
        added++;
      }
      pages++;
      if (added === 0) {
        throw new Error('incomplete Firebase channel read');
      }
      cursor = keys[keys.length - 1];
      if (keys.length < limit) break;
    }
    if (!sameKeySet(oKeys, Object.keys(oMap))) {
      throw new Error('incomplete Firebase channel read');
    }
  }

  const post = await firebaseRestGet({
    fetchFn,
    baseUrl: cleanBase,
    relPath: channelPath,
    query: { shallow: 'true' },
    authToken,
    authMode,
    wantEtag: true
  });
  if (!post.etag) {
    throw new Error('missing Firebase server ETag');
  }
  if (post.etag !== pre.etag) {
    throw new Error('concurrent Firebase channel mutation detected');
  }

  const snapshot = {};
  if (kMap !== undefined) snapshot.k = kMap;
  if (oKeys.length > 0) snapshot.o = oMap;

  return {
    snapshot: Object.freeze(snapshot),
    serverHead: Object.freeze({
      etag: pre.etag,
      kCount: kKeys.length,
      oCount: oKeys.length
    })
  };
}

export async function fetchAndPackFirebaseStore({
  codigo,
  authToken,
  authMode = 'bearer',
  baseUrl = DEFAULT_FIREBASE_RTDB_URL,
  firebaseCleanSuffix,
  fetchFn = globalThis.fetch,
  pageSize = DEFAULT_PAGE_SIZE,
  maxRecords = DEFAULT_MAX_RECORDS,
  maxPages = DEFAULT_MAX_PAGES,
  limits
}) {
  const bindings = await deriveFirebaseCertifierBindings(codigo, { firebaseCleanSuffix });
  const [catRes, opsRes] = await Promise.all([
    fetchFirebaseChannelSnapshot({
      baseUrl,
      channelPath: bindings.firebasePaths.y,
      authToken,
      authMode,
      fetchFn,
      pageSize,
      maxRecords,
      maxPages
    }),
    fetchFirebaseChannelSnapshot({
      baseUrl,
      channelPath: bindings.firebasePaths.ops,
      authToken,
      authMode,
      fetchFn,
      pageSize,
      maxRecords,
      maxPages
    })
  ]);

  const yEtagSha256 = sha256Hex(catRes.serverHead.etag);
  const opsEtagSha256 = sha256Hex(opsRes.serverHead.etag);
  const frozenHead = `fb-head-${sha256Hex(`${catRes.serverHead.etag}|${opsRes.serverHead.etag}`).slice(0, 24)}`;

  const bundle = await packFirebaseFrozenR2Bundle({
    codigo,
    firebaseCleanSuffix,
    frozenHead,
    ySnapshot: catRes.snapshot,
    opsSnapshot: opsRes.snapshot,
    limits
  });

  return {
    ...bundle,
    sourceProof: Object.freeze({
      completeToHead: true,
      independentServerEtags: true,
      frozenHead,
      yEtagSha256,
      opsEtagSha256,
      yRecords: catRes.serverHead.kCount + catRes.serverHead.oCount,
      opsRecords: opsRes.serverHead.kCount + opsRes.serverHead.oCount
    })
  };
}
