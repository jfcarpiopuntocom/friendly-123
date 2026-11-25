'use strict';
// C246 (JFC 23 nov 2026): a cold-joining device must show the history it already downloaded (customers, sales) even when
// the C186 HEAD release never arrives (relay paused). Safety net retries the same add-only apply() inside a PIN session.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const src=fs.readFileSync('docs/sync-yjs.js','utf8');
test('C246: cold-join safety net bounds retries and preserves session and notebook guards',()=>{
 const i=src.indexOf('var _redDoc = API.doc');assert.ok(i>0,'safety net present');
 const blk=src.slice(i,src.indexOf('}, 10000);',i)+10);
 assert.match(blk,/_redDoc\.isDestroyed/);
 assert.match(blk,/f123_tienda_activa/);
 assert.match(blk,/Math\.min\([^\n]*60\)/);
 assert.match(blk,/_redRevision !== API\._catalogoRevision/);
 assert.match(blk,/OCAuth\.rolActual/);
 assert.match(blk,/aplicar\(true\);/);
 assert.doesNotMatch(blk,/\.delete\(|\.clear\(|\.setItem\(|\.removeItem\(|indexedDB/,'never deletes or rewrites data');
});
