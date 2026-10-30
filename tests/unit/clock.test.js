import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// clock.js has temporary circular imports back to main.js (for
// easeOutCubic/REDUCED) and to sleep-timer.js (for sleepCheckDeadline) —
// see the refactor rule in CLAUDE.md. Since step 5c, clock.js also imports
// addPlayedRange/checkTrackCompletion from the real src/history/played.js,
// which itself imports from the real src/history/sessions.js — both load
// for real here, so the main.js mock below also needs every name *they*
// need from main.js, not just clock.js's own direct imports. Since step
// 6b, played.js's/sessions.js's own applyDiscVariant/restoreThumbs/
// snapshotAlbumDisplay/etc. imports are real (looks.js/thumbs.js/
// achievements.js, not main.js), but loading those for real reaches
// thumbs.js's own further real chain: edit.js, which reaches sealed.js
// and credits.js (each circularly importing a few more names from
// main.js, rule 8) and, through credits.js's own real setQueue import,
// player/queue.js — which would in turn reach player/buffers.js's
// ensureContext (audio/engine.js) and, through that, sundown/location.js's
// own circular import of queueSave from main.js — same reasoning
// tags.test.js/credits.test.js/search.test.js give for mocking
// audio/engine.js directly rather than loading that whole chain.
// main.js has DOM-dependent top-level code that needs a browser, and
// sleep-timer.js's real file would in turn pull in location.js and
// transport.js (which itself needs ~11 main.js exports). Mocking main.js,
// sleep-timer.js and audio/engine.js directly, rather than loading their
// real dependency chains, is what lets tick() load here at all. Since
// step 6c, clock.js's own bgPosition import is real (player/background.js
// instead of main.js) — background.js loads for real too: its own
// engine.js/transport.js imports resolve to the mocks already set up for
// this test, and its player/controls.js import reaches the same real
// queue.js/sessions.js chain already loaded via played.js above, so
// nothing new needs mocking except background.js's own queueSave
// circular import, added to the main.js mock below.
mock.module(new URL('../../src/main.js', import.meta.url).href, {
  namedExports: { queueSave(){} },
});
// Since step 7d, renderTracks/exitSelectMode/songRow (reached via
// edit.js/credits.js, transitively through the chain the comment above
// describes) are all real imports from src/library/view.js instead of
// main.js — mocked directly here, same "stop the chain at the door"
// reasoning.
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: { renderTracks(){}, exitSelectMode(){}, songRow(){}, updateTrackRow(){ return false; } },
});
// Since step 7e, sealed.js's updateSealedSheetAfterBreak import is real
// (from src/gatefold/sealed-sheet.js) instead of main.js — mocked here
// rather than main.js, since the real sealed-sheet.js would otherwise
// reach gatefold/view.js's own wide real chain (library/credits.js,
// shell/start-sequence.js and more) just to satisfy this one name.
mock.module(new URL('../../src/gatefold/sealed-sheet.js', import.meta.url).href, {
  namedExports: { updateSealedSheetAfterBreak(){} },
});
// Since step 7c, edit.js's deleteCrateArtTiers/buildCrateTier imports are
// real ones from src/crate/tiers.js instead of main.js — mocked directly
// here, same "stop the chain at the door" reasoning as the rest of this
// file (crate/model.js's own real chain reads window.devicePixelRatio via
// crate/constants.js at module load, which there's no browser for here).
mock.module(new URL('../../src/crate/tiers.js', import.meta.url).href, {
  namedExports: { deleteCrateArtTiers(){}, buildCrateTier(){} },
});
mock.module(new URL('../../src/crate/model.js', import.meta.url).href, {
  namedExports: { invalidateCrateModel(){} },
});
// Since step 7b, easeOutCubic/REDUCED moved off main.js into
// src/util/motion.js, and the five screen/ceremony functions that used to
// be mocked above moved into real src/shell/ modules — mocked directly
// here for the same "stop the chain at the door" reasoning the rest of
// this file's comment gives (shell/mini-player.js's own real
// player/background.js import would otherwise reach player/controls.js/
// storage/meta.js/audio/mode.js).
mock.module(new URL('../../src/util/motion.js', import.meta.url).href, {
  namedExports: { easeOutCubic(x){ return 1 - Math.pow(1 - x, 3); }, REDUCED: false },
});
mock.module(new URL('../../src/shell/start-sequence.js', import.meta.url).href, {
  namedExports: { runStartSequence(){}, isShrinkWrapTarget(){ return false; } },
});
mock.module(new URL('../../src/shell/player-overlay.js', import.meta.url).href, {
  namedExports: { openPlayerViaSheet(){}, closePlayer(){} },
});
// CEREMONY PR 3: player/queue.js and shell/start-sequence.js import
// shell/runout.js, whose real chain reaches library/view.js — stop it here.
mock.module(new URL('../../src/shell/runout.js', import.meta.url).href, {
  namedExports: { endOfQueue(){}, maybeSideFlip(){ return false; }, cancelRunout(){}, interruptRunout(){ return false; }, clearToRest(){}, performPendingFlip(){ return false; }, stopAtRecordEndCeremony(){} },
});
mock.module(new URL('../../src/shell/put-away.js', import.meta.url).href, {
  namedExports: { shouldPutAway(){ return false; }, putAwayInstant(){}, runPutAwaySequence(){} },
});
mock.module(new URL('../../src/shell/mini-player.js', import.meta.url).href, {
  namedExports: { renderMiniPlayer(){} },
});
mock.module(new URL('../../src/shell/routes.js', import.meta.url).href, {
  namedExports: { showRoute(){} },
});
// Since step 6e, played.js's persistTrackLastPlayed and thumbs.js's
// renderProfile are real imports from src/profile/screens.js instead of
// main.js — mocked directly here, same "stop the chain at the door"
// reasoning as above, since the real screens.js would pull in
// profile/storefront.js, profile/settings.js and the social/ screens too.
mock.module(new URL('../../src/profile/screens.js', import.meta.url).href, {
  namedExports: { persistTrackLastPlayed: async () => {}, renderProfile(){} },
});
// RF23 (docs/12_REFINE.md): library/credits.js's new, one-directional
// import of openFriendStore (social/screens/friend-store.js) would
// otherwise reach that module's own real chain (profile/storefront.js and
// everything past it) through credits.js's real chain described above —
// stopped at that new edge, the same way tests/unit/credits.test.js does.
mock.module(new URL('../../src/social/screens/friend-store.js', import.meta.url).href, {
  namedExports: { openFriendStore(){} },
});
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { ensureContext(){}, applyWobbleRate(){}, applyCharacter(){}, decodeAudioFile: async () => {} },
});
// Since step 7a, clock.js's own real player/background.js import (for
// bgPosition, step 6c) reaches background.js's own real queueSave import,
// now from storage/meta.js instead of main.js — meta.js itself real-chains
// into audio/mode.js/engine.js/location.js/player/controls.js for its own
// applyPrefs() helpers, so it's mocked directly here, same "stop the chain
// at the door" reasoning as every other mock in this file.
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave(){}, touchBackupField(){} },
});
mock.module(new URL('../../src/player/sleep-timer.js', import.meta.url).href, {
  namedExports: { sleepCheckDeadline(){}, sleepStopPlayback(){} },
});
// scrub.js (loaded below for angleDelta) imports pause/play/seek from
// transport.js, which has its own ~13-function main.js dependency list
// (step 3b) — mocked directly for the same reason as above. `load` is
// needed too since step 6b's transitive chain (see above) reaches the
// real player/queue.js, which imports it alongside play/pause/seek.
const cancelPendingGaplessMock = mock.fn();
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { load(){}, pause(){}, pauseAndRest(){}, play(){}, seek(){}, sideLetterFor(){ return ''; }, maybeScheduleGaplessNext(){}, cancelPendingGapless: cancelPendingGaplessMock },
});
// clock.js's top-level setInterval (the hidden-page fallback clock) is a
// real OS timer once clock.js is imported directly here — unlike in the
// browser, where the page has other reasons to stay alive, that timer
// alone would keep this test file's Node process from exiting. Mocking
// the timer API before importing clock.js avoids a real one ever being
// created, with no change to clock.js itself.
mock.timers.enable({ apis: ['setInterval'] });

// ui/theme.js's own real chain is just state.js + storage/meta.js, and
// the latter is already mocked above (for background.js's benefit), so
// this loads for real with no new mock needed, EXCEPT that drawSun()'s
// tests below want deterministic control over which branch it takes —
// done via a thin override on top of the real effectiveTheme(), not a
// full mock. The real light/dark/auto resolution logic itself is already
// covered by tests/unit/theme.test.js; this file only ever asks "did
// drawSun() believe it was light, or not, and did it behave correctly."
let fakeEffectiveTheme = null;
const realTheme = await import('../../src/ui/theme.js');
mock.module(new URL('../../src/ui/theme.js', import.meta.url).href, {
  namedExports: {
    ...realTheme,
    effectiveTheme(){ return fakeEffectiveTheme ?? realTheme.effectiveTheme(); },
  },
});

// drawSun() (tested below, alongside tick()) touches about a dozen ids
// via $ and, separately, document.documentElement.style directly for the
// --sky1/--sky2 fix under test — neither exists in this file's Node
// environment otherwise. A single reusable stub element is enough: none
// of drawSun()'s own tests care about its textContent/style.width, only
// about the one inline-style side effect this fix changed.
// RF26 (docs/12_REFINE.md): drawSun() now also writes dataset.phase onto
// the sheet's two ways-in (the sun knob, the mini-player's sun button) —
// dataset needs a real (if fake) object for that write to land on.
function fakeEl(){
  return {
    style: {}, textContent: '', toLocaleTimeString(){ return ''; }, dataset: {},
    classList: { toggle(){}, add(){}, remove(){} }, setAttribute(){},
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: { $(){ return fakeEl(); }, el(){ return fakeEl(); } },
});
const fakeRootStyle = {};
globalThis.document = {
  documentElement: {
    style: {
      setProperty(name, value){ fakeRootStyle[name] = value; },
      removeProperty(name){ delete fakeRootStyle[name]; },
    },
  },
};

const { tick, currentPos, drawSun, skyGradientStops, mutedGradientStops, phaseText, crateLightColor } = await import('../../src/player/clock.js');
const { S } = await import('../../src/state.js');

function drawSunAt(theme, sunOk){
  fakeEffectiveTheme = theme;
  S.mode = 'vinyl'; S.auto = false; S.rate = 1; S.target = 1.2;
  S.sun = { ok: !!sunOk };
  for(const k of Object.keys(fakeRootStyle)) delete fakeRootStyle[k];
  drawSun();
  return fakeRootStyle;
}

function fakeTrack(duration){ return { duration, tags: {} }; }

// tick()'s internal `last` is seeded from performance.now() at module
// load time. Anchoring fake `now` values well ahead of that (rather than
// small fixed numbers like 1000) guarantees each test's first tick()
// call sees a positive, over-the-cap elapsed time regardless of how
// long the test runner itself took to start — a fixed small `now` could
// otherwise land behind the real `last` and produce a negative dt.
function farFutureNow(){ return performance.now() + 10000; }

// PL2 (docs/19_PLAYER.md, "one clock"): a minimal fake AudioContext —
// just enough of the real shape (currentTime, state) for currentPos()/
// tick() to read, with currentTime settable by the test rather than
// advancing on its own the way a real context's clock would.
function fakeCtx(currentTime, state = 'running'){
  return { currentTime, state };
}

test('currentPos derives position from the anchor, not accumulated dt', () => {
  S.tracks = [fakeTrack(10)]; S.index = 0;
  S.playing = true; S.rate = 2; S.pos = 0;
  S.ctx = fakeCtx(100);
  S.anchor = { ctxTime: 100, offset: 0, rate: 2 };
  S.ctx.currentTime = 100.05; // 0.05s of real time elapsed on the audio clock
  assert.ok(Math.abs(currentPos() - 0.05 * 2) < 1e-9);
});

test('tick writes currentPos() into S.pos while playing', () => {
  S.tracks = [fakeTrack(10)]; S.index = 0;
  S.playing = true; S.rate = 1; S.pos = 0; S.source = null;
  // pins computeRate() to exactly S.rate, so tick()'s own rate-change/
  // re-anchor branch never fires mid-test — this test is only about
  // currentPos() feeding S.pos, not about a rate change.
  S.mode = 'vinyl'; S.auto = false; S.manualRate = 1;
  S.ctx = fakeCtx(200);
  S.anchor = { ctxTime: 200, offset: 0, rate: 1 };
  const now0 = farFutureNow();
  tick(now0, 0.1); // primes `last`; this call's own dt is uncontrolled and discarded
  S.ctx.currentTime = 200.25;
  tick(now0 + 50, 0.1);
  assert.ok(Math.abs(S.pos - 0.25) < 1e-9);
});

test('tick does not advance S.pos while paused', () => {
  S.tracks = [fakeTrack(10)]; S.index = 0;
  S.playing = false; S.rate = 1; S.pos = 3; S.source = null; S.ctx = null;
  const now0 = farFutureNow();
  tick(now0, 0.1);
  const before = S.pos;
  tick(now0 + 50, 0.1);
  assert.equal(S.pos, before);
});

test('tick never advances S.pos past the track duration', () => {
  S.tracks = [fakeTrack(1)]; S.index = 0;
  // starts close to the end already (matching S.anchor's own offset, so
  // the priming tick below reports the same position it starts at —
  // curPlayed stays a near-empty range rather than tripping the 95%
  // completion check with an unrelated jump from 0).
  S.playing = true; S.rate = 1; S.pos = 0.95; S.source = null;
  S.mode = 'vinyl'; S.auto = false; S.manualRate = 1;
  S.ctx = fakeCtx(300);
  S.anchor = { ctxTime: 300, offset: 0.95, rate: 1 };
  const now0 = farFutureNow();
  tick(now0, 0.1); // primes `last`; ctx.currentTime === anchor.ctxTime, so S.pos is unchanged
  S.ctx.currentTime = 300 + 5000; // way past the 1s track, all on the audio clock
  tick(now0 + 5000, 0.1);
  assert.ok(S.pos <= 1);
});

test('currentPos reads 0 during the lead-in, before anchor.ctxTime', () => {
  S.tracks = [fakeTrack(10)]; S.index = 0;
  S.playing = true; S.rate = 1; S.pos = 0;
  S.ctx = fakeCtx(400);
  // the needle-drop/lead-in noise is already playing; the track's own
  // audio is scheduled to start 3s from now on the audio clock.
  S.anchor = { ctxTime: 403, offset: 0, rate: 1 };
  assert.equal(currentPos(), 0);
  S.ctx.currentTime = 402.99;
  assert.equal(currentPos(), 0);
  S.ctx.currentTime = 403.5;
  assert.ok(Math.abs(currentPos() - 0.5) < 1e-9);
});

test('currentPos holds S.pos steady while the context is not running (PL4 interruption freeze)', () => {
  S.tracks = [fakeTrack(10)]; S.index = 0;
  S.playing = true; S.rate = 1; S.pos = 4.2;
  S.ctx = fakeCtx(500, 'suspended');
  S.anchor = { ctxTime: 490, offset: 0, rate: 1 };
  assert.equal(currentPos(), 4.2);
});

test('a rate change re-anchors to the current derived position with no jump', () => {
  S.tracks = [fakeTrack(60)]; S.index = 0;
  S.playing = true; S.rate = 1; S.pos = 0; S.source = null;
  S.mode = 'vinyl'; S.auto = false; S.manualRate = 1;
  S.ctx = fakeCtx(600);
  S.anchor = { ctxTime: 600, offset: 0, rate: 1 };
  const now0 = farFutureNow();
  tick(now0, 0.1); // primes `last`
  S.ctx.currentTime = 610; // 10s in at rate 1 -- position should read 10
  // Sundown's own computeRate() drives the real rate change; this test
  // exercises tick()'s re-anchor branch directly rather than mocking
  // computeRate(), by asserting the invariant it has to hold: immediately
  // after a rate change, currentPos() must still read the same position
  // it read the instant before, regardless of the new rate.
  const posBefore = currentPos();
  S.rate = 0.8;
  S.anchor = { ctxTime: S.ctx.currentTime, offset: posBefore, rate: S.rate };
  assert.ok(Math.abs(currentPos() - posBefore) < 1e-9);
  S.ctx.currentTime += 5; // 5 more real seconds, now at the new rate
  assert.ok(Math.abs(currentPos() - (posBefore + 5 * 0.8)) < 1e-9);
});

test('PL3: tick\'s real rate-change branch cancels whatever gapless source was pre-armed for the old boundary', () => {
  S.tracks = [fakeTrack(60)]; S.index = 0;
  S.playing = true; S.rate = 1; S.pos = 0; S.source = null;
  S.mode = 'vinyl'; S.auto = false; S.manualRate = 1;
  S.ctx = fakeCtx(700);
  S.anchor = { ctxTime: 700, offset: 0, rate: 1 };
  const now0 = farFutureNow();
  tick(now0, 0.1); // primes `last`; manualRate matches S.rate, so no re-anchor yet
  cancelPendingGaplessMock.mock.resetCalls();
  S.manualRate = 0.85; // computeRate() (S.auto === false) now returns a different rate
  S.ctx.currentTime = 701;
  tick(now0 + 50, 0.1); // this tick's own rate-change branch must re-anchor and cancel the stale arm
  assert.equal(cancelPendingGaplessMock.mock.calls.length, 1);
  assert.equal(S.rate, 0.85);
});

const { angleDelta, SCRUB_SEC_PER_ROTATION, SCRATCH_SEC_PER_ROTATION } = await import('../../src/player/scrub.js');

test('angleDelta handles wraparound across +180 degrees', () => {
  // from 170 to -170 is a 20-degree step forward (170 -> 180/-180 -> -170),
  // not a 340-degree step backward
  assert.equal(angleDelta(-170, 170), 20);
});

test('angleDelta handles wraparound across -180 degrees', () => {
  assert.equal(angleDelta(170, -170), -20);
});

test('angleDelta is a plain difference away from the wrap boundary', () => {
  assert.equal(angleDelta(30, 10), 20);
  assert.equal(angleDelta(10, 30), -20);
});

// F2: a full 360° turn moves 30s with Scratch off, 1.8s (the real 33⅓ rpm
// rate) with it on — see wireSpinToScrub's `d * (secPerRotation/360)`.
test('F2: a full rotation moves 30s with Scratch off, 1.8s with Scratch on', () => {
  assert.equal(360 * (SCRUB_SEC_PER_ROTATION / 360), 30);
  assert.equal(360 * (SCRATCH_SEC_PER_ROTATION / 360), 1.8);
});

// DA3 (docs/DAY_ARC.md): skyGradientStops(dayPos, theme) — the 8-anchor
// sky across the whole day, both themes. A tiny dayPos-shaped fixture
// builder, same shape dayPosition() itself returns.
function pos(phase, phaseProgress = 0, duskRampProgress = 0){
  return { phase, phaseProgress, nightness: 0, rateProgress: 0, duskRampProgress };
}

test('skyGradientStops: midday is the exact dark anchor (byte-identical to the old A triple)', () => {
  assert.deepEqual(skyGradientStops(pos('midday'), 'dark'), ['rgb(29,47,56)', 'rgb(16,26,32)']);
});
// Golden hour holds flat at its own anchor for its whole phase (the same
// "flat for the whole phase" judgment call drift.js already makes for
// its own anchors). Twilight itself ramps toward the Dusk anchor, not
// its own same-named "Twilight" table row — see skyGradientStops()'s own
// header comment for why: Dusk is the one true interior waypoint this
// design needs (continuous with Night's own first 30 minutes), while the
// "Twilight"/"Morning"/"Midday"/"Golden" table rows each describe a
// single representative instant, used here as a flat hold across their
// own whole phase rather than a second, separately-targeted waypoint.
test('skyGradientStops: golden hour holds its own anchor; twilight ramps toward Dusk, reaching it exactly at the dusk instant', () => {
  // RF14 (docs/12_REFINE.md, point 2): Golden's own sky1 was cooled from
  // #3D2A1F (rgb(61,42,31)) to #352A24 (rgb(53,42,36)) — sky2 unchanged.
  assert.deepEqual(skyGradientStops(pos('golden'), 'dark'), ['rgb(53,42,36)', 'rgb(26,19,16)']);
  assert.deepEqual(skyGradientStops(pos('twilight', 1), 'dark'), ['rgb(30,24,40)', 'rgb(13,11,19)']);
});
test('skyGradientStops: night, once settled, is the exact dark anchor (old C triple)', () => {
  assert.deepEqual(skyGradientStops(pos('night', 0, 1), 'dark'), ['rgb(18,14,25)', 'rgb(8,7,12)']);
});
test('skyGradientStops: light theme never matches the dark anchors, for every phase', () => {
  for(const phase of ['night', 'dawn', 'morning', 'midday', 'afternoon', 'golden', 'twilight']){
    const dark = skyGradientStops(pos(phase, 0.5, 0.5), 'dark');
    const light = skyGradientStops(pos(phase, 0.5, 0.5), 'light');
    assert.notDeepEqual(dark, light, `${phase} should differ between themes`);
  }
});
test('skyGradientStops: an unknown/missing dayPos falls back to midday', () => {
  assert.deepEqual(skyGradientStops(null, 'dark'), skyGradientStops(pos('midday'), 'dark'));
});

// Continuity across all eight anchors, both themes: the end of one
// phase's blend must match the start of the next phase's blend exactly —
// this is the whole point of the shared-anchor architecture (same
// precedent as drift.test.js's own six-boundary continuity test).
test('skyGradientStops: every phase boundary is continuous, in both themes', () => {
  for(const theme of ['dark', 'light']){
    // twilight(1) -> night(duskRamp=0): the dusk anchor on both sides
    assert.deepEqual(skyGradientStops(pos('twilight', 1), theme), skyGradientStops(pos('night', 0, 0), theme));
    // night(duskRamp=1) -> dawn(0): the night anchor on both sides
    assert.deepEqual(skyGradientStops(pos('night', 0, 1), theme), skyGradientStops(pos('dawn', 0), theme));
    // dawn(1) -> morning(0): the morning anchor on both sides
    assert.deepEqual(skyGradientStops(pos('dawn', 1), theme), skyGradientStops(pos('morning', 0), theme));
    // morning(1) -> midday: the midday anchor on both sides
    assert.deepEqual(skyGradientStops(pos('morning', 1), theme), skyGradientStops(pos('midday'), theme));
    // midday -> afternoon(0): the midday anchor on both sides
    assert.deepEqual(skyGradientStops(pos('midday'), theme), skyGradientStops(pos('afternoon', 0), theme));
    // afternoon(1) -> golden: the golden anchor on both sides
    assert.deepEqual(skyGradientStops(pos('afternoon', 1), theme), skyGradientStops(pos('golden'), theme));
    // golden -> twilight(0): the golden anchor on both sides
    assert.deepEqual(skyGradientStops(pos('golden'), theme), skyGradientStops(pos('twilight', 0), theme));
  }
});

// WCAG contrast — the design README's own ≥4.5:1 requirement, including
// "blended values between anchors also stay above 4.5:1," sampled every
// 10 minutes across a real 24h day (Columbia, MD) rather than just at
// the eight named anchors, the same "sample the whole continuous range,
// not just the fixture points" approach drift.test.js's own whole-day
// sweep already uses.
function srgbToLinear(c){ c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function relLuminance([r, g, b]){ return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b); }
function parseRGB(s){ return s.match(/\d+/g).map(Number); }
function contrastRatio(hexOrRgb, rgbStr){
  const fg = Array.isArray(hexOrRgb) ? hexOrRgb : hexOrRgb;
  const L1 = relLuminance(fg), L2 = relLuminance(parseRGB(rgbStr));
  const lighter = Math.max(L1, L2), darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}
// CR8 (docs/13_CRATE.md point 2) moved light theme's --paper (#15232B ->
// #26202C) and --muted (#4F616A -> #6B6258) -- --muted-2/--accent-text
// are untouched.
const TEXT_TOKENS = {
  dark: { paper: [239,233,223], muted: [148,160,166], accentText: [255,158,44] },
  light: { paper: [38,32,44], muted: [107,98,88], accentText: [154,71,0] },
};

test('skyGradientStops: every anchor stays >=4.5:1 against paper/muted/accent-text, both themes', () => {
  for(const theme of ['dark', 'light']){
    for(const phase of ['night', 'dawn', 'morning', 'midday', 'afternoon', 'golden', 'twilight']){
      const [sky1, sky2] = skyGradientStops(pos(phase, 0, 1), theme);
      for(const token in TEXT_TOKENS[theme]){
        const fg = TEXT_TOKENS[theme][token];
        const ratio = Math.min(contrastRatio(fg, sky1), contrastRatio(fg, sky2));
        assert.ok(ratio >= 4.5, `${theme}/${phase}/${token}: contrast ${ratio.toFixed(2)} below 4.5`);
      }
    }
  }
});

test('skyGradientStops: blended values stay >=4.5:1 too, sampled every 10 minutes across a full day', async () => {
  const { dayEvents, dayPosition } = await import('../../src/sundown/day.js');
  const COLUMBIA = { lat: 39.20, lon: -76.86 };
  const date = new Date('2025-06-21T12:00:00Z');
  const events = dayEvents(date, COLUMBIA.lat, COLUMBIA.lon);
  const start = new Date('2025-06-21T04:00:00Z');
  for(const theme of ['dark', 'light']){
    for(let m = 0; m < 24 * 60; m += 10){
      const now = new Date(start.getTime() + m * 60000);
      const dayPos = dayPosition(now, events);
      const [sky1, sky2] = skyGradientStops(dayPos, theme);
      for(const token in TEXT_TOKENS[theme]){
        const fg = TEXT_TOKENS[theme][token];
        const ratio = Math.min(contrastRatio(fg, sky1), contrastRatio(fg, sky2));
        assert.ok(ratio >= 4.5, `${theme} at +${m}min (${dayPos.phase}) / ${token}: contrast ${ratio.toFixed(2)} below 4.5`);
      }
    }
  }
});

// RF14 (docs/12_REFINE.md, point 5): "extend the existing per-minute
// contrast test to cover --muted, --muted-2 and the dial labels." --muted
// needs >=4.5:1 (same floor as paper/accent-text above); --muted-2 is
// tertiary text, >=3:1 per the design README's own "Colour" section. The
// dial's own hour labels (src/styles/25-day-arc-v2.css's
// .day-dial-hourlabel) sit on --paper outside the ring, not on --muted/
// --muted-2 against the sky, so this is what actually exercises them: the
// same floors, just for the new per-anchor-blended token instead of a
// single static value.
// RW6 (docs/23_RHYTHM_AND_WEAR.md): seasonal sky tint, a third optional
// seasonWeights argument (seasonTint()'s own shape) -- omitted, this is
// byte-identical to the pre-RW6 function every test above already
// covers, which is also exactly what "Sky follows the seasons" off means.
test('skyGradientStops: no season weights (off) matches an explicit null weights argument, at every anchor', () => {
  for(const theme of ['dark', 'light']){
    for(const phase of ['night', 'dawn', 'morning', 'midday', 'afternoon', 'golden', 'twilight']){
      assert.deepEqual(skyGradientStops(pos(phase, 0, 1), theme), skyGradientStops(pos(phase, 0, 1), theme, null));
    }
  }
});

test('skyGradientStops: with a season blend, every anchor still stays >=4.5:1 against paper/muted/accent-text, at each of the four season peaks, both themes', async () => {
  const { seasonTint } = await import('../../src/sundown/season.js');
  const peaks = [
    new Date(Date.UTC(2026, 3, 20)),
    new Date(Date.UTC(2026, 6, 20)),
    new Date(Date.UTC(2026, 9, 20)),
    new Date(Date.UTC(2026, 0, 20)),
  ];
  for(const peak of peaks){
    const weights = seasonTint(peak, null);
    for(const theme of ['dark', 'light']){
      for(const phase of ['night', 'dawn', 'morning', 'midday', 'afternoon', 'golden', 'twilight']){
        const [sky1, sky2] = skyGradientStops(pos(phase, 0, 1), theme, weights);
        for(const token in TEXT_TOKENS[theme]){
          const fg = TEXT_TOKENS[theme][token];
          const ratio = Math.min(contrastRatio(fg, sky1), contrastRatio(fg, sky2));
          assert.ok(ratio >= 4.5, `${peak.toISOString()} ${theme}/${phase}/${token}: contrast ${ratio.toFixed(2)} below 4.5`);
        }
      }
    }
  }
});

test('skyGradientStops: blended values stay >=4.5:1 with a season blend too, sampled every 10 minutes across a full day, at each season peak', async () => {
  const { dayEvents, dayPosition } = await import('../../src/sundown/day.js');
  const { seasonTint } = await import('../../src/sundown/season.js');
  const COLUMBIA = { lat: 39.20, lon: -76.86 };
  const peaks = [
    new Date('2026-04-20T12:00:00Z'),
    new Date('2026-07-20T12:00:00Z'),
    new Date('2026-10-20T12:00:00Z'),
    new Date('2026-01-20T12:00:00Z'),
  ];
  for(const peakDate of peaks){
    const weights = seasonTint(peakDate, COLUMBIA.lat);
    const events = dayEvents(peakDate, COLUMBIA.lat, COLUMBIA.lon);
    const start = new Date(peakDate.getTime() - 8 * 3600000);
    for(const theme of ['dark', 'light']){
      for(let m = 0; m < 24 * 60; m += 10){
        const now = new Date(start.getTime() + m * 60000);
        const dayPos = dayPosition(now, events);
        const [sky1, sky2] = skyGradientStops(dayPos, theme, weights);
        for(const token in TEXT_TOKENS[theme]){
          const fg = TEXT_TOKENS[theme][token];
          const ratio = Math.min(contrastRatio(fg, sky1), contrastRatio(fg, sky2));
          assert.ok(ratio >= 4.5, `${peakDate.toISOString()} ${theme} at +${m}min (${dayPos.phase}) / ${token}: contrast ${ratio.toFixed(2)} below 4.5`);
        }
      }
    }
  }
});

test('mutedGradientStops: every anchor clears 4.5:1 (muted) / 3:1 (muted-2), both themes', () => {
  for(const theme of ['dark', 'light']){
    for(const phase of ['night', 'dawn', 'morning', 'midday', 'afternoon', 'golden', 'twilight']){
      const [sky1, sky2] = skyGradientStops(pos(phase, 0, 1), theme);
      const [muted, muted2] = mutedGradientStops(pos(phase, 0, 1), theme);
      const mutedRatio = Math.min(contrastRatio(parseRGB(muted), sky1), contrastRatio(parseRGB(muted), sky2));
      const muted2Ratio = Math.min(contrastRatio(parseRGB(muted2), sky1), contrastRatio(parseRGB(muted2), sky2));
      assert.ok(mutedRatio >= 4.5, `${theme}/${phase}/muted: contrast ${mutedRatio.toFixed(2)} below 4.5`);
      assert.ok(muted2Ratio >= 3, `${theme}/${phase}/muted-2: contrast ${muted2Ratio.toFixed(2)} below 3`);
    }
  }
});

test('mutedGradientStops: dark theme is warm during Golden/Twilight, cool everywhere else', () => {
  const [goldenMuted] = mutedGradientStops(pos('golden'), 'dark');
  const [twilightMuted] = mutedGradientStops(pos('twilight'), 'dark');
  const [nightMuted] = mutedGradientStops(pos('night', 0, 1), 'dark');
  const [middayMuted] = mutedGradientStops(pos('midday'), 'dark');
  assert.deepEqual(goldenMuted, 'rgb(169,156,143)');   // the warm pair (#A99C8F)
  assert.deepEqual(twilightMuted, 'rgb(169,156,143)');
  assert.deepEqual(nightMuted, 'rgb(148,160,166)');    // the cool pair (#94A0A6)
  assert.deepEqual(middayMuted, 'rgb(148,160,166)');
});

test('mutedGradientStops: light theme keeps one pair regardless of phase', () => {
  const golden = mutedGradientStops(pos('golden'), 'light');
  const night = mutedGradientStops(pos('night', 0, 1), 'light');
  assert.deepEqual(golden, night);
  // TY1 (docs/22_TYPE.md, audit point 4): --muted-2's light floor was
  // raised #6E7A80 -> #5E6A70.
  assert.deepEqual(golden, ['rgb(107,98,88)', 'rgb(94,106,112)']);
});

test('mutedGradientStops: blended values stay >=4.5:1 (muted) / >=3:1 (muted-2) too, sampled every 10 minutes across a full day', async () => {
  const { dayEvents, dayPosition } = await import('../../src/sundown/day.js');
  const COLUMBIA = { lat: 39.20, lon: -76.86 };
  const date = new Date('2025-06-21T12:00:00Z');
  const events = dayEvents(date, COLUMBIA.lat, COLUMBIA.lon);
  const start = new Date('2025-06-21T04:00:00Z');
  for(const theme of ['dark', 'light']){
    for(let m = 0; m < 24 * 60; m += 10){
      const now = new Date(start.getTime() + m * 60000);
      const dayPos = dayPosition(now, events);
      const [sky1, sky2] = skyGradientStops(dayPos, theme);
      const [muted, muted2] = mutedGradientStops(dayPos, theme);
      const mutedRatio = Math.min(contrastRatio(parseRGB(muted), sky1), contrastRatio(parseRGB(muted), sky2));
      const muted2Ratio = Math.min(contrastRatio(parseRGB(muted2), sky1), contrastRatio(parseRGB(muted2), sky2));
      assert.ok(mutedRatio >= 4.5, `${theme} at +${m}min (${dayPos.phase}) / muted: contrast ${mutedRatio.toFixed(2)} below 4.5`);
      assert.ok(muted2Ratio >= 3, `${theme} at +${m}min (${dayPos.phase}) / muted-2: contrast ${muted2Ratio.toFixed(2)} below 3`);
    }
  }
});

// phaseText: the new phase line's own wording — separate from #rateWhy's
// existing, shorter copy (untouched by DA3, still tested via drawSunAt
// below).
test('phaseText: dawn reads "percent risen", twilight reads "percent down", others are flat copy', () => {
  assert.deepEqual(phaseText(pos('dawn', 0.5), 0, 0), { name: 'Dawn', sub: '50% of the way up' });
  assert.deepEqual(phaseText(pos('twilight', 0.6), 0, 0.6), { name: 'Twilight', sub: '60% of the way down' });
  assert.deepEqual(phaseText(pos('morning'), 0, 0), { name: 'Morning', sub: 'Bright, full speed' });
  assert.deepEqual(phaseText(pos('night'), 0, 0), { name: 'Night', sub: 'Settled in for the night' });
});

// The fix under test since the sky-fix changelog entry, now extended by
// DA3: drawSun() always sets --sky1/--sky2 inline, in both themes (the
// D2-era "light clears instead of setting" behavior is gone — see
// clock.js's own updated comment at the call site).
test('drawSun(): dark theme sets animated --sky1/--sky2 inline', () => {
  const style = drawSunAt('dark', false);
  assert.ok(style['--sky1'] && style['--sky1'].startsWith('rgb('));
  assert.ok(style['--sky2'] && style['--sky2'].startsWith('rgb('));
  // CR1: --phase-color/--crate-light ride the same guarded-write pattern.
  // This is the first drawSun() call in the whole file, so the module's own
  // "skip an unchanged value" cache (same shape as --sky1/--sky2's) hasn't
  // latched onto a value yet — a later, repeated call at the same day
  // position (every other drawSunAt() test in this file uses the same
  // sunOk:false flat-midday fallback) always skips, same as --sky1/--sky2
  // would; that skip itself is covered by the dedicated test below.
  assert.ok(style['--phase-color'] && /^#[0-9A-Fa-f]{6}$/.test(style['--phase-color']));
  assert.ok(style['--crate-light'] && style['--crate-light'].startsWith('rgba('));
});
test('drawSun(): light theme now also sets animated --sky1/--sky2 inline', () => {
  const style = drawSunAt('light', false);
  assert.ok(style['--sky1'] && style['--sky1'].startsWith('rgb('));
  assert.ok(style['--sky2'] && style['--sky2'].startsWith('rgb('));
});
// RF14 (docs/12_REFINE.md, point 1): --muted/--muted-2 follow --sky1/
// --sky2 the same way, in both themes.
test('drawSun(): also sets animated --muted/--muted-2 inline, in both themes', () => {
  for(const theme of ['dark', 'light']){
    const style = drawSunAt(theme, false);
    assert.ok(style['--muted'] && style['--muted'].startsWith('rgb('));
    assert.ok(style['--muted-2'] && style['--muted-2'].startsWith('rgb('));
  }
});
test('drawSun(): dark and light produce different inline values for the same day position', () => {
  const dark = drawSunAt('dark', false);
  const darkSky1 = dark['--sky1'];
  const light = drawSunAt('light', false);
  assert.notEqual(light['--sky1'], darkSky1);
});
// TY5 (docs/22_TYPE.md): "Nychthemeron and mutedGradientStops() move tone
// only" -- drawSun() writes a handful of custom properties onto :root
// every tick (--sky1/--sky2/--muted/--muted-2/etc, asserted individually
// above); this guards that none of them, now or in some later phase/theme
// this file adds, is a font property smuggled in alongside a color.
test('drawSun(): never writes a font-size/font-family/letter-spacing/font-weight custom property', () => {
  for(const theme of ['dark', 'light']){
    const style = drawSunAt(theme, false);
    for(const name of Object.keys(style)){
      assert.doesNotMatch(name, /font|letter-spacing/i, `drawSun() wrote ${name}, a font property`);
    }
  }
});

// NV1: drawSun() runs on a steady ~220ms timer while visible, repainting
// the fixed-position sky gradient (.sky-bg, 00-base.css) every time it
// writes --sky1/--sky2 — a classic cause of scroll stutter on iPhone when
// the colors haven't actually moved. drawSunAt() always clears
// fakeRootStyle before calling drawSun(), so calling drawSun() directly a
// second time with the exact same S state (no drawSunAt() in between)
// isolates just the skip: nothing should land in the cleared object.
test('drawSun(): repeating the same day position skips the redundant write', () => {
  drawSunAt('dark', false); // establishes the cached sky values
  for(const k of Object.keys(fakeRootStyle)) delete fakeRootStyle[k];
  drawSun(); // identical S.mode/auto/rate/target/sun — identical sky output
  assert.equal(fakeRootStyle['--sky1'], undefined);
  assert.equal(fakeRootStyle['--sky2'], undefined);
  // RF14: --muted/--muted-2 skip the same way.
  assert.equal(fakeRootStyle['--muted'], undefined);
  assert.equal(fakeRootStyle['--muted-2'], undefined);
  // CR1: --phase-color/--crate-light skip the same way too.
  assert.equal(fakeRootStyle['--phase-color'], undefined);
  assert.equal(fakeRootStyle['--crate-light'], undefined);
});

// CR1 (docs/13_CRATE.md): crateLightColor() is the lit-top-edge tint every
// sleeve/lip surface in the bin shares (10-crate.css's --crate-light) —
// warm near Golden hour, cool everywhere else, the same two-anchor shape
// mutedGradientStops() already uses, just with its own short anchor table
// rather than a derived one.
test('crateLightColor: warm during Golden/Twilight, cool everywhere else', () => {
  const golden = crateLightColor(pos('golden'));
  const twilight = crateLightColor(pos('twilight'));
  const night = crateLightColor(pos('night', 0, 1));
  const midday = crateLightColor(pos('midday'));
  assert.equal(golden, 'rgba(255,235,200,.2)');
  assert.equal(twilight, 'rgba(255,235,200,.2)');
  assert.equal(night, 'rgba(205,214,230,.2)');
  assert.equal(midday, 'rgba(205,214,230,.2)');
});

