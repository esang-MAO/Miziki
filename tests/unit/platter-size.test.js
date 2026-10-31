// SZ1 (docs/26_SIZES_AND_ZOETROPES.md): player/transport.js's load() sets
// #platterStage's own [data-size] from S.recordFormat.size, replacing the
// old .format-7in class toggle -- every per-size CSS rule in
// 02-stage-platter.css (and, from SZ2 on, the zoetrope ring's band) keys
// off this one attribute. Same heavy-mock shape as
// transport-interruption.test.js: load() touches nearly every subsystem,
// so every direct import besides state.js/util/dom.js/record-art/format.js
// (the real modules under test) is stubbed.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const elCache = new Map();
function fakeEl(){
  return {
    textContent: '', style: {}, src: '',
    classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    querySelectorAll(){ return []; },
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
// mutable so each test can pick which format cell load() lands on
let nextFormat = { size: '12"', speed: 33.333 };
mock.module(new URL('../../src/shell/ceremony-timing.js', import.meta.url).href, {
  namedExports: { splitSides(){ return null; }, albumFormatFor(){ return nextFormat; } },
});
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { routeSource(){}, applyLoudnessNorm(){}, applyWobbleRate(){}, applyCharacter(){} },
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
mock.module(new URL('../../src/player/buffers.js', import.meta.url).href, {
  namedExports: { ensureBuffer: async () => true },
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
mock.module(new URL('../../src/player/background.js', import.meta.url).href, {
  namedExports: { bgPrime(){}, bgRouteActive(){ return false; }, bgIdleNow(){}, bgPosition(){} },
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
// transport.js reaches the social client as a global, not an import.
globalThis.MizikiSocial = { nowSpinning(){}, nowSpinningPaused(){}, stopSpinning(){} };

const { load } = await import('../../src/player/transport.js');
const { S } = await import('../../src/state.js');

function fakeTrack(album){
  return { id: 't1', tags: { title: 't', artist: 'a', album }, meta: {}, buffer: {}, duration: 180 };
}

function resetState(){
  elCache.clear();
  Object.assign(S, {
    tracks: [fakeTrack('al')], index: 0, queue: [0], qpos: 0, repeat: 'off', shuffle: false,
    playing: false, pos: 0, source: null, anchor: null, gen: 0, rate: 1,
    // pure mode skips every surface-noise/rpm-ease branch load() would
    // otherwise run through -- irrelevant to data-size, which is set
    // long before any of those branches.
    mode: 'pure', recordFormat: { size:'12"', speed: 33.333 }, pendingSideStart: false,
    surfaceNoise: 'off', privateSpin: false, resumePending: false, pausedBySystem: false,
    char: {}, platterEmpty: false, albumSides: false, surfaceNoiseUnderMusic: false,
  });
}

for(const [cell, format] of [
  ['7-45', { size: '7"', speed: 45 }],
  ['10-45', { size: '10"', speed: 45 }],
  ['12-45', { size: '12"', speed: 45 }],
  ['12-33', { size: '12"', speed: 33.333 }],
]){
  test(`SZ1: load() sets #platterStage data-size for the ${cell} format cell`, () => {
    resetState();
    nextFormat = format;
    const setAttribute = mock.fn();
    elCache.set('#platterStage', Object.assign(fakeEl(), { setAttribute }));

    load(0);

    const sizeCalls = setAttribute.mock.calls.filter(c => c.arguments[0] === 'data-size');
    assert.equal(sizeCalls.length, 1);
    assert.equal(sizeCalls[0].arguments[1], format.size.replace('"', ''));
  });
}

test('SZ1: load() never falls back to the old format-7in class toggle', () => {
  resetState();
  nextFormat = { size: '7"', speed: 45 };
  const toggle = mock.fn();
  elCache.set('#platterStage', Object.assign(fakeEl(), { classList: { add(){}, remove(){}, contains(){ return false; }, toggle } }));

  load(0);

  assert.equal(toggle.mock.calls.filter(c => c.arguments[0] === 'format-7in').length, 0);
});
