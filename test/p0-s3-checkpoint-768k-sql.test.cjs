'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'../supabase-relay/migrations');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('768KiB SQL migration: exact checkpoint boundary, 1.5MB recovery, all operations drained, no OP-cap change',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
 await db.exec(read('20261016024151_private_ciphertext_relay_core.sql'));
 await db.exec(read('20261017071000_bounded_recovery_page.sql'));
 const hash='e'.repeat(64);
 await db.query('SELECT relay_private.open_room($1)',[hash]);
 // First assert old 262144-byte server cap, before applying the new migration.
 const old=await db.query("SELECT relay_private.save_checkpoint($1,1,encode(decode(repeat('ab',262145),'hex'),'base64'),2,0,0) AS result",[hash]);
 assert.equal(old.rows[0].result.ok,false,'old server must reject 262145 B');
 await db.exec(read('20261101090000_checkpoint_768k.sql'));
 const save=async bytes=>(await db.query(
  "SELECT relay_private.save_checkpoint($1,1,encode(decode(repeat('ab',$2),'hex'),'base64'),2,$3,0) AS result",
  [hash,bytes,0]
 )).rows[0].result;
 assert.equal((await save(786433)).ok,false,'786433 decoded bytes rejected');
 assert.equal((await save(786432)).ok,true,'786432 decoded bytes accepted');
 const meta=(await db.query('SELECT octet_length(checkpoint_cipher) AS n,revision FROM relay_private.rooms WHERE room_hash=$1',[hash])).rows[0];
 assert.equal(meta.n,786432);
 assert.equal(Number(meta.revision),1);
 const operations=4;
 await db.query(
  `INSERT INTO relay_private.operations(room_hash,op_id,lam,cipher)
   SELECT $1,'synthetic-768k-'||i,100+i,decode(repeat('25',262144),'hex')
   FROM generate_series(1,$2::integer) AS i`,
  [hash,operations]
 );
 // The operations table still enforces its independent 262144-byte CHECK.
 await assert.rejects(db.query(
  "INSERT INTO relay_private.operations(room_hash,op_id,lam,cipher) VALUES($1,'oversized-op',200,decode(repeat('25',262145),'hex'))",[hash]
 ),/check constraint/i);
 let seq=0,rev=0,seen=0,checkpointSeen=false,rounds=0;
 do{
  const p=(await db.query('SELECT relay_private.pull_page($1,$2,$3,64) AS page',[hash,rev,seq])).rows[0].page;
  assert.ok(Buffer.byteLength(JSON.stringify(p))<=1500000,'REST page must stay below 1.5MB');
  assert.equal(Number(p.rev),1);
  if(rev===0){
   assert.equal(Buffer.from(p.frames[0],'base64').byteLength,786432,'checkpoint first');
   checkpointSeen=true;
   assert.equal(p.n,1,'remaining budget admits one 256KiB op');
   assert.equal(p.more,true,'remaining operations must be paged');
  }
  for(const encoded of p.frames.slice(rev===0?1:0)){
   assert.equal(Buffer.from(encoded,'base64').byteLength,262144);
   seen++;
  }
  assert.ok(Number(p.seq)>seq,'cursor must advance');
  seq=Number(p.seq);rev=1;rounds++;
  if(!p.more)break;
  assert.ok(rounds<=operations+1,'bounded recovery must terminate');
 }while(true);
 assert.equal(checkpointSeen,true);
 assert.equal(seen,operations,'no operations lost, repeated or truncated');
 assert.equal(rounds,2,'the remaining three ops drain on the second page');
 const terminal=(await db.query('SELECT relay_private.pull_page($1,1,$2,64) AS page',[hash,seq])).rows[0].page;
 assert.equal(terminal.n,0);
 assert.equal(terminal.more,false);
 assert.deepEqual(terminal.frames,[]);
});
