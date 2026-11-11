'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const packet=read('docs/designs/EGM-GOLDFISH-REVIEW.md');
const contract=read('docs/designs/FRIENDLY123-STABLE-EGM.md');
const index=read('docs/designs/SITEMAP.md');

test('five EGM phases preserve their original meanings and order',()=>{
 const names=['Initial Zoom Out','Comprehension','Design Critique','Intermediate Zoom Out','Implementation Readiness'];
 const rows=[...packet.matchAll(/^\| GF-[1-5]\b[^\n]*$/gm)].map(m=>m[0]);
 assert.equal(rows.length,5,'five reviewer phases');
 names.forEach((name,i)=>assert.match(rows[i],new RegExp(name,'i'),'GF-'+(i+1)));
 assert.match(packet,/SUPPLEMENTAL friendly-123 code audit/i,'code audit is not an EGM phase');
 assert.match(packet,/SUPPLEMENTAL friendly-123 release signoff/i,'human signoff is not an EGM phase');
});

test('review packet and spec are readable Markdown without escaped code spans',()=>{
 for(const [name,body] of [['packet',packet],['contract',contract]]) {
   assert.doesNotMatch(body,/\\`/,name+' has escaped code spans');
   assert.match(body,/`docs\/sync-yjs\.js`/);
 }
 assert.match(packet,/^```text$/m,'fenced finding template');
});

test('stable spec retains 10 invariants, 8 gates, 42 physical cases and NO-GO',()=>{
 assert.match(index,/FRIENDLY123-STABLE-EGM\.md/);
 assert.match(index,/INDEPENDENT REVIEW NOT RUN/);
 for(let i=1;i<=10;i++)assert.match(contract,new RegExp('^\\| INV-'+String(i).padStart(2,'0')+'\\b','m'));
 for(let i=0;i<=7;i++)assert.match(contract,new RegExp('^\\| G'+i+'\\b','m'));
 for(const term of ['42','A→B→A ×2','NO-GO','#584','#621','#629','#618','15','33','MDD-2026-10-31','synthetic writer A']) {
   assert.ok(contract.includes(term),'missing acceptance detail: '+term);
 }
 assert.match(packet,/NOT RUN/);
 assert.match(contract,/NOT CERTIFIED/);
});
