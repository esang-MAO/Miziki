// AC5 (docs/39_ACCESSIBILITY.md, finding 9): REDUCED used to be read once,
// at module load, so changing the OS's Reduce Motion setting while the app
// was already open needed a relaunch to take effect. It's now backed by
// the media query's own live `.matches`, updated on `change` -- every
// other module imports it as an ordinary ES binding and already re-reads
// it each time it runs (see motion.js's own header comment), so this is
// the one place that needs a direct test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

let changeListener = null;
const mediaQueryList = {
  matches: false,
  addEventListener(type, fn){ if(type === 'change') changeListener = fn; },
};
globalThis.window = { matchMedia(){ return mediaQueryList; } };

const { REDUCED, easeOutCubic } = await import('../../src/util/motion.js');

test('REDUCED starts at the media query\'s own matches value', () => {
  assert.equal(REDUCED, false);
});

test('REDUCED follows a live change event, with no relaunch', async () => {
  assert.ok(changeListener, 'motion.js should register a change listener on the query');
  changeListener({ matches: true });
  const motion = await import('../../src/util/motion.js');
  assert.equal(motion.REDUCED, true);
  changeListener({ matches: false });
  assert.equal(motion.REDUCED, false);
});

test('easeOutCubic is unaffected by any of this', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
});
