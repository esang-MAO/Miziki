/* ================= Day Arc v2: the dial (DAY_ARC_BRIEF.md §4) =================
   Pure functions, no DOM, no S import — same "testable without a browser"
   shape as arc.js/solar.js/day.js themselves. dialStateAt(now, sun,
   settings) gathers everything the Day view's dial + reading cards +
   event row need into one plain object, from arc.js's own exports — the
   DOM-painting module (dial-view.js) only ever reads this object, it
   never recomputes any of the day-model math itself. */
import { clamp } from '../util/math.js';
import { phaseAt, rateAt, trendAt, warmthAt, toneWordAt, skyPaletteNameAt, skyPhaseAt, skyBackgroundStops, skyRingStops } from './arc.js';

const MIN = 60000;
const DAY_MIN = 1440;

// §3.1's own formula: 0deg at 12:00 (top), 90deg at 18:00 (right), 180deg
// at 24:00 (bottom) — clockwise, matching CSS `transform:rotate()`'s own
// positive-is-clockwise convention directly, so dial-view.js can use this
// angle as-is with no further sign flip.
function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}
export function angleDegAt(date) {
  const deg = (minutesOfDay(date) / DAY_MIN) * 360 - 180;
  return ((deg % 360) + 360) % 360;
}

// angleDeltaMinutes(a, b) -> the signed minutes-of-day change from angle
// `b` to angle `a`, taking the shorter way around the ring (never more
// than half a turn) — the same shape and argument order as
// player/scrub.js's own angleDelta(a, b) (`d = a - b`, wrapped to
// +/-180), just scaled from degrees to minutes via angleDegAt's own
// inverse (1 degree = 1440/360 = 4 minutes). PR 5's drag gesture
// (dial-gesture.js) samples the pointer's angle on every pointermove and
// feeds consecutive samples through this to accumulate into
// S.previewMin — the same "many small deltas, not one absolute lookup"
// shape scrub.js's own spin-to-scrub already uses, which is also what
// makes multiple full turns (brief §4.4: "wraps... multiple turns are
// fine") work for free: a delta never has to resolve which lap it's on.
export function angleDeltaMinutes(a, b) {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d * (DAY_MIN / 360);
}

const fmtClock = date => {
  const h24 = date.getHours(), m = date.getMinutes();
  const h12 = h24 % 12 || 12;
  return { big: h12 + ':' + String(m).padStart(2, '0'), ampm: h24 < 12 ? 'AM' : 'PM' };
};
const fmtShortClock = date => {
  const h24 = date.getHours(), m = date.getMinutes();
  const h12 = h24 % 12 || 12;
  return h12 + ':' + String(m).padStart(2, '0') + (h24 < 12 ? 'A' : 'P');
};

// nextEventText(now, sun) -> { label: 'SUNRISE'|'SUNSET', text: 'IN N MIN'
// | 'IN NH NM' }. sun.rise/sun.set are each the *nearest calendar day's*
// transit to `now` (day.js's own property) — which can already be in the
// past relative to `now` (e.g. `now` well after today's sunset). Adding a
// full day when a transit has already passed is what turns "the nearest
// one" into "the next upcoming one," without ever needing tomorrow's
// actual sun.rise/sun.set. A loop, not a single +24h add: "Preview the
// day" can push `now` up to a full day ahead of real time (S.previewMin,
// max 1440), which can leave a single +24h still behind `now` whenever
// the previewed moment lands after the transit's own time of day *and*
// more than 24h past the stored transit itself — one add isn't always
// enough, and a result not strictly after `now` would otherwise go
// negative and get silently clamped to 0 by nextEventText's own
// Math.max(0, ...) below, reading as "IN 0 MIN" for an event that's
// actually hours away.
function nextOccurrence(now, transit) {
  const t = now.getTime();
  let tr = transit.getTime();
  while (tr <= t) tr += 24 * 3600000;
  return tr;
}
export function nextEventText(now, sun) {
  if (!sun || !sun.rise || !sun.set) return null;
  const nextRise = nextOccurrence(now, sun.rise), nextSet = nextOccurrence(now, sun.set);
  const toSunrise = nextRise < nextSet;
  const target = toSunrise ? nextRise : nextSet;
  const minsLeft = Math.max(0, Math.round((target - now.getTime()) / MIN));
  const text = minsLeft < 60 ? minsLeft + ' MIN' : Math.floor(minsLeft / 60) + 'H ' + (minsLeft % 60) + 'M';
  return { label: toSunrise ? 'SUNRISE' : 'SUNSET', text: 'IN ' + text };
}

// dialStateAt(now, sun, settings) -> everything dial-view.js's
// renderDialView() needs to paint, in one call. `settings` is the same
// {mode, auto, target, paceMode, recoveryWindowMs} shape rateInfoAt/
// driftOffsetsAt already take.
export function dialStateAt(now, sun, settings = {}) {
  const phase = phaseAt(now, sun);
  const rate = rateAt(now, sun, settings);
  const trend = trendAt(now, sun, settings);
  const tone = toneWordAt(now, sun);
  const paletteName = skyPaletteNameAt(now, sun, settings);
  const skyPhase = skyPhaseAt(now, sun, settings);
  const { big, ampm } = fmtClock(now);
  const nextEvent = nextEventText(now, sun);
  return {
    phase, phaseLabel: phase.toUpperCase(),
    timeBig: big, timeAmPm: ampm,
    platterPct: clamp(Math.round(rate * 100), 0, 100),
    trend, tone, paletteName,
    skyPhase, skyStops: skyBackgroundStops(skyPhase), ringStops: skyRingStops(sun),
    sunriseLabel: sun && sun.rise ? fmtShortClock(sun.rise) : '—',
    sunsetLabel: sun && sun.set ? fmtShortClock(sun.set) : '—',
    nextEvent,
    markerAngleDeg: angleDegAt(now),
    sunriseAngleDeg: sun && sun.rise ? angleDegAt(sun.rise) : null,
    sunsetAngleDeg: sun && sun.set ? angleDegAt(sun.set) : null,
    warmth: warmthAt(now, sun),
    // §4.4's own accessibility example verbatim ("5:58 PM, dusk") — a
    // slider's aria-valuenow is conventionally a plain number, so this
    // uses minutes-of-day (0..1439, wrapping every real day) rather than
    // the dial-gesture's own unbounded S.previewMin, which can run
    // negative or past 1440 across multiple drag turns.
    ariaValueNow: Math.round(minutesOfDay(now)) % DAY_MIN,
    ariaValueText: big + ' ' + ampm + ', ' + phase,
  };
}
