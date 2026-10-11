// A proper home for two small motion-related primitives that used to live
// as top-level main.js exports: the OS-level reduced-motion preference
// (read once, at module load, same as it always was) and the easing curve
// the put-away sequence's spin-down uses (src/shell/put-away.js — read by
// the render loop, src/player/clock.js). Moved out, step 7b.
export const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The disc's rotation normally snaps to 0 the instant S.playing goes false
// (see frame()). A put-away eases it down instead, over putSpinMs, read by
// the draw loop and cleared the moment it finishes or is cancelled — an
// ordinary pause is never touched by this.
export function easeOutCubic(x){ return 1 - Math.pow(1 - x, 3); }
