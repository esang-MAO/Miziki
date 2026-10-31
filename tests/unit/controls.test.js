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
      toggle(c, on){ if(on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); },
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
  namedExports: { openPlayerViaSheet(){}, wakeEveningGlance(){} },
});
// CEREMONY PR 3: player/queue.js and shell/start-sequence.js import
// shell/runout.js, whose real chain reaches library/view.js — stop it here.
// docs/15_SURFACE_NOISE.md §4: nextTrack()/prevTrack() now import
// performPendingFlip too, for the Auto-flip-Off waiting case.
const performPendingFlipMock = mock.fn();
mock.module(new URL('../../src/shell/runout.js', import.meta.url).href, {
  namedExports: {
    endOfQueue(){}, maybeSideFlip(){ return false; }, cancelRunout(){}, interruptRunout(){ return false; },
    clearToRest(){}, performPendingFlip: performPendingFlipMock, stopAtRecordEndCeremony(){},
  },
});
mock.module(new URL('../../src/shell/put-away.js', import.meta.url).href, {
  namedExports: { shouldPutAway(){ return false; }, putAwayInstant(){}, runPutAwaySequence(){} },
});
const playMock = mock.fn();
const pauseMock = mock.fn();
const seekMock = mock.fn();
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { load(){}, play: playMock, pause: pauseMock, pauseAndRest(){}, seek: seekMock, stop(){}, sideLetterFor(){ return ''; }, cancelPendingGapless(){}, handleContextInterruption(){} },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { drawTime(){}, drawSun(){}, updateFocusStatusLine(){} },
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

const { nextTrack, prevTrack, toggleShuffle, cycleRepeat } = await import('../../src/player/controls.js');
const { setMode } = await import('../../src/audio/mode.js');
const { computeRate } = await import('../../src/sundown/solar.js');
const { S } = await import('../../src/state.js');

function resetState(overrides){
  Object.assign(S, {
    tracks: [{ id: 't1', tags: {}, duration: 100 }],
    index: 0, playing: false, pos: 0,
    baseQueue: [0], queue: [0], qpos: 0, shuffle: false, repeat: 'off',
    mode: 'vinyl', source: null, nodes: null, auto: false, target: 1,
    runout: null,
  }, overrides);
  playMock.mock.resetCalls(); pauseMock.mock.resetCalls(); seekMock.mock.resetCalls();
  performPendingFlipMock.mock.resetCalls();
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
//
// AU2 (docs/16_AUDIO.md §2.2): a real mode switch with something playing
// is now a dip, not an instant reconnect — fade out, reroute, fade in —
// so the actual routeSource() call lands MODE_DIP_MS later on a setTimeout,
// not synchronously inside setMode() itself. mock.timers (the same API
// tests/unit/backup-sync.test.js already uses) flushes exactly that delay.
// S.ctx stays unset throughout, same as before AU2: applyCharacter()'s own
// `!S.ctx` guard (audio/engine.js) and fadeMusicTo()'s matching guard
// (audio/surface-noise.js) both no-op harmlessly with no real context, so
// these tests can stay focused on the routing itself.
test('setMode switches routing: pure connects to master, vinyl connects to pad', () => {
  resetState();
  // AU3 (docs/16_AUDIO.md §2.3): the Vinyl path now enters through a
  // -3dB pad in front of wobble — routeSource() connects trackGain to
  // S.nodes.pad for Vinyl, not straight to S.nodes.wobble.
  const masterConnect = mock.fn(), padConnect = mock.fn();
  S.nodes = {
    master: { connect: masterConnect },
    pad: { connect: padConnect },
    trackGain: { disconnect: mock.fn(), connect(target){
      if(target === S.nodes.master) masterConnect();
      else if(target === S.nodes.pad) padConnect();
    } },
  };
  S.source = { disconnect: mock.fn(), connect(){ return S.nodes.trackGain; } };
  mock.timers.enable({ apis: ['setTimeout'] });
  try{
    setMode('pure');
    assert.equal(S.mode, 'pure');
    mock.timers.tick(15);
    assert.equal(masterConnect.mock.calls.length, 1);
    assert.equal(padConnect.mock.calls.length, 0);
    setMode('vinyl');
    assert.equal(S.mode, 'vinyl');
    mock.timers.tick(15);
    assert.equal(padConnect.mock.calls.length, 1);
  }finally{ mock.timers.reset(); }
});

// The very first mode set at boot (nothing playing yet, S.source null)
// still routes immediately — there's no live source to dip, and nothing
// should wait on a timer just to reflect the saved/default mode.
test('setMode with nothing playing routes immediately, no dip', () => {
  resetState({ mode: 'pure' });
  const padConnect = mock.fn();
  S.nodes = {
    master: { connect: mock.fn() },
    pad: { connect: padConnect },
    trackGain: { disconnect: mock.fn(), connect(target){
      if(target === S.nodes.pad) padConnect();
    } },
  };
  S.source = null;
  setMode('vinyl');
  assert.equal(S.mode, 'vinyl');
  // nothing to route (no S.source) -- routeSource() is never called, dip or not
  assert.equal(padConnect.mock.calls.length, 0);
});

// docs/15_SURFACE_NOISE.md §4: with the record waiting in the run-out for a
// flip (Auto-flip Off), Next/Previous (including the lock-screen/
// headphone/car controls, which call these same two functions) perform the
// flip instead of skipping — there's no "next"/"previous" track to lift to
// yet, since side B hasn't loaded.
test('nextTrack performs the pending flip instead of skipping, while the record is waiting', () => {
  resetState({ runout: { kind: 'wait', n: 1, to: 'B' } });
  nextTrack();
  assert.equal(performPendingFlipMock.mock.calls.length, 1);
  assert.equal(playMock.mock.calls.length, 0);
  assert.equal(pauseMock.mock.calls.length, 0);
});

test('prevTrack performs the same pending flip while waiting', () => {
  resetState({ runout: { kind: 'wait', n: 1, to: 'B' }, pos: 10 });
  prevTrack();
  assert.equal(performPendingFlipMock.mock.calls.length, 1);
});

test('nextTrack/prevTrack never touch performPendingFlip once nothing is waiting', () => {
  resetState({ runout: null });
  nextTrack();
  resetState({ runout: {kind:'end'} });
  prevTrack();
  assert.equal(performPendingFlipMock.mock.calls.length, 0);
});

test('setMode leaves the F1 Pure-rate rule intact: computeRate() is always 1 in Pure', () => {
  resetState({ auto: true, target: 0.85 });
  setMode('pure');
  assert.equal(computeRate(), 1);
  setMode('vinyl');
  S.auto = false; S.manualRate = 0.9;
  assert.equal(computeRate(), 0.9);   // Vinyl still follows the manual rate, unchanged by this move
});
