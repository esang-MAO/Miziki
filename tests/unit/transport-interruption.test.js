import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// PL4 (docs/19_PLAYER.md, "interruptions and coming back"): the first test
// to load the real src/player/transport.js directly, rather than mocking
// it the way every other test file in this suite does (clock.test.js,
// queue.test.js, background-offer.test.js, controls.test.js...) --
// handleContextInterruption()/play()'s own resume path are transport.js's
// own logic, so this file mocks transport.js's direct imports instead,
// the mirror image of the "stop the chain at the door" approach those
// other files already use.
const elCache = new Map();
function fakeEl(){
  return {
    textContent: '', style: {}, src: '',
    classList: { add(){}, remove(){}, contains(){ return false; } },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: { $(sel){ if(!elCache.has(sel)) elCache.set(sel, fakeEl()); return elCache.get(sel); } },
});
mock.module(new URL('../../src/record-art/tiers.js', import.meta.url).href, {
  namedExports: { albumKey(){ return 'album'; }, trackTier(){ return 'standard'; } },
});
mock.module(new URL('../../src/library/model.js', import.meta.url).href, {
  namedExports: { albumTracks(){ return []; } },
});
mock.module(new URL('../../src/shell/ceremony-timing.js', import.meta.url).href, {
  namedExports: { splitSides(){ return null; }, albumFormatFor(){ return { size:'12"', speed: 33.333 }; } },
});
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { routeSource(){}, applyLoudnessNorm(){}, applyWobbleRate(){}, applyCharacter(){} },
});
mock.module(new URL('../../src/record-art/format.js', import.meta.url).href, {
  namedExports: { rotationHz(){ return 0.556; }, RPM_33: 33.333, RPM_45: 45, sideFullness(){ return 1; }, formatChipText(){ return ''; } },
});
mock.module(new URL('../../src/ui/haptic.js', import.meta.url).href, {
  namedExports: { hapticTick(){} },
});
mock.module(new URL('../../src/util/motion.js', import.meta.url).href, {
  namedExports: { REDUCED: false },
});
mock.module(new URL('../../src/player/sleep-timer.js', import.meta.url).href, {
  namedExports: { updateSleepUI(){} },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { drawTime(){}, settleTrackEnd(){}, updateFocusStatusLine(){} },
});
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote(){} },
});
mock.module(new URL('../../src/player/queue.js', import.meta.url).href, {
  namedExports: { advance(){}, preloadNextTrack(){}, peekNextIndex(){ return null; }, updateFocusUI(){} },
});
const ensureBufferMock = mock.fn(async () => true);
mock.module(new URL('../../src/player/buffers.js', import.meta.url).href, {
  namedExports: { ensureBuffer: ensureBufferMock },
});
mock.module(new URL('../../src/history/sessions.js', import.meta.url).href, {
  namedExports: { sessionOnLoad(){}, touchActiveSession(){} },
});
mock.module(new URL('../../src/library/credits.js', import.meta.url).href, {
  namedExports: { updateCreditsButtonForCurrent(){} },
});
mock.module(new URL('../../src/library/favorites.js', import.meta.url).href, {
  namedExports: { updateFavoriteButtons(){} },
});
mock.module(new URL('../../src/record-art/looks.js', import.meta.url).href, {
  namedExports: { applyDiscVariant(){} },
});
mock.module(new URL('../../src/library/sealed.js', import.meta.url).href, {
  namedExports: { breakSeal(){} },
});
const bgPrimeMock = mock.fn();
mock.module(new URL('../../src/player/background.js', import.meta.url).href, {
  namedExports: { bgPrime: bgPrimeMock, bgRouteActive(){ return false; }, bgIdleNow(){}, bgPosition(){} },
});
mock.module(new URL('../../src/shell/mini-player.js', import.meta.url).href, {
  namedExports: { updateShellAlbum(){ return { type: 'none' }; }, renderMiniPlayer(){} },
});
mock.module(new URL('../../src/shell/routes.js', import.meta.url).href, {
  namedExports: { showRoute(){} },
});
mock.module(new URL('../../src/shell/put-away.js', import.meta.url).href, {
  namedExports: { clearSpinDown(){} },
});
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: { renderTracks(){}, updateTrackRow(){ return false; } },
});
mock.module(new URL('../../src/gatefold/view.js', import.meta.url).href, {
  namedExports: { updateGatefoldNowPlaying(){} },
});
mock.module(new URL('../../src/shell/player-side-panel.js', import.meta.url).href, {
  namedExports: { renderPlayerSidePanel(){} },
});
mock.module(new URL('../../src/sundown/solar.js', import.meta.url).href, {
  namedExports: { realDayPosition(){ return { phase: 'midday' }; } },
});
mock.module(new URL('../../src/record-art/etchings.js', import.meta.url).href, {
  namedExports: { applyDeadWaxEtching(){} },
});
mock.module(new URL('../../src/shell/runout.js', import.meta.url).href, {
  namedExports: { performPendingFlip(){ return false; }, sideFlipTurnAt(){ return null; } },
});
mock.module(new URL('../../src/player/resume.js', import.meta.url).href, {
  namedExports: { saveResumeNow(){} },
});
// transport.js calls MizikiSocial.* directly as a global (the classic,
// not-a-module social client script -- src/miziki-social.js's own header
// comment) rather than importing it.
globalThis.MizikiSocial = { nowSpinning(){}, nowSpinningPaused(){}, stopSpinning(){} };

const { play, handleContextInterruption } = await import('../../src/player/transport.js');
const { S } = await import('../../src/state.js');

function fakeTrack(duration){
  return { tags: { title: 't', artist: 'a', album: 'al' }, meta: {}, buffer: {}, duration };
}

function fakeCtx(currentTime, state = 'running'){
  const created = [];
  return {
    currentTime, state,
    createBufferSource(){
      const src = { buffer: null, playbackRate: { value: 1 }, onended: null, connect(){}, start(){ created.push(src); }, stop(){} };
      return src;
    },
    resume: async () => {},
    _created: created,
  };
}

function resetState(){
  elCache.clear();
  ensureBufferMock.mock.resetCalls();
  bgPrimeMock.mock.resetCalls();
  Object.assign(S, {
    tracks: [fakeTrack(60)], index: 0, queue: [0], qpos: 0, repeat: 'off', shuffle: false,
    playing: false, pos: 0, source: null, anchor: null, gen: 0, rate: 1, mode: 'vinyl',
    recordFormat: { size:'12"', speed: 33.333 }, pendingSideStart: false, surfaceNoise: 0,
    privateSpin: false, resumePending: false, pausedBySystem: false, char: {}, platterEmpty: false,
  });
}

test('PL4: a context interruption mid-track freezes playback -- no second source, S.pos stays put', () => {
  resetState();
  S.playing = true;
  S.pos = 12.5;
  S.ctx = fakeCtx(100);
  S.anchor = { ctxTime: 100, offset: 12.5, rate: 1 };
  const originalSource = { onended: () => { throw new Error('a frozen source must never fire onended again'); }, stop: mock.fn() };
  S.source = originalSource;

  handleContextInterruption();

  assert.equal(S.playing, false);
  assert.equal(S.pausedBySystem, true);
  assert.equal(S.source, null);              // no second source was ever started in its place
  assert.equal(S.pos, 12.5);                 // nothing here touches S.pos -- it stays exactly where the anchor last reported it
  assert.equal(originalSource.stop.mock.calls.length, 1);
});

test('PL4: handleContextInterruption while nothing is playing is a quiet no-op', () => {
  resetState();
  S.playing = false;
  S.pausedBySystem = false;
  handleContextInterruption();
  assert.equal(S.pausedBySystem, false);   // never set when there was nothing to interrupt
});

test('PL4: resuming after a system pause starts fresh audio from the frozen position, and clears the flag', async () => {
  resetState();
  S.playing = true;
  S.pos = 12.5;
  S.ctx = fakeCtx(100);
  S.anchor = { ctxTime: 100, offset: 12.5, rate: 1 };
  S.source = { onended(){}, stop(){} };
  handleContextInterruption();
  assert.equal(S.pausedBySystem, true);

  S.ctx = fakeCtx(200);   // the context is back to 'running' by the time Play is tapped
  await play();

  assert.equal(S.playing, true);
  assert.equal(S.pausedBySystem, false);           // the resume clears the system-pause flag
  assert.equal(bgPrimeMock.mock.calls.length, 1);  // rule 9: still the first thing play() does
  assert.ok(S.source);                             // a fresh source was actually started
  assert.equal(S.anchor.offset, 12.5);             // ...from exactly the frozen position, not 0
});
