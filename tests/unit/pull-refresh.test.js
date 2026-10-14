import { test } from 'node:test';
import assert from 'node:assert/strict';

// NV4 (docs/11_SMOOTH_NAVIGATION.md): decidePull()/pullTravel()/
// shouldThrottle() are pure -- no DOM, no touch events -- but the module
// itself imports util/motion.js, whose REDUCED export reads
// window.matchMedia at module load (the same stub shell.test.js already
// needs for the same reason), so `window` has to exist before this module
// is ever imported -- a dynamic import, after the stub, rather than a
// static one at the top of the file.
globalThis.window = { matchMedia(){ return { matches: false }; } };

const {
  decidePull, pullTravel, shouldThrottle,
  PULL_AXIS_LOCK_PX, PULL_THRESHOLD_PX, PULL_MAX_TRAVEL_PX, REFRESH_THROTTLE_MS,
} = await import('../../src/shell/pull-refresh.js');

test('decidePull: starts only at the top -- any startScrollY > 0 is idle no matter the drag', () => {
  assert.equal(decidePull({ dy: 200, dx: 0, startScrollY: 1 }), 'idle');
  assert.equal(decidePull({ dy: 200, dx: 0, startScrollY: 500 }), 'idle');
});

test('decidePull: stays idle before the axis-lock distance is reached', () => {
  assert.equal(decidePull({ dy: PULL_AXIS_LOCK_PX - 1, dx: 0, startScrollY: 0 }), 'idle');
  assert.equal(decidePull({ dy: 0, dx: PULL_AXIS_LOCK_PX - 1, startScrollY: 0 }), 'idle');
});

test('decidePull: a mostly-sideways drag past the lock distance cancels, never arms', () => {
  assert.equal(decidePull({ dy: 5, dx: 40, startScrollY: 0 }), 'cancel');
});

test('decidePull: moving back up (dy <= 0) past the lock distance cancels', () => {
  assert.equal(decidePull({ dy: -20, dx: 0, startScrollY: 0 }), 'cancel');
  assert.equal(decidePull({ dy: 0, dx: PULL_AXIS_LOCK_PX, startScrollY: 0 }), 'cancel');
});

test('decidePull: pulling below the threshold is "pulling", at or past it is "armed"', () => {
  const justBelow = (PULL_THRESHOLD_PX / 0.5) - 1; // PULL_RESISTANCE is 0.5
  const atThreshold = PULL_THRESHOLD_PX / 0.5;
  assert.equal(decidePull({ dy: justBelow, dx: 0, startScrollY: 0 }), 'pulling');
  assert.equal(decidePull({ dy: atThreshold, dx: 0, startScrollY: 0 }), 'armed');
});

test('decidePull: travel caps at PULL_MAX_TRAVEL_PX -- an enormous drag still just reads "armed"', () => {
  assert.equal(decidePull({ dy: 100000, dx: 0, startScrollY: 0 }), 'armed');
});

test('pullTravel: the resistance curve (move = pull * 0.5), capped at PULL_MAX_TRAVEL_PX, never negative', () => {
  assert.equal(pullTravel(100), 50);
  assert.equal(pullTravel(0), 0);
  assert.equal(pullTravel(-50), 0);
  assert.equal(pullTravel(100000), PULL_MAX_TRAVEL_PX);
});

test('shouldThrottle: true inside the 10s window, false once it has elapsed', () => {
  assert.equal(shouldThrottle(1000, 1000 + REFRESH_THROTTLE_MS - 1), true);
  assert.equal(shouldThrottle(1000, 1000 + REFRESH_THROTTLE_MS), false);
  // lastRefreshAt starts at 0 ("never refreshed yet") -- in real usage `now`
  // is always a real Date.now() timestamp, so this reads as "plenty of time
  // has passed since never," never as a same-instant collision.
  assert.equal(shouldThrottle(0, REFRESH_THROTTLE_MS), false);
});
