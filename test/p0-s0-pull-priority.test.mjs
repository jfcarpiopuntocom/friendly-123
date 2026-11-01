import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRelayTransport} from '../supabase-relay/transport.mjs';

test('S0: cold pull must run while an old durable op awaits slow RPC ACK',async()=>{
  let resolveOld;
  const held=new Promise(resolve=>{resolveOld=resolve;});
  const commands=[],events=[];
  const channel={
    on(){return this;},
    subscribe(fn){queueMicrotask(()=>fn('SUBSCRIBED'));return this;},
    track:async()=> 'ok',
    presenceState:()=>({peer:[{}]}),
    send:async()=> 'ok'
  };
  const client={
    channel:()=>channel,
    removeChannel:async()=>{},
    realtime:{disconnect(){}},
    async rpc(fn,args){
      if(fn==='f123_relay_has_topic')return {data:true,error:null};
      assert.equal(fn,'f123_relay_command');
      commands.push(args.p_action);
      if(args.p_action==='op')return held;
      if(args.p_action==='pull')return {data:{frames:[],v:2,rev:1,seq:0,n:0,more:false},error:null};
      return {data:{ok:true},error:null};
    }
  };
  const transport=createRelayTransport({client});
  const socket=transport.connect('SYNTHETIC_S0');
  socket.addEventListener('message',e=>{if(typeof e.data==='string')events.push(JSON.parse(e.data));});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('socket did not open')),1000);
    socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
  });
  try{
    socket.send(JSON.stringify({k:'op',ack:1,id:'slow-old',lam:1,c:'synthetic-frame'}));
    socket.send(JSON.stringify({k:'pull',v:2,rev:0,seq:0,limit:64}));
    await new Promise(resolve=>setTimeout(resolve,40));
    assert.ok(commands.includes('op'),'old RPC must have begun');
    assert.ok(commands.includes('pull'),'fresh remote events must never wait behind old pending ACK');
  }finally{
    resolveOld({data:{ok:true},error:null});
    await new Promise(resolve=>setTimeout(resolve,30));
    socket.close();
    await transport.dispose();
  }
  assert.ok(events.some(e=>e.k==='persist-result'&&e.id==='slow-old'&&e.ok===true),'existing op ACK survives parallel pull');
  assert.ok(events.some(e=>e.k==='pull-page'),'cold catch-up completes');
});
