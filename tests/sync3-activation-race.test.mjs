import test from 'node:test';
import assert from 'node:assert/strict';
import {createVerifiedCrossDeviceFailbackCoordinator} from '../src/port2-cross-device-failback.mjs';

function fixture(openCatalogSession) {
  const store = {loadAll: async () => [], loadCommittedOpIds: async () => [], save: async () => {}, remove: async () => {}};
  const reconciler = {ready: async () => {}, pending: () => [], quarantined: () => [],
    submit: async () => ({committed:false}), reconcileNow: async () => ({attempted:0,results:[]})};
  return createVerifiedCrossDeviceFailbackCoordinator({store,reconciler,openCatalogSession});
}

test('synchronous writer conflict during session opening never activates stale writer', async () => {
  let closed = 0;
  const coordinator = fixture(async ({onWriterConflict}) => {
    onWriterConflict();
    return {frozenHead:'certified-head-2026',close(){closed++;}};
  });
  const result = await coordinator.activate20();
  assert.equal(result.ok,false);
  assert.equal(coordinator.mode(),'failback-legacy-1.0');
  assert.equal(closed,1);
  coordinator.destroy();
});

test('manual failback invalidates pending async catalog session', async () => {
  let release;
  let closed = 0;
  const gate = new Promise(resolve => {release=resolve;});
  const coordinator = fixture(async () => {
    await gate;
    return {frozenHead:'certified-head-2026',close(){closed++;}};
  });
  const activating = coordinator.activate20();
  await new Promise(resolve => setImmediate(resolve));
  await coordinator.failbackToLegacy('manual');
  release();
  const result = await activating;
  assert.equal(result.ok,false);
  assert.equal(coordinator.mode(),'failback-legacy-1.0');
  assert.equal(closed,1);
  coordinator.destroy();
});

test('destroy invalidates pending async catalog session', async () => {
  let release;
  let closed=0;
  const gate = new Promise(resolve => {release=resolve;});
  const coordinator=fixture(async () => {
    await gate;
    return {frozenHead:'certified-head-2026',close(){closed++;}};
  });
  const activating=coordinator.activate20();
  await new Promise(resolve => setImmediate(resolve));
  coordinator.destroy();
  release();
  assert.equal((await activating).ok,false);
  assert.equal(closed,1);
});

test('late conflict callback from replaced session cannot cancel current writer', async () => {
  const callbacks=[];
  const coordinator=fixture(async ({onWriterConflict}) => {
    callbacks.push(onWriterConflict);
    return {frozenHead:'certified-head-2026',close(){}};
  });
  assert.equal((await coordinator.activate20()).ok,true);
  assert.equal((await coordinator.activate20()).ok,true);
  callbacks[0]();
  assert.equal(coordinator.mode(),'active-2.0');
  callbacks[1]();
  assert.equal(coordinator.mode(),'failback-legacy-1.0');
  coordinator.destroy();
});

test('legacy is blocked while commercial IDB intent is still asynchronously committing', async () => {
  let release;
  const pending = new Promise(resolve=>{release=resolve;});
  const store={loadAll:async()=>[],loadCommittedOpIds:async()=>[],save:async()=>{},remove:async()=>{}};
  const reconciler={ready:async()=>true,pending:()=>[],quarantined:()=>[],
    submit:async()=>pending,reconcileNow:async()=>({attempted:0,results:[]})};
  const coordinator=createVerifiedCrossDeviceFailbackCoordinator({
    store,reconciler,openCatalogSession:async()=>({frozenHead:'certified-head-2026',close(){}})
  });
  assert.equal((await coordinator.activate20()).ok,true);
  const opId='sale_race_12345678';
  const sending=coordinator.submitCommercial({opId});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await coordinator.canDispatchOnLegacy(opId),false);
  await coordinator.failbackToLegacy('network-outage');
  assert.equal(await coordinator.canDispatchOnLegacy(opId),false);
  release({committed:false,fallbackLegacy:true,reconcileRequired:false,stage:'ticket-unavailable'});
  assert.equal((await sending).fallbackLegacy,true);
  assert.equal(await coordinator.canDispatchOnLegacy(opId),true,
    'definitive pre-send failure with durable removal permits legacy once unlocked');
  coordinator.destroy();
});

test('a settled same-DO opId cannot be unlatched by a subsequent pre-send denial', async () => {
  const opId='sale_settled_123456';
  const store={loadAll:async()=>[],loadCommittedOpIds:async()=>[opId],
    save:async()=>{},remove:async()=>{}};
  const reconciler={ready:async()=>true,pending:()=>[],quarantined:()=>[],
    submit:async()=>({committed:false,fallbackLegacy:true,reconcileRequired:false,stage:'ticket-unavailable'}),
    reconcileNow:async()=>({attempted:0,results:[]})};
  const coordinator=createVerifiedCrossDeviceFailbackCoordinator({
    store,reconciler,openCatalogSession:async()=>({frozenHead:'certified-head-2026',close(){}})
  });
  assert.equal((await coordinator.activate20()).ok,true);
  const outcome=await coordinator.submitCommercial({opId});
  assert.equal(outcome.fallbackLegacy,false);
  assert.equal(outcome.retryTarget,'same-do-only');
  assert.equal(await coordinator.canDispatchOnLegacy(opId),false);
  coordinator.destroy();
});
