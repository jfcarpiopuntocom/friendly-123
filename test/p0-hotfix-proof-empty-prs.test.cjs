'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {verifyPR}=require('../scripts/p0-hotfix-proof.cjs');
const HEAD='6598fcd6f8fb7767bffa3ed43db83a844bf6a580';
const MERGE='af918a8b832210d14e1718f44ca4018f82653e9d';
const successful={id:42312909059,head_sha:HEAD,path:'.github/workflows/p0-hotfix-gate.yml',event:'pull_request',status:'completed',conclusion:'success',pull_requests:[]};
const associated={number:602,state:'closed',merged_at:'2026-11-06T23:37:15Z',merge_commit_sha:MERGE,base:{ref:'master'},head:{sha:HEAD}};
const response=x=>({ok:true,json:async()=>x});
function mock({runs=[successful],prs=[associated],httpStatus=200}={}){
  const requested=[];
  const fetcher=async(url)=>{
    requested.push(url);
    if(url.includes('/actions/workflows/'))return response({workflow_runs:runs});
    if(url.includes('/commits/'+HEAD+'/pulls'))return httpStatus===200?response(prs):{ok:false,status:httpStatus};
    throw Error('unexpected endpoint '+url);
  };
  return {fetcher,requested};
}
test('RED: missing GitHub workflow pull_requests metadata must NOT make a real exact-merge green look unverified',async()=>{
  const m=mock();
  const proof=await verifyPR(MERGE,'jfcarpiopuntocom/friendly-123','SYNTHETIC-TOKEN-NOT-USED',m.fetcher);
  assert.equal(proof.prHead,HEAD);
  assert.equal(proof.runId,42312909059);
  assert.equal(m.requested.length,2);
  assert.ok(m.requested[1].endsWith('/commits/'+HEAD+'/pulls?per_page=100'));
});
test('fail closed on unmerged, wrong-base, wrong-head or wrong merge SHA associations',async()=>{
 for(const bad of [
  {...associated,merged_at:null}, {...associated,base:{ref:'development'}},
  {...associated,head:{sha:'a'.repeat(40)}},
  {...associated,merge_commit_sha:'b'.repeat(40)},
  {...associated,state:'open'}
 ]) {
  await assert.rejects(verifyPR(MERGE,'jfcarpiopuntocom/friendly-123','TEST',mock({prs:[bad]}).fetcher),/No merged PR/);
 }
});
test('fail closed on missing or failing exact gate even if merged PR association is valid',async()=>{
 for(const runs of [[],[{...successful,head_sha:'c'.repeat(40)}],[{...successful,conclusion:'failure'}],[{...successful,event:'push'}]]){
  await assert.rejects(verifyPR(MERGE,'jfcarpiopuntocom/friendly-123','TEST',mock({runs}).fetcher),/No successful verified P0 gate/);
 }
});
test('fail closed on permissions error in PR association API',async()=>{
 await assert.rejects(verifyPR(MERGE,'jfcarpiopuntocom/friendly-123','TEST',mock({httpStatus:403}).fetcher),/Cannot verify PR association: HTTP 403/);
});
