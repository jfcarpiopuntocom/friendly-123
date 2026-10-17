const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createHash, createHmac } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const sql = name => fs.readFileSync(path.join(__dirname, '../supabase-relay', name), 'utf8');
const sha = text => createHash('sha256').update(text).digest('hex');

test('signed operator pages bind room, token, cursor, time and exact encrypted bytes without private client access', async t => {
 const db = new PGlite({ extensions: { pgcrypto } }); t.after(() => db.close());
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;');
 for (const name of ['20261016024151_private_ciphertext_relay_core.sql','20261016030737_preserve_stable_operation_retry.sql','20261016033131_cold_ciphertext_import.sql','20261016035912_inactive_route_gate.sql']) await db.exec(sql('migrations/' + name));
 await db.exec(sql('staged-import.sql'));
 // Secret table interface comes from provision.sql; this fixture is not production provisioning.
 await db.exec('CREATE TABLE relay_private.provisioning_secret(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), secret text NOT NULL); ALTER TABLE relay_private.provisioning_secret ENABLE ROW LEVEL SECURITY; REVOKE ALL ON relay_private.provisioning_secret FROM PUBLIC,anon,authenticated,service_role;');
 const secret='d'.repeat(64), hash='a'.repeat(64), token='b'.repeat(64);
 await db.query('INSERT INTO relay_private.provisioning_secret(secret) VALUES($1)',[secret]);
 await db.exec(sql('signed-import.sql'));
 const source=JSON.stringify({v:1,cut:{minSeq:1,maxSeq:1,fingerprint:sha('null')},checkpoint:null,ops:[{seq:1,id:'synthetic-signed-page',lam:5,c:'AQIDBA=='}],after:1,more:false});
 const issued=Date.now(), digest=sha(source);
 const signature=(when=issued,key=secret,after=0,d=digest,h=hash,tok=token)=>createHmac('sha256',key).update(['friendly-import:v1',when,h,tok,after,d].join('\n')).digest('hex');
 const call=(args)=>db.query('SELECT public.f123_relay_stage_import_signed($1,$2,$3,$4,$5,$6,$7) AS result',args);
 await db.exec('SET ROLE anon');
 for (const args of [
  [hash,token,0,source,digest,issued,signature(issued,'e'.repeat(64))],
  [hash,token,0,source,digest,issued-120000,signature(issued-120000)],
  [hash,token,0,source,digest,issued+120000,signature(issued+120000)],
  [hash,token,0,source.replace('AQIDBA==','BQYHCA=='),digest,issued,signature()],
  [hash,token,0,source,'f'.repeat(64),issued,signature(issued,secret,0,'f'.repeat(64))],
  [hash,token,-1,source,digest,issued,signature(issued,secret,-1)],
  [null,token,0,source,digest,issued,signature()],
  [hash,token,0,source,digest,issued,'invalid'],
  ['c'.repeat(64),token,0,source,digest,issued,signature()],
  [hash,'c'.repeat(64),0,source,digest,issued,signature()],
  [hash,token,1,source,digest,issued,signature()]
 ]) await assert.rejects(call(args));
 await assert.rejects(db.query('SELECT * FROM relay_private.provisioning_secret'));
 await assert.rejects(db.query('SELECT relay_private.stage_import_page($1,$2,0,$3,$4)',[hash,token,source,digest]));
 let result=(await call([hash,token,0,source,digest,issued,signature()])).rows[0].result;
 assert.equal(result.ok,true); assert.equal(result.copyComplete,true);
 result=(await call([hash,token,0,source,digest,issued,signature()])).rows[0].result;
 assert.equal(result.duplicate,true);
 await db.exec('RESET ROLE');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM relay_private.rooms')).rows[0].n,1,'unauthorized calls cannot create targets');
 assert.equal((await db.query("SELECT encode(cipher,'hex') AS bytes FROM relay_private.operations WHERE room_hash=$1",[hash])).rows[0].bytes,'01020304');
 await db.query('UPDATE relay_private.rooms SET transport_active=true WHERE room_hash=$1',[hash]);
 await db.exec('SET ROLE authenticated');
 result=(await call([hash,token,0,source,digest,issued,signature()])).rows[0].result;
 assert.equal(result.reason,'target-active');
 await db.exec('RESET ROLE');
});
