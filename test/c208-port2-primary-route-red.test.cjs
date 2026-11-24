'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const pilot=fs.readFileSync(path.join(__dirname,'../src/yparty-piloto.js'),'utf8');
const rollout=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/sync-rollout.json'),'utf8'));

test('JFC architecture 2.0 rollout has explicit YParty eligibility',()=>{
 const jfc=Object.values(rollout.licenses).find(x=>x.yparty===true);
 assert.ok(jfc,'JFC YParty rollout missing');
 assert.match(jfc.frozenHead,/^[A-Za-z0-9_.:-]{3,128}$/);
});

test('C208 RED: private YParty path must not unconditionally fall back before certified provider setup',()=>{
 const connect=pilot.slice(pilot.indexOf('        conectar() {'));
 assert.ok(connect.length>1000,'cannot find connect()');
 const certified=connect.indexOf('const proveedor = new AuthorizedYProvider(');
 assert.ok(certified>0,'certified provider not found');
 const before=connect.slice(0,certified);
 // The current master returns before the provider can ever be constructed.
 assert.doesNotMatch(before,/enRespaldo\s*=\s*true;\s*usarRelayHabitual\(\);\s*return;\s*const getCredentials/,
   'unreachable certified transport: unconditional legacy return');
});

test('private Yjs must retain authorization and never send raw document without ticket',()=>{
 assert.match(pilot,/createOwnerTicketParams/);
 assert.match(pilot,/authorization-error/);
 assert.match(pilot,/owner-session-unavailable/);
});
