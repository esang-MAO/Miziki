// GS3 (docs/30_GROOVES_AND_SHELF.md): grooves drawn from the audio -- the
// pure band-geometry/pitch-mapping/side-map leaf. No imports in the
// module under test besides util/math.js's clamp (itself pure/zero-
// import), so none in this file either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROOVE_INNER_PCT, GROOVE_OUTER_PCT,
  GROOVE_PITCH_MIN_PCT, GROOVE_PITCH_MAX_PCT, GROOVE_PITCH_MIDDLE_PCT,
  LOUDNESS_FLOOR_LUFS, LOUDNESS_CEIL_LUFS,
  groovePitchForLoudness, bandRadiiFromDurations, grooveBandsForSide,
  needleRadiusPct, sideMapSegments, grooveBackgroundImage,
} from '../../src/record-art/grooves.js';

// -- groovePitchForLoudness ---------------------------------------------

test('groovePitchForLoudness: an unmeasured track takes the middle pitch', () => {
  assert.equal(groovePitchForLoudness(null), GROOVE_PITCH_MIDDLE_PCT);
  assert.equal(groovePitchForLoudness(undefined), GROOVE_PITCH_MIDDLE_PCT);
  assert.equal(groovePitchForLoudness(NaN), GROOVE_PITCH_MIDDLE_PCT);
});

test('groovePitchForLoudness: louder means a tighter (smaller) pitch', () => {
  const loud = groovePitchForLoudness(LOUDNESS_CEIL_LUFS);
  const quiet = groovePitchForLoudness(LOUDNESS_FLOOR_LUFS);
  assert.ok(Math.abs(loud - GROOVE_PITCH_MIN_PCT) < 1e-9);
  assert.equal(quiet, GROOVE_PITCH_MAX_PCT);
  assert.ok(loud < quiet);
});

test('groovePitchForLoudness: out-of-range values clamp to the nearest end', () => {
  assert.ok(Math.abs(groovePitchForLoudness(LOUDNESS_CEIL_LUFS + 10) - GROOVE_PITCH_MIN_PCT) < 1e-9);
  assert.equal(groovePitchForLoudness(LOUDNESS_FLOOR_LUFS - 10), GROOVE_PITCH_MAX_PCT);
});

test('groovePitchForLoudness: monotonic between the two ends', () => {
  const mid = groovePitchForLoudness((LOUDNESS_FLOOR_LUFS + LOUDNESS_CEIL_LUFS) / 2);
  assert.ok(mid > GROOVE_PITCH_MIN_PCT && mid < GROOVE_PITCH_MAX_PCT);
});

// -- bandRadiiFromDurations / grooveBandsForSide -------------------------

test('bandRadiiFromDurations: one band per duration, outer to inner, width proportional to duration', () => {
  const bands = bandRadiiFromDurations([300, 100], 0, 100);
  assert.equal(bands.length, 2);
  assert.equal(bands[0].startPct, 100);
  assert.equal(bands[0].endPct, 25); // 300/400 of the 100pt span
  assert.equal(bands[1].startPct, 25);
  assert.equal(bands[1].endPct, 0);
});

test('bandRadiiFromDurations: bands are contiguous -- each one\'s end is the next one\'s start', () => {
  const bands = bandRadiiFromDurations([100, 200, 50], GROOVE_INNER_PCT, GROOVE_OUTER_PCT);
  assert.equal(bands[0].startPct, GROOVE_OUTER_PCT);
  assert.equal(bands[0].endPct, bands[1].startPct);
  assert.equal(bands[1].endPct, bands[2].startPct);
  assert.equal(bands[2].endPct, GROOVE_INNER_PCT);
});

test('bandRadiiFromDurations: an all-silent/empty duration list splits evenly, never divides by zero', () => {
  const bands = bandRadiiFromDurations([0, 0], 0, 100);
  assert.equal(bands.length, 2);
  assert.equal(bands[0].endPct, 50);
  assert.equal(bands[1].endPct, 0);
  assert.deepEqual(bandRadiiFromDurations(null, 0, 100), [{ startPct: 100, endPct: 0 }]);
});

test('bandRadiiFromDurations: default bounds are the groove area\'s own constants', () => {
  const bands = bandRadiiFromDurations([1, 1]);
  assert.equal(bands[0].startPct, GROOVE_OUTER_PCT);
  assert.equal(bands[1].endPct, GROOVE_INNER_PCT);
});

test('grooveBandsForSide: pairs each band with its own track\'s measured loudness', () => {
  const tracks = [
    { duration: 100, details: { loudness: LOUDNESS_CEIL_LUFS } },
    { duration: 100, details: {} },
  ];
  const bands = grooveBandsForSide(tracks, 0, 100);
  assert.ok(Math.abs(bands[0].pitchPct - GROOVE_PITCH_MIN_PCT) < 1e-9);
  assert.equal(bands[1].pitchPct, GROOVE_PITCH_MIDDLE_PCT);
});

test('grooveBandsForSide: empty/missing tracks never throws', () => {
  assert.deepEqual(grooveBandsForSide(null, 0, 100), [{ startPct: 100, endPct: 0, pitchPct: GROOVE_PITCH_MIDDLE_PCT }]);
});

// -- needleRadiusPct ------------------------------------------------------

test('needleRadiusPct: moves inward across the active band as playedFrac goes 0 -> 1', () => {
  const bands = bandRadiiFromDurations([100, 100], 0, 100);
  assert.equal(needleRadiusPct(bands, 0, 0), 100);
  assert.equal(needleRadiusPct(bands, 0, 1), 50);
  assert.equal(needleRadiusPct(bands, 0, 0.5), 75);
  assert.equal(needleRadiusPct(bands, 1, 0), 50);
  assert.equal(needleRadiusPct(bands, 1, 1), 0);
});

test('needleRadiusPct: an out-of-range activeIdx clamps to the nearest real band', () => {
  const bands = bandRadiiFromDurations([100, 100], 0, 100);
  assert.equal(needleRadiusPct(bands, -1, 0), 100);
  assert.equal(needleRadiusPct(bands, 5, 1), 0);
});

test('needleRadiusPct: no bands at all falls back to the groove area\'s outer edge', () => {
  assert.equal(needleRadiusPct(null, 0, 0.5), GROOVE_OUTER_PCT);
  assert.equal(needleRadiusPct([], 0, 0.5), GROOVE_OUTER_PCT);
});

// -- sideMapSegments -------------------------------------------------------

test('sideMapSegments: widths are proportional to duration and sum to 100', () => {
  const segs = sideMapSegments([300, 100], null, 0);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].widthPct, 75);
  assert.equal(segs[1].widthPct, 25);
});

test('sideMapSegments: tracks before the active one are full, after are empty, the active one fills by its own played fraction', () => {
  const segs = sideMapSegments([100, 100, 100], 1, 0.4);
  assert.deepEqual(segs.map(s => s.fillPct), [100, 40, 0]);
});

test('sideMapSegments: no active track (nothing playing on this side) leaves every segment unfilled', () => {
  const segs = sideMapSegments([100, 100], null, 0.9);
  assert.deepEqual(segs.map(s => s.fillPct), [0, 0]);
  const segs2 = sideMapSegments([100, 100], 5, 0.9); // out of range
  assert.deepEqual(segs2.map(s => s.fillPct), [0, 0]);
});

test('sideMapSegments: an empty duration list still returns one even segment, never divides by zero', () => {
  const segs = sideMapSegments([0, 0], 0, 0.5);
  assert.equal(segs[0].widthPct, 50);
  assert.equal(segs[1].widthPct, 50);
  assert.equal(segs[0].fillPct, 50);
});

// -- grooveBackgroundImage -------------------------------------------------

test('grooveBackgroundImage: no bands returns null rather than an empty gradient', () => {
  assert.equal(grooveBackgroundImage(null), null);
  assert.equal(grooveBackgroundImage([]), null);
});

test('grooveBackgroundImage: a real band list produces a radial-gradient string with ascending, in-range stops', () => {
  const bands = grooveBandsForSide([{ duration: 100 }, { duration: 100 }], 0, 100);
  const css = grooveBackgroundImage(bands);
  assert.ok(css.startsWith('radial-gradient(circle at 50% 50%,'));
  const stopList = css.slice(css.indexOf('%,') + 2);
  const pcts = [...stopList.matchAll(/(-?\d+(?:\.\d+)?)%/g)].map(m => Number(m[1]));
  assert.ok(pcts.length > 4);
  for(const p of pcts) assert.ok(p >= 0 && p <= 100);
  for(let i = 1; i < pcts.length; i++) assert.ok(pcts[i] >= pcts[i-1] - 1e-6);
});
