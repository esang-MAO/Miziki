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
  // sun.rise is checked separately below (not here): a sun object with
  // only set/dusk known (no usable sunrise — the brief's own "polar
  // day/night, no location" case, or a legacy/partial fixture) still
  // drives the existing down-leg/floor/hold shape correctly; it just
  // never recovers, since there's no sunrise to recover toward. This
  // mirrors day.js's own "legacy/partial data" fallback for exactly the
  // same reason (see that file's own comment on the shape).
  if (!sun || !sun.set || !sun.dusk) return { rate: 1, trend: 'full' };

  const t = now.getTime();
  const setT = sun.set.getTime(), duskT = sun.dusk.getTime();
  const riseT = sun.rise ? sun.rise.getTime() : null;
  const lo = Math.min(1, target), hi = Math.max(1, target);

  // `t < riseT` is only ever true here when `now` is genuinely approaching
  // the upcoming sunrise (see the module header) — so this branch alone
  // decides the whole pre-sunrise half of the night, with no need to
  // consult sun.set/sun.dusk (which, for a pre-dawn `now`, name *this
  // transit's own* evening — still hours in the future, not the dusk that
  // actually preceded this stretch of night).
  if (riseT !== null && t < riseT) {
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

// toneWordAt(now, sun) -> 'BRIGHT' | 'OPENING' | 'WARMING' | 'WARM' — §3.4's
// own word table, read off warmthAt() and its own direction (brightening
// after midnight toward noon = OPENING, warming after noon toward midnight
// = WARMING), using the brief's own thresholds on brightness = 1 - w.
// Falls back to 'BRIGHT' with no usable solar noon — the same "no data
// yet, default to the full/day state" posture rateInfoAt/phaseAt already
// take, rather than a fifth, undocumented word.
export function toneWordAt(now, sun) {
  if (!sun || !sun.noon) return 'BRIGHT';
  const w = warmthAt(now, sun);
  const brightness = 1 - w;
  if (brightness <= 0.12) return 'WARM';
  if (brightness >= 0.93) return 'BRIGHT';
  const t = now.getTime(), noon = sun.noon.getTime();
  const rad = 2 * Math.PI * ((t - noon) / DAY_MS);
  return Math.sin(rad) > 0 ? 'WARMING' : 'OPENING';
}

/* ---------------- 3.4 Tone drift: per-parameter offsets ---------------- */

// §3.4's own table — direction and size, as a fraction of each parameter's
// own 0..1 range, at Full intensity. Bus compression is deliberately 0
// ("unchanged") — DA2's old anchor table (sundown/drift.js) drifted it
// too, but this brief's own table does not, and this is an implementation
// of what the brief specifies, not a carry-over of DA2's shape.
const DRIFT_SIZE = { wow: 0.30, sat: 0.27, soft: 0.27, comp: 0 };

// "Subtle is roughly one third of Full" (§3.4) — deliberately its own
// scale, not DA2's {off:0, subtle:0.5, full:1} (sundown/drift.js's
// INTENSITY_SCALE): a different table with different per-parameter sizes
// gets its own proportion rather than inheriting DA2's.
export const DRIFT_SCALE = { off: 0, subtle: 1 / 3, full: 1 };

// driftOffsetsAt(now, sun, intensity) -> {wow, sat, soft, comp}, each an
// additive offset onto the user's own 0..1 Character slider value.
// Unlike DA2's driftOffsets() (an anchor table that can push either warmer
// or brighter than the user's own baseline), warmth w(t) only ever rises
// off of 0 at its brightest (solar noon) — so every offset here is >= 0;
// "softer / warmer / more" is the only direction §3.4's table names.
export function driftOffsetsAt(now, sun, intensity) {
  const scale = DRIFT_SCALE[intensity] || 0;
  if (scale === 0) return { wow: 0, sat: 0, soft: 0, comp: 0 };
  const f = warmthAt(now, sun) * scale;
  return { wow: DRIFT_SIZE.wow * f, sat: DRIFT_SIZE.sat * f, soft: DRIFT_SIZE.soft * f, comp: DRIFT_SIZE.comp * f };
}

// effectiveCharAt(userChar, now, sun, intensity) -> {wow, sat, soft, comp},
// each clamp(user + offset, 0, 1) — the Day Arc v2 replacement for
// sundown/drift.js's effectiveChar(); src/audio/engine.js's
// applyCharacter() is the one real caller (PR 3, DAY_ARC_BRIEF.md).
// userChar is a plain {wow,sat,soft,comp} object (S.char itself, or
// anything shaped like it); never mutated.
export function effectiveCharAt(userChar, now, sun, intensity) {
  const o = driftOffsetsAt(now, sun, intensity);
  return {
    wow: clamp(userChar.wow + o.wow, 0, 1),
    sat: clamp(userChar.sat + o.sat, 0, 1),
    soft: clamp(userChar.soft + o.soft, 0, 1),
    comp: clamp(userChar.comp + o.comp, 0, 1),
  };
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

// §4.2's own SKY reading-card palette names, one per skyPhaseAt() row —
// 'night' and 'pre-dawn' deliberately share one name (INDIGO): the brief
// names only four palette words for five background rows.
const SKY_PALETTE_NAME = { dusk: 'EMBER', night: 'INDIGO', 'pre-dawn': 'INDIGO', dawn: 'ROSE', day: 'AZURE' };

export function skyPaletteNameAt(now, sun, settings = {}) {
  return SKY_PALETTE_NAME[skyPhaseAt(now, sun, settings)] || 'AZURE';
}

const minutesOfDay = date => date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;

// RF14 (docs/12_REFINE.md, point 3): "the dial ring takes its colors from
// the anchor table, about 15% less saturated, instead of a palette of its
// own" -- replacing the eight hand-picked EMBER/INDIGO/ROSE/AZURE-family
// hexes above with the seven already-contrast-checked phase colors from
// docs/design/refine/README.md's own "Dial ring" row (the desaturation is
// already baked into these literal hexes, not recomputed here). Only the
// ring changes -- SKY_STOPS/skyBackgroundStops/skyPaletteNameAt above are
// untouched, still their own four/five-row palette for the reading card's
// background and palette name, which RF14 doesn't mention.
const RING_PHASE_COLOR = {
  night: '#8578AE', dawn: '#CFA0AD', morning: '#98C2CE', midday: '#D8D3C9',
  afternoon: '#CBBD9C', golden: '#E8B67A', twilight: '#D99A5A',
};

// The same MORNING_SPAN_MS/GOLDEN_SPAN_MS-shaped phase-boundary clamping
// src/sundown/day.js's own dayPosition() uses (3h morning span off
// sunrise, 1h golden span off sunset, clamped so nothing overlaps or runs
// backward on a very short day) -- duplicated here in minutes-of-day
// rather than imported, since this file deliberately keeps its own
// independent DAWN/DAY/DUSK/NIGHT phase model (phaseAt(), this file's own
// header comment) apart from day.js's 7-phase dayPosition() model; the
// ring is the one place Day Arc v2 borrows that *other* model's phase
// boundaries (for exactly the seven colors above), so this is the same
// "duplicate the small shared formula rather than wire two independent
// systems together" call CLAUDE.md documents for sync/images.js's own
// crop logic and player/clock.js's own PHASE_COLOR duplication.
const RING_MORNING_SPAN_MIN = 180;
const RING_GOLDEN_SPAN_MIN = 60;

// skyRingStops(sun) -> [{ min, color }, ...], sorted by minute-of-day
// (0..1440), for the §3.5A conic ring — "stops defined relative to the
// solar anchors, not fixed angles." Empty with no usable sun (caller
// falls back to a plain ring, not this module's concern). Needs dawn/
// dusk too (not just rise/set), since the ring now needs all seven named
// anchors, not just a day/night split.
export function skyRingStops(sun) {
  if (!sun || !sun.dawn || !sun.rise || !sun.noon || !sun.set || !sun.dusk) return [];
  const dawnMin = minutesOfDay(sun.dawn), riseMin = minutesOfDay(sun.rise);
  const noonMin = minutesOfDay(sun.noon), setMin = minutesOfDay(sun.set), duskMin = minutesOfDay(sun.dusk);
  const goldenStart = Math.max(setMin - RING_GOLDEN_SPAN_MIN, riseMin);
  const morningEnd = Math.min(riseMin + RING_MORNING_SPAN_MIN, goldenStart);
  // Midday/Afternoon boundary: the same "midpoint between solar noon and
  // sunset, clamped so it never falls before noon or after sunset" rule
  // src/sundown/day.js's own dayPosition() uses for this exact split --
  // duplicated per this function's own header comment. Splitting exactly
  // at noon itself (an earlier version of this code) put solar noon on
  // the Midday/Afternoon boundary, where a conic-gradient's own same-
  // position stop-ordering rule (colorAt's header comment above) resolves
  // to whichever color is listed *second*, i.e. Afternoon -- silently
  // breaking "solar noon always falls inside the midday span."
  const noonSetMid = clamp((noonMin + setMin) / 2, noonMin, setMin);
  const middaySplit = Math.min(Math.max(noonSetMid, morningEnd), goldenStart);

  // Each phase gets two stops of its own flat color (start, end) --
  // "at the clock angles of today's events," a hard edge at every real
  // boundary rather than a soft invented blend the design doc doesn't
  // specify. Pushed in strict chronological order from midnight (0) to
  // midnight (1440), with Night split into its own pre-dawn and post-dusk
  // halves at those two endpoints — this is what lets a plain ascending
  // sort (stable, so ties at a shared boundary keep the "ending phase
  // first, starting phase second" order this list is already in) close
  // the ring correctly with no separate wrap-around case to special-case.
  const seg = (from, to, color) => ([{ min: from, color }, { min: to, color }]);
  const stops = [
    ...seg(0, dawnMin, RING_PHASE_COLOR.night),
    ...seg(dawnMin, riseMin, RING_PHASE_COLOR.dawn),
    ...seg(riseMin, morningEnd, RING_PHASE_COLOR.morning),
    ...seg(morningEnd, middaySplit, RING_PHASE_COLOR.midday),
    ...seg(middaySplit, goldenStart, RING_PHASE_COLOR.afternoon),
    ...seg(goldenStart, setMin, RING_PHASE_COLOR.golden),
    ...seg(setMin, duskMin, RING_PHASE_COLOR.twilight),
    ...seg(duskMin, 1440, RING_PHASE_COLOR.night),
  ];
  return stops.sort((a, b) => a.min - b.min);
}
