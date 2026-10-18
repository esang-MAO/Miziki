import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayEvents } from '../../src/sundown/day.js';
import { phaseAt, rateAt, trendAt, warmthAt, driftOffsetsAt, effectiveCharAt, toneWordAt, skyPaletteNameAt, skyRingStops, RECOVERY_WINDOW_MS } from '../../src/sundown/arc.js';

// src/sundown/arc.js has no DOM/`S`-mutating top level (same precedent as
// day.test.js/solar.test.js) — no mocking needed.

const COLUMBIA = { lat: 39.20, lon: -76.86 };

// A fixed date/location whose sunrise/sunset land close to the brief's
// own placeholder example (sunrise 7:11 AM, sunset 6:12 PM) without
// hardcoding those exact minutes — these are the real values dayEvents()
// computes for this date/location, used as the fixture for every test
// below so rateAt/phaseAt/warmthAt are all exercised against one
// consistent, real sun object.
const DATE = new Date('2025-03-20T12:00:00Z'); // near equinox, Columbia, MD
const SUN = dayEvents(DATE, COLUMBIA.lat, COLUMBIA.lon);

const settings = (over = {}) => ({ mode: 'vinyl', auto: true, target: 0.85, paceMode: 'window', ...over });

test('rateAt: recovery leg — floor at sunrise-3h and sunrise-2h, rising and ~midway at sunrise-1h, 1.0 at sunrise, 1.0 at noon', () => {
  const rise = SUN.rise.getTime();
  const s = settings({ recoveryWindowMs: RECOVERY_WINDOW_MS });
  const at = (ms) => rateAt(new Date(rise + ms), SUN, s);

  assert.equal(at(-3 * 3600000), 0.85, 'sunrise-3h is at the floor');
  assert.equal(at(-2 * 3600000), 0.85, 'sunrise-2h (recovery start) is still at the floor');
  const mid = at(-1 * 3600000);
  assert.ok(mid > 0.85 && mid < 1, 'sunrise-1h is rising, strictly between floor and 1.0');
  assert.ok(Math.abs(mid - (0.85 + (1 - 0.85) * 0.5)) < 1e-9, 'sunrise-1h is exactly the smoothstep midpoint value');
  assert.equal(rateAt(SUN.rise, SUN, s), 1, 'rate is exactly 1.0 at sunrise');
  assert.equal(rateAt(SUN.noon, SUN, s), 1, 'rate is 1.0 at solar noon');
});

test('rateAt: continuous at the hold->recovery and recovery->day joins (no jump)', () => {
  const rise = SUN.rise.getTime();
  const s = settings();
  const recoveryStart = rise - RECOVERY_WINDOW_MS;
  const eps = 1; // 1ms either side of each join

  const beforeJoin1 = rateAt(new Date(recoveryStart - eps), SUN, s);
  const afterJoin1 = rateAt(new Date(recoveryStart + eps), SUN, s);
  assert.ok(Math.abs(beforeJoin1 - afterJoin1) < 1e-6, 'hold->recovery join has no jump');

  const beforeJoin2 = rateAt(new Date(rise - eps), SUN, s);
  const afterJoin2 = rateAt(new Date(rise + eps), SUN, s);
  assert.ok(Math.abs(beforeJoin2 - afterJoin2) < 1e-3, 'recovery->day join has no jump');
});

test('rateAt: continuous at the day->down-leg and down-leg->hold joins (existing down-leg, unchanged shape)', () => {
  const set = SUN.set.getTime(), dusk = SUN.dusk.getTime();
  const s = settings();
  const eps = 1;

  const beforeSet = rateAt(new Date(set - eps), SUN, s);
  const afterSet = rateAt(new Date(set + eps), SUN, s);
  assert.ok(Math.abs(beforeSet - afterSet) < 1e-6, 'day->down-leg join has no jump');

  const beforeDusk = rateAt(new Date(dusk - eps), SUN, s);
  const afterDusk = rateAt(new Date(dusk + eps), SUN, s);
  assert.ok(Math.abs(beforeDusk - afterDusk) < 1e-3, 'down-leg->hold join has no jump');
});

test('rateAt: Pure mode returns 1.0 at every time, including during recovery and the down-leg', () => {
  const rise = SUN.rise.getTime(), set = SUN.set.getTime(), dusk = SUN.dusk.getTime();
  const s = settings({ mode: 'pure' });
  for (const t of [rise - 3600000, rise, set, (set + dusk) / 2, dusk + 3600000]) {
    assert.equal(rateAt(new Date(t), SUN, s), 1, `Pure is 1.0 at ${new Date(t).toISOString()}`);
  }
});

test('rateAt: manual override (auto off) returns 1.0 from the day-arc curve, same as Pure', () => {
  const s = settings({ auto: false });
  assert.equal(rateAt(SUN.dusk, SUN, s), 1);
});

test('rateAt: no usable sun data (polar/no location) never throws and returns a plain 1.0', () => {
  const s = settings();
  assert.equal(rateAt(new Date(), {}, s), 1);
  assert.equal(rateAt(new Date(), null, s), 1);
  assert.equal(rateAt(new Date(), { rise: SUN.rise }, s), 1, 'partial sun object (no set/dusk) is also treated as no data');
});

test('rateAt: legacy/partial sun (set+dusk known, no rise) still drives the down-leg/hold, just never recovers', () => {
  const now = Date.now();
  const pastDusk = { set: new Date(now - 60 * 60000), dusk: new Date(now - 30 * 60000) };
  const s = settings();
  assert.equal(rateAt(new Date(now), pastDusk, s), 0.85, 'settles at the floor past dusk with no rise to recover toward');
  const midTwilight = { set: new Date(now - 10 * 60000), dusk: new Date(now + 10 * 60000) };
  const mid = rateAt(new Date(now), midTwilight, s);
  assert.ok(mid > 0.85 && mid < 1, 'still eases through the down-leg with no rise known');
});

test('rateAt: output never goes negative or outside [floor, 1] across a full 24h sweep (no reversed leg)', () => {
  const s = settings();
  const lo = 0.85 - 1e-9, hi = 1 + 1e-9;
  for (let m = 0; m < 1440; m += 5) {
    const t = new Date(SUN.noon.getTime() - 12 * 3600000 + m * 60000);
    const r = rateAt(t, SUN, s);
    assert.ok(r >= lo && r <= hi, `rate ${r} at +${m}min stays within [floor, 1.0]`);
  }
});

test('rateAt: a very short recovery/short-night window still produces a monotonic, bounded curve', () => {
  // A deliberately tiny recovery window stresses the recovery-leg math
  // without needing a genuine polar fixture; the output stays within
  // [floor, 1.0] regardless (the defensive clamp in rateInfoAt).
  const s = settings({ recoveryWindowMs: 5 * 60000 });
  const rise = SUN.rise.getTime();
  const samples = [-30, -10, -5, -2, -1, 0, 1].map(min => rateAt(new Date(rise + min * 60000), SUN, s));
  for (const r of samples) assert.ok(r >= 0.85 - 1e-9 && r <= 1 + 1e-9, `rate ${r} stays bounded`);
  // monotonic non-decreasing through the approach to sunrise
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i] >= samples[i - 1] - 1e-9, 'never reverses while approaching sunrise');
});

test('trendAt: labels match §3.3\'s table at each state', () => {
  const s = settings();
  const rise = SUN.rise.getTime(), set = SUN.set.getTime(), dusk = SUN.dusk.getTime();
  assert.equal(trendAt(new Date(rise - 3 * 3600000), SUN, s), 'Slowest');
  assert.equal(trendAt(new Date(rise - 1 * 3600000), SUN, s), 'Rising');
  assert.equal(trendAt(SUN.noon, SUN, s), 'Full speed');
  assert.equal(trendAt(new Date((set + dusk) / 2), SUN, s), 'Easing down');
  assert.equal(trendAt(new Date(dusk + 3600000), SUN, s), 'Slowest');
});

test('phaseAt: boundaries at sunrise/sunset offsets and the midnight wrap', () => {
  const rise = SUN.rise.getTime(), set = SUN.set.getTime();
  assert.equal(phaseAt(new Date(rise - 32 * 60000), SUN), 'night', 'just before dawn-lead is still night');
  assert.equal(phaseAt(new Date(rise - 31 * 60000), SUN), 'dawn', 'dawn starts exactly 31 min before sunrise');
  assert.equal(phaseAt(new Date(rise - 1), SUN), 'dawn', 'still dawn just before sunrise');
  assert.equal(phaseAt(SUN.rise, SUN), 'day', 'day starts exactly at sunrise');
  assert.equal(phaseAt(new Date(set - 32 * 60000), SUN), 'dusk', 'dusk starts exactly 32 min before sunset');
  assert.equal(phaseAt(new Date(set - 33 * 60000), SUN), 'day', 'still day just before dusk starts');
  assert.equal(phaseAt(new Date(set + 43 * 60000), SUN), 'night', 'night starts exactly 43 min after sunset');
  assert.equal(phaseAt(new Date(set + 42 * 60000), SUN), 'dusk', 'still dusk just before night starts');
  // midnight wrap: deep pre-dawn (a couple hours before sunrise) and deep
  // post-dusk (several hours after sunset) both read as night without
  // ever needing "yesterday's"/"tomorrow's" events.
  assert.equal(phaseAt(new Date(rise - 2 * 3600000), SUN), 'night');
  assert.equal(phaseAt(new Date(set + 5 * 3600000), SUN), 'night');
});

test('phaseAt: no usable sun data falls back to day, never throws', () => {
  assert.equal(phaseAt(new Date(), {}), 'day');
  assert.equal(phaseAt(new Date(), null), 'day');
});

test('warmthAt: 0 at solar noon, 1 at solar midnight, continuous across midnight', () => {
  const noon = SUN.noon.getTime();
  assert.ok(Math.abs(warmthAt(SUN.noon, SUN) - 0) < 1e-9, 'warmth is 0 at solar noon');
  const midnight = noon + 12 * 3600000;
  assert.ok(Math.abs(warmthAt(new Date(midnight), SUN) - 1) < 1e-9, 'warmth is 1 at solar midnight');

  // continuity: no jump stepping across the midnight instant itself
  const eps = 1;
  const before = warmthAt(new Date(midnight - eps), SUN);
  const after = warmthAt(new Date(midnight + eps), SUN);
  assert.ok(Math.abs(before - after) < 1e-6, 'no jump across solar midnight');

  // monotonic rise from noon to midnight, fall from midnight to next noon
  const wAt = h => warmthAt(new Date(noon + h * 3600000), SUN);
  assert.ok(wAt(3) > wAt(0));
  assert.ok(wAt(6) > wAt(3));
  assert.ok(wAt(9) > wAt(6));
  assert.ok(wAt(15) < wAt(12));
  assert.ok(wAt(21) < wAt(18));
});

test('warmthAt: no usable solar noon falls back to a neutral 0.5, never throws', () => {
  assert.equal(warmthAt(new Date(), {}), 0.5);
  assert.equal(warmthAt(new Date(), null), 0.5);
});

test('driftOffsetsAt: off is always zero regardless of warmth', () => {
  const midnight = new Date(SUN.noon.getTime() + 12 * 3600000);
  assert.deepEqual(driftOffsetsAt(midnight, SUN, 'off'), { wow: 0, sat: 0, soft: 0, comp: 0 });
  assert.deepEqual(driftOffsetsAt(SUN.noon, SUN, 'full'), { wow: 0, sat: 0, soft: 0, comp: 0 }, 'also zero at noon itself (warmth 0)');
});

test('driftOffsetsAt: at Full and max warmth (solar midnight), matches §3.4\'s own sizes; comp is always 0', () => {
  const midnight = new Date(SUN.noon.getTime() + 12 * 3600000);
  const o = driftOffsetsAt(midnight, SUN, 'full');
  assert.ok(Math.abs(o.wow - 0.30) < 1e-9, 'wow up to +30% of range at Full');
  assert.ok(Math.abs(o.sat - 0.27) < 1e-9, 'sat up to +27% of range at Full');
  assert.ok(Math.abs(o.soft - 0.27) < 1e-9, 'soft up to +27% of range at Full');
  assert.equal(o.comp, 0, 'bus compression never drifts, at any intensity');
});

test('driftOffsetsAt: Subtle is exactly one third of Full at the same time', () => {
  const midnight = new Date(SUN.noon.getTime() + 12 * 3600000);
  const full = driftOffsetsAt(midnight, SUN, 'full');
  const subtle = driftOffsetsAt(midnight, SUN, 'subtle');
  for (const k of ['wow', 'sat', 'soft']) {
    assert.ok(Math.abs(subtle[k] - full[k] / 3) < 1e-9, `${k}: subtle is one third of full`);
  }
});

test('driftOffsetsAt: never negative — warmth only ever rises off of 0 at noon, unlike DA2\'s old anchor table', () => {
  for (let h = 0; h < 24; h++) {
    const t = new Date(SUN.noon.getTime() + h * 3600000);
    const o = driftOffsetsAt(t, SUN, 'full');
    assert.ok(o.wow >= 0 && o.sat >= 0 && o.soft >= 0, `offsets at +${h}h are never negative`);
  }
});

test('driftOffsetsAt: an unrecognized intensity value is treated as off, not thrown on', () => {
  assert.deepEqual(driftOffsetsAt(SUN.noon, SUN, 'bogus'), { wow: 0, sat: 0, soft: 0, comp: 0 });
  assert.deepEqual(driftOffsetsAt(SUN.noon, SUN, undefined), { wow: 0, sat: 0, soft: 0, comp: 0 });
});

test('effectiveCharAt: with intensity off, the effective value is exactly the user\'s own', () => {
  const userChar = { wow: 0.3, sat: 0.4, soft: 0.5, comp: 0.6 };
  const midnight = new Date(SUN.noon.getTime() + 12 * 3600000);
  assert.deepEqual(effectiveCharAt(userChar, midnight, SUN, 'off'), userChar);
});

test('effectiveCharAt: no offset ever pushes an effective value outside 0-1, even starting near the ceiling', () => {
  const userChar = { wow: 0.95, sat: 0.9, soft: 0.85, comp: 0.5 };
  const midnight = new Date(SUN.noon.getTime() + 12 * 3600000);
  const eff = effectiveCharAt(userChar, midnight, SUN, 'full');
  for (const k of ['wow', 'sat', 'soft', 'comp']) {
    assert.ok(eff[k] >= 0 && eff[k] <= 1, `${k} stays within [0,1]`);
  }
});

test('toneWordAt: BRIGHT at solar noon, WARM at solar midnight', () => {
  assert.equal(toneWordAt(SUN.noon, SUN), 'BRIGHT');
  assert.equal(toneWordAt(new Date(SUN.noon.getTime() + 12 * 3600000), SUN), 'WARM');
});

test('toneWordAt: WARMING after noon approaching dusk, OPENING after midnight approaching dawn', () => {
  assert.equal(toneWordAt(new Date(SUN.noon.getTime() + 4 * 3600000), SUN), 'WARMING');
  assert.equal(toneWordAt(new Date(SUN.noon.getTime() + 16 * 3600000), SUN), 'OPENING');
});

test('toneWordAt: no usable solar noon falls back to BRIGHT, never throws', () => {
  assert.equal(toneWordAt(new Date(), {}), 'BRIGHT');
  assert.equal(toneWordAt(new Date(), null), 'BRIGHT');
});

test('skyPaletteNameAt: matches §4.2\'s own four palette names, INDIGO covering both night rows', () => {
  const s = settings();
  assert.equal(skyPaletteNameAt(SUN.noon, SUN, s), 'AZURE');
  assert.equal(skyPaletteNameAt(SUN.dusk, SUN, s), 'EMBER');
  assert.equal(skyPaletteNameAt(new Date(SUN.rise.getTime() - 10 * 60000), SUN, s), 'ROSE', 'within the dawn window, just before sunrise');
  assert.equal(skyPaletteNameAt(new Date(SUN.dusk.getTime() + 3600000), SUN, s), 'INDIGO');
  const preDawn = new Date(SUN.rise.getTime() - RECOVERY_WINDOW_MS / 2);
  assert.equal(skyPaletteNameAt(preDawn, SUN, s), 'INDIGO');
});

// RF14 (docs/12_REFINE.md, point 3): the ring's own stops now come
// straight from docs/design/refine/README.md's seven phase anchor colors,
// "at the clock angles of today's events," in place of the eight hand-
// picked EMBER/INDIGO/ROSE/AZURE-family hexes the old ring used.
const minutesOfDay = date => date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;

test('skyRingStops: empty with no usable sun data (polar/no location)', () => {
  assert.deepEqual(skyRingStops(null), []);
  assert.deepEqual(skyRingStops({ rise: SUN.rise }), [], 'partial sun object is also treated as no data');
});

test('skyRingStops: sorted ascending by minute-of-day, closing the ring from 0 to 1440', () => {
  const stops = skyRingStops(SUN);
  assert.ok(stops.length > 0);
  for(let i = 1; i < stops.length; i++) assert.ok(stops[i].min >= stops[i - 1].min);
  assert.equal(stops[0].min, 0);
  assert.equal(stops[stops.length - 1].min, 1440);
});

test('skyRingStops: each named anchor holds flat across its own real span, at the design doc\'s own hex', () => {
  const stops = skyRingStops(SUN);
  const colorAt = min => {
    // conic-gradient semantics: the color in effect just past a stop is
    // whichever one of a same-position pair comes *second* in list order
    // (see this function's own header comment on why the stops are
    // pushed chronologically) — so for a real midpoint between two
    // stops, nearest-below is exactly what's painted there.
    let color = stops[0].color;
    for(const s of stops) if(s.min <= min) color = s.color; else break;
    return color;
  };
  const mid = (a, b) => (a + b) / 2;
  const dawnMin = minutesOfDay(SUN.dawn), riseMin = minutesOfDay(SUN.rise);
  const noonMin = minutesOfDay(SUN.noon), setMin = minutesOfDay(SUN.set), duskMin = minutesOfDay(SUN.dusk);
  assert.equal(colorAt(mid(dawnMin, riseMin)), '#CFA0AD', 'dawn');
  assert.equal(colorAt(noonMin), '#D8D3C9', 'midday (solar noon always falls inside the midday span)');
  assert.equal(colorAt(mid(setMin - 30, setMin)), '#E8B67A', 'golden hour, just before sunset');
  assert.equal(colorAt(mid(setMin, duskMin)), '#D99A5A', 'twilight');
  assert.equal(colorAt(mid(duskMin, 1440)), '#8578AE', 'the dead of night, well past dusk');
  assert.equal(colorAt(mid(0, dawnMin)), '#8578AE', 'the pre-dawn tail, also night');
});

test('effectiveCharAt: never mutates the userChar object passed in', () => {
  const userChar = { wow: 0.3, sat: 0.4, soft: 0.5, comp: 0.6 };
  const snapshot = { ...userChar };
  effectiveCharAt(userChar, new Date(SUN.noon.getTime() + 12 * 3600000), SUN, 'full');
  assert.deepEqual(userChar, snapshot);
});
