// AC2 (docs/39_ACCESSIBILITY.md, step 2): pure-function tests for the
// player's two new VoiceOver-only behaviors -- the seek slider's spoken
// value and the "same track -> no announcement" rule behind the "now
// playing" live region.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubValueText, shouldAnnounceNewTrack } from '../../src/util/text.js';

test('scrubValueText: formats as "m:ss of m:ss"', () => {
  assert.equal(scrubValueText(83, 245), '1:23 of 4:05');
});

test('scrubValueText: zero position and a short duration', () => {
  assert.equal(scrubValueText(0, 9), '0:00 of 0:09');
});

test('scrubValueText: floors fractional seconds, same as fmt()', () => {
  assert.equal(scrubValueText(83.9, 245.1), '1:23 of 4:05');
});

test('shouldAnnounceNewTrack: a different track object announces', () => {
  const a = { tags: { title: 'A' } }, b = { tags: { title: 'B' } };
  assert.equal(shouldAnnounceNewTrack(a, b), true);
});

test('shouldAnnounceNewTrack: the same track object again does not announce', () => {
  const a = { tags: { title: 'A' } };
  assert.equal(shouldAnnounceNewTrack(a, a), false);
});

test('shouldAnnounceNewTrack: nothing was playing before -- a first track still announces', () => {
  const a = { tags: { title: 'A' } };
  assert.equal(shouldAnnounceNewTrack(null, a), true);
  assert.equal(shouldAnnounceNewTrack(undefined, a), true);
});

test('shouldAnnounceNewTrack: no new track (nothing loaded) never announces', () => {
  const a = { tags: { title: 'A' } };
  assert.equal(shouldAnnounceNewTrack(a, null), false);
  assert.equal(shouldAnnounceNewTrack(null, null), false);
});
