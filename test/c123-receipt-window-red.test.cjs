'use strict';
// C123 RED: exact production snapshot expression and cold-open receipt retention.
// Run: node --test test/c123-receipt-window-red.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
test('C123: 2,001 durable remote receipts survive cold-open when localStorage quota is full',()=>{
 const line=source.split('\n').find(x=>x.includes('? { opsAplicadas:'));
 assert.ok(line,'production notebook exports durable op receipts');
 const expr=line.match(/opsAplicadas:\s*(.+?)\s*}\s*:/);
 assert.ok(expr,'extract real production receipt snapshot expression');
 const old=Array.from({length:2001},(_,i)=>'remote-stock:'+i);
 const sandbox={_opsAplicadas:new Set(old),_opsDelCuaderno:null};
 const exported=vm.runInNewContext(expr[1],sandbox);
 const persisted=JSON.parse(JSON.stringify({opsAplicadas:exported}));
 // No localStorage fallback: emulate quota-full and a fresh browser process.
 const reopened=new Set(persisted.opsAplicadas);
 assert.equal(reopened.size,2001,'all 2001 unacknowledged receipts must remain durable');
 assert.ok(reopened.has(old[0]),'oldest opId must not replay stock after cold-open');
});
