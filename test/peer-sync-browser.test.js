'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {WebSocketServer}=require('ws');
const {chromium,webkit}=require('playwright');
const root=path.join(__dirname,'..'),docs=path.join(root,'docs');
const source=fs.readFileSync(path.join(docs,'sync-yjs.js'),'utf8');
const block=source.slice(source.indexOf('  function _frame('),source.indexOf('  // Carga perezosa'));
const cryptoStart=source.indexOf('  async function cifrarBin('),cryptoEnd=source.indexOf('  // ===',cryptoStart);
const cryptoSource=source.slice(cryptoStart,cryptoEnd);
const room='a'.repeat(40);

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test('direct '+name+': durable business/photo recovery without central payload',{timeout:30000},async t=>{
  const worker=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(root,'cloudflare-sync-relay/worker.js')).toString('base64'));
  let metadataBytes=0,invalidMetadata=0;
  const groups=new Map();
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Synthetic peer fixture</title>');});
  const wss=new WebSocketServer({server});
  function notify(group){const peers=[...group.values()].filter(s=>s.readyState===1);const text=JSON.stringify({v:1,k:'peers',peers:peers.map(s=>s.peer)});for(const s of peers)s.send(text);}
  wss.on('connection',(socket,request)=>{
    const url=new URL(request.url,'http://fixture'),key=url.pathname;socket.peer=url.searchParams.get('peer');
    if(!/^\/signal\/[a-f0-9]{40}$/.test(key)||!/^[a-f0-9]{32}$/.test(socket.peer||'')){socket.close();return;}
    let group=groups.get(key);if(!group){group=new Map();groups.set(key,group);}group.set(socket.peer,socket);notify(group);
    socket.on('message',(raw,binary)=>{metadataBytes+=raw.length;let data;try{data=JSON.parse(raw);}catch{invalidMetadata++;socket.close();return;}
      if(binary||!worker.validSignal(data)){invalidMetadata++;socket.close(1008,'metadata only');return;}
      if(data.k==='clock'){socket.send(JSON.stringify({v:1,k:'clock',t0:data.t0,t1:Date.now(),t2:Date.now()}));return;}
      const peer=group.get(data.to);if(peer)peer.send(JSON.stringify({...data,from:socket.peer}));
    });
    socket.on('close',()=>{group.delete(socket.peer);notify(group);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address='http://127.0.0.1:'+server.address().port;
  let browser;
  try{
    const launch={headless:true};
    const existing='C:/Users/JFC/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
    if(name==='chromium'&&!fs.existsSync(engine.executablePath())&&fs.existsSync(existing))launch.executablePath=existing;
    browser=await engine.launch(launch);
    const first=await browser.newContext(),second=await browser.newContext();
    for(const context of [first,second])await context.route('**/*',route=>route.request().url().startsWith(address)?route.continue():route.abort());
    const probe=await first.newPage();await probe.goto(address);
    const rtc=await probe.evaluate(()=>typeof RTCPeerConnection==='function');
    if(!rtc){
      await probe.addScriptTag({content:fs.readFileSync(path.join(docs,'peer-sync.js'),'utf8')});
      const rejected=await probe.evaluate(room=>{try{F123Relay.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+room);return false;}catch(error){return /unavailable/.test(error.message);}},room);
      assert.equal(rejected,true,'unsupported RTC must fail before sending connection or business bytes');
      assert.equal(metadataBytes,0);
      await first.close();await second.close();
      t.skip('Installed browser build has no RTC API; native direct connectivity remains unverified for this engine');return;
    }
    // API presence alone does not prove this WebKit build has a working native RTC backend.
    const native=await probe.evaluate(async()=>{
      const pc=new RTCPeerConnection({iceServers:[]});let stage='createDataChannel';
      const bounded=promise=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('native RTC '+stage+' timed out')),2500))]);
      try{
        pc.createDataChannel('native-capability-probe');stage='createOffer';const offer=await bounded(pc.createOffer());
        stage='setLocalDescription';await bounded(pc.setLocalDescription(offer));
        return {ok:true};
      }catch(error){return {ok:false,stage,name:error.name,message:error.message};}finally{pc.close();}
    });
    if(!native.ok&&name==='webkit'){
      assert.equal(metadataBytes,0,'native capability probe runs before application/network code');
      console.error(JSON.stringify({engine:name,nativeRTC:native}));
      await first.close();await second.close();
      t.skip('Native WebKit RTC preflight failed/timed out before app code; direct connectivity unverified: '+JSON.stringify(native));return;
    }
    assert.equal(native.ok,true,JSON.stringify(native));
    await probe.close();
    async function boot(context,seed){
      const page=await context.newPage();await page.goto(address);
      await page.addScriptTag({content:fs.readFileSync(path.join(docs,'peer-sync.js'),'utf8')});
      await page.addScriptTag({content:fs.readFileSync(path.join(docs,'estado-idb.js'),'utf8')});
      await page.addScriptTag({content:fs.readFileSync(path.join(docs,'vendor/yjs-bundle.min.js'),'utf8')});
      await page.evaluate(async({address,room,block,cryptoSource,seed})=>{
        window.F123Relay=F123Peer.create({signalURL:address.replace('http:','ws:')+'/signal/',iceServers:[]});
        window.API={roomId:room,clave:await crypto.subtle.importKey('raw',new Uint8Array(32).fill(7),'AES-GCM',false,['encrypt','decrypt'])};
        window.log=()=>{};window.RELAY_URL='wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/';
        window.doc=new Y.Doc();window.persistence=new IndexeddbPersistence('synthetic-business-peer',doc);await persistence.whenSynced;
        window.allowed=true;
        API._store={aplicar(){window.business=doc.getMap('business').toJSON();}};
        API.confirmarCatalogoDurable=async()=>{API._store.aplicar();return allowed&&(await OCEstadoIDB.guardar({_rev:Date.now(),productos:[business],ubicaciones:[]},true))===true;};
        const make=new Function(cryptoSource+block+';return crearCanal;')();
        window.channel=make(Y,doc,'-y','catalogo',false,null,persistence);
        doc.on('update',(update,origin)=>{if(origin!=='red'&&origin!==persistence)channel.enviarUpdate(update);});
        if(seed)doc.getMap('business').set('record',seed);
        channel.conectar();
      },{address,room,block,cryptoSource,seed});
      return page;
    }
    const seed={id:'synthetic-sale',total:42.75,stock:7,history:['sale','payment'],photo:'synthetic-photo-'+ 'x'.repeat(220000)};
    const a=await boot(first,seed),b=await boot(second,null);
    try { await b.waitForFunction(()=>!channel.recuperando&&doc.getMap('business').get('record')?.total===42.75,{},{timeout:10000}); }
    catch(error) {
      const diagnostic=async page=>page.evaluate(()=>({rtc:typeof RTCPeerConnection,recovery:channel.recuperando,ready:channel.ws?.readyState,
        signal:channel.ws?.hub?.signal?.readyState,peers:[...(channel.ws?.hub?.peers?.values()||[])].map(p=>({connection:p.pc.connectionState,ice:p.pc.iceConnectionState,signal:p.pc.signalingState,dc:p.dc?.readyState})),
        pending:channel.pendientesRelay,record:!!doc.getMap('business').get('record')}));
      console.error(JSON.stringify({engine:name,invalidMetadata,a:await diagnostic(a),b:await diagnostic(b)}));throw error;
    }
    await a.waitForFunction(()=>!channel.recuperando,{},{timeout:10000});
    assert.deepEqual(await b.evaluate(()=>doc.getMap('business').get('record')),seed);
    await b.evaluate(()=>{allowed=false;});
    await a.evaluate(()=>{const old=doc.getMap('business').get('record');doc.getMap('business').set('record',{...old,total:43.25,stock:6,history:old.history.concat('edit')});});
    await b.waitForFunction(()=>doc.getMap('business').get('record')?.total===43.25,{},{timeout:5000});
    assert.ok(await a.evaluate(()=>channel.pendientesRelay>0),'recipient rejection keeps source ciphertext pending');
    await b.evaluate(()=>{allowed=true;});
    await a.waitForFunction(()=>channel.pendientesRelay===0,{},{timeout:12000});
    const saved=await b.evaluate(async()=>await OCEstadoIDB.leer());assert.equal(saved.productos[0].record.stock,6);
    await b.close();
    const reopened=await boot(second,null);
    await reopened.waitForFunction(()=>doc.getMap('business').get('record')?.total===43.25,{},{timeout:5000});
    assert.equal(await reopened.evaluate(()=>doc.getMap('business').get('record').photo),seed.photo);
    assert.equal(invalidMetadata,0,'real browser connection metadata passes the restrictive coordinator');
    assert.ok(metadataBytes<100000,'fixture transfers large photo directly, keeping coordination small');
    await first.close();await second.close();
  }finally{
    if(browser)await browser.close();for(const clients of groups.values())for(const socket of clients.values())socket.terminate();
    await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));
  }
});

test('coordinator rejects business frames and disguised SDP payloads',async()=>{
 const worker=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(root,'cloudflare-sync-relay/worker.js')).toString('base64'));
 for(const k of ['op','ckpt','pull','data','binary'])assert.equal(worker.validSignal({v:1,k,to:'b'.repeat(32),data:'synthetic-business'}),false);
 assert.equal(worker.validSignal({v:1,k:'offer',to:'b'.repeat(32),data:{type:'offer',sdp:'v=0\na=msid-semantic: WMS {"business":"secret"}'}}),false);
 assert.equal(worker.validSignal({v:1,k:'ice',to:'b'.repeat(32),data:{candidate:'candidate:secret arbitrary business data',sdpMid:'0',sdpMLineIndex:0}}),false);
});
