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
  namedExports: { renderTracks(){}, exitSelectMode(){}, songRow(){} },
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
  namedExports: { runStartSequence(){} },
});
mock.module(new URL('../../src/shell/player-overlay.js', import.meta.url).href, {
  namedExports: { openPlayerViaSheet(){}, closePlayer(){} },
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
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { ensureContext(){} },
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
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { load(){}, pause(){}, play(){}, seek(){} },
});
// clock.js's top-level setInterval (the hidden-page fallback clock) is a
// real OS timer once clock.js is imported directly here — unlike in the
// browser, where the page has other reasons to stay alive, that timer
// alone would keep this test file's Node process from exiting. Mocking
// the timer API before importing clock.js avoids a real one ever being
// created, with no change to clock.js itself.
mock.timers.enable({ apis: ['setInterval'] });

const { tick } = await import('../../src/player/clock.js');
const { S } = await import('../../src/state.js');

function fakeTrack(duration){ return { duration, tags: {} }; }

// tick()'s internal `last` is seeded from performance.now() at module
// load time. Anchoring fake `now` values well ahead of that (rather than
// small fixed numbers like 1000) guarantees each test's first tick()
// call sees a positive, over-the-cap elapsed time regardless of how
// long the test runner itself took to start — a fixed small `now` could
// otherwise land behind the real `last` and produce a negative dt.
function farFutureNow(){ return performance.now() + 10000; }

test('tick advances S.pos by dt * S.rate while playing', () => {
  S.tracks = [fakeTrack(10)]; S.index = 0;
  S.playing = true; S.rate = 2; S.pos = 0; S.source = null; S.ctx = null;
  const now0 = farFutureNow();
  tick(now0, 0.1); // primes `last` to a known value; its own dt is uncontrolled and discarded
  const before = S.pos;
  const dt = 0.05; // seconds, well under the 0.1s frame cap
  tick(now0 + dt * 1000, 0.1);
  assert.ok(Math.abs((S.pos - before) - dt * S.rate) < 1e-9);
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
  S.playing = true; S.rate = 1; S.pos = 0.95; S.source = null; S.ctx = null;
  const now0 = farFutureNow();
  tick(now0, 0.1);
  tick(now0 + 5000, 0.1); // a huge dt, capped at maxDt=0.1s per call anyway
  assert.ok(S.pos <= 1);
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
