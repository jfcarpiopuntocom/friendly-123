/* JFC 2026-10-05: a green result is evidence only for the exact candidate.
 * This gate reads GitHub; it never changes refs or customer data. */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

function evaluateRuns(runs, sha) {
  const relevant = runs.filter(r => r.head_sha === sha && r.head_branch === 'master' &&
    ['push','workflow_dispatch'].includes(r.event) && r.path === '.github/workflows/release-control.yml');
  relevant.sort((a,b) => Number(b.id)-Number(a.id) || Number(b.run_attempt)-Number(a.run_attempt));
  const latest = relevant[0];
  return {ok: !!latest && latest.status === 'completed' && latest.conclusion === 'success',
    reason: latest ? `${latest.status}/${latest.conclusion || 'pending'}` : 'missing exact-commit QA', runId:latest?.id};
}
function validateCapabilities(current, previous, exists) {
  const errors=[], ids=new Set();
  for(const c of current) {
    if(!c.id || ids.has(c.id)) errors.push(`duplicate/missing capability: ${c.id}`);
    ids.add(c.id);
    if(!Array.isArray(c.tests) || !c.tests.length) errors.push(`no executable checks: ${c.id}`);
    for(const file of c.tests || []) if(!/^test\/[\w/.-]+\.test\.js$/.test(file) || file.includes('..') || !exists(file)) errors.push(`missing/invalid test: ${file}`);
  }
  for(const c of previous) {
    const now=current.find(n=>n.id===c.id);
    if(!now) errors.push(`approved capability removed: ${c.id}`);
    else {
      if(now.contract !== c.contract) {
        const a=now.changeApproval;
        if(!a || a.approvedBy !== 'JFC' || !/^\d{4}-\d{2}-\d{2}$/.test(a.date || '') ||
          !Number.isFinite(Date.parse(a.date)) || !a.reason?.trim() || a.previousContract !== c.contract)
          errors.push(`contract change requires JFC, date, reason and previousContract: ${c.id}`);
      }
      for(const file of c.tests || []) if(!now.tests?.includes(file)) errors.push(`protected check removed: ${c.id}/${file}`);
    }
  }
  return errors;
}
function validateIdentity(version, sw, previous, runtimeChanged) {
  const errors=[];
  const shell=version.shell?.match(/^f123-shell-v([1-9][0-9]*)$/);
  const actual=sw.match(/\bconst CACHE = "(f123-shell-v[0-9]+)"/);
  if(!shell || actual?.[1]!==version.shell) errors.push('shell identity mismatch');
  if(!/^golden[1-9][0-9]*$/.test(version.cacheGeneration || '') || !sw.includes(`const CACHE_GENERACION = "-${version.cacheGeneration}"`)) errors.push('cache generation mismatch');
  const old=previous?.shell?.match(/^f123-shell-v([1-9][0-9]*)$/);
  if(old && shell && (+shell[1]<+old[1] || runtimeChanged && +shell[1]<=+old[1])) errors.push('changed runtime requires a new increasing shell; do not reuse canary identity');
  return errors;
}
const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8',maxBuffer:8*1024*1024}).trim();
async function api(url) {
  const r=await fetch(url,{headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''}`},signal:AbortSignal.timeout(20000)});
  if(!r.ok) throw new Error(`GitHub evidence unavailable: HTTP ${r.status}`);
  return r.json();
}
async function gate(sha, waitSeconds=0) {
  if(!/^[a-f0-9]{40}$/.test(sha||'')) throw new Error('Exact 40-character candidate SHA required');
  const repo=process.env.GITHUB_REPOSITORY;
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo||'')) throw new Error('GITHUB_REPOSITORY required');
  const end=Date.now()+waitSeconds*1000;
  do {
    const d=await api(`https://api.github.com/repos/${repo}/actions/workflows/release-control.yml/runs?head_sha=${sha}&per_page=100`);
    const result=evaluateRuns(d.workflow_runs||[],sha);
    if(result.ok) {console.log(`PASS exact-commit QA ${sha} run ${result.runId}`);return;}
    if(Date.now()>=end || !result.reason.startsWith('missing') && !/queued|in_progress|waiting|pending|requested/.test(result.reason)) throw new Error(`BLOCK ${sha}: ${result.reason}`);
    await new Promise(resolve=>setTimeout(resolve,15000));
  }while(true);
}
async function published(sha, waitSeconds=0) {
  const end=Date.now()+waitSeconds*1000;
  do {
    try {
      const r=await fetch(`https://jfcarpiopuntocom.github.io/friendly-123/next/release-proof.json?t=${Date.now()}`,{signal:AbortSignal.timeout(20000),cache:'no-store'});
      if(r.ok && (await r.json()).commit===sha) {console.log(`PASS canary published ${sha}`);return;}
    } catch(e) { console.log(`Canary evidence not available: ${e.message}`); }
    if(Date.now()>=end) throw new Error(`BLOCK: canary does not serve ${sha}`);
    await new Promise(resolve=>setTimeout(resolve,15000));
  }while(true);
}
async function served(fallback='') {
  try {
    const r=await fetch(`https://jfcarpiopuntocom.github.io/friendly-123/next/release-proof.json?t=${Date.now()}`,{signal:AbortSignal.timeout(5000),cache:'no-store'});
    if(r.ok) {
      const proof=await r.json();
      if(/^[a-f0-9]{40}$/.test(proof.commit || '')) {
        git('cat-file','-e',`${proof.commit}:docs/index.html`);
        return proof.commit;
      }
    }
  } catch(e) {console.error(`Previous canary proof unavailable: ${e.message}`);}
  return fallback;
}
function validate(base) {
  const catalog=JSON.parse(fs.readFileSync('release/capabilities.json','utf8'));
  let previous=[];
  if(base && /^0+$/.test(base)) base=null;
  if(base) {
    // Absence is allowed only for the first introduction. Invalid base/JSON fails closed.
    git('rev-parse','--verify',`${base}^{commit}`);
    if(git('ls-tree','--name-only',base,'release/capabilities.json')) previous=JSON.parse(git('show',`${base}:release/capabilities.json`)).capabilities;
  }
  const errors=validateCapabilities(catalog.capabilities,previous,fs.existsSync);
  const version=JSON.parse(fs.readFileSync('docs/version.json','utf8'));
  const old=base?JSON.parse(git('show',`${base}:docs/version.json`)):null;
  const runtimeChanged=base?!!git('diff','--name-only',base,'HEAD','--','docs/'):false;
  errors.push(...validateIdentity(version,fs.readFileSync('docs/sw.js','utf8'),old,runtimeChanged));
  if(runtimeChanged) {
    const history=git('log','--format=','-p',base,'--','docs/version.json');
    const used=[...history.matchAll(/f123-shell-v([0-9]+)/g)].map(m=>Number(m[1]));
    if(used.length && Number(version.shell?.split('v').pop())<=Math.max(...used)) errors.push('shell was already used in history; choose a new integer');
  }
  if(errors.length) throw new Error(errors.join('\n'));
  console.log(`PASS ${catalog.capabilities.length} protected capabilities; identity consistent`);
}
function provenance(directory, sha) {
  if(!/^[a-f0-9]{40}$/.test(sha||'')) throw new Error('Invalid provenance SHA');
  const version=JSON.parse(fs.readFileSync(path.join(directory,'version.json'),'utf8'));
  const hashes={};
  for(const file of ['version.json','version-manifest.json','sw.js','index.html']) hashes[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,file))).digest('hex');
  fs.writeFileSync(path.join(directory,'release-proof.json'),JSON.stringify({schema:1,commit:sha,shell:version.shell,cacheGeneration:version.cacheGeneration,hashes},null,2)+'\n');
}
module.exports={evaluateRuns,validateCapabilities,validateIdentity,gate,published,provenance,served};
if(require.main===module) (async()=>{
  const [command,arg,extra]=process.argv.slice(2);
  if(command==='gate') await gate(arg,Number(extra)||0);
  else if(command==='published') await published(arg,Number(extra)||0);
  else if(command==='served') console.log(await served(arg));
  else if(command==='validate') validate(arg);
  else if(command==='provenance') provenance(arg,extra);
  else throw new Error('Use validate [base], gate SHA [wait seconds], or provenance directory SHA');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
