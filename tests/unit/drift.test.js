import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driftOffsets, effectiveChar } from '../../src/sundown/drift.js';
import { dayEvents, dayPosition } from '../../src/sundown/day.js';

// src/sundown/drift.js has no DOM/`S`-mutating top level, same precedent
// as day.test.js/crate-geometry.test.js — no mocking needed.

const COLUMBIA = { lat: 39.20, lon: -76.86 };
const MIDDAY = { phase: 'midday', phaseProgress: 0, nightness: 0, rateProgress: 0 };
const NIGHT = { phase: 'night', phaseProgress: 0, nightness: 1, rateProgress: 1 };
const MORNING = { phase: 'morning', phaseProgress: 0.4, nightness: 0, rateProgress: 0 };
const GOLDEN = { phase: 'golden', phaseProgress: 0.6, nightness: 0, rateProgress: 0 };

test('driftOffsets: zero at midday, at every intensity', () => {
  for(const intensity of ['off', 'subtle', 'full']){
    assert.deepEqual(driftOffsets(MIDDAY, intensity), { wow: 0, sat: 0, soft: 0, comp: 0 });
  }
});

test('driftOffsets: zero at intensity off, at every phase', () => {
  for(const dayPos of [NIGHT, MORNING, GOLDEN, MIDDAY]){
    assert.deepEqual(driftOffsets(dayPos, 'off'), { wow: 0, sat: 0, soft: 0, comp: 0 });
  }
});

// An unrecognized S.charDrift value (shouldn't happen, since parsePrefs
// only ever lets the three real ones through, but defensive the same way
// the rest of this codebase's enum-ish settings are) is treated as off.
test('driftOffsets: an unrecognized intensity is treated as off', () => {
  assert.deepEqual(driftOffsets(NIGHT, 'maximum'), { wow: 0, sat: 0, soft: 0, comp: 0 });
});

test('driftOffsets: Subtle is exactly half of Full, at every phase', () => {
  for(const dayPos of [NIGHT, MORNING, GOLDEN]){
    const full = driftOffsets(dayPos, 'full');
    const subtle = driftOffsets(dayPos, 'subtle');
    for(const k of ['wow', 'sat', 'soft', 'comp']){
      assert.ok(Math.abs(subtle[k] - full[k] / 2) < 1e-9, `${k}: subtle should be exactly half of full`);
    }
  }
});

// The doc's own table, at Full intensity — confirms the anchors themselves
// (not just the off/half/full scaling) match docs/DAY_ARC.md's DA2 table.
test('driftOffsets: the four named anchors match the doc\'s own table at Full', () => {
  assert.deepEqual(driftOffsets(MORNING, 'full'), { wow: -0.05, sat: -0.10, soft: -0.20, comp: -0.10 });
  assert.deepEqual(driftOffsets(GOLDEN, 'full'), { wow: 0, sat: 0.05, soft: 0.08, comp: 0.03 });
  assert.deepEqual(driftOffsets(NIGHT, 'full'), { wow: 0.05, sat: 0.10, soft: 0.20, comp: 0.10 });
});

test('effectiveChar: no offset ever pushes an effective value outside 0-1', () => {
  // a user already near either rail, at Full intensity (the largest
  // possible offset), in both directions (Night pushes up, Morning pushes
  // down) — clamp() has to actually do something in both of these, not
  // just happen to already be in range.
  const hot = { wow: 0.98, sat: 0.97, soft: 0.95, comp: 0.99 };
  const cold = { wow: 0.02, sat: 0.03, soft: 0.01, comp: 0.02 };
  for(const userChar of [hot, cold]){
    for(const dayPos of [NIGHT, MORNING, GOLDEN, MIDDAY]){
      const eff = effectiveChar(userChar, dayPos, 'full');
      for(const k of ['wow', 'sat', 'soft', 'comp']){
        assert.ok(eff[k] >= 0 && eff[k] <= 1, `${k} must stay within 0-1, got ${eff[k]}`);
      }
    }
  }
});

test('effectiveChar: with intensity off, the effective value is exactly the user\'s own', () => {
  const userChar = { wow: 0.30, sat: 0.35, soft: 0.40, comp: 0.35 };
  assert.deepEqual(effectiveChar(userChar, NIGHT, 'off'), userChar);
});

// Continuity across the full 24h, driven by the real dayPosition() (day.js,
// DA1) rather than synthetic phase objects — the actual composition this
// module is built to be fed, walking Columbia, MD's own real events the
// same way day.test.js's own 48h continuity test does.
//
// "Continuous" here specifically means no *jump* right at a phase
// boundary (the handoff between two of anchorOffsets()'s branches) — not
// a bounded rate of change throughout the whole ramp. Those are different
// properties: dawn/twilight on this date (and this latitude) each last
// only ~32 minutes, and the soft knob swings its full 0.40-wide range
// across that one ramp (Night's +0.20 down to Morning's -0.20, or back up
// the other way) — a real, continuous, intentional ramp that is simply
// steep, not a bug. A whole-day loop with a fixed per-2-minute-step cap
// (an earlier version of this test used 0.01) flags that legitimate
// steepness as if it were a discontinuity, and the right cap would need
// to track this date/location's own dawn/twilight duration to not be
// either too loose to catch a real bug or too tight for a real ramp —
// fragile either way. Testing continuity directly at each of the six real
// phase-boundary instants (dawnT, riseT, morningEnd, middaySplit,
// goldenStart, setT — duskT loops back to night, already covered by
// night's own flat 0) with a tiny ±1s straddle sidesteps that entirely:
// a boundary is continuous exactly when the value an instant before it
// matches the value an instant after, regardless of how fast the ramp on
// either side is moving.
test('driftOffsets: no jump at any of the six real phase-boundary instants', () => {
  const date = new Date('2025-06-21T12:00:00Z');
  const events = dayEvents(date, COLUMBIA.lat, COLUMBIA.lon);
  const goldenStart = Math.max(events.set.getTime() - 60 * 60000, events.rise.getTime());
  const morningEnd = Math.min(events.rise.getTime() + 3 * 60 * 60000, goldenStart);
  const middaySplit = Math.min(Math.max(events.noon.getTime(), morningEnd), goldenStart);
  const boundaries = [
    events.dawn.getTime(), events.rise.getTime(), morningEnd,
    middaySplit, goldenStart, events.set.getTime(),
  ];
  for(const t of boundaries){
    const before = driftOffsets(dayPosition(new Date(t - 1000), events), 'full');
    const after = driftOffsets(dayPosition(new Date(t + 1000), events), 'full');
    for(const k of ['wow', 'sat', 'soft', 'comp']){
      assert.ok(Math.abs(after[k] - before[k]) < 0.01,
        `${k} jumped by ${Math.abs(after[k] - before[k])} across boundary at ${new Date(t).toISOString()}`);
    }
  }
});

// A separate, looser whole-day sweep: not a slew-rate bound (the ramps
// are allowed to be steep, as above), just a sanity check that nothing
// anywhere in the day ever produces a swing larger than the largest
// single anchor-to-anchor distance in the table (0.40, Night's soft
// +0.20 to Morning's soft -0.20) — which would indicate a real bug (e.g.
// overshoot past an anchor), not a steep-but-legitimate ramp.
test('driftOffsets: never exceeds the largest anchor-to-anchor swing across 24 hours', () => {
  const date = new Date('2025-06-21T12:00:00Z');
  const events = dayEvents(date, COLUMBIA.lat, COLUMBIA.lon);
  const start = new Date('2025-06-21T04:00:00Z'); // well before dawn
  for(let m = 0; m < 24 * 60; m += 2){
    const now = new Date(start.getTime() + m * 60000);
    const o = driftOffsets(dayPosition(now, events), 'full');
    for(const k of ['wow', 'sat', 'soft', 'comp']){
      assert.ok(Math.abs(o[k]) <= 0.20 + 1e-9, `${k}=${o[k]} exceeds the largest documented Full-intensity anchor magnitude`);
    }
  }
});
