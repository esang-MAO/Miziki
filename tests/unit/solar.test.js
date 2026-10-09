import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solarEvent } from '../../src/sundown/solar.js';

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
