// Two small motion-related primitives: the OS-level reduced-motion
// preference and the easing curve the put-away sequence's spin-down uses
// (src/shell/put-away.js — read by the render loop, src/player/clock.js).
//
// AC5 (docs/39_ACCESSIBILITY.md): REDUCED used to be read once, at module
// load, so changing the OS setting while the app was already open (or
// already saved to the home screen) needed a relaunch to take effect.
// Every importer reads this as a live ES module binding (CLAUDE.md rule
// 7 — only this module itself may ever reassign it), so backing it with
// the query's own `.matches` and updating it on `change` is enough to
// make every existing `if(REDUCED)`/`!REDUCED` check everywhere else in
// the app (the platter spin in player/clock.js's frame(), the launch
// intro, every sheet/gatefold/sealed-front ceremony) follow the setting
// live, with no code at any of those call sites needing to change — they
// already re-read REDUCED each time they run.
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export let REDUCED = reducedMotionQuery.matches;
reducedMotionQuery.addEventListener('change', (e) => { REDUCED = e.matches; });

// The disc's rotation normally snaps to 0 the instant S.playing goes false
// (see frame()). A put-away eases it down instead, over putSpinMs, read by
// the draw loop and cleared the moment it finishes or is cancelled — an
// ordinary pause is never touched by this.
export function easeOutCubic(x){ return 1 - Math.pow(1 - x, 3); }
