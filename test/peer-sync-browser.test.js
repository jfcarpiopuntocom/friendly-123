'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const dgram=require('node:dgram'),os=require('node:os');
const {WebSocketServer}=require('ws');
const {chromium,webkit}=require('playwright');
const root=path.join(__dirname,'..'),docs=path.join(root,'docs');
const source=fs.readFileSync(path.join(docs,'sync-yjs.js'),'utf8');
const block=source.slice(source.indexOf('  function _frame('),source.indexOf('  // Carga perezosa'))
  .replace('      var pendientesPeer = [], snapshotPeerRecibido = false, reintentosPeer = 0;',
    '      var pendientesPeer = [], snapshotPeerRecibido = false, reintentosPeer = 0; canal.fixturePeerState=()=>({snapshot:snapshotPeerRecibido,receipts:pendientesPeer.length,retries:reintentosPeer});')
  .replace('    return canal;', '    canal.fixtureState=()=>({localRecovery:canal.recuperacionLocal,paused:_pausado,visible:!document.hidden,allowed:permitido(),causalStructs:!!doc.store.pendingStructs,causalDeletes:!!doc.store.pendingDs,fragments:Object.values(partesEntrantes).map(g=>({tag:g.tag,count:g.cuenta,total:g.total,receipts:g.receipts.length})),inFlight:Object.keys(_durableInFlight).length,unsaved:_unsaved.length,liveQueue:canal.pend.length,bufferPump:!!_bufferPumpTimer,replayTimer:!!_tReplay}); return canal;');
const cryptoStart=source.indexOf('  async function cifrarBin('),cryptoEnd=source.indexOf('  // ===',cryptoStart);
const cryptoSource=source.slice(cryptoStart,cryptoEnd);
const room='a'.repeat(40);

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test('direct '+name+': durable business/photo recovery without central payload',{timeout:90000},async t=>{
  const worker=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(root,'cloudflare-sync-relay/worker.js')).toString('base64'));
  let metadataBytes=0,invalidMetadata=0,stunRequests=0;const metadataKinds={};
  // RFC5389 binding fixture: only address discovery; no TURN allocation or business relay.
  const stun=dgram.createSocket('udp4');
  const groups=new Map();let server,wss,browser;
  stun.on('message',(request,remote)=>{
    if(request.length<20||request.readUInt16BE(0)!==1||request.readUInt32BE(4)!==0x2112a442)return;
    const response=Buffer.alloc(32);response.writeUInt16BE(0x0101,0);response.writeUInt16BE(12,2);request.copy(response,4,4,20);
    response.writeUInt16BE(0x0020,20);response.writeUInt16BE(8,22);response[25]=1;response.writeUInt16BE(remote.port^0x2112,26);
    remote.address.split('.').forEach((n,i)=>{response[28+i]=Number(n)^request[4+i];});stunRequests++;stun.send(response,remote.port,remote.address);
  });
  try{
  await new Promise((resolve,reject)=>{stun.once('error',reject);stun.bind(0,'0.0.0.0',()=>{stun.removeListener('error',reject);resolve();});});
  const local=Object.values(os.networkInterfaces()).flat().find(iface=>iface.family==='IPv4'&&!iface.internal)?.address||'127.0.0.1';
  const stunURL='stun:'+local+':'+stun.address().port;
  server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Synthetic peer fixture</title>');});
  wss=new WebSocketServer({server});
  function notify(group){const peers=[...group.values()].filter(s=>s.readyState===1);const text=JSON.stringify({v:1,k:'peers',peers:peers.map(s=>s.peer)});for(const s of peers)s.send(text);}
  wss.on('connection',(socket,request)=>{
    const url=new URL(request.url,'http://fixture'),key=url.pathname;socket.peer=url.searchParams.get('peer');
    if(!/^\/signal\/[a-f0-9]{40}$/.test(key)||!/^[a-f0-9]{32}$/.test(socket.peer||'')){socket.close();return;}
    let group=groups.get(key);if(!group){group=new Map();groups.set(key,group);}group.set(socket.peer,socket);notify(group);
    socket.on('message',(raw,binary)=>{metadataBytes+=raw.length;let data;try{data=JSON.parse(raw);}catch{invalidMetadata++;socket.close();return;}
      if(binary||!worker.validSignal(data)){invalidMetadata++;socket.close(1008,'metadata only');return;}
      metadataKinds[data.k]=(metadataKinds[data.k]||0)+1;
      if(data.k==='clock'){socket.send(JSON.stringify({v:1,k:'clock',t0:data.t0,t1:Date.now(),t2:Date.now()}));return;}
      const peer=group.get(data.to);if(peer)peer.send(JSON.stringify({...data,from:socket.peer}));
    });
    socket.on('close',()=>{group.delete(socket.peer);notify(group);});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  const address='http://127.0.0.1:'+server.address().port;
    const launch={headless:true};
    const existing='C:/Users/JFC/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
    if(name==='chromium'&&!fs.existsSync(engine.executablePath())&&fs.existsSync(existing))launch.executablePath=existing;
    browser=await engine.launch(launch);
    const first=await browser.newContext(),second=await browser.newContext(),third=await browser.newContext();
    for(const context of [first,second,third])await context.route('**/*',route=>route.request().url().startsWith(address)?route.continue():route.abort());
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
    // Establish a native pair before app code: an SDP alone does not prove RTC data connectivity.
    const native=await probe.evaluate(async()=>{
      const left=new RTCPeerConnection({iceServers:[]}),right=new RTCPeerConnection({iceServers:[]});let stage='createDataChannel';
      let timer;const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('native RTC '+stage+' timed out')),5000);});
      const bounded=promise=>Promise.race([promise,deadline]);
      const candidates=new Map([[left,[]],[right,[]]]),errors=[];
      const candidate=(target,value)=>{if(!value)return;if(target.remoteDescription)target.addIceCandidate(value).catch(error=>errors.push(error.message));else candidates.get(target).push(value);};
      left.onicecandidate=event=>candidate(right,event.candidate);right.onicecandidate=event=>candidate(left,event.candidate);
      try{
        const dc=left.createDataChannel('native-capability-probe');
        const opened=new Promise(resolve=>{dc.onopen=resolve;});
        const received=new Promise(resolve=>{right.ondatachannel=event=>{event.channel.onmessage=message=>resolve(message.data);};});
        stage='createOffer';const offer=await bounded(left.createOffer());
        stage='setLocalDescription';await bounded(left.setLocalDescription(offer));
        stage='setRemoteOffer';await bounded(right.setRemoteDescription(left.localDescription));
        for(const value of candidates.get(right).splice(0))await bounded(right.addIceCandidate(value));
        stage='createAnswer';await bounded(right.setLocalDescription(await bounded(right.createAnswer())));
        stage='setRemoteAnswer';await bounded(left.setRemoteDescription(right.localDescription));
        for(const value of candidates.get(left).splice(0))await bounded(left.addIceCandidate(value));
        stage='native data channel open';await bounded(opened);
        stage='native data message';dc.send('native-only-probe');
        if(await bounded(received)!=='native-only-probe')throw Error('native RTC payload mismatch');
        return {ok:true};
      }catch(error){return {ok:false,stage,name:error.name,message:error.message,errors};}finally{clearTimeout(timer);left.close();right.close();}
    });
    if(!native.ok&&name==='webkit'){
      assert.equal(metadataBytes,0,'native capability probe runs before application/network code');
      if(process.env.F123_REQUIRE_WEBKIT==='1')
        assert.fail('WebKit native RTC is required for this CI gate: '+JSON.stringify(native));
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
      await page.evaluate(async({address,room,block,cryptoSource,seed,stunURL})=>{
        window.F123Relay=F123Peer.create({signalURL:address.replace('http:','ws:')+'/signal/',iceServers:[{urls:stunURL}]});
        window.API={roomId:room,clave:await crypto.subtle.importKey('raw',new Uint8Array(32).fill(7),'AES-GCM',false,['encrypt','decrypt'])};
        window.log=()=>{};window.RELAY_URL='wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/';
        window.doc=new Y.Doc();window.persistence=new IndexeddbPersistence('synthetic-business-peer',doc);await persistence.whenSynced;
        window.fixtureStorage={started:0,completed:0,accepted:0,rejected:0,errors:[],journalStarted:0,journalComplete:0,journalFailed:0};
        const transaction=persistence.db.transaction.bind(persistence.db);
        persistence.db.transaction=(...args)=>{const tx=transaction(...args);fixtureStorage.journalStarted++;tx.addEventListener('complete',()=>fixtureStorage.journalComplete++);tx.addEventListener('abort',()=>fixtureStorage.journalFailed++);tx.addEventListener('error',()=>fixtureStorage.journalFailed++);return tx;};
        window.allowed=true;
        API._store={aplicar(){window.business=doc.getMap('business').toJSON();}};
        API.confirmarCatalogoDurable=async()=>{fixtureStorage.started++;try{API._store.aplicar();const ok=allowed&&(await OCEstadoIDB.guardar({_rev:Date.now(),productos:[business],ubicaciones:[]},true))===true;fixtureStorage[ok?'accepted':'rejected']++;return ok;}catch(error){fixtureStorage.errors.push(error.name);throw error;}finally{fixtureStorage.completed++;}};
        const make=new Function(cryptoSource+block+';return crearCanal;')();
        window.channel=make(Y,doc,'-y','catalogo',false,null,persistence);
        doc.on('update',(update,origin)=>{if(origin!=='red'&&origin!==persistence)channel.enviarUpdate(update);});
        if(seed)doc.getMap('business').set('record',seed);
        window.rtcErrors=[];
        window.addEventListener('error',event=>rtcErrors.push({name:'window-error',message:event.message}));
        channel.conectar();
        const hub=channel.ws.hub,receiveSignal=hub.receiveSignal;
        hub.receiveSignal=function(...args){return receiveSignal.apply(this,args).catch(error=>{rtcErrors.push({name:error.name,message:error.message,stack:error.stack});throw error;});};
        const makePeer=hub.peer;
        hub.peer=function(...args){const peer=makePeer.apply(this,args);if(peer&&!peer.traced){peer.traced=true;for(const method of ['createOffer','setLocalDescription','setRemoteDescription','createAnswer']){const call=peer.pc[method].bind(peer.pc);peer.pc[method]=async(...args)=>{peer.nativeStage=method;const result=await call(...args);peer.nativeStage=method+' complete';return result;};}}return peer;};
      },{address,room,block,cryptoSource,seed,stunURL});
      return page;
    }
    const seed={id:'synthetic-sale',total:42.75,stock:7,history:['sale','payment'],photo:'synthetic-photo-'+ 'x'.repeat(220000)};
    const a=await boot(first,seed),b=await boot(second,null);
    try { await b.waitForFunction(()=>!channel.recuperando&&doc.getMap('business').get('record')?.total===42.75,{},{timeout:10000}); }
    catch(error) {
      const diagnostic=async page=>page.evaluate(()=>({rtc:typeof RTCPeerConnection,errors:rtcErrors,recovery:channel.recuperando,ready:channel.ws?.readyState,
        signal:channel.ws?.hub?.signal?.readyState,peers:[...(channel.ws?.hub?.peers?.values()||[])].map(p=>({stage:p.nativeStage,connection:p.pc.connectionState,ice:p.pc.iceConnectionState,gathering:p.pc.iceGatheringState,signal:p.pc.signalingState,dc:p.dc?.readyState})),
        pending:channel.pendientesRelay,record:!!doc.getMap('business').get('record'),storage:fixtureStorage,channel:channel.fixtureState(),receipt:channel.fixturePeerState()}));
      console.error(JSON.stringify({engine:name,invalidMetadata,stunRequests,metadataKinds,a:await diagnostic(a),b:await diagnostic(b)}));throw error;
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
    // Third isolated browser joins AFTER the first two have exchanged and
    // one was re-opened: it must receive exact history and pass new moves back.
    const c=await boot(third,null);
    await c.waitForFunction(()=>doc.getMap('business').get('record')?.total===43.25,{},{timeout:12000});
    // One of two receiving browsers cannot commit. ACK from the other must
    // NOT retire the sender's outbox while an active peer remains uncommitted.
    await c.evaluate(()=>{allowed=false;});
    await a.evaluate(()=>{
      const old=doc.getMap('business').get('record');
      doc.getMap('business').set('record',{...old,total:46.25,stock:9,history:old.history.concat('pending-peer')});
    });
    for(const page of [reopened,c])await page.waitForFunction(
      ()=>doc.getMap('business').get('record')?.total===46.25,{},{timeout:12000});
    await a.waitForFunction(()=>channel.pendientesRelay>0,{},{timeout:4000});
    await c.evaluate(()=>{allowed=true;});
    await a.waitForFunction(()=>channel.pendientesRelay===0,{},{timeout:16000});
    await c.evaluate(()=>{
      const old=doc.getMap('business').get('record');
      doc.getMap('business').set('record',{...old,total:47.75,stock:11,history:old.history.concat('third-browser-move')});
    });
    for(const page of [a,reopened])
      await page.waitForFunction(()=>doc.getMap('business').get('record')?.total===47.75,{},{timeout:12000});
    await c.waitForFunction(()=>channel.pendientesRelay===0,{},{timeout:12000});
    const exactly=await Promise.all([a,reopened,c].map(page=>page.evaluate(
      ()=>({record:doc.getMap('business').get('record'),revision:channel.pendientesRelay}))));
    for(const entry of exactly){
      assert.equal(entry.record.stock,11,'latest genuine third-browser movement propagates');
      assert.deepEqual(entry.record.history,['sale','payment','edit','pending-peer','third-browser-move']);
      assert.equal(entry.revision,0,'no unacknowledged ciphertext after three-way delivery');
    }
    await c.close();
    const cRestart=await boot(third,null);
    await cRestart.waitForFunction(()=>doc.getMap('business').get('record')?.total===47.75,{},{timeout:12000});
    const durable=await cRestart.evaluate(()=>doc.getMap('business').get('record'));
    assert.equal(durable.stock,11,'independent third browser keeps its journal across restart');
    assert.equal(invalidMetadata,0,'real browser connection metadata passes the restrictive coordinator');
    assert.ok(stunRequests>0,'native browsers exercised address discovery without a TURN/business relay');
    assert.ok(metadataBytes<100000,'fixture transfers large photo directly, keeping coordination small');
    await first.close();await second.close();await third.close();
  }finally{
    if(browser)await browser.close();for(const clients of groups.values())for(const socket of clients.values())socket.terminate();
    if(wss)await new Promise(resolve=>wss.close(resolve));if(server)await new Promise(resolve=>server.close(resolve));
    try{await new Promise(resolve=>stun.close(resolve));}catch(_){} // A failed bind has no open socket to close.
  }
});

test('coordinator rejects business frames and disguised SDP payloads',async()=>{
 const worker=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(root,'cloudflare-sync-relay/worker.js')).toString('base64'));
 for(const k of ['op','ckpt','pull','data','binary'])assert.equal(worker.validSignal({v:1,k,to:'b'.repeat(32),data:'synthetic-business'}),false);
 assert.equal(worker.validSignal({v:1,k:'offer',to:'b'.repeat(32),data:{type:'offer',sdp:'v=0\na=msid-semantic: WMS {"business":"secret"}'}}),false);
 assert.equal(worker.validSignal({v:1,k:'ice',to:'b'.repeat(32),data:{candidate:'candidate:secret arbitrary business data',sdpMid:'0',sdpMLineIndex:0}}),false);
});
