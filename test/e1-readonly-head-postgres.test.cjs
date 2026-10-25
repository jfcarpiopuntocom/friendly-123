'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migration = fs.readFileSync(path.join(__dirname, '../supabase-relay/migrations/20261022000100_readonly_head.sql'), 'utf8');

test('E1 HEAD is room-gated metadata-only and preserves the relay command dispatch', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE stranger;
    CREATE SCHEMA extensions; CREATE SCHEMA relay_private;
    CREATE FUNCTION extensions.digest(input text, algorithm text) RETURNS bytea
      LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
        IF lower(algorithm) <> 'sha256' THEN RAISE EXCEPTION 'unsupported digest'; END IF;
        RETURN pg_catalog.sha256(pg_catalog.convert_to(input, 'UTF8'));
      END $$;
    CREATE TABLE relay_private.rooms(
      room_hash text PRIMARY KEY, revision bigint NOT NULL DEFAULT 0,
      transport_active boolean NOT NULL DEFAULT false,
      checkpoint_cipher bytea, checkpoint_lam bigint NOT NULL DEFAULT 0
    );
    CREATE TABLE relay_private.operations(
      seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, room_hash text NOT NULL,
      op_id text NOT NULL, lam bigint NOT NULL, cipher bytea NOT NULL
    );
    CREATE INDEX relay_operations_room_sequence ON relay_private.operations(room_hash,seq);
    CREATE FUNCTION relay_private.persist_operation(text,text,bigint,text) RETURNS jsonb
      LANGUAGE sql AS $$ SELECT '{"ok":true,"old":"op"}'::jsonb $$;
    CREATE FUNCTION relay_private.save_checkpoint(text,bigint,text,integer,bigint,bigint) RETURNS jsonb
      LANGUAGE sql AS $$ SELECT '{"ok":true,"old":"ckpt"}'::jsonb $$;
    CREATE FUNCTION relay_private.pull_page(text,bigint,bigint,integer) RETURNS jsonb
      LANGUAGE sql AS $$ SELECT '{"frames":["AQ=="],"v":2,"rev":7,"seq":9,"n":1,"more":false}'::jsonb $$;
    CREATE FUNCTION relay_private.pull_legacy(text,bigint) RETURNS jsonb
      LANGUAGE sql AS $$ SELECT '["Ag=="]'::jsonb $$;
  `);
  // Minimal fixture implements the migration's existing callee contracts only.
  await db.exec(migration);
  const room = 'active-room';
  const roomHash = async name => (await db.query(
    "SELECT encode(extensions.digest('friendly-relay:' || $1,'sha256'),'hex') AS h", [name]
  )).rows[0].h;
  const activeHash = await roomHash(room), inactiveHash = await roomHash('inactive-room');
  await db.query('INSERT INTO relay_private.rooms(room_hash,revision,transport_active) VALUES($1,0,true),($2,4,false)', [activeHash, inactiveHash]);
  await db.query('INSERT INTO relay_private.operations(room_hash,op_id,lam,cipher) VALUES($1,$2,1,decode($3,\'base64\'))', [activeHash, 'synthetic-1', 'AQ==']);

  const call = (action, message = {}, roomName = room) => db.query(
    'SELECT public.f123_relay_command($1,$2,$3::jsonb) AS result',
    [roomName, action, JSON.stringify(message)]
  );
  const snapshot = async () => (await db.query(`
    SELECT (SELECT jsonb_agg(to_jsonb(r) ORDER BY room_hash) FROM relay_private.rooms r) rooms,
           (SELECT jsonb_agg(to_jsonb(o) ORDER BY seq) FROM relay_private.operations o) operations
  `)).rows[0];
  const before = await snapshot();

  for (const role of ['anon', 'authenticated', 'service_role']) {
    await db.exec(`SET ROLE ${role}`);
    assert.deepEqual((await call('head')).rows[0].result, { v: 2, rev: 0, seq: 1 });
    await db.exec('RESET ROLE');
    assert.deepEqual((await snapshot()), before, 'HEAD leaves room, checkpoint and operation rows unchanged');
  }
  await assert.rejects(call('head', {}, 'inactive-room'), /Room capability not authorized/);
  await assert.rejects(call('head', {}, 'unknown-room'), /Room capability not authorized/);

  const grants = (await db.query(`
    SELECT coalesce(bool_or(x.grantee = 0 AND x.privilege_type = 'EXECUTE'), false) AS public_execute
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
    WHERE p.oid = 'public.f123_relay_command(text,text,jsonb)'::regprocedure
  `)).rows[0];
  assert.equal(grants.public_execute, false);
  await db.exec('SET ROLE stranger');
  await assert.rejects(call('head'), /permission denied/);
  await db.exec('RESET ROLE');

  assert.deepEqual((await call('op', { id: 'x', lam: 1, c: 'AQ==' })).rows[0].result, { ok: true, old: 'op' });
  assert.deepEqual((await call('ckpt', { lam: 1, c: 'AQ==', v: 2, rev: 0, seq: 1 })).rows[0].result, { ok: true, old: 'ckpt' });
  assert.deepEqual((await call('pull', { v: 2, rev: 0, seq: 0, limit: 64 })).rows[0].result, { frames: ['AQ=='], v: 2, rev: 7, seq: 9, n: 1, more: false });
  assert.deepEqual((await call('pull', { lam: 0 })).rows[0].result, { frames: ['Ag=='] });
  const ts = (await call('ts', { t0: 123 })).rows[0].result;
  assert.equal(ts.k, 'tsr'); assert.equal(ts.t0, 123); assert.ok(Number.isSafeInteger(ts.t1));

  await db.query('UPDATE relay_private.rooms SET revision=5 WHERE room_hash=$1', [activeHash]);
  await db.query('DELETE FROM relay_private.operations WHERE room_hash=$1', [activeHash]);
  assert.deepEqual((await call('head')).rows[0].result, { v: 2, rev: 5, seq: 0 }, 'checkpoint revision with compacted empty tail keeps the metadata response shape');
  await db.query('INSERT INTO relay_private.operations(room_hash,op_id,lam,cipher) VALUES($1,$2,2,decode($3,\'base64\'))', [activeHash, 'synthetic-2', 'Ag==']);
  await db.query('INSERT INTO relay_private.operations(room_hash,op_id,lam,cipher) VALUES($1,$2,3,decode($3,\'base64\'))', [activeHash, 'synthetic-3', 'Aw==']);
  assert.deepEqual((await call('head')).rows[0].result, { v: 2, rev: 5, seq: 3 });
});
