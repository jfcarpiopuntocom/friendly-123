#!/usr/bin/env node
'use strict';
// Reuse a PR's exact successful P0 test result ONLY when master has exactly
// the same file tree as the reviewed PR head. Otherwise fail closed to the
// existing focused post-merge tests. Never trust a different or stale SHA.
const {execFileSync}=require('node:child_process');
const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();
const protectedInputs=[
  '.github/workflows/p0-hotfix-gate.yml',
  '.github/workflows/hotfix.yml',
  'scripts/p0-hotfix-proof.cjs',
  'scripts/p0-hotfix-tests.cjs',
  'scripts/pruebas-del-area.cjs',
  'scripts/release-control.cjs',
  'test/helpers/sin-red-produccion.cjs'
];
function identical(a,b,paths=[]){
  try {execFileSync('git',['diff','--quiet',a,b,'--',...(paths.length?paths:['.'])]);return true;}
  catch(_){return false;}
}
function inspectGit(sha){
  if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('exact merge SHA required');
  const parents=git('show','-s','--format=%P',sha).split(/\s+/).filter(Boolean);
  if(parents.length!==2)throw Error('only a standard two-parent PR merge can reuse PR checks');
  const [base,prHead]=parents;
  if(!identical(sha,prHead))throw Error('merge tree differs from the tested PR head');
  if(!identical(base,prHead,protectedInputs))throw Error('gate or proof logic changed in the PR; retest after merge');
  return {base,prHead};
}
async function verifyPR(sha,repo,token,fetcher=fetch){
  const {prHead}=inspectGit(sha);
  if(!/^[-\w.]+\/[-\w.]+$/.test(repo||'')||!token)throw Error('repo/token required to prove PR checks');
  const api='https://api.github.com/repos/'+repo+'/actions/workflows/p0-hotfix-gate.yml/runs?head_sha='+prHead+'&event=pull_request&per_page=100';
  const response=await fetcher(api,{headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Cannot verify P0 workflow: HTTP '+response.status);
  const d=await response.json();
  const matches=(d.workflow_runs||[]).filter(r=>
    r.head_sha===prHead &&
    r.path==='.github/workflows/p0-hotfix-gate.yml' &&
    r.event==='pull_request' &&
    r.status==='completed' &&
    r.conclusion==='success' &&
    Array.isArray(r.pull_requests) && r.pull_requests.some(pr=>pr.base&&pr.base.ref==='master'&&pr.head&&pr.head.sha===prHead)
  );
  if(!matches.length)throw Error('No successful verified P0 gate for the exact merged PR SHA');
  return {prHead,runId:matches.sort((a,b)=>b.id-a.id)[0].id};
}
if(require.main===module)(async()=>{
  try{
    const sha=process.argv[2];
    const ok=await verifyPR(sha,process.env.GITHUB_REPOSITORY,process.env.GITHUB_TOKEN||process.env.GH_TOKEN);
    console.log('EXACT P0 PR GREEN '+ok.prHead+' run '+ok.runId+'; merge tree identical; skip duplicate tests');
  }catch(e){console.error('SAFE FALLBACK: '+e.message);process.exitCode=1;}
})();
module.exports={identical,inspectGit,verifyPR,protectedInputs};
