'use strict';
// C246 (JFC 23 nov 2026): a cold-joining device must show the history it already downloaded (customers, sales) even when
// the C186 HEAD release never arrives (relay paused). Safety net retries the same add-only apply() inside a PIN session.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const src=fs.readFileSync('docs/sync-yjs.js','utf8');
test('C246: cold-join safety net retries the existing apply() every 10 s, at most 30 times, only with a PIN session',()=>{
 const i=src.indexOf('var _redUnionFria = 0');assert.ok(i>0,'safety net present');
 const blk=src.slice(i,src.indexOf('}, 10000);',i)+10);
 assert.match(blk,/_primerMergeAceptado \|\| \+\+_redUnionFria > 30/);
 assert.match(blk,/OCAuth\.rolActual/);
 assert.match(blk,/if \(hay\) aplicar\(\);/);
 assert.doesNotMatch(blk,/\.delete\(|\.clear\(|localStorage|indexedDB/,'never deletes or rewrites data');
});
