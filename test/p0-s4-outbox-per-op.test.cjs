'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
test('S4: JFC-only migration atomically moves old blob and preserves all envelopes',()=>{
 assert.match(source,/API\.esLicenciaPruebaJfc = _salaId !== codigo/);
 const first=source.indexOf('var tx = db.transaction(["custom"], "readwrite")');
 const end=source.indexOf('      });\n          _v2Cache = old;',first);
 assert.ok(first>=0&&end>first,'one transaction owns migration');
 const body=source.slice(first,end);
 assert.match(body,/old\.pending\.forEach/);
 assert.match(body,/store\.put\(entry, _v2Prefix \+ entry\.id\)/);
 assert.match(body,/store\.put\(\{v:2,rev:1/);
 assert.match(body,/store\.delete\(_outboxKey\)/);
 assert.match(body,/tx\.oncomplete = resolve/);
});
test('S4: one new movement never rewrites all historic operations',()=>{
 const first=source.indexOf('    function guardarOutbox() {');
 const end=source.indexOf('    function mutarOutbox(change) {',first);
 assert.ok(first>=0&&end>first);
 const saved=source.slice(first,end);
 assert.match(saved,/if \(!_v2Signatures\.has\(id\) \|\| _v2Signatures\.get\(id\) !== v2Signature\(entry\)\)/);
 assert.match(saved,/store\.put\(entry, _v2Prefix \+ id\)/);
 assert.match(saved,/store\.delete\(_v2Prefix \+ id\)/);
 assert.match(saved,/confirmed:_outbox\.confirmed/);
});
test('S4: old clientes keep their same storage algorithm',()=>{
 assert.match(source,/if \(!API\.esLicenciaPruebaJfc \|\| !persistencia/);
 assert.match(source,/if \(persistencia && typeof persistencia\.set === "function"\) return persistencia\.set\(_outboxKey, _outbox\)/);
});
