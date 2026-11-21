'use strict';
/* C101 regression: called workflow uses the CALLER github context.
   Ensure an independently RED canary, never hitching a post-deploy hotfix. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const yaml=fs.readFileSync(path.join(__dirname,'../.github/workflows/recorrido.yml'),'utf8');
const hotfix=fs.readFileSync(path.join(__dirname,'../.github/workflows/hotfix.yml'),'utf8');
const docs='https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations';
// Only extract a job-level if in this narrow workflow, not an unrelated step expression.
function jobIf(){
 const match=yaml.match(/^  union-fria:\r?\n(?:    [^\n]*\r?\n)*?    if:\s*(.+)$/m);
 assert.ok(match,'cold join job must remain defined and guarded with a job-level if');
 return match[1].trim();
}
function mayRun(workflow,event){
 const expression=jobIf().replace(/^\$\{\{\s*|\s*\}\}$/g,'');
 assert.match(expression,/github\.workflow/, 'called context must discriminate caller from direct recorrido workflow: '+docs);
 assert.match(expression,/github\.event_name/,'keep direct independent event filter');
 assert.match(expression,/^[\w\s.'()&|!=-]+$/,'only pure fixed GitHub context comparisons');
 const js=expression.replace(/github\.workflow/g,JSON.stringify(workflow)).replace(/github\.event_name/g,JSON.stringify(event));
 assert.doesNotMatch(js,/github\.|\$\{\{/,'no unresolved contexts');
 return Function('return ('+js+')')();
}
test('C101: a hotfix push calls only public page smoke, not the long-history cold join',()=>{
 assert.match(hotfix,/uses:\s*\.\/\.github\/workflows\/recorrido\.yml/);
 assert.equal(mayRun('hotfix','push'),false);
 assert.equal(mayRun('hotfix','workflow_dispatch'),false);
 assert.equal(mayRun('hotfix','schedule'),false);
});
test('C101: direct scheduled/manual/push recorrido still runs red-capable cold join',()=>{
 for(const event of ['schedule','workflow_dispatch','push'])assert.equal(mayRun('recorrido',event),true,event);
});
test('C101: unrecognized callers/events cannot silently create a synthetic store join',()=>{
 for(const name of ['other','release-control','publicar'])for(const event of ['push','workflow_dispatch','schedule'])assert.equal(mayRun(name,event),false,name+' / '+event);
 assert.equal(mayRun('recorrido','pull_request'),false);
});
test('C101: exact canary step remains real, configured and fail-closed',()=>{
 assert.match(yaml,/node scripts\/canario-union-fria\.cjs https:\/\/jfcarpiopuntocom\.github\.io\/friendly-123\//);
 assert.match(yaml,/node --test test\/canario-union-fria-guard\.test\.cjs/);
 assert.match(yaml,/F123_CANARIO_LICENCIA:/);
 assert.doesNotMatch(yaml,/continue-on-error:\s*true/);
 assert.match(yaml,/^  recorrer:/m);
});
