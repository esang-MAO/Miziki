// RW4 (docs/23_RHYTHM_AND_WEAR.md): "Tests for the final-state selection
// (queue end vs. RW3 stop vs. nothing played)." This file covers the
// synchronous "early exit" path of endOfQueue()/stopAtRecordEndCeremony()
// -- Pure, the setting off, the player closed, or the page hidden skip
// the run-out/put-away animation entirely and land on the final state
// immediately, so it needs no sleep()/timer handling to test. The
// animated path (the groove, the ceremony's own timers) is integration
// territory, same as the rest of shell/runout.js's state machine (no
// existing unit coverage before this PR either) -- verified instead by
// build + Playwright per the PR description.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { matchMedia(){ return { matches: false }; } };
globalThis.document = { hidden: false };

const elCache = new Map();
function fakeEl(){
  const classes = new Set();
  return {
    textContent: '', style: {}, src: '', alt: '',
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
      toggle(c, on){ if(on === undefined) on = !classes.has(c); if(on) classes.add(c); else classes.delete(c); return on; },
    },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, appendChild(child){ return child; }, offsetWidth: 0,
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ if(!elCache.has(sel)) elCache.set(sel, fakeEl()); return elCache.get(sel); },
    el(){ return fakeEl(); },
  },
});

const loadMock = mock.fn();
const playMock = mock.fn();
const pauseMock = mock.fn();
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { load: loadMock, play: playMock, pause: pauseMock },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { drawTime(){} },
});
mock.module(new URL('../../src/player/sleep-timer.js', import.meta.url).href, {
  namedExports: { stopSleepState(){} },
});
mock.module(new URL('../../src/audio/runout.js', import.meta.url).href, {
  namedExports: { startRunout(){ return { stop(){} }; } },
});
mock.module(new URL('../../src/audio/surface-noise.js', import.meta.url).href, {
  namedExports: {
    releaseSeed(){ return 0; }, noiseFloorScale(){ return 0; }, surfaceNoiseActive(){ return false; },
    startRunoutNoise(){ return { stop(){} }; }, playNeedleLift(){},
  },
});
mock.module(new URL('../../src/record-art/looks.js', import.meta.url).href, {
  namedExports: { applyDiscVariant(){} },
});
mock.module(new URL('../../src/record-art/etchings.js', import.meta.url).href, {
  namedExports: { applyDeadWaxEtching(){} },
});
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: { renderTracks(){} },
});
mock.module(new URL('../../src/gatefold/view.js', import.meta.url).href, {
  namedExports: { updateGatefoldNowPlaying(){} },
});
mock.module(new URL('../../src/shell/mini-player.js', import.meta.url).href, {
  namedExports: { renderMiniPlayer(){} },
});
mock.module(new URL('../../src/shell/player-side-panel.js', import.meta.url).href, {
  namedExports: { renderPlayerSidePanel(){} },
});
mock.module(new URL('../../src/shell/nav-stack.js', import.meta.url).href, {
  namedExports: { forceCloseLayer(){} },
});
const putAwayInstantMock = mock.fn();
let shouldPutAwayReturn = false;
mock.module(new URL('../../src/shell/put-away.js', import.meta.url).href, {
  namedExports: {
    shouldPutAway(){ return shouldPutAwayReturn; },
    putAwayInstant: putAwayInstantMock,
    runPutAwaySequence(){ return Promise.resolve(); },
    startSpinDown(){}, clearSpinDown(){},
  },
});
mock.module(new URL('../../src/shell/start-sequence.js', import.meta.url).href, {
  namedExports: { sleeveArtFor(){} },
});
const paintRestingCardMock = mock.fn();
mock.module(new URL('../../src/player/queue.js', import.meta.url).href, {
  namedExports: { paintRestingCard: paintRestingCardMock },
});

const { endOfQueue, stopAtRecordEndCeremony, clearToRest } = await import('../../src/shell/runout.js');
const { S } = await import('../../src/state.js');

function fakeTrack(album, side){
  return { tags: { title: 't', artist: 'a', album }, meta: {}, side, art: null };
}

function resetState(overrides){
  Object.assign(S, {
    tracks: [], index: -1, playing: false, pos: 0, queue: [], qpos: 0,
    playerOpen: true, resting: null, platterEmpty: false, sleeveSeq: 0, runout: null,
    sleevePullEnabled: true, mode: 'vinyl',
  }, overrides);
  globalThis.document.hidden = false;
  shouldPutAwayReturn = false;   // early-exit by default -- these tests target that path
  loadMock.mock.resetCalls(); playMock.mock.resetCalls(); pauseMock.mock.resetCalls();
  putAwayInstantMock.mock.resetCalls(); paintRestingCardMock.mock.resetCalls();
  elCache.clear();
}

test('endOfQueue: a real finish lands on the held sleeve, not the empty slipmat', async () => {
  resetState({ tracks: [fakeTrack('X','A')], queue: [0], qpos: 0, index: 0 });
  await endOfQueue(true);
  assert.equal(putAwayInstantMock.mock.calls.length, 0);   // never clears to empty
  assert.equal(S.resting.reason, 'queueEnd');
  assert.equal(S.resting.pendingIndex, null);
  assert.equal(typeof S.resting.endedAt, 'number');
  assert.equal(S.platterEmpty, false);
  assert.equal(paintRestingCardMock.mock.calls.length, 1);
});

test('endOfQueue: a manual skip (auto=false) does nothing', async () => {
  resetState({ tracks: [fakeTrack('X','A')], queue: [0], qpos: 0, index: 0 });
  await endOfQueue(false);
  assert.equal(S.resting, null);
  assert.equal(paintRestingCardMock.mock.calls.length, 0);
});

test('endOfQueue: nothing currently loaded falls back to the genuinely-empty clearToRest() path', async () => {
  resetState({ tracks: [], queue: [], qpos: 0, index: -1 });
  await endOfQueue(true);
  assert.equal(putAwayInstantMock.mock.calls.length, 1);
  assert.equal(S.resting, null);
  assert.equal(S.index, -1);   // clearToRest()'s own doing, not a side effect of holdSleeve
});

test('stopAtRecordEndCeremony: This record only lands on the held sleeve with the queue intact', async () => {
  resetState({ tracks: [fakeTrack('X','A'), fakeTrack('Y','A')], queue: [0,1], qpos: 0, index: 0 });
  await stopAtRecordEndCeremony('recordOnly', 1);
  assert.equal(S.resting.reason, 'recordOnly');
  assert.equal(S.resting.pendingIndex, 1);
  assert.deepEqual(S.queue, [0,1]);   // untouched -- holding, not clearing
  assert.equal(S.qpos, 0);
});

test('stopAtRecordEndCeremony: Stop between records (sunset) lands on the held sleeve with its own reason', async () => {
  resetState({ tracks: [fakeTrack('X','A'), fakeTrack('Y','A')], queue: [0,1], qpos: 0, index: 0 });
  await stopAtRecordEndCeremony('sunset', 1);
  assert.equal(S.resting.reason, 'sunset');
  assert.equal(S.resting.pendingIndex, 1);
});

// clearToRest() itself is otherwise untouched by this PR -- a quick smoke
// test that it still reaches the genuinely-empty final state (CEREMONY §2,
// RW4 item 2's "the empty slipmat stays for the genuinely empty case").
test('clearToRest: still reaches the plain empty-slipmat final state', () => {
  resetState({ tracks: [fakeTrack('X','A')], queue: [0], qpos: 0, index: 0 });
  clearToRest();
  assert.equal(S.index, -1);
  assert.equal(S.queue.length, 0);
  assert.equal(S.platterEmpty, true);
});
