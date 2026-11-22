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
