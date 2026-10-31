import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { DB } from '../../src/storage/idb.js';

// src/player/resume.js's restoreResume() calls player/queue.js's real
// setQueue(), which would otherwise pull in its own very wide chain
// (shell/start-sequence.js, shell/player-overlay.js, shell/runout.js,
// shell/nav-stack.js, audio/surface-noise.js, and player/transport.js
// itself) — none of which this file's own save/restore logic touches.
// Mocked directly, the same "stop the chain at the door" reasoning every
// other mock-heavy file in this suite already uses. setQueue is recorded
// (not a no-op) so tests can assert what AU1's own restore path handed it.
let setQueueCalls = [];
mock.module(new URL('../../src/player/queue.js', import.meta.url).href, {
  namedExports: { setQueue(...args){ setQueueCalls.push(args); } },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { drawTime(){}, updateFocusStatusLine(){} },
});

const { saveResumeNow, restoreResume, autosaveResumeTick } = await import('../../src/player/resume.js');
const { S } = await import('../../src/state.js');

function freshIndexedDB(){
  const factory = new IDBFactory();
  globalThis.indexedDB = factory;
  return factory;
}
function resetDB(){ DB.db = null; DB.ok = false; }
async function openFresh(){
  freshIndexedDB();
  resetDB();
  const { storage } = await import('../../src/storage/repo.js');
  await storage.open();
}

function fakeTrack(id, overrides){
  return Object.assign({ id, addedAt: 0, tags: { title: id, artist: 'A', album: 'Al' } }, overrides);
}

function resetState(overrides){
  setQueueCalls = [];
  Object.assign(S, {
    tracks: [], index: -1, pos: 0, playing: false, qpos: 0, baseQueue: [], queue: [],
    resumePending: false,
  }, overrides);
}

test('saveResumeNow()/restoreResume() round trip: queue, current track and position survive by id', async () => {
  await openFresh();
  resetState({
    tracks: [fakeTrack('t1'), fakeTrack('t2'), fakeTrack('t3')],
    baseQueue: [0, 1, 2], queue: [0, 2, 1], qpos: 1, index: 2, pos: 42.5,
  });
  saveResumeNow();
  await new Promise(r => setTimeout(r, 20));

  // a fresh "session" — same tracks, same ids, but indices could differ
  resetState({ tracks: [fakeTrack('t1'), fakeTrack('t2'), fakeTrack('t3')] });
  const ok = await restoreResume();
  assert.equal(ok, true);
  assert.equal(setQueueCalls.length, 1);
  assert.deepEqual(setQueueCalls[0][0], [0, 1, 2]);   // baseQueue, by index
  assert.equal(setQueueCalls[0][2], false);            // never autoplay
  assert.deepEqual(S.queue, [0, 2, 1]);                // exact saved order, not reshuffled
  assert.equal(S.qpos, 1);
  assert.equal(S.pos, 42.5);
  assert.equal(S.resumePending, true);

  DB.db.close();
});

test('restoreResume(): a deleted current track lands on the next surviving one in the queue, at 0:00', async () => {
  await openFresh();
  resetState({
    tracks: [fakeTrack('t1'), fakeTrack('t2'), fakeTrack('t3')],
    baseQueue: [0, 1, 2], queue: [0, 1, 2], qpos: 1, index: 1, pos: 77,
  });
  saveResumeNow();
  await new Promise(r => setTimeout(r, 20));

  // t2 (the saved current track) is gone now
  resetState({ tracks: [fakeTrack('t1'), fakeTrack('t3')] });
  const ok = await restoreResume();
  assert.equal(ok, true);
  assert.deepEqual(S.queue, [0, 1]);   // t1, t3 — by their new indices
  assert.equal(S.qpos, 1);             // lands on t3, which took t2's slot
  assert.equal(S.pos, 0);              // "restore the next one at 0:00"

  DB.db.close();
});

test('restoreResume(): every queued track gone falls back to nothing restored', async () => {
  await openFresh();
  resetState({
    tracks: [fakeTrack('t1')],
    baseQueue: [0], queue: [0], qpos: 0, index: 0, pos: 10,
  });
  saveResumeNow();
  await new Promise(r => setTimeout(r, 20));

  resetState({ tracks: [fakeTrack('t9')] });   // nothing left of the saved library
  const ok = await restoreResume();
  assert.equal(ok, false);
  assert.equal(setQueueCalls.length, 0);

  DB.db.close();
});

test('restoreResume(): nothing saved at all resolves to false', async () => {
  await openFresh();
  resetState({ tracks: [fakeTrack('t1')] });
  const ok = await restoreResume();
  assert.equal(ok, false);
  DB.db.close();
});

test('saveResumeNow(): no-ops with nothing currently loaded', async () => {
  await openFresh();
  resetState({ tracks: [fakeTrack('t1')], index: -1 });
  saveResumeNow();   // should not throw, and leaves nothing to restore
  await new Promise(r => setTimeout(r, 20));
  const ok = await restoreResume();
  assert.equal(ok, false);
  DB.db.close();
});

test('autosaveResumeTick(): throttles to about once every 5s, and only while playing', async () => {
  await openFresh();
  resetState({
    tracks: [fakeTrack('t1')], baseQueue: [0], queue: [0], qpos: 0, index: 0, pos: 1, playing: true,
  });
  autosaveResumeTick(1000);
  await new Promise(r => setTimeout(r, 20));
  let saved = await (await import('../../src/storage/repo.js')).meta.get('resume');
  assert.ok(saved, 'first tick while playing saves');

  resetState({
    tracks: [fakeTrack('t1')], baseQueue: [0], queue: [0], qpos: 0, index: 0, pos: 999, playing: true,
  });
  autosaveResumeTick(1500);   // well under 5000ms since the last save — throttled
  await new Promise(r => setTimeout(r, 20));
  saved = await (await import('../../src/storage/repo.js')).meta.get('resume');
  assert.equal(saved.pos, 1, 'throttled tick did not overwrite the earlier save');

  autosaveResumeTick(6600);   // past the 5000ms window
  await new Promise(r => setTimeout(r, 20));
  saved = await (await import('../../src/storage/repo.js')).meta.get('resume');
  assert.equal(saved.pos, 999, 'a tick past the throttle window saves again');

  resetState({ tracks: [fakeTrack('t1')], baseQueue: [0], queue: [0], qpos: 0, index: 0, pos: 1234, playing: false });
  autosaveResumeTick(20000);
  await new Promise(r => setTimeout(r, 20));
  saved = await (await import('../../src/storage/repo.js')).meta.get('resume');
  assert.equal(saved.pos, 999, 'never saves while paused');

  DB.db.close();
});
