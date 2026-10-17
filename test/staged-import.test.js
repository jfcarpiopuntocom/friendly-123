const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const sha = text => createHash('sha256').update(text).digest('hex');
const sql = name => fs.readFileSync(path.join(__dirname, '../supabase-relay', name), 'utf8');

test('private staged SQL preserves a history above 16 MiB and appends the final tail without replacing bytes', async t => {
  const db = new PGlite({ extensions: { pgcrypto } }); t.after(() => db.close());
  // Local roles and extension are fixtures. No hosted Realtime/auth simulation.
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;');
  const smoke = (await db.query("SELECT version() AS version, encode(extensions.digest('fixture','sha256'),'hex') AS digest")).rows[0];
  assert.equal(smoke.digest, sha('fixture'));
  t.diagnostic(smoke.version);
  for (const name of ['20261016024151_private_ciphertext_relay_core.sql', '20261016030737_preserve_stable_operation_retry.sql', '20261016033131_cold_ciphertext_import.sql', '20261016035912_inactive_route_gate.sql']) await db.exec(sql('migrations/' + name));
  await db.exec(sql('staged-import.sql'));
  const hash = 'a'.repeat(64), token = 'b'.repeat(64), fingerprint = sha('null');
  const cipher = Buffer.alloc(250 * 1024, 37).toString('base64');
  const makePage = (seq, max = 70, id = 'synthetic-photo-' + seq) => ({ v: 1,
    cut: { minSeq: 1, maxSeq: max, fingerprint }, checkpoint: null,
    ops: [{ seq, id, lam: seq % 2 ? 20 : 10, c: cipher }], after: seq, more: seq < max });
  const append = async (page, after, cap = token, room = hash, digest) => {
    const text = JSON.stringify(page);
    return (await db.query('SELECT relay_private.stage_import_page($1,$2,$3,$4,$5) AS result', [room, cap, after, text, digest || sha(text)])).rows[0].result;
  };
  let archiveBytes = 0;
  for (let seq = 1; seq <= 70; seq++) {
    const page = makePage(seq); archiveBytes += Buffer.byteLength(JSON.stringify(page));
    assert.equal((await append(page, seq - 1)).ok, true, 'source page ' + seq);
    if (seq === 1) assert.equal((await append(page, 0)).duplicate, true);
    if (seq === 35) {
      assert.equal((await append(makePage(36), 35, token, hash, '0'.repeat(64))).ok, false);
      assert.equal((await append(makePage(36, 70, 'synthetic-photo-1'), 35)).ok, false, 'conflicting ID rolls back page and cursor');
    }
  }
  assert.ok(archiveBytes > 16777216);
  assert.equal((await append(makePage(71, 72), 70, 'c'.repeat(64))).ok, false);
  assert.equal((await append(makePage(71, 72), 70)).ok, true);
  assert.equal((await append(makePage(72, 72), 71)).copyComplete, true);
  const compacted = makePage(73, 73); compacted.cut.minSeq = 30;
  assert.equal((await append(compacted, 72)).ok, false, 'compaction needs a new coherent archive, never silently drops history');
  const page = (await db.query('SELECT relay_private.pull_page($1,-1,0,128) AS result', [hash])).rows[0].result;
  assert.equal(page.frames.length, 72);
  for (const frame of page.frames) assert.equal(sha(Buffer.from(frame, 'base64')), sha(Buffer.alloc(250 * 1024, 37)));
  const state = (await db.query('SELECT r.transport_active,s.source_after,s.source_max FROM relay_private.rooms r JOIN relay_private.import_sessions s USING(room_hash) WHERE room_hash=$1', [hash])).rows[0];
  assert.equal(state.transport_active, false); assert.equal(Number(state.source_after), 72); assert.equal(Number(state.source_max), 72);
  await db.query('UPDATE relay_private.rooms SET transport_active=true WHERE room_hash=$1', [hash]);
  assert.equal((await append(makePage(73, 73), 72)).reason, 'target-active');
  const other = 'd'.repeat(64);
  await db.query('SELECT relay_private.open_room($1)', [other]);
  await db.query("SELECT relay_private.persist_operation($1,'existing',1,'AQID')", [other]);
  assert.equal((await append(makePage(1), 0, token, other)).reason, 'target-not-empty');
  const privileges = (await db.query("SELECT has_function_privilege('anon','relay_private.stage_import_page(text,text,bigint,text,text)','EXECUTE') AS anon,has_function_privilege('authenticated','relay_private.stage_import_page(text,text,bigint,text,text)','EXECUTE') AS authenticated")).rows[0];
  assert.equal(privileges.anon, false); assert.equal(privileges.authenticated, false);
  t.diagnostic(JSON.stringify({ archiveBytes, preservedEnvelopes: page.frames.length, providerRequests: 0, sourceFenceVerified: false, cutoverReady: false }));
});
