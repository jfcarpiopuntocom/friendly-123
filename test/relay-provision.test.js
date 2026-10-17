const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, createHmac } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = () => import(pathToFileURL(path.join(__dirname, '../cloudflare-worker/worker.js')).href);
const secret = 'b'.repeat(64), master = 'synthetic-master';
function env() {
 const values = new Map();
 return { MASTER_KEY: master, SUPABASE_ORIGIN: 'https://' + 'a'.repeat(20) + '.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'synthetic-public', RELAY_PROVISION_SECRET: secret,
  LICENCIAS: { get: async k => values.get(k) || null, put: async (k,v) => values.set(k,v), list: async () => ({keys:[]}) } };
}
function call(worker,e,url,body,authorized=true) {
 return worker.default.fetch(new Request('https://fixture.invalid'+url,{method:'POST',
  headers:{'content-type':'application/json',...(authorized?{'X-Master-Key':master}:{})},body:JSON.stringify(body)}),e);
}
test('master provisioning sends a scoped signed group with exact Yjs identity; public requests cannot provision', async t => {
 const worker=await load(),e=env(), requests=[];
 const previous=global.fetch;t.after(()=>global.fetch=previous);
 global.fetch=async(url,init)=>{
  const body=JSON.parse(init.body);requests.push(body);
  assert.equal(url,e.SUPABASE_ORIGIN+'/rest/v1/rpc/f123_relay_provision');
  assert.equal(init.headers.apikey,e.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(body.p_signature,createHmac('sha256',secret).update('friendly-provision:v1\n'+body.p_issued_at+'\n'+body.p_rooms.join('\n')).digest('hex'));
  assert.equal(init.body.includes('F123-'),false);
  return Response.json({ok:true,created:1,ready:0,migrationRequired:0});
 };
 const code='F123-TEST-AAAA-BBBB-CCCCC';
 assert.equal((await call(worker,e,'/relay/provision',{licenseCode:code},false)).status,401);
 assert.equal(requests.length,0);
 const result=await call(worker,e,'/relay/provision',{licenseCode:' '+code.toLowerCase()+' '});
 assert.equal(result.status,200);
 assert.deepEqual(requests[0].p_rooms,[createHash('sha256').update('amigable-sala:'+code).digest('hex').slice(0,40)]);
 const body=await result.json();assert.equal(body.created,1);assert.equal(JSON.stringify(body).includes(requests[0].p_rooms[0]),false);
 assert.equal((await call(worker,e,'/relay/provision',{licenseCode:'invalid'})).status,400);
});
test('pending migration and unavailable provisioning preserve licences and expose retry status',async t=>{
 const worker=await load(),e=env(),previous=global.fetch;t.after(()=>global.fetch=previous);
 global.fetch=async()=>Response.json({ok:false,created:0,ready:0,migrationRequired:1});
 assert.equal((await call(worker,e,'/relay/provision',{licenseCode:'F123-TEST-AAAA-BBBB-CCCCC'})).status,409);
 let requests=0;
 global.fetch=async(_,init)=>{requests++;assert.equal(JSON.parse(init.body).p_rooms.length,60);return new Response('',{status:503});};
 const response=await call(worker,e,'/licencias/lote',{etiqueta:'Synthetic batch',cantidad:60});
 assert.equal(response.status,200);const body=await response.json();
 assert.equal(body.codigos.length,60);assert.equal(requests,1);assert.equal(body.relay.reason,'provisioning-unavailable');
 for(const code of body.codigos) assert.ok(await e.LICENCIAS.get('lic:'+code));
});
test('public checkin never calls provisioning even when provision credentials exist',async t=>{
 const worker=await load(),e=env(),previous=global.fetch;t.after(()=>global.fetch=previous);
 global.fetch=async()=>{throw Error('Public checkin attempted provisioning');};
 const response=await call(worker,e,'/checkin',{instanceId:'synthetic-device-123',accion:'login',licenseCode:'F123-TEST-AAAA-BBBB-CCCCC'},false);
 assert.equal(response.status,200);
});

test('private SQL authenticates provisioning and never activates existing inactive history',async t=>{
 const {PGlite}=require('@electric-sql/pglite');
 const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const fs=require('node:fs');
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());
 const sql=name=>fs.readFileSync(path.join(__dirname,'../supabase-relay',name),'utf8');
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;');
 await db.exec(sql('migrations/20261016024151_private_ciphertext_relay_core.sql'));
 await db.exec(sql('migrations/20261016035912_inactive_route_gate.sql'));
 await db.exec(sql('provision.sql'));
 const sign=(rooms,time)=>createHmac('sha256',secret).update('friendly-provision:v1\n'+time+'\n'+rooms.join('\n')).digest('hex');
 const provision=async(rooms,time=Date.now(),signature)=>{
  return (await db.query('SELECT public.f123_relay_provision($1::text[],$2::bigint,$3::text) AS result',[rooms,time,signature||sign(rooms,time)])).rows[0].result;
 };
 const a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40);
 await assert.rejects(()=>provision([a]),/Provisioning not authorized/);
 await db.query('INSERT INTO relay_private.provisioning_secret(secret) VALUES($1)',[secret]);
 await assert.rejects(()=>provision([a],Date.now()-120000),/Provisioning not authorized/);
 await assert.rejects(()=>provision([a],Date.now(),'0'.repeat(64)),/Provisioning not authorized/);
 assert.deepEqual(await provision([a]),{ok:true,ready:0,created:1,migrationRequired:0});
 assert.deepEqual(await provision([a]),{ok:true,ready:1,created:0,migrationRequired:0});
 const hash=createHash('sha256').update('friendly-relay:'+b+'-fotos').digest('hex');
 await db.query('SELECT relay_private.open_room($1)',[hash]);
 await db.query("SELECT relay_private.persist_operation($1,'synthetic-history',2,'AQID')",[hash]);
 const before=(await db.query('SELECT * FROM relay_private.rooms WHERE room_hash=$1',[hash])).rows;
 assert.deepEqual(await provision([b,c]),{ok:false,ready:0,created:1,migrationRequired:1});
 assert.deepEqual((await db.query('SELECT * FROM relay_private.rooms WHERE room_hash=$1',[hash])).rows,before);
 assert.equal((await db.query('SELECT count(*) AS n FROM relay_private.operations WHERE room_hash=$1',[hash])).rows[0].n,1);
 const rights=(await db.query("SELECT has_table_privilege('anon','relay_private.provisioning_secret','SELECT') AS secret_read,has_table_privilege('anon','relay_private.rooms','INSERT') AS room_insert")).rows[0];
 assert.deepEqual(rights,{secret_read:false,room_insert:false});
 await db.exec('SET ROLE anon');
 assert.equal((await provision([a])).ready,1);
 await assert.rejects(()=>provision([a],Date.now(),'0'.repeat(64)),/Provisioning not authorized/);
 await db.exec('RESET ROLE');
});
