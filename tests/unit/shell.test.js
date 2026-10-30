import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// util/motion.js's REDUCED is read once, at module load, from
// window.matchMedia -- there's no browser `window` in Node, so it's
// stubbed here (matches: false) before anything imports the real module.
// This lets both easeOutCubic and shouldPutAway (which reads REDUCED
// through shell/put-away.js) run as the genuine, unmocked code rather
// than a re-implementation, the same "test the real thing, stub only what
// a browser would otherwise provide" approach prefs.test.js/idb.test.js use.
globalThis.window = { matchMedia(){ return { matches: false }; } };

// shell/put-away.js's own non-pure imports (mini-player.js for
// SLEEVE_ANIM/renderMiniPlayer, start-sequence.js for waitAnimEnd/
// sleeveArtFor) are only used by putAwayInstant/runPutAwaySequence, not by
// shouldPutAway/clearSpinDown — but an ES module evaluates its whole import
// graph regardless of which export is actually used, and mini-player.js's
// own real chain reaches player/background.js -> player/controls.js ->
// storage/meta.js -> audio/mode.js, the same "stop the chain at the door"
// reasoning as every other mock-heavy file in this suite. Mocked directly
// here since this file only wants the two pure decisions.
mock.module(new URL('../../src/shell/mini-player.js', import.meta.url).href, {
  namedExports: { SLEEVE_ANIM: { putSpinMs: 500 }, renderMiniPlayer(){} },
});
mock.module(new URL('../../src/shell/start-sequence.js', import.meta.url).href, {
  namedExports: { waitAnimEnd: async () => {}, sleeveArtFor(){}, applySleeveWear(){} },
});

const { easeOutCubic } = await import('../../src/util/motion.js');
const { shouldPutAway } = await import('../../src/shell/put-away.js');
const { S } = await import('../../src/state.js');

test('easeOutCubic: 0 and 1 are the curve\'s own fixed points', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
});

test('easeOutCubic: matches the documented formula at the midpoint', () => {
  // 1 - (1 - 0.5)^3 = 1 - 0.125 = 0.875
  assert.ok(Math.abs(easeOutCubic(0.5) - 0.875) < 1e-9);
});

test('easeOutCubic: monotonically increasing across the whole 0..1 range', () => {
  let prev = -Infinity;
  for (let x = 0; x <= 1; x += 0.05) {
    const y = easeOutCubic(x);
    assert.ok(y >= prev, `expected easeOutCubic(${x})=${y} >= previous ${prev}`);
    prev = y;
  }
});

// shouldPutAway(auto) = auto && S.sleevePullEnabled && !REDUCED (REDUCED is
// stubbed false above throughout this file, via window.matchMedia) --
// advance()'s end-of-queue branch passes `auto` to tell a real finish
// (true) apart from a manual skip (false); the sleeve-pull setting and
// reduced-motion are both independent gates on top of that.
test('shouldPutAway: true only when auto, sleevePullEnabled, and not reduced-motion', () => {
  S.sleevePullEnabled = true;
  assert.equal(shouldPutAway(true), true);
});

test('shouldPutAway: false for a manual skip (auto=false), even with the setting on', () => {
  S.sleevePullEnabled = true;
  assert.equal(shouldPutAway(false), false);
});

test('shouldPutAway: false when the sleeve-pull setting itself is off', () => {
  S.sleevePullEnabled = false;
  assert.equal(shouldPutAway(true), false);
});
