import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planForwardCurrentUnion} from '../src/current-state-union.mjs';

const BUSINESS='a'.repeat(64), A='1'.repeat(64),B='2'.repeat(64),C='3'.repeat(64);
const H1='4'.repeat(64),H2='5'.repeat(64), KEY='6'.repeat(64);
function obs(sourceId,facts=[],views=[],extra={}){
 return {application:'friendly-123',businessScope:BUSINESS,sourceId,facts,views,...extra};
}
function fact(opId,amountCents){return {opId,payload:{kind:'sale.record',amountCents,quantity:1}};}
function view(valueHash=H1){return {domain:'stock',keyHash:KEY,valueHash};}

test('C93 RED: unite PRESENT iPhone, desktop and dashboard facts, preserving provenance and browser-only cash',()=>{
 const input=[
  obs(A,[fact('sale_c93_001',1250),fact('payment_c93_001',500)],[view()]),
  obs(B,[fact('sale_c93_001',1250),fact('adjust_c93_001',325)],[view()]),
  obs(C,[],[view()])
 ];
 const original=structuredClone(input);
 const result=planForwardCurrentUnion({observations:input});
 assert.equal(result.sealed,false,'this is only a candidate, never a server ACK');
 assert.equal(result.readyForAuthenticatedSeal,true);
 assert.equal(result.facts.length,3);
 assert.equal(result.quarantined.length,0);
 assert.equal(result.viewDifferences.length,0);
 assert.deepEqual(result.facts.find(x=>x.opId==='sale_c93_001').observedBy,[A,B]);
 assert.deepEqual(result.facts.find(x=>x.opId==='adjust_c93_001').observedBy,[B]);
 assert.equal(result.facts.find(x=>x.opId==='payment_c93_001').payload.amountCents,500);
 assert.deepEqual(input,original,'no mutation of live-source input');
 assert.deepEqual(result,planForwardCurrentUnion({observations:[input[2],input[1],input[0]]}),
  'changing the order of current devices must not change the union');
 assert.match(result.digest,/^[0-9a-f]{64}$/);
 assert(Object.isFrozen(result.facts)&&Object.isFrozen(result.facts[0]));
 assert.equal(result.digest,createHash('sha256').update(result.manifestCanonical).digest('hex'));
});
test('C93 RED: same economic opId different amount quarantines BOTH intact facts, never picks latest writer',()=>{
 const a=obs(A,[fact('sale_c93_003',1999)]);
 const b=obs(B,[fact('sale_c93_003',2000)]);
 const result=planForwardCurrentUnion({observations:[a,b]});
 assert.equal(result.readyForAuthenticatedSeal,false);
 assert.equal(result.facts.length,0);
 assert.equal(result.quarantined.length,1);
 assert.equal(result.quarantined[0].opId,'sale_c93_003');
 assert.equal(result.quarantined[0].variants.length,2);
 assert.deepEqual(result.quarantined[0].variants.map(x=>x.payload.amountCents),[1999,2000]);
 assert.deepEqual(result.quarantined[0].variants.map(x=>x.observedBy),[[A],[B]]);
});
test('C93 RED: current stock view discrepancy is NOT a stock=N command, do not choose by timestamp',()=>{
 const output=planForwardCurrentUnion({observations:[
  obs(A,[fact('sale_c93_004',500)],[view(H1)],{observedAt:1700000000000}),
  obs(B,[],[view(H2)],{observedAt:1900000000000})
 ]});
 assert.equal(output.readyForAuthenticatedSeal,false);
 assert.equal(output.viewDifferences.length,1);
 assert.equal(output.viewDifferences[0].domain,'stock');
 assert.equal(output.viewDifferences[0].variants.length,2);
 assert.equal(output.facts.length,1,'commercial fact remains intact while views disagree');
 assert(!Object.hasOwn(output,'stock'));
});
test('C93 RED: other apps sharing the same license/room can NEVER contaminate friendly-123',()=>{
 assert.throws(()=>planForwardCurrentUnion({observations:[
  obs(A,[fact('sale_c93_005',550)]),
  obs(B,[],[],{application:'amigable-123'})
 ]}),/application|friendly-123/);
 assert.throws(()=>planForwardCurrentUnion({observations:[
  obs(A,[fact('sale_c93_005',550)]),
  obs(B,[],[],{application:'consultorio-123'})
 ]}),/application|friendly-123/);
 assert.throws(()=>planForwardCurrentUnion({observations:[
  obs(A,[fact('sale_c93_005',550)]),
  obs(B,[],[],{businessScope:'b'.repeat(64)})
 ]}),/scope|business/i);
 assert.throws(()=>planForwardCurrentUnion({observations:[obs(A),obs(A)]}),/duplicate|source/i);
});
test('C93 RED: reject unsafe payloads and credential keys rather than logging sensitive source details',()=>{
 const bad=[NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1];
 for(const amountCents of bad){
  assert.throws(()=>planForwardCurrentUnion({observations:[
   obs(A,[fact('sale_c93_006',amountCents)]),obs(B)
  ]}),/unsafe|number|payload|finite/i);
 }
 assert.throws(()=>planForwardCurrentUnion({observations:[
  obs(A,[{opId:'sale_c93_007',payload:{kind:'sale.record',pin:'123',amountCents:100}}]),obs(B)
 ]}),/secret|credential|forbidden/i);
 assert.throws(()=>planForwardCurrentUnion({observations:[
  obs(A,[{opId:'sale_c93_008',payload:{kind:'sale.record',metadata:{authorization:'Bearer secret'}}}]),obs(B)
 ]}),/secret|credential|forbidden/i);
 assert.throws(()=>planForwardCurrentUnion({observations:[
  obs(A,[{opId:'sale_c93_009',payload:{kind:'sale.record',amountCents:0.5}}]),obs(B)
 ]}),/integer|unsafe|number/i);
});
test('C93 RED: input is frozen by value, receipts do not grant a live cutover or create a store',()=>{
 const original=obs(A,[fact('sale_c93_010',875)]);
 const result=planForwardCurrentUnion({observations:[original,obs(B)]});
 original.facts[0].payload.amountCents=2;
 assert.equal(result.facts[0].payload.amountCents,875);
 assert.equal(result.sealed,false);
 assert.equal(result.readyForAuthenticatedSeal,true);
 assert.equal(result.sourceCount,2);
 assert(!('commit' in result));
 assert(!('ack' in result));
});
test('C93 RED: fail closed for single source or no commercial facts, never claim a verified current union',()=>{
 const one=planForwardCurrentUnion({observations:[obs(A,[fact('sale_c93_011',100)])]});
 assert.equal(one.readyForAuthenticatedSeal,false);
 assert.equal(one.sealed,false);
 const empty=planForwardCurrentUnion({observations:[obs(A),obs(B)]});
 assert.equal(empty.readyForAuthenticatedSeal,false);
});

test('C93 security: untrusted observed fact with accessor must be refused WITHOUT invoking getter',()=>{
 let calls=0;
 const payload=Object.create(null);
 Object.defineProperty(payload,'kind',{enumerable:true,value:'sale.record'});
 Object.defineProperty(payload,'amountCents',{enumerable:true,get(){calls++;throw Error('evil getter ran');}});
 assert.throws(()=>planForwardCurrentUnion({observations:[
  obs(A,[{opId:'sale_c93_099',payload}]),obs(B)
 ]}),/accessor/i,'must not access evil getter');
 assert.equal(calls,0,'no accessor evaluation while observing current user state');
});
