import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessQaReadiness,classifyIssuer,ENDPOINTS} from '../scripts/qa-port2-readiness.mjs';

const json=(status,data)=>({status,json:async()=>data});
function stub({ticket=404,worker=503,version='v0.7.86',rollout={schema:1,licenses:{}},badJson=false}={}){
  const methods=[];
  const fetcher=async(url,options)=>{
    methods.push(options.method);
    assert.equal(options.method,'GET','never send a business write or ticket');
    assert.equal(options.credentials,'omit');
    if(url===ENDPOINTS.issuer)return json(ticket,{});
    if(url===ENDPOINTS.worker)return json(worker,{});
    if(url===ENDPOINTS.version)return json(200,{version,shell:'f123-shell-v786'});
    if(url===ENDPOINTS.rollout)return json(200,badJson?null:rollout);
    throw Error('not allowed');
  };
  return {fetcher,methods};
}
test('legacy ticket 404 and Worker fail-closed 503 means BLOCKED, never GO',async()=>{
  const p=stub(),r=await assessQaReadiness({fetcher:p.fetcher});
  assert.deepEqual(p.methods,['GET','GET','GET','GET']);
  assert.equal(r.issuer.state,'ROUTE_ABSENT');
  assert.equal(r.worker.state,'FAIL_CLOSED');
  assert.equal(r.signedQaTestPossible,false);
  assert.equal(r.certified,false);
  assert.equal(r.status,'BLOCKED_BEFORE_QA');
});
test('deployed issuer missing security config 503 is not missing route 404',async()=>{
  const r=await assessQaReadiness({fetcher:stub({ticket:503}).fetcher});
  assert.equal(r.issuer.state,'DEPLOYED_AUTHORITY_OFF');
  assert.equal(r.status,'BLOCKED_BEFORE_QA');
});
test('configured issuer GET 405 permits signed QA tests, not commercial GO',async()=>{
  const r=await assessQaReadiness({fetcher:stub({ticket:405,worker:404}).fetcher});
  assert.equal(r.issuer.state,'ROUTE_CONFIGURED');
  assert.equal(r.signedQaTestPossible,true);
  assert.equal(r.certified,false);
  assert.equal(r.status,'READY_FOR_SIGNED_QA_TEST');
});
test('unexpected YParty ON for any rollout entry halts progression',async()=>{
  const r=await assessQaReadiness({fetcher:stub({ticket:405,worker:404,
    rollout:{schema:1,licenses:{opaqueHash:{yparty:true}}}}).fetcher});
  assert.equal(r.published.enabledStores,1);
  assert.equal(r.rolloutSafe,false);
  assert.equal(r.status,'INVESTIGATE_SAFETY');
  assert.equal(r.signedQaTestPossible,false);
});
test('invalid or missing rollout payload is never assumed to be OFF',async()=>{
  const r=await assessQaReadiness({fetcher:stub({ticket:405,worker:404,badJson:true}).fetcher});
  assert.equal(r.status,'INVESTIGATE_SAFETY');
  assert.equal(r.certified,false);
});
test('network failures never count as issuer or business proof',async()=>{
  const r=await assessQaReadiness({fetcher:async()=>{throw Error('offline')}});
  assert.equal(r.issuer.state,'NETWORK_UNAVAILABLE');
  assert.equal(r.signedQaTestPossible,false);
  assert.equal(r.certified,false);
});
test('HTTP issuer classification fails closed for all other statuses',()=>{
  assert.equal(classifyIssuer(404),'ROUTE_ABSENT');
  assert.equal(classifyIssuer(503),'DEPLOYED_AUTHORITY_OFF');
  assert.equal(classifyIssuer(405),'ROUTE_CONFIGURED');
  for(const code of [200,204,301,400,401,403,500])assert.equal(classifyIssuer(code),'UNVERIFIED_STATUS');
});
