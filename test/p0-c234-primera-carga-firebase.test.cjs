'use strict';
// C234 (JFC 23 nov 2026, eligio «Quitar el tope en la 1a carga»): a new device's first history download from Firebase does
// not count against the daily cap; photos and Supabase keep their caps; a safety bound protects the free accounts.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const src=fs.readFileSync('docs/relay-selector.js','utf8');
test('C234: first Firebase restore of a room is exempt from the daily download cap, bounded, photos excluded',()=>{
 const i=src.indexOf('function sumarBajada(');const body=src.slice(i,src.indexOf('\n  }',i));
 assert.match(body,/capa\.relay === fb && !esFoto\(url\) && !headAplicado\(url\)/);
 assert.match(body,/< CAP_DOWN \* 10/);
 assert.match(body,/c\.down \+= delta/);
});
