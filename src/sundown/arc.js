/* ================= Day Arc v2 (DAY_ARC_BRIEF.md) =================
   Pure functions, no DOM, no S import — same "testable without a browser"
   shape as sundown/solar.js / day.js themselves. This module implements
   the brief's own day model: a 4-phase label (phaseAt), the platter-rate
   curve with the new fixed-window recovery leg (rateAt/trendAt), the
   tone-drift warmth scalar (warmthAt), and the sky palette lookups
   (skyBackgroundStops/skyRingStops) — all as pure functions of
   (time, sun, settings), per the brief's own §3.3 rule ("no stored ramp
   state").

   `sun` throughout is the existing dayEvents()-shaped object
   (dawn/rise/noon/set/dusk, S.sun's own five fields) — the brief's own
   instruction is "use the existing solar code" and "no usable sunrise:
   use the existing fallback sun, do not invent new fallback logic," so
   this module never computes its own sun times; it only ever reads
   whichever sun object (real or location.js's fallbackSun()) it's given.

   Midnight-wrap note: dayEvents()/solarEvent() already resolve each of
   dawn/rise/noon/set/dusk to whichever calendar day's transit is nearest
   to `now` (src/sundown/day.js's own comment on this). rateAt()/phaseAt()
   below rely on that same property the way day.js's dayPosition() does:
   checking `t < sun.rise` first (which, by that nearest-transit property,
   is only ever true when `now` is genuinely approaching an upcoming
   sunrise — see the inline comments below) before ever consulting
   sun.set/sun.dusk, so a pre-dawn `now` never accidentally compares
   against "today's" not-yet-happened evening values. */
import { clamp } from '../util/math.js';

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY_MS = 24 * HOUR;

// §3.3: "Default RECOVERY_WINDOW = 2h. Make it a named constant so it can
// be tuned by ear (try 90 min to 3 h)." Not user-facing yet (§7).
export const RECOVERY_WINDOW_MS = 2 * HOUR;

const smooth = p => p * p * (3 - 2 * p);
// Mirrors solar.js's own pace() exactly (Window spreads evenly; Moment
// holds back then moves near the end) — the down-leg keeps using this,
// per the brief's "do not rewrite the existing down-leg, replace with
// whatever the real code does."
function pace(local, paceMode) {
  const p = clamp(local, 0, 1);
  return paceMode === 'moment' ? smooth(clamp((p - 0.62) / 0.38, 0, 1)) : smooth(p);
}

/* ---------------- 3.2 Phases (DAWN/DAY/DUSK/NIGHT) ---------------- */

const DAWN_LEAD_MIN = 31;
const DUSK_LEAD_MIN = 32;
const DUSK_TRAIL_MIN = 43;

// phaseAt(now, sun) -> 'dawn' | 'day' | 'dusk' | 'night'. §3.2's own table,
// expressed as fixed-minute offsets from sunrise/sunset only (not civil
// twilight) — independent of rateAt()'s own RECOVERY_WINDOW. Falls back
// to 'day' with no usable sun data, the same conservative "no data yet"
// default the rest of this file uses.
export function phaseAt(now, sun) {
  if (!sun || !sun.rise || !sun.set) return 'day';
  const t = now.getTime();
  const riseT = sun.rise.getTime(), setT = sun.set.getTime();
  const dawnStart = riseT - DAWN_LEAD_MIN * MIN;
  const duskStart = setT - DUSK_LEAD_MIN * MIN;
  const duskEnd = setT + DUSK_TRAIL_MIN * MIN;
  if (t >= dawnStart && t < riseT) return 'dawn';
  if (t >= riseT && t < duskStart) return 'day';
  if (t >= duskStart && t < duskEnd) return 'dusk';
  return 'night';
}

/* ---------------- 3.3 Platter speed ---------------- */

// rateInfoAt(now, sun, settings) -> { rate, trend }. settings:
//   mode: S.mode ('pure' wins over everything, rate 1, no recovery)
//   auto: S.auto (false = manual speed override; brief: wins over
//         everything the same way Pure does — the day-arc curve itself
//         contributes nothing, 1.0, letting the caller's own manual rate
//         apply outside this function, same as today)
//   target: the floor (S.target)
//   paceMode: S.pace ('window' | 'moment'), applied to the down-leg only —
//         unchanged shape from solar.js's own easedProgress()/pace()
//   recoveryWindowMs: defaults to RECOVERY_WINDOW_MS
//
// Down-leg (sunset -> dusk) and the post-dusk hold are untouched from
// today's behavior/shape (just re-expressed here); the recovery leg
// (riseT - recoveryWindowMs -> riseT) is the new part (§3.3).
export function rateInfoAt(now, sun, settings = {}) {
  const { mode, auto, target = 1, paceMode = 'window', recoveryWindowMs = RECOVERY_WINDOW_MS } = settings;
  if (mode === 'pure') return { rate: 1, trend: 'full' };
  if (auto === false) return { rate: 1, trend: 'full' };
  if (!sun || !sun.set || !sun.dusk || !sun.rise) return { rate: 1, trend: 'full' };

  const t = now.getTime();
  const riseT = sun.rise.getTime(), setT = sun.set.getTime(), duskT = sun.dusk.getTime();
  const lo = Math.min(1, target), hi = Math.max(1, target);

  // `t < riseT` is only ever true here when `now` is genuinely approaching
  // the upcoming sunrise (see the module header) — so this branch alone
  // decides the whole pre-sunrise half of the night, with no need to
  // consult sun.set/sun.dusk (which, for a pre-dawn `now`, name *this
  // transit's own* evening — still hours in the future, not the dusk that
  // actually preceded this stretch of night).
  if (t < riseT) {
    const recoveryStart = riseT - recoveryWindowMs;
    if (t >= recoveryStart) {
      const p = smooth(clamp((t - recoveryStart) / (recoveryWindowMs || 1), 0, 1));
      return { rate: clamp(target + (1 - target) * p, lo, hi), trend: 'rising' };
    }
    return { rate: clamp(target, lo, hi), trend: 'floor' };
  }
  if (t < setT) return { rate: 1, trend: 'full' };
  if (t < duskT) {
    const p = pace((t - setT) / (duskT - setT || 1), paceMode);
    return { rate: clamp(1 + (target - 1) * p, lo, hi), trend: 'down' };
  }
  // t >= duskT, and we already know t >= riseT (the first branch would
  // otherwise have matched) — the ordinary post-dusk hold, continuing
  // until the (stale-from-here, genuinely upcoming-elsewhere) riseT.
  return { rate: clamp(target, lo, hi), trend: 'floor' };
}

export function rateAt(now, sun, settings = {}) {
  return rateInfoAt(now, sun, settings).rate;
}

const TREND_LABEL = { down: 'Easing down', floor: 'Slowest', rising: 'Rising', full: 'Full speed' };

export function trendAt(now, sun, settings = {}) {
  return TREND_LABEL[rateInfoAt(now, sun, settings).trend];
}

/* ---------------- 3.4 Tone drift: warmth ---------------- */

// warmthAt(now, sun) -> w in [0,1]. 0 at solar noon, 1 at solar midnight,
// a plain cosine of continuous time around sun.noon — continuous
// everywhere, midnight included, by construction (no branch at all).
// Falls back to a neutral 0.5 with no usable solar noon, the same
// "no data yet" posture as phaseAt's own fallback.
export function warmthAt(now, sun) {
  if (!sun || !sun.noon) return 0.5;
  const t = now.getTime(), noon = sun.noon.getTime();
  const phase = 2 * Math.PI * ((t - noon) / DAY_MS);
  return (1 - Math.cos(phase)) / 2;
}

/* ---------------- 3.5 Sky ---------------- */

// §3.5B: the screen-background gradient, chosen by phase (phaseAt's own
// 4-phase label, plus 'pre-dawn' — the brief's own table names five rows,
// one more than phaseAt's four, splitting 'night' into the settled night
// hold and its own pre-dawn (recovering) tail. skyPhaseAt() below is that
// fifth-phase split, used only for picking a background row — phaseAt()
// itself is unchanged, still exactly the brief's §3.2 four labels.
const SKY_STOPS = {
  dusk: ['#0b1030', '#2b2358', '#8a3f5f', '#e9733f', '#3a2a3e', '#0f1a23'],
  night: ['#03050d', '#080d24', '#101a45', '#1c2a63', '#121a38', '#0f1a23'],
  'pre-dawn': ['#03050d', '#0b1030', '#1c2a63', '#4a3a78', '#2a2442', '#0f1a23'],
  dawn: ['#1c2a63', '#5a4a8a', '#b86a82', '#f2a38a', '#3a2a3e', '#0f1a23'],
  day: ['#123a5c', '#2c6f9c', '#5ea4cc', '#8ec5e6', '#1c3346', '#0f1a23'],
};

// skyPhaseAt(now, sun, settings) -> one of the five background-row keys
// above. 'night' is split into plain 'night' and 'pre-dawn' by whether
// the recovery leg has started yet (rateInfoAt's own 'rising' trend) —
// the same boundary the dial's own Platter reading already uses, so the
// sky and the trend label always agree on where "pre-dawn" begins.
export function skyPhaseAt(now, sun, settings = {}) {
  const p = phaseAt(now, sun);
  if (p === 'dusk' || p === 'dawn' || p === 'day') return p;
  // p === 'night'
  const { trend } = rateInfoAt(now, sun, settings);
  return trend === 'rising' ? 'pre-dawn' : 'night';
}

export function skyBackgroundStops(skyPhase) {
  return SKY_STOPS[skyPhase] || SKY_STOPS.day;
}

const minutesOfDay = date => date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
const wrapMin = m => ((m % 1440) + 1440) % 1440;

// skyRingStops(sun) -> [{ min, color }, ...], sorted by minute-of-day
// (0..1440), for the §3.5A conic ring — "stops defined relative to the
// solar anchors, not fixed angles." Empty with no usable sun (caller
// falls back to a plain ring, not this module's concern).
export function skyRingStops(sun) {
  if (!sun || !sun.rise || !sun.set) return [];
  const riseMin = minutesOfDay(sun.rise), setMin = minutesOfDay(sun.set);
  const stops = [
    { min: wrapMin(riseMin + 49), color: '#8ec5e6' },
    { min: wrapMin(setMin - 52), color: '#8ec5e6' },
    { min: wrapMin(setMin), color: '#e8744f' },
    { min: wrapMin(setMin + 60), color: '#7a3d6a' },
    { min: wrapMin(setMin + 116), color: '#1c2a63' },
    { min: wrapMin(riseMin - 79), color: '#1c2a63' },
    { min: wrapMin(riseMin - 23), color: '#b86a82' },
    { min: wrapMin(riseMin), color: '#f2a38a' },
  ];
  return stops.sort((a, b) => a.min - b.min);
}
