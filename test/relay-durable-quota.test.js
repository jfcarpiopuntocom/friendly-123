const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const src=fs.readFileSync(path.join(__dirname,'../cloudflare-sync-relay/worker.js'),'utf8');
async function fixture(){
 const mod=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
 const db=new DatabaseSync(':memory:');let rejectWrites=false;
 const sql={exec(q,...a){if(rejectWrites&&/^(INSERT|DELETE)/.test(q))throw Error('quota');const s=db.prepare(q);return {toArray:()=>s.all(...a),...(/^SELECT|^EXPLAIN/.test(q)?{}:(s.run(...a),{}))}}};
 const state={storage:{sql,transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}},getWebSockets:()=>[]};
 const sala=new mod.SalaSync(state,{}),sent=[];
 const sock={readyState:1,send:x=>sent.push(JSON.parse(x))};
 return {sala,db,sock,sent,reject:()=>{rejectWrites=true}};
}
test('relay confirms only durable operations and explicitly rejects quota failure',async()=>{
 const f=await fixture();
 await f.sala.webSocketMessage(f.sock,JSON.stringify({k:'op',id:'synthetic-sale',lam:1,c:'YQ==',ack:1}));
 assert.equal(f.sent.at(-1)?.ok,true);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ops').get().n,1);
 f.reject();
 await f.sala.webSocketMessage(f.sock,JSON.stringify({k:'op',id:'synthetic-next',lam:2,c:'Yg==',ack:1}));
 assert.equal(f.sent.at(-1)?.ok,false);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ops').get().n,1);
 // An already durable retry must not need another INSERT after quota exhaustion.
 await f.sala.webSocketMessage(f.sock,JSON.stringify({k:'op',id:'synthetic-sale',lam:1,c:'YQ==',ack:1}));
 assert.equal(f.sent.at(-1)?.ok,true);
 f.db.close();
});
test('checkpoint and pruning roll back together if deletion is rejected',async()=>{
 const f=await fixture();
 f.sala._guardarOp('old',1,'YQ==');
 const original=f.sala.sql.exec;
 f.sala.sql.exec=(q,...a)=>{if(q.startsWith('DELETE'))throw Error('quota during pruning');return original(q,...a)};
 await f.sala.webSocketMessage(f.sock,JSON.stringify({k:'ckpt',id:'snapshot',v:2,rev:0,seq:1,lam:2,c:'Yg==',ack:1}));
 assert.equal(f.sent.at(-1)?.ok,false);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ckpt').get().n,0,'failed pruning must not replace the recovery generation');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ops').get().n,1);
 f.db.close();
});

test('full photo history is preserved; only new durable writes are refused until safe compaction',async()=>{
 const f=await fixture();
 const insert=f.db.prepare('INSERT INTO ops(id,lam,c) VALUES(?,?,?)');
 for(let i=0;i<8000;i++)insert.run('photo-'+i,8000-i,'YQ==');
 // Select a historically sampled id: this used to erase the oldest encrypted photo.
 let id;
 for(let i=0;!id;i++){const candidate='synthetic-overflow-'+i;let h=2166136261;for(const ch of candidate)h=Math.imul(h^ch.charCodeAt(0),16777619);if((h>>>0)%256===0)id=candidate;}
 const before=f.db.prepare('SELECT rowid,* FROM ops ORDER BY rowid').all();
 await f.sala.webSocketMessage(f.sock,JSON.stringify({k:'op',id,lam:9000,c:'Yg==',ack:1}));
 assert.equal(f.sent.at(-1)?.ok,false,'no acknowledgement for bytes that cannot safely fit');
 assert.deepEqual(f.db.prepare('SELECT rowid,* FROM ops ORDER BY rowid').all(),before,
  'no ciphertext may be pruned solely because its timestamp is old');
 await f.sala.webSocketMessage(f.sock,JSON.stringify({k:'op',id:'photo-0',lam:9001,c:'Yw==',ack:1}));
 assert.equal(f.sent.at(-1)?.ok,true,'existing stable-id retries remain durable at capacity');
 assert.equal(f.sala._guardarCkpt(9002,'Yw==',2,0,4000),true);
 assert.equal(f.sala._guardarOp(id,9003,'Yg=='),true,'a covered prefix checkpoint frees capacity');
 assert.equal(f.db.prepare('SELECT count(*) n FROM ops').get().n,4001);
 f.db.close();
});
test('capacity uses indexed range probes, remains bounded after hibernation and never counts all ops',async()=>{
 const f=await fixture();
 f.db.prepare('INSERT INTO ops(rowid,id,lam,c) VALUES(?,?,?,?)').run(100,'first',1,'YQ==');
 f.db.prepare('INSERT INTO ops(rowid,id,lam,c) VALUES(?,?,?,?)').run(8099,'last',2,'Yg==');
 const queries=[],original=f.sala.sql.exec;
 f.sala.sql.exec=(q,...a)=>{queries.push(q);return original(q,...a)};
 assert.equal(f.sala._guardarOp('after-hibernation',3,'Yw=='),false,
  'capacity does not depend on an in-memory counter and conservatively tolerates old row gaps');
 const query=queries.find(q=>/MAX\(rowid\)/.test(q));assert.ok(query);
 const plans=f.db.prepare('EXPLAIN QUERY PLAN '+query).all().map(r=>r.detail);
 assert.ok(plans.filter(x=>x==='SEARCH ops').length>=2,plans.join('\n'));
 assert.ok(!plans.some(x=>x==='SCAN ops'),plans.join('\n'));
 assert.ok(!queries.some(q=>/COUNT\s*\(/i.test(q)));
 f.db.close();
});
