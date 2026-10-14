import { test } from 'node:test';
import assert from 'node:assert/strict';

// NV5 (docs/11_SMOOTH_NAVIGATION.md): decideSwipeTrack()/shouldCommitClose()
// are pure -- no DOM, no touch events -- but src/shell/swipe-close.js has no
// imports of its own (unlike pull-refresh.js, it never reads REDUCED --
// see that file's own header comment for why), so nothing needs stubbing
// before importing it.
const {
  decideSwipeTrack, shouldCommitClose, wireSwipeToClose,
  SWIPE_AXIS_LOCK_PX, SWIPE_COMMIT_VELOCITY_PX_MS,
} = await import('../../src/shell/swipe-close.js');

test('decideSwipeTrack: stays idle before the axis-lock distance is reached', () => {
  assert.equal(decideSwipeTrack({ dy: SWIPE_AXIS_LOCK_PX - 1, dx: 0 }), 'idle');
  assert.equal(decideSwipeTrack({ dy: 0, dx: SWIPE_AXIS_LOCK_PX - 1 }), 'idle');
});

test('decideSwipeTrack: a mostly-sideways drag past the lock distance cancels, never arms', () => {
  assert.equal(decideSwipeTrack({ dy: 5, dx: 40 }), 'cancel');
});

test('decideSwipeTrack: moving up (dy <= 0) past the lock distance cancels -- a sheet only ever closes downward', () => {
  assert.equal(decideSwipeTrack({ dy: -20, dx: 0 }), 'cancel');
  assert.equal(decideSwipeTrack({ dy: 0, dx: SWIPE_AXIS_LOCK_PX }), 'cancel');
});

test('decideSwipeTrack: a confirmed downward drag is "dragging"', () => {
  assert.equal(decideSwipeTrack({ dy: SWIPE_AXIS_LOCK_PX, dx: 0 }), 'dragging');
  assert.equal(decideSwipeTrack({ dy: 500, dx: 2 }), 'dragging');
});

test('shouldCommitClose: a drag past a third of the sheet\'s own height commits, even at zero velocity', () => {
  assert.equal(shouldCommitClose({ dy: 200, velocity: 0, sheetHeight: 600 }), true); // 200 >= 600/3
  assert.equal(shouldCommitClose({ dy: 199, velocity: 0, sheetHeight: 600 }), false);
});

test('shouldCommitClose: a fast flick commits even on a short drag', () => {
  assert.equal(shouldCommitClose({ dy: 10, velocity: SWIPE_COMMIT_VELOCITY_PX_MS, sheetHeight: 600 }), true);
  assert.equal(shouldCommitClose({ dy: 10, velocity: SWIPE_COMMIT_VELOCITY_PX_MS - 0.01, sheetHeight: 600 }), false);
});

test('shouldCommitClose: never commits on an upward or zero-distance release, or with no measured height', () => {
  assert.equal(shouldCommitClose({ dy: 0, velocity: 10, sheetHeight: 600 }), false);
  assert.equal(shouldCommitClose({ dy: -50, velocity: 10, sheetHeight: 600 }), false);
  assert.equal(shouldCommitClose({ dy: 500, velocity: 10, sheetHeight: 0 }), false);
});

// ---- wireSwipeToClose: the DOM-wiring half. A small but real fake touch
// surface (real addEventListener, so a test can fire the exact handler the
// real one would), the same convention tests/unit/home.test.js's own
// fakeEl() already established for this suite.
function fakeSheetEl({ scrollTop = 0, height = 600 } = {}){
  const listeners = {};
  return {
    scrollTop,
    style: {},
    addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
    getBoundingClientRect(){ return { height }; },
    _fire(type, ev){ (listeners[type] || []).forEach(fn => fn(ev)); },
  };
}
function touch(x, y){ return { touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] }; }

test('wireSwipeToClose: a drag past the commit threshold calls onClose', () => {
  const el = fakeSheetEl({ height: 300 }); // a third of 300 is 100
  let closed = 0;
  wireSwipeToClose(el, { onClose: () => closed++ });
  el._fire('touchstart', { touches: [{ clientX: 0, clientY: 0 }] });
  el._fire('touchmove', { ...touch(0, 150), preventDefault(){} });
  el._fire('touchend', touch(0, 150));
  assert.equal(closed, 1);
  assert.equal(el.style.transform, '', 'cleared back to the CSS class\'s own target, not left mid-drag');
});

test('wireSwipeToClose: a short, slow drag springs back without closing', async () => {
  const el = fakeSheetEl({ height: 300 }); // a third of 300 is 100
  let closed = 0;
  wireSwipeToClose(el, { onClose: () => closed++ });
  el._fire('touchstart', { touches: [{ clientX: 0, clientY: 0 }] });
  el._fire('touchmove', { ...touch(0, 20), preventDefault(){} });
  // a real pause, so the release reads as a slow drag (low px/ms) rather
  // than the effectively-infinite velocity a synchronous touchend would
  // otherwise compute -- shouldCommitClose()'s own velocity branch is
  // exercised by the fast-flick test above instead, with real numbers.
  await new Promise(r => setTimeout(r, 200));
  el._fire('touchend', touch(0, 20));
  assert.equal(closed, 0);
  assert.equal(el.style.transform, '');
});

test('wireSwipeToClose: a mostly-sideways drag cancels and never closes', () => {
  const el = fakeSheetEl({ height: 300 });
  let closed = 0;
  wireSwipeToClose(el, { onClose: () => closed++ });
  el._fire('touchstart', { touches: [{ clientX: 0, clientY: 0 }] });
  el._fire('touchmove', { ...touch(80, 5), preventDefault(){} });
  el._fire('touchend', touch(80, 5));
  assert.equal(closed, 0);
});

test('wireSwipeToClose: never starts a gesture while the sheet\'s own content is scrolled down', () => {
  const el = fakeSheetEl({ scrollTop: 40, height: 300 });
  let closed = 0;
  wireSwipeToClose(el, { onClose: () => closed++ });
  el._fire('touchstart', { touches: [{ clientX: 0, clientY: 0 }] });
  el._fire('touchmove', { ...touch(0, 200), preventDefault(){} });
  el._fire('touchend', touch(0, 200));
  assert.equal(closed, 0, 'a drag starting mid-scroll must never be read as a close gesture');
});

test('wireSwipeToClose: isValidStart gates where a drag may even begin (the full player\'s own disc exclusion)', () => {
  const el = fakeSheetEl({ height: 300 });
  let closed = 0;
  const onDisc = { closest: () => true };
  const offDisc = { closest: () => false };
  wireSwipeToClose(el, {
    onClose: () => closed++,
    isValidStart: (ev) => !ev.target.closest('#platterStage'),
  });
  el._fire('touchstart', { touches: [{ clientX: 0, clientY: 0 }], target: onDisc });
  el._fire('touchmove', { ...touch(0, 200), preventDefault(){} });
  el._fire('touchend', touch(0, 200));
  assert.equal(closed, 0, 'a drag starting on the disc must never close the player');

  el._fire('touchstart', { touches: [{ clientX: 0, clientY: 0 }], target: offDisc });
  el._fire('touchmove', { ...touch(0, 200), preventDefault(){} });
  el._fire('touchend', touch(0, 200));
  assert.equal(closed, 1, 'the same drag starting off the disc does close it');
});

test('wireSwipeToClose: touchcancel resets exactly like a spring-back release', () => {
  const el = fakeSheetEl({ height: 300 });
  let closed = 0;
  wireSwipeToClose(el, { onClose: () => closed++ });
  el._fire('touchstart', { touches: [{ clientX: 0, clientY: 0 }] });
  el._fire('touchmove', { ...touch(0, 150), preventDefault(){} });
  el._fire('touchcancel', {});
  assert.equal(closed, 0);
  assert.equal(el.style.transform, '');
});
