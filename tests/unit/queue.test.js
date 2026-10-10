import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// queue.js has temporary circular imports back to main.js (rule 8 in
// CLAUDE.md) for session/screen functions not yet extracted, plus real
// circular imports with transport.js (load/play/pause/seek) — the same
// shape already established between engine.js and transport.js. main.js
// has DOM-dependent top-level code that needs a browser, and transport.js
// itself still imports ~15 functions from main.js, so both are mocked
// directly here rather than loading their real dependency chains — same
// approach as engine.test.js and clock.test.js.
mock.module(new URL('../../src/main.js', import.meta.url).href, {
  namedExports: {
    invalidateActiveSessionIfAny(){}, runStartSequence(){}, openPlayerViaSheet(){},
    shouldPutAway(){ return false; }, putAwayInstant(){}, runPutAwaySequence(){},
  },
});
const loadMock = mock.fn();
const playMock = mock.fn();
const pauseMock = mock.fn();
const seekMock = mock.fn();
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { load: loadMock, play: playMock, pause: pauseMock, seek: seekMock },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { drawTime(){} },
});
mock.module(new URL('../../src/player/sleep-timer.js', import.meta.url).href, {
  namedExports: { sleepStopPlayback(){} },
});
// buffers.js's own real imports — mocked the same way for the same reason
// (engine.js has a real, non-circular import of main.js/transport.js too).
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { ensureContext(){} },
});
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote(){} },
});

const { buildOrder, setQueue, reorderQueue, advance } = await import('../../src/player/queue.js');
const { ensureBuffer, touchLRU } = await import('../../src/player/buffers.js');
const { S } = await import('../../src/state.js');

function resetState(overrides){
  Object.assign(S, {
    tracks: [], index: -1, playing: false, pos: 0,
    baseQueue: [], queue: [], qpos: 0, shuffle: false, repeat: 'off',
    sleep: { mode: null }, lru: [], playerOpen: false,
    pendingShellInfo: null, sleevePullEnabled: true,
  }, overrides);
  loadMock.mock.resetCalls(); playMock.mock.resetCalls();
  pauseMock.mock.resetCalls(); seekMock.mock.resetCalls();
}

test('buildOrder with no "first" shuffles the whole base queue, keeping every index exactly once', () => {
  resetState({ baseQueue: [0,1,2,3,4] });
  buildOrder();
  assert.deepEqual(S.queue.slice().sort((a,b)=>a-b), [0,1,2,3,4]);
});

test('buildOrder with a "first" puts it at the front, shuffling the rest', () => {
  resetState({ baseQueue: [0,1,2,3,4] });
  buildOrder(2);
  assert.equal(S.queue[0], 2);
  assert.deepEqual(S.queue.slice().sort((a,b)=>a-b), [0,1,2,3,4]);
});

test('reorderQueue with shuffle off keeps the base queue order', () => {
  resetState({ baseQueue: [3,1,4,0,2], index: 4, shuffle: false });
  reorderQueue();
  assert.deepEqual(S.queue, [3,1,4,0,2]);
  assert.equal(S.qpos, S.queue.indexOf(4));
});

test('reorderQueue with shuffle on keeps the current track first and every track exactly once', () => {
  resetState({ baseQueue: [0,1,2,3,4], index: 3, shuffle: true });
  reorderQueue();
  assert.equal(S.queue[0], 3);
  assert.deepEqual(S.queue.slice().sort((a,b)=>a-b), [0,1,2,3,4]);
  assert.equal(S.qpos, 0);
});

function fakeTrack(){ return { tags: {}, meta: {} }; }

test('advance: repeat off stops at the end of the queue without wrapping', () => {
  resetState({ tracks: [fakeTrack(), fakeTrack()], queue: [0,1], qpos: 1, repeat: 'off', playing: true });
  advance(1, true);
  assert.equal(S.qpos, 1); // unchanged -- end of the record, no wraparound
  assert.equal(pauseMock.mock.calls.length, 1);
});

test('advance: repeat all wraps back to the first track in the queue', () => {
  resetState({ tracks: [fakeTrack(), fakeTrack(), fakeTrack()], queue: [0,1,2], qpos: 2, repeat: 'all', shuffle: false });
  advance(1, true);
  assert.equal(S.qpos, 0);
});

test('advance: repeat one restarts the current track instead of moving the queue position', () => {
  resetState({ tracks: [fakeTrack()], queue: [0], qpos: 0, repeat: 'one', playing: true, pos: 42 });
  advance(1, true);
  assert.equal(S.qpos, 0); // position in the queue never changes for repeat-one
  assert.deepEqual(seekMock.mock.calls[0].arguments, [0]);
  assert.equal(playMock.mock.calls.length, 0); // already playing, so play() is not called again
});

test('advance: repeat one calls play() if playback had stopped', () => {
  resetState({ tracks: [fakeTrack()], queue: [0], qpos: 0, repeat: 'one', playing: false });
  advance(1, true);
  assert.equal(playMock.mock.calls.length, 1);
});

test('advance: a manual skip (auto=false) past the end still does not wrap under repeat off', () => {
  resetState({ tracks: [fakeTrack(), fakeTrack()], queue: [0,1], qpos: 1, repeat: 'off' });
  advance(1, false);
  assert.equal(S.qpos, 1);
});

test('ensureBuffer/touchLRU: keeps at most 3 decoded tracks, evicting the least recently used', async () => {
  const mkTrack = () => ({ tags: { title: 't' }, meta: {}, blob: { arrayBuffer: async () => new ArrayBuffer(0) } });
  resetState({
    tracks: [mkTrack(), mkTrack(), mkTrack(), mkTrack()],
    index: 1,   // track 1 is "playing" -- distinct from whichever ends up least recently used
    lru: [],
  });
  S.ctx = { decodeAudioData: async () => ({ duration: 10 }) };

  await ensureBuffer(0);
  await ensureBuffer(1);
  await ensureBuffer(2);
  assert.ok(S.tracks[0].buffer && S.tracks[1].buffer && S.tracks[2].buffer);

  // decoding a 4th evicts the least recently used (track 0, touched first and
  // never touched again), which is not the playing track
  await ensureBuffer(3);
  assert.equal(S.tracks[0].buffer, null);
  assert.ok(S.tracks[1].buffer && S.tracks[2].buffer && S.tracks[3].buffer);
});

test('touchLRU evicts the least recently used track once over the cap of 3', () => {
  const mkTrack = () => ({ buffer: {} });
  resetState({ tracks: [mkTrack(), mkTrack(), mkTrack(), mkTrack()], index: 1, lru: [0,1,2] });
  // lru is most-recent-first: 0 was touched most recently, 2 least recently.
  // touching 3 pushes it to 4 entries -- over the cap -- and drops the one
  // that ends up at the back: 2 (not the playing track, index 1).
  touchLRU(3);
  assert.equal(S.tracks[2].buffer, null);
  assert.ok(S.tracks[0].buffer && S.tracks[1].buffer && S.tracks[3].buffer);
});

test('touchLRU keeps the playing track decoded even when it is the one that would be evicted', () => {
  const mkTrack = () => ({ buffer: {} });
  resetState({ tracks: [mkTrack(), mkTrack(), mkTrack(), mkTrack()], index: 2, lru: [0,1,2] });
  // same shape as above, but this time the track that would be dropped (2)
  // is also S.index -- the one currently playing -- so its buffer survives.
  touchLRU(3);
  assert.ok(S.tracks[2].buffer !== null);
});
