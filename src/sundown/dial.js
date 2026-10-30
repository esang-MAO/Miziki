/* ================= Day Arc v2: the dial (DAY_ARC_BRIEF.md §4) =================
   Pure functions, no DOM, no S import — same "testable without a browser"
   shape as arc.js/solar.js/day.js themselves. dialStateAt(now, sun,
   settings) gathers everything the Day view's dial + reading cards +
   event row need into one plain object, from arc.js's own exports — the
   DOM-painting module (dial-view.js) only ever reads this object, it
   never recomputes any of the day-model math itself. */
import { clamp } from '../util/math.js';
import { phaseAt, rateInfoAt, trendAt, warmthAt, toneWordAt, skyPaletteNameAt, skyPhaseAt, skyBackgroundStops, skyRingStops, driftOffsetsAt, DRIFT_SCALE } from './arc.js';

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

// formatRate(0.8) -> '0.80×', formatRate(0.8286) -> '0.829×' — three
// decimals, trimmed to two when the third is a trailing zero (the "round
// floor" case), matching the design frames' own "0.80×"/"0.805×" copy.
function formatRate(rate) {
  let s = rate.toFixed(3);
  if (s.endsWith('0')) s = s.slice(0, -1);
  return s + '×';
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

// RW1's own night card (docs/23_RHYTHM_AND_WEAR.md, frames Main/Stirring):
// shown only in the 'night' phase, title the phase word, body picked by
// trend ('floor' before solar midnight, 'rising' from then on — the only
// two trends rateInfoAt ever reports while phaseAt reads 'night').
// Returns null outside 'night', same "nothing to paint" shape every other
// optional field on this object already uses.
function nightCardAt(phase, info, sun) {
  if (phase !== 'night') return null;
  const body = info.trend === 'rising'
    ? 'Rising slowly since midnight. Back to full speed at sunrise' + (sun && sun.rise ? ', ' + fmtShortestClock(sun.rise) : '') + '.'
    : "Settled for the night. After midnight the platter starts rising, slowly enough that you won't notice until near sunrise.";
  return { trendRate: TREND_RATE_LABEL[info.trend] + ' · ' + formatRate(info.rate), body };
}

const TREND_RATE_LABEL = { floor: 'Slowest', rising: 'Rising' };

// fmtShortestClock(date) -> '7:34' — no am/pm suffix, for the night
// card's own "sunrise, 7:34." copy (fmtShortClock's trailing A/P reads
// wrong mid-sentence there).
const fmtShortestClock = date => {
  const h24 = date.getHours(), m = date.getMinutes();
  const h12 = h24 % 12 || 12;
  return h12 + ':' + String(m).padStart(2, '0');
};

// dialStateAt(now, sun, settings) -> everything dial-view.js's
// renderDialView() needs to paint, in one call. `settings` is the same
// {mode, auto, target, paceMode} shape rateInfoAt/driftOffsetsAt already
// take.
export function dialStateAt(now, sun, settings = {}) {
  const phase = phaseAt(now, sun);
  const info = rateInfoAt(now, sun, settings);
  const rate = info.rate;
  const trend = trendAt(now, sun, settings);
  const tone = toneWordAt(now, sun);
  const paletteName = skyPaletteNameAt(now, sun, settings);
  const skyPhase = skyPhaseAt(now, sun, settings);
  const { big, ampm } = fmtClock(now);
  const nextEvent = nextEventText(now, sun);
  // RW1: while rising, a thin amber arc on the ring from solar midnight
  // (info.recoveryStart) to the current marker angle — null the rest of
  // the time, same "nothing to paint" shape as sunriseAngleDeg/etc.
  const risingArc = info.trend === 'rising' && info.recoveryStart != null
    ? { fromDeg: angleDegAt(new Date(info.recoveryStart)), toDeg: angleDegAt(now) }
    : null;
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
    nightCard: nightCardAt(phase, info, sun),
    risingArc,
    // §4.4's own accessibility example verbatim ("5:58 PM, dusk") — a
    // slider's aria-valuenow is conventionally a plain number, so this
    // uses minutes-of-day (0..1439, wrapping every real day) rather than
    // the dial-gesture's own unbounded S.previewMin, which can run
    // negative or past 1440 across multiple drag turns.
    ariaValueNow: Math.round(minutesOfDay(now)) % DAY_MIN,
    ariaValueText: big + ' ' + ampm + ', ' + phase,
  };
}

/* ================= §4.3 Sound view: character cards + tone curve ================= */

// §3.4's own word table ("Per-card words (SLIGHT / LOOSER, WARMER / CLEAN,
// OPEN / SOFTENING / SOFT, STEADY) follow w the same way") — each list runs
// low-drift to high-drift, picked by index so a 2-word param is a plain
// on/off-ish split and a 3-word one gets a middle word too. Bus compression
// never drifts (§3.4's own table: "unchanged, 0"), so its one-word list
// always resolves to the same word regardless of frac.
const CARD_DEFS = [
  { key: 'wow', label: 'Wow & flutter', words: ['SLIGHT', 'LOOSER'] },
  { key: 'sat', label: 'Saturation', words: ['CLEAN', 'WARMER'] },
  { key: 'soft', label: 'Top end', words: ['OPEN', 'SOFTENING', 'SOFT'] },
  { key: 'comp', label: 'Bus compression', words: ['STEADY'] },
];

function wordForFrac(words, frac) {
  if (words.length <= 1) return words[0];
  const idx = Math.min(words.length - 1, Math.floor(clamp(frac, 0, 0.999) * words.length));
  return words[idx];
}

// soundCardsAt(userChar, now, sun, intensity) -> one entry per §4.3 card,
// in display order. `frac` (how far into today's drift each card's word
// has moved) is warmth(t) * the intensity's own scale — the same shared
// timeline every parameter drifts along, independent of each parameter's
// own drift *size* (driftOffsetsAt already bakes that into userPct/nowPct
// below, via the real per-track offset) — so the word and the percentage
// always agree on direction even though they're computed two different
// ways. Bus compression's word never moves (frac forced to 0): §3.4's
// table gives it no direction to drift in at all.
export function soundCardsAt(userChar, now, sun, intensity) {
  const offsets = driftOffsetsAt(now, sun, intensity);
  const frac = warmthAt(now, sun) * (DRIFT_SCALE[intensity] || 0);
  const char = userChar || {};
  return CARD_DEFS.map(def => {
    const o = offsets[def.key] || 0;
    const userVal = clamp(char[def.key] || 0, 0, 1);
    const nowVal = clamp(userVal + o, 0, 1);
    return {
      key: def.key,
      label: def.label,
      word: wordForFrac(def.words, def.key === 'comp' ? 0 : frac),
      userPct: Math.round(userVal * 100),
      nowPct: Math.round(nowVal * 100),
    };
  });
}

// toneCurveSamples(now, sun, count) -> [{ frac, warmth }, ...], frac 0..1
// across local midnight-to-midnight of `now`'s own day, warmth from
// warmthAt() (0 bright/noon .. 1 warm/midnight) — the "Tone today" card's
// own 24h curve (§4.3 item 5). warmthAt() is a plain continuous cosine of
// time (see arc.js), so this is "a smooth monotonic equivalent" of the
// brief's own illustrative bezier (§3.4: "do not copy its bezier") by
// construction, not a second curve shape to keep in sync with it.
export function toneCurveSamples(now, sun, count = 48) {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const t = new Date(dayStart.getTime() + (i / count) * DAY_MIN * MIN);
    pts.push({ frac: i / count, warmth: warmthAt(t, sun) });
  }
  return pts;
}
