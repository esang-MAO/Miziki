import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solarEvent, computeRate, depthKeyFor, depthCaptionFor, formatRateChange } from '../../src/sundown/solar.js';
import { S } from '../../src/state.js';

// Columbia, MD (39.20, -76.86). Published sunset for Jun 21, 2025 is 8:38 pm
// EDT (00:38 UTC Jun 22) — https://sunrisesunset.io/us/maryland/columbia/
test('solarEvent: sunset for Columbia, MD matches published time within a few minutes', () => {
  const date = new Date('2025-06-21T12:00:00Z');
  const set = solarEvent(date, 39.20, -76.86, -0.833);
  const published = new Date('2025-06-22T00:38:00Z');
  const diffMinutes = Math.abs(set - published) / 60000;
  assert.ok(diffMinutes < 5, `expected within 5 minutes of published sunset, got ${diffMinutes} minutes`);
});

test('solarEvent: polar day returns null (sun never sets)', () => {
  const date = new Date('2025-06-21T12:00:00Z');
  const set = solarEvent(date, 78.2, 15.6, -0.833);
  assert.equal(set, null);
});

// F1: "Pure means untouched" — Sundown's rate change only ever reaches the
// recording in Vinyl. computeRate() is the one place that rule lives.
// Sunset/dusk are set relative to "now" (not fixed dates) so these don't
// depend on which real-world date the test happens to run on.
const now = Date.now();
const midTwilight = { set: new Date(now - 10 * 60000), dusk: new Date(now + 10 * 60000), ok: true }; // 10 min into a 20 min window
const pastDusk = { set: new Date(now - 60 * 60000), dusk: new Date(now - 30 * 60000), ok: true }; // well after dusk

test('computeRate: Pure is always 1, with auto on, whatever the target', () => {
  S.mode = 'pure'; S.auto = true; S.pace = 'window'; S.previewMin = 0;
  for (const target of [0.85, 0.80, 0.75]) {
    S.target = target;
    S.sun = { lat: 39.20, lon: -76.86, ...midTwilight }; // mid-twilight: Vinyl would not be 1 here
    assert.equal(computeRate(), 1);
  }
});

test('computeRate: Pure is always 1, with auto off (manual rate set)', () => {
  S.mode = 'pure'; S.auto = false; S.manualRate = 0.72;
  assert.equal(computeRate(), 1);
});

test('computeRate: Vinyl with auto off returns the manual rate, unchanged', () => {
  S.mode = 'vinyl'; S.auto = false; S.manualRate = 0.72;
  assert.equal(computeRate(), 0.72);
});

test('computeRate: Vinyl with auto on still follows Sundown, unchanged', () => {
  S.mode = 'vinyl'; S.auto = true; S.target = 0.80; S.pace = 'window'; S.previewMin = 0;

  // sun not resolved (ok:false) -> sunProgress() is 0 -> full speed (1), the
  // same daylight-default behavior Vinyl has always had
  S.sun = { lat: 39.20, lon: -76.86, ok: false, set: null, dusk: null };
  assert.equal(computeRate(), 1);

  // past dusk -> fully settled at the target rate
  S.sun = { lat: 39.20, lon: -76.86, ...pastDusk };
  assert.equal(computeRate(), 0.80);
});

// RF9 (docs/12_REFINE.md): "Sundown, set once" collapsed Auto/Manual, the
// full-night-rate seg and Window/Moment pacing onto one "How deep the
// night goes" choice (Off/Gentle/Medium/Deep) -- depthKeyFor()/
// depthCaptionFor() are the pure mapping both src/wiring/sundown.js's
// click handler and src/storage/meta.js's restore-time sync use.
test('depthKeyFor: auto off is always Off, regardless of target', () => {
  assert.equal(depthKeyFor(false, 0.80), 'off');
  assert.equal(depthKeyFor(false, 0.75), 'off');
});

test('depthKeyFor: the three auto targets map back onto their own button', () => {
  assert.equal(depthKeyFor(true, 0.85), 'gentle');
  assert.equal(depthKeyFor(true, 0.80), 'medium');
  assert.equal(depthKeyFor(true, 0.75), 'deep');
});

test('depthKeyFor: an unrecognized saved target falls back to Medium, not Off', () => {
  assert.equal(depthKeyFor(true, 0.9), 'medium');
});

test('depthCaptionFor: Off names no rate at all', () => {
  assert.match(depthCaptionFor('off', 0.80), /^Off/);
});

test('depthCaptionFor: each depth names its own rate as a percentage and semitones (RF27)', () => {
  assert.equal(depthCaptionFor('gentle', 0.85), 'Gentle — −15.0% ≈ −2¾ semitones');
  assert.equal(depthCaptionFor('medium', 0.80), 'Medium — −20.0% ≈ −3¾ semitones');
  assert.equal(depthCaptionFor('deep', 0.75), 'Deep — −25.0% ≈ −5 semitones');
});

// RF27 (docs/12_REFINE.md): "show the number next to the sound" — one pure
// helper every rate reader (the depth caption above, player/clock.js's
// #rateOut and #trackSpecPhase) shows a rate change through.
test('formatRateChange: no change at all reads as a plain, signless zero', () => {
  assert.equal(formatRateChange(1), '0.0% ≈ 0 semitones');
});

test('formatRateChange: a quarter semitone down reads as a singular fraction', () => {
  // 2^(-0.25/12) ~= 0.98566 -- exactly a quarter semitone slower.
  assert.equal(formatRateChange(Math.pow(2, -0.25 / 12)), '−1.4% ≈ −¼ semitone');
});

test('formatRateChange: exactly one semitone down stays singular, no fraction glyph', () => {
  // 2^(-1/12) ~= 0.94387 -- exactly one semitone slower.
  assert.equal(formatRateChange(Math.pow(2, -1 / 12)), '−5.6% ≈ −1 semitone');
});

test('formatRateChange: a sped-up rate reads with a plus sign', () => {
  assert.equal(formatRateChange(1.05), '+5.0% ≈ +¾ semitone');
});

test('formatRateChange: several whole semitones down pluralizes and drops the fraction', () => {
  assert.equal(formatRateChange(0.75), '−25.0% ≈ −5 semitones');
});
