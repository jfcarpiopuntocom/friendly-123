"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sync=fs.readFileSync(path.join(__dirname,"../docs/sync-yjs.js"),"utf8");
const tabs=fs.readFileSync(path.join(__dirname,"../docs/tab-session.js"),"utf8");

test("E1b-3 RED: visibility and tab ownership pause and resume all Yjs rooms",()=>{
 assert.match(sync,/function sincronizarVisibilidad\(/,"one visibility/lease gate controls Yjs");
 assert.match(sync,/window\.addEventListener\("oc-tab-session-changed",\s*sincronizarVisibilidad\)/);
 assert.match(sync,/document\.addEventListener\("visibilitychange",\s*sincronizarVisibilidad\)/);
 for(const name of ["canal","fotosCanal","opsCanal"]){
  assert.match(sync,new RegExp("API\\."+name+"\\.(?:pausar|reanudar)"),name+" must be governed");
 }
 assert.match(sync,/if \(_pausado \|\| !permitido\(\)\) return;/,"intentional pause fences connecting");
 assert.match(sync,/if \(_pausado \|\| !permitido\(\)\) return;/,"paused disconnect cannot retry forever");
});
test("E1b-3 RED: losing lease fences old tab and notifies transport",()=>{
 assert.match(tabs,/function puedeSincronizar\(\)/);
 assert.match(tabs,/suspendida\s*=\s*true/,"loser stays suspended until new PIN");
 assert.match(tabs,/new Event\("oc-tab-session-changed"\)/);
 assert.match(tabs,/canSync:\s*puedeSincronizar/);
 assert.match(tabs,/if\s*\(!document\.hidden\)\s*check\(\)/);
});
test("E1b-3 RED: former-tab panel is recommendations, friendly tools and dashboard with PIN",()=>{
 assert.match(tabs,/Herramientas amigas/);
 assert.match(tabs,/Friendly tools/);
 assert.match(tabs,/Ingresar al dashboard con PIN/);
 assert.match(tabs,/Enter dashboard with PIN/);
 assert.match(tabs,/Recomendar Friendly/);
 assert.doesNotMatch(tabs,/Ideas para empezar|Getting started/);
});
test("E1b-3 RED: pause never deletes durable outbox, Yjs journal or PIN",()=>{
 const a=sync.indexOf("    canal.pausar = function () {");
 const b=sync.indexOf("    canal.reanudar = function () {",a);
 assert.ok(a>0&&b>a,"explicit connection lifecycle exists");
 const block=sync.slice(a,b);
 assert.match(block,/ws\.close\(/,"socket is really closed");
 assert.doesNotMatch(block,/\.clear\(|delete\w*Database|localStorage\.removeItem|_outbox\s*=/);
});
