import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// controls.js (nextTrack/prevTrack/toggleShuffle/cycleRepeat) imports real
// $/el, seek (transport.js), advance/reorderQueue (player/queue.js) and
// invalidateActiveSessionIfAny (history/sessions.js) — no main.js import at
// all (step 6c). mode.js (setMode) imports real $ and routeSource
// (audio/engine.js) — also no main.js import. Loading queue.js/engine.js
// for real, though, pulls in the same wide chains queue.test.js/
// engine.test.js already stop at the door: queue.js's own temporary
// circular import of five screen/ceremony functions from main.js (rule 8),
// and engine.js's real player/background.js import (applyOutputRoute,
// since step 6c) plus its player/transport.js (stop) and sundown/
// location.js -> player/clock.js (drawSun) chain. history/sessions.js is
// mocked directly too, the same "stop the chain at the door" reasoning —
// its own real imports (record-art/looks.js, library/thumbs.js) reach
// library/edit.js and, through that, library/sealed.js/credits.js, each
// still circularly importing main.js.
// Since this step, controls.js's real nextTrack/prevTrack route through
// queue.js's skipWithLift(), which imports REDUCED from util/motion.js --
// read once, at module load, from window.matchMedia (same stub shape as
// queue.test.js's own window stub).
globalThis.window = { matchMedia(){ return { matches: false }; } };

const elCache = new Map();
function fakeEl(){
  const classes = new Set();
  return {
    textContent: '', style: {}, title: '', dataset: {},
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
    },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, appendChild(child){ return child; },
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ if(!elCache.has(sel)) elCache.set(sel, fakeEl()); return elCache.get(sel); },
    el(tag, cls, text){ const e = fakeEl(); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; },
  },
});
// RF15 (docs/12_REFINE.md): setMode() also toggles a 'mode-pure' class on
// documentElement (for the platter label's Pure-mode flatten) alongside
// its existing --accent custom-property write.
globalThis.document = { documentElement: { style: { setProperty(){} }, classList: { toggle(){} } } };

mock.module(new URL('../../src/history/sessions.js', import.meta.url).href, {
  namedExports: { invalidateActiveSessionIfAny(){} },
});
mock.module(new URL('../../src/main.js', import.meta.url).href, {
  namedExports: { queueSave(){} },
});
// Since step 7b, the five screen/ceremony functions queue.js used to reach
// through main.js (above) moved into real src/shell/ modules — mocked
// directly here, same "stop the chain at the door" reasoning: letting
// shell/start-sequence.js load for real would reach library/sealed.js's
// own circular import of main.js's renderTracks/updateSealedSheetAfterBreak.
mock.module(new URL('../../src/shell/start-sequence.js', import.meta.url).href, {
  namedExports: { runStartSequence(){} },
});
mock.module(new URL('../../src/shell/player-overlay.js', import.meta.url).href, {
  namedExports: { openPlayerViaSheet(){} },
});
// CEREMONY PR 3: player/queue.js and shell/start-sequence.js import
// shell/runout.js, whose real chain reaches library/view.js — stop it here.
mock.module(new URL('../../src/shell/runout.js', import.meta.url).href, {
  namedExports: { endOfQueue(){}, maybeSideFlip(){ return false; }, cancelRunout(){}, interruptRunout(){ return false; }, clearToRest(){} },
});
mock.module(new URL('../../src/shell/put-away.js', import.meta.url).href, {
  namedExports: { shouldPutAway(){ return false; }, putAwayInstant(){}, runPutAwaySequence(){} },
});
const playMock = mock.fn();
const pauseMock = mock.fn();
const seekMock = mock.fn();
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { load(){}, play: playMock, pause: pauseMock, seek: seekMock, stop(){}, sideLetterFor(){ return ''; } },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { drawTime(){}, drawSun(){} },
});
mock.module(new URL('../../src/player/sleep-timer.js', import.meta.url).href, {
  namedExports: { sleepStopPlayback(){} },
});
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote(){} },
});
mock.module(new URL('../../src/player/background.js', import.meta.url).href, {
  namedExports: { applyOutputRoute(){} },
});
// Since step 7a, sundown/location.js's own queueSave import is real (from
// storage/meta.js, which real-chains into audio/mode.js/player/controls.js/
// player/background.js for its own applyPrefs() helpers) instead of
// main.js — mocked directly here, same "stop the chain at the door"
// reasoning as every other mock in this file, since queue.js's real
// buffers.js->engine.js->location.js import chain would otherwise reach it.
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave(){} },
});

const { toggleShuffle, cycleRepeat } = await import('../../src/player/controls.js');
const { setMode } = await import('../../src/audio/mode.js');
const { computeRate } = await import('../../src/sundown/solar.js');
const { S } = await import('../../src/state.js');

function resetState(overrides){
  Object.assign(S, {
    tracks: [{ id: 't1', tags: {}, duration: 100 }],
    index: 0, playing: false, pos: 0,
    baseQueue: [0], queue: [0], qpos: 0, shuffle: false, repeat: 'off',
    mode: 'vinyl', source: null, nodes: null, auto: false, target: 1,
  }, overrides);
  playMock.mock.resetCalls(); pauseMock.mock.resetCalls(); seekMock.mock.resetCalls();
  elCache.clear();
}

test('cycleRepeat goes off -> all -> one -> off', () => {
  resetState({ repeat: 'off' });
  cycleRepeat();
  assert.equal(S.repeat, 'all');
  cycleRepeat();
  assert.equal(S.repeat, 'one');
  cycleRepeat();
  assert.equal(S.repeat, 'off');
});

test('toggleShuffle keeps the current track playing and its position stable', () => {
  resetState({ playing: true, pos: 42, index: 0, shuffle: false });
  toggleShuffle();
  assert.equal(S.shuffle, true);
  assert.equal(S.playing, true);
  assert.equal(S.pos, 42);
  assert.equal(S.index, 0);
  assert.equal(playMock.mock.calls.length, 0);
  assert.equal(pauseMock.mock.calls.length, 0);
  assert.equal(seekMock.mock.calls.length, 0);
});

test('toggleShuffle back off also leaves playback untouched', () => {
  resetState({ playing: true, pos: 17, shuffle: true });
  toggleShuffle();
  assert.equal(S.shuffle, false);
  assert.equal(S.playing, true);
  assert.equal(S.pos, 17);
  assert.equal(playMock.mock.calls.length, 0);
  assert.equal(pauseMock.mock.calls.length, 0);
});

// docs/15_SURFACE_NOISE.md §3: src now routes through a dedicated
// trackGain node first (engine.js's routeSource()), not straight to
// wobble/master — see that file's own entry for why.
test('setMode switches routing: pure connects to master, vinyl connects to wobble', () => {
  resetState();
  const masterConnect = mock.fn(), wobbleConnect = mock.fn();
  S.nodes = {
    master: { connect: masterConnect },
    wobble: { connect: wobbleConnect },
    trackGain: { disconnect: mock.fn(), connect(target){
      if(target === S.nodes.master) masterConnect();
      else if(target === S.nodes.wobble) wobbleConnect();
    } },
  };
  S.source = { disconnect: mock.fn(), connect(){ return S.nodes.trackGain; } };
  setMode('pure');
  assert.equal(S.mode, 'pure');
  assert.equal(masterConnect.mock.calls.length, 1);
  assert.equal(wobbleConnect.mock.calls.length, 0);
  setMode('vinyl');
  assert.equal(S.mode, 'vinyl');
  assert.equal(wobbleConnect.mock.calls.length, 1);
});

test('setMode leaves the F1 Pure-rate rule intact: computeRate() is always 1 in Pure', () => {
  resetState({ auto: true, target: 0.85 });
  setMode('pure');
  assert.equal(computeRate(), 1);
  setMode('vinyl');
  S.auto = false; S.manualRate = 0.9;
  assert.equal(computeRate(), 0.9);   // Vinyl still follows the manual rate, unchanged by this move
});
