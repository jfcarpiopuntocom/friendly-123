'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(require('node:path').join(__dirname,'..',p),'utf8');
test('RED: dashboard encrypted transient broadcast delivers exact bytes to same room, rejects other room',async()=>{
 const source=read('docs/dashboard-broadcast.js');
 const peers=new Map(),published=[];
 const fake={channel(topic){
  const handlers=[];const item={topic,handlers,closed:false};
  if(!peers.has(topic))peers.set(topic,[]);
  peers.get(topic).push(item);
  return {
   on(type,filter,fn){assert.equal(type,'broadcast');handlers.push({event:filter.event,fn});return this},
   subscribe(fn){queueMicrotask(()=>fn('SUBSCRIBED'));return this},
   async send(message){assert.equal(message.type,'broadcast');published.push(message);for(const x of peers.get(topic)){if(x===item||x.closed)continue;for(const h of x.handlers)if(h.event===message.event)h.fn({payload:message.payload})}return 'ok'},
   async unsubscribe(){item.closed=true}
  }
 }};
 const context={window:{F123DashboardRealtime:fake},EventTarget,Event,MessageEvent,TextEncoder,Uint8Array,ArrayBuffer,crypto:crypto.webcrypto,console,Promise,Map,Set,JSON,Date,Math,atob,btoa,setTimeout,clearTimeout,queueMicrotask,DOMException};
 vm.runInNewContext(source,context);
 const bus=context.window.F123DashboardBroadcast;
 assert.equal(typeof bus.connect,'function');
 const a=bus.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+'a'.repeat(40));
 const b=bus.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+'a'.repeat(40));
 const wrong=bus.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+'b'.repeat(40));
 await new Promise(r=>setTimeout(r,10));
 assert.equal(a.readyState,1);assert.equal(b.readyState,1);assert.equal(wrong.readyState,1);
 let bytes=null,wrongHit=0;
 b.addEventListener('message',e=>{bytes=Array.from(new Uint8Array(e.data));});
 wrong.addEventListener('message',()=>{wrongHit++});
 const secret=Uint8Array.from([15,0,127,255,1,2,3,4]);
 a.send(secret.buffer);
 await new Promise(r=>setTimeout(r,10));
 assert.deepEqual(bytes,Array.from(secret));assert.equal(wrongHit,0);
 assert.ok(published.every(x=>typeof x.payload?.c==='string'&&!JSON.stringify(x).includes('15,0,127')),'wire only base64 ciphertext');
 assert.throws(()=>a.send('plaintext'),/binary|cipher|ArrayBuffer/);
 a.close();b.close();wrong.close();
});
test('RED: real index loads dashboard bus after vendor and before legacy sync; dashboard selects encrypted bus',()=>{
 const index=read('docs/index.html'),dash=read('docs/dashboard.html'),legacy=read('docs/sync-realtime.js'),vendor=read('docs/vendor/supabase-relay.min.js');
 assert.ok(index.includes('dashboard-broadcast.js')&&index.indexOf('dashboard-broadcast.js')<index.indexOf('sync-realtime.js'));
 assert.ok(dash.includes('dashboard-broadcast.js')&&dash.indexOf('dashboard-broadcast.js')<dash.indexOf('dashboard-main.min.js'));
 assert.ok(dash.includes('dashboard-broadcast.js\" data-f123-dashboard'),'dashboard-only transport selector is script attribute');
 assert.ok(read('docs/dashboard-broadcast.js').includes('window.F123Relay = window.F123DashboardRealtime'),'client selector uses already-loaded ephemeral SDK');
 assert.ok(vendor.includes('window.F123DashboardRealtime=mn'),'SDK instance exported, no duplicate SDK');
 assert.ok(legacy.includes('dashboard-broadcast')&&legacy.includes('ev.relaySource === "dashboard-broadcast"'),'existing Owner PIN verification re-used by app');
});

test('P0: an app-side transient Supabase CHANNEL_ERROR recovers the subscription without losing its dashboard listener', async()=>{
  let signal=null,unsubscribed=0,deliver=null;
  const adapter={
    channel(){return {
      on(t,filter,fn){if(t==='broadcast'&&filter.event==='frame')deliver=fn;return this;},
      subscribe(fn){signal=fn;return this;},
      unsubscribe(){unsubscribed++;}
    }}
  };
  const context={window:{F123DashboardRealtime:adapter},EventTarget,Event,MessageEvent,TextEncoder,Uint8Array,ArrayBuffer,crypto:crypto.webcrypto,console,Promise,Map,Set,JSON,Date,Math,atob,btoa,setTimeout,clearTimeout,queueMicrotask,DOMException};
  vm.runInNewContext(read('docs/dashboard-broadcast.js'),context);
  const socket=context.window.F123DashboardBroadcast.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+'c'.repeat(40));
  const seen=[]; socket.addEventListener('open',()=>seen.push('open'));
  signal('SUBSCRIBED');assert.equal(socket.readyState,1);
  signal('CHANNEL_ERROR');
  assert.equal(socket.readyState,0,'a transient provider error stops sends but keeps the same listener');
  assert.equal(unsubscribed,0,'do not kill the Supabase SDK automatic rejoin');
  signal('SUBSCRIBED');assert.equal(socket.readyState,1);
  assert.deepEqual(seen,['open','open'],'the app sees a renewed ready channel');
  socket.close();assert.equal(unsubscribed,1);
});


function __p0ExtractRealHandler(source, name) {
  const kind = name === 'dashboardRespuestaDisponible' ? 'function' : 'async function';
  const start = source.indexOf('  ' + kind + ' ' + name + '(');
  assert.ok(start >= 0, 'real runtime handler found: ' + name);
  const end = source.indexOf('\n  }\n\n', start);
  assert.ok(end > start, 'real runtime handler ends: ' + name);
  return source.slice(start, end + '\n  }'.length);
}
function __p0BuildHandler(name, opts={}) {
  const source=read('docs/sync-realtime.js');
  const sent=[];
  const bridge={readyState:opts.bridgeOpen===false?0:1,send:(p)=>sent.push(p)};
  const env={
    window:{OCSecure:{migrarSiHaceFalta:async()=>{}, verificarOwnerOEmpleado:async p=>p==='123'?'dueno':''}, OCSync:{}},
    WebSocket:{OPEN:1,CONNECTING:0}, ws:{readyState:0}, _dashboardBroadcast:bridge,
    TIPO_RESPUESTA:'__respuesta__',TIPO_FOTO_TROZO:'__foto_trozo__',
    fotoAutorizadaHasta:{panel:{token:'token-ok',hasta:Date.now()+60000}}, presenciaN:1,
    uuidCorto:()=> 'synthetic-op-id', deviceId:()=> 'app-device',
    claveActual:{},cifrar:async (_key,value)=>value,
    fetch:async()=>({ok:false}), Date,Math,Promise,JSON,String,Array,Object,
    setTimeout:(fn)=>fn(),armarFoto:async()=>({
      negocio:'Synthetic QA',generadaEn:'2026-11-18T00:00:00Z',
      productos:[{nombre:'Sample',stockActual:9}],clientes:[],ventas:[],liquidaciones:[],
      perchas:[],promotoras:[],movimientos:[],gastos:[],ajustesComision:[],
      transferencias:[],hechosFinancieros:[],gastosMensuales:{},cobertura:{},resumen:{entra:27}
    }),
    trocear:(name,items)=>[{tabla:name,i:0,total:1,filas:Array.isArray(items)?items:[items]}]
  };
  const extra=source.includes('  function dashboardRespuestaDisponible(')
    ? __p0ExtractRealHandler(source,'dashboardRespuestaDisponible')+'\n' : '';
  vm.runInNewContext(extra+__p0ExtractRealHandler(source,name)+'\nthis.__handler='+name+';',env);
  return {env,sent,run:env.__handler};
}
test('P0: real responderPin uses encrypted dashboard lane while legacy ws is CONNECTING',async()=>{
  const h=__p0BuildHandler('responderPin');
  await h.run({__dashboardBroadcast:true,deviceId:'panel',payload:{pin:'123',pedidoId:'real-pin'}});
  assert.equal(h.sent.length,1,'Owner answers on transient bus without legacy socket');
  assert.equal(h.sent[0].tipo,'__respuesta__');
  assert.equal(h.sent[0].payload.ok,true);
  assert.ok(h.sent[0].payload.datos.fotoToken);
  const deny=__p0BuildHandler('responderPin');
  await deny.run({__dashboardBroadcast:true,deviceId:'panel',payload:{pin:'999',pedidoId:'wrong-pin'}});
  assert.equal(deny.sent.some(x=>x.payload.ok===true),false,'wrong PIN never gets authorization');
  const closed=__p0BuildHandler('responderPin',{bridgeOpen:false});
  await closed.run({__dashboardBroadcast:true,deviceId:'panel',payload:{pin:'123',pedidoId:'closed-bridge'}});
  assert.equal(closed.sent.length,0,'closed bridge does not emit any response');
});
test('P0: real responderFoto emits verified snapshot parts despite legacy ws CONNECTING',async()=>{
  const h=__p0BuildHandler('responderFoto');
  await h.run({__dashboardBroadcast:true,deviceId:'panel',payload:{fotoToken:'token-ok'}});
  assert.ok(h.sent.length>=3,'snapshot parts must reach ephemeral channel');
  assert.ok(h.sent.some(x=>x.payload.tabla==='productos'&&x.payload.filas[0].stockActual===9));
  assert.ok(h.sent.some(x=>x.payload.tabla==='resumen'&&x.payload.filas[0].entra===27));
  const bad=__p0BuildHandler('responderFoto');
  await bad.run({__dashboardBroadcast:true,deviceId:'panel',payload:{fotoToken:'invalid'}});
  assert.equal(bad.sent.length,0,'invalid photo token rejected');
  const closed=__p0BuildHandler('responderFoto',{bridgeOpen:false});
  await closed.run({__dashboardBroadcast:true,deviceId:'panel',payload:{fotoToken:'token-ok'}});
  assert.equal(closed.sent.length,0,'closed bridge rejects photo');
});
