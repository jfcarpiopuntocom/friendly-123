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
