'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.js'),'utf8');
const shipped=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.min.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');
test('PIN gate card uses border-box to avoid width+padding overflow',()=>{
 assert.match(src,/#oc-gate, #oc-gate \*, #oc-gate \*::before, #oc-gate \*::after\s*\{box-sizing:border-box;\}/);
 assert.match(src,/#oc-gate \.caja\{[^}]*max-width:420px;width:100%;min-width:0;/);
});
test('narrow viewport keeps PIN keys and actions inside card',()=>{
 assert.match(src,/@media\(max-width:380px\)/);
 assert.match(src,/#oc-gate \.oc-pad button\{min-width:0;/);
 assert.match(src,/#oc-gate \.oc-acciones button\{min-width:0;overflow-wrap:anywhere;/);
});
test('PIN gate scroll remains available and update semantics untouched',()=>{
 assert.match(src,/#oc-gate\{position:fixed;inset:0;[^}]*overflow-y:auto;/);
 assert.match(src,/document\.body\.appendChild\(gate\)/);
});

test('actual PIN script loaded by index contains responsive layout fix',()=>{
 assert.match(html,/<script defer src="\\.\\/auth-ui\\.min\\.js"><\\/script>/);
 assert.match(shipped,/#oc-gate, #oc-gate \\*, #oc-gate \\*::before, #oc-gate \\*::after\\{box-sizing:border-box;\\}/);
 assert.match(shipped,/#oc-gate \\.oc-pad button\\{min-width:0;/);
});
