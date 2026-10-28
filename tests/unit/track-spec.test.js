import { test } from 'node:test';
import assert from 'node:assert/strict';
import { specRateSuffix, specState, specStateLabel } from '../../src/player/track-spec.js';

test('specRateSuffix: empty when rates match, missing, or engine rate unknown', () => {
  assert.equal(specRateSuffix(44100, 44100), '');
  assert.equal(specRateSuffix(44100, null), '');
  assert.equal(specRateSuffix(null, 48000), '');
});

test('specRateSuffix: "no upsampling claims" -- shows the real engine rate whenever it differs, either direction', () => {
  assert.equal(specRateSuffix(192000, 48000), ' → 48 kHz');
  assert.equal(specRateSuffix(44100, 48000), ' → 48 kHz');
  assert.equal(specRateSuffix(44100, 88200), ' → 88.2 kHz');
});

const baseCtx = { lossless: true, mode: 'pure', eqEnabled: false, loudnessMode: 'off', sourceRateHz: 44100, engineRateHz: 44100 };

test('specState: Untouched needs lossless + Pure + EQ/normalization off + rates matching, all at once', () => {
  assert.deepEqual(specState(baseCtx), { state: 'untouched', reasons: [] });
});

test('specState: a lossy source is never Untouched, even with everything else flat', () => {
  assert.deepEqual(specState({ ...baseCtx, lossless: false }), { state: 'converted', reasons: [] });
});

test('specState: Vinyl mode is never Untouched, even with EQ/normalization off', () => {
  assert.deepEqual(specState({ ...baseCtx, mode: 'vinyl' }), { state: 'shaped', reasons: ['Vinyl'] });
});

test('specState: a rate conversion alone (no shaping) reads as Converted, not Untouched', () => {
  assert.deepEqual(specState({ ...baseCtx, sourceRateHz: 44100, engineRateHz: 48000 }), { state: 'converted', reasons: [] });
});

test('specState: EQ on names EQ, independent of mode/normalization', () => {
  assert.deepEqual(specState({ ...baseCtx, eqEnabled: true }), { state: 'shaped', reasons: ['EQ'] });
});

test('specState: normalization on (any mode but off) names normalization', () => {
  assert.deepEqual(specState({ ...baseCtx, loudnessMode: 'track' }), { state: 'shaped', reasons: ['normalization'] });
  assert.deepEqual(specState({ ...baseCtx, loudnessMode: 'album' }), { state: 'shaped', reasons: ['normalization'] });
});

test('specState: every shaping cause present at once is named in order -- EQ, normalization, Vinyl', () => {
  assert.deepEqual(
    specState({ ...baseCtx, eqEnabled: true, loudnessMode: 'auto', mode: 'vinyl' }),
    { state: 'shaped', reasons: ['EQ', 'normalization', 'Vinyl'] },
  );
});

test('specState: shaping wins over a rate mismatch -- only the real cause is named, not both', () => {
  assert.deepEqual(
    specState({ ...baseCtx, eqEnabled: true, sourceRateHz: 44100, engineRateHz: 48000 }),
    { state: 'shaped', reasons: ['EQ'] },
  );
});

test('specStateLabel: the three plain-text states, and a graceful empty for no result', () => {
  assert.equal(specStateLabel({ state: 'untouched', reasons: [] }), 'Untouched');
  assert.equal(specStateLabel({ state: 'converted', reasons: [] }), 'Converted');
  assert.equal(specStateLabel({ state: 'shaped', reasons: ['EQ', 'Vinyl'] }), 'Shaped: EQ, Vinyl');
  assert.equal(specStateLabel(null), '');
});
