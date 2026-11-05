// GS3 (docs/30_GROOVES_AND_SHELF.md): grooves drawn from the audio -- the
// pure band-geometry/pitch-mapping/side-map leaf. No imports in the
// module under test besides util/math.js's clamp (itself pure/zero-
// import), so none in this file either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROOVE_INNER_PCT, GROOVE_OUTER_PCT,
  GROOVE_PITCH_MIN_PCT, GROOVE_PITCH_MAX_PCT, GROOVE_PITCH_MIDDLE_PCT,
  LOUDNESS_FLOOR_LUFS, LOUDNESS_CEIL_LUFS, RIM_INNER_PCT, DROP_NEEDLE_SNAP_PCT,
  LABEL_INNER_PCT_BY_SIZE,
  groovePitchForLoudness, bandRadiiFromDurations, grooveBandsForSide,
  needleRadiusPct, sideMapSegments, grooveBackgroundImage,
  isRimRadiusPct, radiusPctFromPoint, bandIndexForRadius, dropNeedleTarget,
  labelInnerPctForSize,
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
  assert.ok(Math.abs(bands[2].endPct - GROOVE_INNER_PCT) < 1e-9);
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

test('grooveBandsForSide: pairs each band with its own track\'s measured loudness (audio/loudness.js\'s own {lufs, measured, ...} shape, not a bare number)', () => {
  const tracks = [
    { duration: 100, details: { loudness: { lufs: LOUDNESS_CEIL_LUFS, measured: true } } },
    { duration: 100, details: {} },
  ];
  const bands = grooveBandsForSide(tracks, 0, 100);
  assert.ok(Math.abs(bands[0].pitchPct - GROOVE_PITCH_MIN_PCT) < 1e-9);
  assert.equal(bands[1].pitchPct, GROOVE_PITCH_MIDDLE_PCT);
});

test('grooveBandsForSide: a loudness object whose own .lufs isn\'t a real number still takes the middle pitch', () => {
  const tracks = [{ duration: 100, details: { loudness: { lufs: null, measured: false } } }];
  const bands = grooveBandsForSide(tracks, 0, 100);
  assert.equal(bands[0].pitchPct, GROOVE_PITCH_MIDDLE_PCT);
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

// -- GS4: drop the needle --------------------------------------------------

// -- isRimRadiusPct ---------------------------------------------------------

test('isRimRadiusPct: the outermost ~8% of the radius counts as the rim', () => {
  assert.equal(isRimRadiusPct(RIM_INNER_PCT), true);
  assert.equal(isRimRadiusPct(100), true);
  assert.equal(isRimRadiusPct(RIM_INNER_PCT - 0.01), false);
});

// GROOVE_OUTER_PCT (2026-11-05, Ken) now sits past RIM_INNER_PCT on
// purpose -- the rim is a touch-gesture zone (hold vs. spin), not a claim
// about where the record's own groove texture stops being drawn.
test('GROOVE_OUTER_PCT reaches past the rim\'s own inner edge -- grooves draw almost to the true edge', () => {
  assert.ok(GROOVE_OUTER_PCT > RIM_INNER_PCT);
});

// -- radiusPctFromPoint ------------------------------------------------------

test('radiusPctFromPoint: the center is 0, the edge is 100', () => {
  const rect = { left: 0, top: 0, width: 200, height: 200 };
  assert.equal(radiusPctFromPoint(100, 100, rect), 0);
  assert.equal(radiusPctFromPoint(200, 100, rect), 100); // rightmost edge
  assert.equal(radiusPctFromPoint(100, 0, rect), 100);   // topmost edge
});

test('radiusPctFromPoint: works off-origin, and diagonally', () => {
  const rect = { left: 50, top: 50, width: 100, height: 100 }; // center (100,100), radius 50
  assert.ok(Math.abs(radiusPctFromPoint(100 + 50/Math.SQRT2, 100 + 50/Math.SQRT2, rect) - 100) < 1e-9);
});

test('radiusPctFromPoint: a zero-size rect never divides by zero', () => {
  assert.equal(radiusPctFromPoint(10, 10, { left: 0, top: 0, width: 0, height: 0 }), 0);
});

// -- bandIndexForRadius ------------------------------------------------------

test('bandIndexForRadius: resolves a radius to the band whose range contains it', () => {
  const bands = bandRadiiFromDurations([100, 100], 0, 100); // [{100,50},{50,0}]
  assert.equal(bandIndexForRadius(bands, 100), 0);
  assert.equal(bandIndexForRadius(bands, 75), 0);
  assert.equal(bandIndexForRadius(bands, 50), 0); // shared boundary -- the outer band owns it (checked first)
  assert.equal(bandIndexForRadius(bands, 25), 1);
  assert.equal(bandIndexForRadius(bands, 0), 1);
});

test('bandIndexForRadius: out-of-range radii clamp to the nearest real band', () => {
  const bands = bandRadiiFromDurations([100, 100], 0, 100);
  assert.equal(bandIndexForRadius(bands, 120), 0);   // past the rim -- outermost band
  assert.equal(bandIndexForRadius(bands, -10), 1);   // past the spindle -- innermost band
});

test('bandIndexForRadius: no bands at all never throws', () => {
  assert.equal(bandIndexForRadius(null, 50), 0);
  assert.equal(bandIndexForRadius([], 50), 0);
});

// -- dropNeedleTarget ---------------------------------------------------------

test('dropNeedleTarget: no bands at all returns null, the same "nothing to drop onto" shape grooveBackgroundImage() uses', () => {
  assert.equal(dropNeedleTarget(null, 50), null);
  assert.equal(dropNeedleTarget([], 50), null);
});

test('dropNeedleTarget: within the snap threshold of a track start, snaps to it exactly', () => {
  const bands = bandRadiiFromDurations([100, 100, 100], 0, 100); // starts at 100, 66.67, 33.33
  const target = dropNeedleTarget(bands, 100 - (DROP_NEEDLE_SNAP_PCT - 0.1));
  assert.equal(target.snapped, true);
  assert.equal(target.index, 0);
  assert.equal(target.radiusPct, bands[0].startPct);
});

test('dropNeedleTarget: outside every track start\'s threshold, follows the raw (clamped) radius unsnapped', () => {
  const bands = bandRadiiFromDurations([100, 100], 0, 100); // starts at 100, 50; ends at 50, 0
  const target = dropNeedleTarget(bands, 75); // squarely mid-band, far from either start
  assert.equal(target.snapped, false);
  assert.equal(target.index, 0); // the band containing 75
  assert.equal(target.radiusPct, 75);
});

test('dropNeedleTarget: a radius past the rim or the spindle clamps into range before resolving', () => {
  const bands = bandRadiiFromDurations([100, 100], 0, 100);
  const outer = dropNeedleTarget(bands, 150);
  assert.equal(outer.snapped, true);
  assert.equal(outer.index, 0);
  const inner = dropNeedleTarget(bands, -50); // clamps to the spindle (0), far from any track start
  assert.equal(inner.snapped, false);
  assert.equal(inner.index, 1); // the innermost band
  assert.equal(inner.radiusPct, 0);
});

test('dropNeedleTarget: picks whichever track start is nearest, even when that\'s not the containing band\'s own start', () => {
  const bands = bandRadiiFromDurations([10, 100, 10], 0, 100); // band0 ends ~91.67, band1 starts there
  // radius 93 is inside band0's own range (bandIndexForRadius would say 0),
  // but it's much closer to band1's start (91.67, 1.33 away) than band0's
  // own (100, 7 away) -- dropNeedleTarget should snap to band1, not band0.
  assert.equal(bandIndexForRadius(bands, 93), 0);
  const target = dropNeedleTarget(bands, 93);
  assert.equal(target.snapped, true);
  assert.equal(target.index, 1);
  assert.ok(Math.abs(target.radiusPct - bands[1].startPct) < 1e-9);
});

// -- labelInnerPctForSize ----------------------------------------------------
// Ken, 2026-11-05: tracks near the end of a side drew groove texture under
// the paper label -- GROOVE_INNER_PCT used to reuse the disc's own static
// background gradient stop (27%), not the real .label element's own edge
// (src/styles/02-stage-platter.css: 33%/40%/51.5% for 12"/10"/7").

test('labelInnerPctForSize: matches the real .label element\'s own edge per record size', () => {
  assert.equal(labelInnerPctForSize('12"'), 33);
  assert.equal(labelInnerPctForSize('10"'), 40);
  assert.equal(labelInnerPctForSize('7"'), 51.5);
});

test('labelInnerPctForSize: an unknown/missing size falls back to the 12" default', () => {
  assert.equal(labelInnerPctForSize(undefined), GROOVE_INNER_PCT);
  assert.equal(labelInnerPctForSize(null), GROOVE_INNER_PCT);
  assert.equal(labelInnerPctForSize('8-track'), GROOVE_INNER_PCT);
});

test('labelInnerPctForSize: GROOVE_INNER_PCT is itself the 12" value, and every smaller format\'s label is proportionally larger', () => {
  assert.equal(LABEL_INNER_PCT_BY_SIZE['12"'], GROOVE_INNER_PCT);
  assert.ok(LABEL_INNER_PCT_BY_SIZE['10"'] > LABEL_INNER_PCT_BY_SIZE['12"']);
  assert.ok(LABEL_INNER_PCT_BY_SIZE['7"'] > LABEL_INNER_PCT_BY_SIZE['10"']);
});

test('grooveBandsForSide: a 7" record\'s own larger label keeps every band\'s own inner edge outside it', () => {
  const tracks = [{ duration: 60 }, { duration: 60 }, { duration: 60 }];
  const innerPct = labelInnerPctForSize('7"');
  const bands = grooveBandsForSide(tracks, innerPct, GROOVE_OUTER_PCT);
  assert.ok(Math.abs(bands[bands.length - 1].endPct - innerPct) < 1e-9);
  for(const b of bands) assert.ok(b.endPct >= innerPct - 1e-9);
});
