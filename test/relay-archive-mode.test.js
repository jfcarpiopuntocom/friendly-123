const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const load=()=>import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../cloudflare-sync-relay/worker.js'))).toString('base64'));

test('archive-only relay rejects public room traffic without entering a Durable Object',async()=>{
 const worker=await load();let entered=0;
 const forbid=()=>{entered++;throw Error('Archive mode must not enter a room');};
 const env={RELAY_ARCHIVE_ONLY:'1',SALAS:{idFromName:forbid,get:forbid}};
 for(const headers of [{},{Upgrade:'websocket'}]){
  const r=await worker.default.fetch(new Request('https://fixture.invalid/sala/synthetic-archived-room',{headers}),env);
  assert.equal(r.status,409);assert.match(await r.text(),/pending writes retained/);
 }
 assert.equal(entered,0);
 const health=await worker.default.fetch(new Request('https://fixture.invalid/health'),env);
 assert.equal(health.status,200);assert.equal(health.headers.get('x-friendly-relay-mode'),'archive-only');
});

test('archive-only relay closes hibernated sockets before persistence or broadcast',async()=>{
 const worker=await load(),db=new DatabaseSync(':memory:');
 const sql={exec(q,...a){const s=db.prepare(q);if(/^SELECT/.test(q))return{toArray:()=>s.all(...a)};s.run(...a);return{toArray:()=>[]};}};
 let sent=0,closed=0;const socket={send(){sent++;},close(){closed++;}};
 const state={storage:{sql},getWebSockets:()=>[socket]};
 const room=new worker.SalaSync(state,{RELAY_ARCHIVE_ONLY:'1'});
 await room.webSocketMessage(socket,JSON.stringify({k:'op',ack:1,id:'synthetic-pending',lam:1,c:'AQID'}));
 await room.webSocketMessage(socket,new Uint8Array([1,2,3]).buffer);
 assert.equal(db.prepare('SELECT count(*) n FROM ops').get().n,0);
 assert.equal(sent,0);assert.equal(closed,2);db.close();
});

test('archive-only relay retains signed encrypted export and rejects unsigned export',async()=>{
 const worker=await load(),keys=crypto.generateKeyPairSync('ed25519');let exported=0;
 const pub=keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64url');
 const env={RELAY_ARCHIVE_ONLY:'1',RELAY_MIGRATION_PUBLIC_KEY:pub,SALAS:{idFromString(){return'fixture';},get(){return{fetch:async()=>{exported++;return new Response('encrypted synthetic archive');}};}}};
 const body=JSON.stringify({v:1,action:'export',objectId:'a'.repeat(64),issuedAt:Date.now()});
 const url='https://fixture.invalid/migration/export';
 assert.equal((await worker.default.fetch(new Request(url,{method:'POST',body}),env)).status,403);
 assert.equal(exported,0);
 const signature=crypto.sign(null,Buffer.from(body),keys.privateKey).toString('base64url');
 const r=await worker.default.fetch(new Request(url,{method:'POST',body,headers:{'X-Relay-Migration-Signature':signature}}),env);
 assert.equal(r.status,200);assert.equal(exported,1);
});
