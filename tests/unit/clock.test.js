import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// clock.js has temporary circular imports back to main.js (for
// bgPosition/addPlayedRange/checkTrackCompletion/easeOutCubic/REDUCED)
// and to sleep-timer.js (for sleepCheckDeadline) — see the refactor
// rule in CLAUDE.md. main.js has DOM-dependent top-level code that
// needs a browser, and sleep-timer.js's real file would in turn pull
// in location.js and transport.js (which itself needs ~20 main.js
// exports). Mocking both main.js and sleep-timer.js directly, rather
// than also loading their real dependency chains, is what lets tick()
// load here at all.
mock.module(new URL('../../src/main.js', import.meta.url).href, {
  namedExports: {
    bgPosition(){}, addPlayedRange(){}, checkTrackCompletion(){},
    easeOutCubic(x){ return 1 - Math.pow(1 - x, 3); }, REDUCED: false,
  },
});
mock.module(new URL('../../src/player/sleep-timer.js', import.meta.url).href, {
  namedExports: { sleepCheckDeadline(){} },
});
// scrub.js (loaded below for angleDelta) imports pause/play/seek from
// transport.js, which has its own ~20-function main.js dependency list
// (step 3b) — mocked directly for the same reason as above.
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { pause(){}, play(){}, seek(){} },
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
