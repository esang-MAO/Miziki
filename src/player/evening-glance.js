/* ================= evening glance (phones) =================
   The phone counterpart of the desktop glance view (src/shell/player-
   overlay.js, TY7b): after sunset, an idle full player sheds its controls
   in two layers instead of one, so the platter and title are what's left
   on screen. CLAUDE.md "How Miziki behaves": less after dark.

   Pure: no DOM, no S. player-overlay.js owns the timers and classes and
   asks eveningGlanceLevel() which layer applies.

   Timings are short on purpose: an iPhone's default auto-lock is 30s, so
   both layers have to land before the screen sleeps to be seen at all. */

export const EVENING_GLANCE_FIRST_MS = 10000;
export const EVENING_GLANCE_DEEP_MS = 25000;

// Phases (src/sundown/day.js's seven) that count as "after dark" here.
// Dawn is left out: by then the platter is rising back toward the day.
const FIRST_PHASES = new Set(['twilight', 'night']);
const DEEP_PHASES = new Set(['night']);

// eveningGlanceLevel(idleMs, phase, playing) -> 0 | 1 | 2.
// 0: normal player. 1: controls faded (title, platter and a dim progress
// line stay). 2: only the platter and a dimmed title.
// Only while a record is actually playing: a paused player keeps its
// controls, since the next thing anyone wants there is Play.
export function eveningGlanceLevel(idleMs, phase, playing){
  if(!playing || !FIRST_PHASES.has(phase)) return 0;
  if(idleMs >= EVENING_GLANCE_DEEP_MS && DEEP_PHASES.has(phase)) return 2;
  if(idleMs >= EVENING_GLANCE_FIRST_MS) return 1;
  return 0;
}
