const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateRuns, validateCapabilities, validateIdentity } = require('../scripts/release-control.cjs');
const sha = 'a'.repeat(40);
const good = { id: 2, run_attempt: 1, head_sha: sha, head_branch: 'master', event: 'push', path: '.github/workflows/release-control.yml', status: 'completed', conclusion: 'success', created_at: '2026-10-05T20:00:00Z' };

test('release gate accepts only successful QA on the exact commit and trusted workflow', () => {
  assert.equal(evaluateRuns([good], sha).ok, true);
  for (const bad of [[], [{...good, head_sha:'b'.repeat(40)}], [{...good,event:'pull_request'}], [{...good,path:'.github/workflows/other.yml'}], [{...good,head_branch:'other'}]]) {
    assert.equal(evaluateRuns(bad, sha).ok, false);
  }
  for(const conclusion of ['failure','cancelled','skipped','timed_out',null]) assert.equal(evaluateRuns([{...good,conclusion}],sha).ok,false);
  assert.equal(evaluateRuns([good,{...good,id:3,status:'in_progress',conclusion:null}],sha).ok,false,'new pending run must invalidate older green');
  assert.equal(evaluateRuns([good,{...good,run_attempt:2,conclusion:'failure'}],sha).ok,false,'new failed attempt must invalidate older green');
});

test('capability catalog cannot silently lose an approved capability or its executable check', () => {
  const base=[{id:'commission-editor',tests:['test/editor.test.js']}];
  assert.deepEqual(validateCapabilities(base,base,()=>true),[]);
  assert.ok(validateCapabilities([],base,()=>true).length);
  assert.ok(validateCapabilities([{id:'commission-editor',tests:[]}],base,()=>true).length);
  assert.ok(validateCapabilities(base,base,()=>false).length);
  assert.ok(validateCapabilities([...base,...base],base,()=>true).length);
  assert.ok(validateCapabilities([{...base[0],contract:'silently replaced'}],base,()=>true).length);
  const prior=[{...base[0],contract:'Original approved behavior'}];
  const changed=[{...prior[0],contract:'Explicit new decision',changeApproval:{approvedBy:'JFC',date:'2026-10-06',reason:'Explicit product decision',previousContract:prior[0].contract}}];
  assert.deepEqual(validateCapabilities(changed,prior,()=>true),[]);
  for(const key of ['approvedBy','date','reason','previousContract']) {
    const bad=structuredClone(changed);delete bad[0].changeApproval[key];
    assert.ok(validateCapabilities(bad,prior,()=>true).length,`approval requires ${key}`);
  }
  assert.ok(validateCapabilities([{...changed[0],tests:[]}],prior,()=>true).length,'approval never permits removing protected tests');
});

test('release API fails closed and live canary must identify the exact candidate', async () => {
  const {gate,published}=require('../scripts/release-control.cjs');
  const original=global.fetch, repo=process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY='fixture/repo';
  try {
    global.fetch=async()=>({ok:true,json:async()=>({workflow_runs:[good]})});
    await gate(sha);
    global.fetch=async()=>({ok:false,status:403});
    await assert.rejects(gate(sha),/HTTP 403/);
    global.fetch=async()=>({ok:true,json:async()=>({workflow_runs:[{...good,head_sha:'b'.repeat(40)}]})});
    await assert.rejects(gate(sha),/BLOCK/);
    global.fetch=async()=>({ok:true,json:async()=>({commit:'b'.repeat(40)})});
    await assert.rejects(published(sha),/BLOCK/);
    global.fetch=async()=>({ok:true,json:async()=>({commit:sha})});
    await published(sha);
  } finally { global.fetch=original;if(repo===undefined) delete process.env.GITHUB_REPOSITORY;else process.env.GITHUB_REPOSITORY=repo; }
});

test('public proof records exact artifact bytes and recovery retains the already published canary', () => {
  const {provenance}=require('../scripts/release-control.cjs');
  const os=require('node:os'),crypto=require('node:crypto');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'release-proof-'));
  try {
    for(const file of ['sw.js','index.html','version-manifest.json']) fs.writeFileSync(path.join(dir,file),'fixture\n');
    fs.writeFileSync(path.join(dir,'version.json'),JSON.stringify({shell:'f123-shell-v451',cacheGeneration:'golden1'}));
    provenance(dir,sha);
    const proof=JSON.parse(fs.readFileSync(path.join(dir,'release-proof.json')));
    assert.equal(proof.commit,sha);
    for(const [file,hash] of Object.entries(proof.hashes)) assert.equal(hash,crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex'));
    fs.appendFileSync(path.join(dir,'index.html'),'changed');provenance(dir,sha);
    assert.notEqual(proof.hashes['index.html'],JSON.parse(fs.readFileSync(path.join(dir,'release-proof.json'))).hashes['index.html']);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
  const workflow=fs.readFileSync(path.resolve(__dirname,'../.github/workflows/publicar.yml'),'utf8');
  assert.match(workflow,/if \[ "\$RECOVERY" = "true" \]/);
  assert.match(workflow,/CANDIDATE="\$\{SERVED:-\$MASTER\}"/,'REWIND can always use master without a Pages proof');
  assert.doesNotMatch(workflow,/gate "\$MASTER" [1-9]/,'no QA wait in Pages queue');
  assert.match(workflow,/git archive origin\/estable docs/);
  assert.match(workflow,/EXPECT_STABLE/);
  assert.doesNotMatch(workflow,/EXPECT_MASTER/,'new master must not block publishing stable');
});

test('new shells are authorized; identity mismatch and same-shell changed runtime are rejected', () => {
  const previous={shell:'f123-shell-v448',cacheGeneration:'golden15'};
  assert.deepEqual(validateIdentity({shell:'f123-shell-v451',cacheGeneration:'golden1'},'const CACHE = "f123-shell-v451"; const CACHE_GENERACION = "-golden1";',previous,true),[]);
  assert.ok(validateIdentity(previous,'const CACHE = "f123-shell-v447";',previous,false).length);
  assert.ok(validateIdentity(previous,'const CACHE = "f123-shell-v448"; const CACHE_GENERACION = "-golden15";',previous,true).length);
  assert.deepEqual(validateIdentity(previous,'const CACHE = "f123-shell-v448"; const CACHE_GENERACION = "-golden15";',previous,false),[]);
});

test('automatic promotion requires exact QA; emergency PUSH only reports QA and never requires a witness', () => {
  const root=path.resolve(__dirname,'..');
  const promoter=fs.readFileSync(path.join(root,'.github/workflows/promover.yml'),'utf8');
  const sonar=fs.readFileSync(path.join(root,'.github/workflows/sonar.yml'),'utf8');
  assert.match(promoter,/release-control\.cjs gate/);
  assert.match(sonar,/release-control\.cjs gate/);
  assert.ok(sonar.indexOf('release-control.cjs gate')>sonar.indexOf('if [ "$ACCION" = "push" ]'));
  assert.ok(sonar.indexOf('release-control.cjs gate')<sonar.indexOf('elif [ "$ACCION" = "rewind" ]'));
  assert.match(sonar,/gate "\$MASTER".*\|\| echo/);
  assert.doesNotMatch(sonar,/420000|hayTestigo|release-control\.cjs published/);
  assert.match(promoter,/timeout-minutes: 45/);
  assert.match(promoter,/FIN=\$\(\( \$\(date -d "\$INICIO" \+%s\) \+ 33 \* 60 \)\)/);
  assert.doesNotMatch(promoter,/gate "\$GITHUB_SHA" [1-9]/);
});

test('missing or unavailable Pages proof never blocks recovery fallback', async () => {
  const {served}=require('../scripts/release-control.cjs');const original=global.fetch;
  try {
    global.fetch=async()=>({ok:false,status:404});assert.equal(await served(sha),sha);
    global.fetch=async()=>{throw new Error('offline');};assert.equal(await served(sha),sha);
  } finally {global.fetch=original;}
});
