import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wearStage, wearCopy } from '../../src/record-art/wear.js';

const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365.25 * DAY;

// RW7 (docs/23_RHYTHM_AND_WEAR.md): stage thresholds (light ~20, worn
// ~100, loved ~300) and the age nudge (a record played steadily for years
// wears more than one played the same raw count in a month).

test('wearStage: no plays at all, no first-played date, is new', () => {
  assert.equal(wearStage(0, null, Date.now()), 'new');
  assert.equal(wearStage(undefined, undefined, Date.now()), 'new');
});

test('wearStage: thresholds without any age nudge (first-played is now)', () => {
  const now = Date.now();
  assert.equal(wearStage(10, now, now), 'new');
  assert.equal(wearStage(20, now, now), 'light');
  assert.equal(wearStage(99, now, now), 'light');
  assert.equal(wearStage(100, now, now), 'worn');
  assert.equal(wearStage(299, now, now), 'worn');
  assert.equal(wearStage(300, now, now), 'loved');
});

test('wearStage: age alone, with zero plays, eventually nudges a record off "new"', () => {
  const now = Date.now();
  const firstPlayed = now - 3 * YEAR;   // 3 years * 10 plays/year = 30 effective
  assert.equal(wearStage(0, firstPlayed, now), 'light');
});

test('wearStage: a record played steadily for years wears more than one played the same raw count in a month', () => {
  const now = Date.now();
  const steady = wearStage(90, now - 5 * YEAR, now);      // 90 + 50 = 140 -> worn
  const binged = wearStage(90, now - DAY, now);            // 90 + ~0 = 90 -> light
  assert.equal(steady, 'worn');
  assert.equal(binged, 'light');
});

test('wearStage: a falsy firstPlayedAt contributes no age nudge', () => {
  assert.equal(wearStage(19, 0, Date.now()), 'new');
  assert.equal(wearStage(19, null, Date.now()), 'new');
});

test('wearCopy: nothing for new or light', () => {
  const now = Date.now();
  assert.equal(wearCopy('new', 5, now), null);
  assert.equal(wearCopy('light', 25, now), null);
});

test('wearCopy: "Worn · N plays since Month YYYY" / "Well loved · …"', () => {
  const firstPlayed = Date.UTC(2025, 2, 1); // March 2025
  assert.equal(wearCopy('worn', 150, firstPlayed), 'Worn · 150 plays since March 2025');
  assert.equal(wearCopy('loved', 412, firstPlayed), 'Well loved · 412 plays since March 2025');
});

test('wearCopy: singular "play" at exactly one play', () => {
  const firstPlayed = Date.UTC(2025, 2, 1);
  assert.equal(wearCopy('worn', 1, firstPlayed), 'Worn · 1 play since March 2025');
});

test('wearCopy: no firstPlayedAt still returns a copy line, without the "since" clause', () => {
  assert.equal(wearCopy('worn', 150, null), 'Worn · 150 plays');
});
