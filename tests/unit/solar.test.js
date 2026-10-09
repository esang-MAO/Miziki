import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solarEvent, computeRate } from '../../src/sundown/solar.js';
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
