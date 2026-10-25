// AU9 (docs/16_AUDIO.md §5): the pure 45 RPM leaf -- side splitting, the
// format table, the personal override, and the rotation helper. No
// imports in the module under test, so none in this file either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RPM_33, RPM_45, SEVEN_INCH_MAX_SEC, TEN_INCH_MAX_SEC, TWELVE_SINGLE_MAX_SEC,
  bestSideCut, sideLengthsFromDurations, formatForLongestSide, recordFormat,
  albumRecordFormat, rotationHz,
  formatRecordName, formatChipText, formatSpeedText, sideCapacitySec, sideFullness,
  formatWireCode, formatFromWireCode,
} from '../../src/record-art/format.js';

test('bestSideCut: fewer than two durations has no meaningful cut', () => {
  assert.equal(bestSideCut([]), 0);
  assert.equal(bestSideCut([400]), 1);
});

test('bestSideCut: two durations always cut at 1', () => {
  assert.equal(bestSideCut([600, 60]), 1);
  assert.equal(bestSideCut([10, 600]), 1);
});

test('bestSideCut: three durations balance by time', () => {
  // k=1: |100-400|=300; k=2: |200-300|=100
  assert.equal(bestSideCut([100, 100, 300]), 2);
});

test('bestSideCut: an even number of equal tracks cuts in the middle', () => {
  assert.equal(bestSideCut([600, 600, 600, 600]), 2);
});

test('bestSideCut: a very uneven set of lengths still finds the closest split', () => {
  // k=1:|10-520|=510; k=2:|510-20|=490; k=3:|520-10|=510
  assert.equal(bestSideCut([10, 500, 10, 10]), 2);
});

test('bestSideCut: an exact tie keeps the earlier cut', () => {
  // five equal tracks: k=2 and k=3 both give a diff of one unit
  assert.equal(bestSideCut([1, 1, 1, 1, 1]), 2);
});

test('sideLengthsFromDurations: empty, one, two and several tracks', () => {
  assert.deepEqual(sideLengthsFromDurations([]), [0]);
  assert.deepEqual(sideLengthsFromDurations([250]), [250]);
  assert.deepEqual(sideLengthsFromDurations([600, 60]), [600, 60]);
  assert.deepEqual(sideLengthsFromDurations([100, 100, 300]), [200, 300]);
});

test('formatForLongestSide: the table\'s four boundaries', () => {
  assert.deepEqual(formatForLongestSide(0), { size: '7"', speed: RPM_45 });
  assert.deepEqual(formatForLongestSide(SEVEN_INCH_MAX_SEC), { size: '7"', speed: RPM_45 });
  assert.deepEqual(formatForLongestSide(SEVEN_INCH_MAX_SEC + 1), { size: '10"', speed: RPM_45 });
  assert.deepEqual(formatForLongestSide(TEN_INCH_MAX_SEC), { size: '10"', speed: RPM_45 });
  assert.deepEqual(formatForLongestSide(TEN_INCH_MAX_SEC + 1), { size: '12"', speed: RPM_45 });
  assert.deepEqual(formatForLongestSide(TWELVE_SINGLE_MAX_SEC), { size: '12"', speed: RPM_45 });
  assert.deepEqual(formatForLongestSide(TWELVE_SINGLE_MAX_SEC + 1), { size: '12"', speed: RPM_33 });
});

test('recordFormat: auto reads straight off the table', () => {
  assert.deepEqual(recordFormat(100, 'auto'), { size: '7"', speed: RPM_45 });
  assert.deepEqual(recordFormat(1000, undefined), { size: '12"', speed: RPM_33 });
});

test('recordFormat: 33 is always a 12", skipping the table\'s own speed', () => {
  assert.deepEqual(recordFormat(100, '33'), { size: '12"', speed: RPM_33 });
  assert.deepEqual(recordFormat(1000, '33'), { size: '12"', speed: RPM_33 });
});

test('recordFormat: 45 still sizes itself from the table, including the 10" band', () => {
  assert.deepEqual(recordFormat(100, '45'), { size: '7"', speed: RPM_45 });
  assert.deepEqual(recordFormat(SEVEN_INCH_MAX_SEC + 1, '45'), { size: '10"', speed: RPM_45 });
  assert.deepEqual(recordFormat(TEN_INCH_MAX_SEC, '45'), { size: '10"', speed: RPM_45 });
  assert.deepEqual(recordFormat(1000, '45'), { size: '12"', speed: RPM_45 });
});

test('albumRecordFormat: picks the longest of the given side lengths', () => {
  assert.deepEqual(albumRecordFormat([100, 1000], 'auto'), { size: '12"', speed: RPM_33 });
  assert.deepEqual(albumRecordFormat([], 'auto'), { size: '7"', speed: RPM_45 });
});

test('rotationHz: 33⅓ and 45, at full speed and a Sundown rate', () => {
  assert.ok(Math.abs(rotationHz(RPM_33, 1) - 0.5556) / 0.5556 < 0.01);
  assert.ok(Math.abs(rotationHz(RPM_45, 1) - 0.75) / 0.75 < 0.01);
  assert.ok(Math.abs(rotationHz(RPM_45, 0.8) - 0.6) / 0.6 < 0.01);
});

test('rotationHz: falls back to 33⅓ for a falsy rpm, and rate 1 for a falsy rate', () => {
  assert.equal(rotationHz(0, 1), rotationHz(RPM_33, 1));
  assert.equal(rotationHz(RPM_45, 0), rotationHz(RPM_45, 1));
});

// AU10 (docs/16_AUDIO.md §5): text and the dead-wax radius, both derived
// from the same table above.
test('formatRecordName: one name per cell, "unremarkable" 33⅓ reads LP', () => {
  assert.equal(formatRecordName({size:'7"', speed:RPM_45}), '7″ SINGLE');
  assert.equal(formatRecordName({size:'10"', speed:RPM_45}), '10″ EP');
  assert.equal(formatRecordName({size:'12"', speed:RPM_45}), '12″ EP');
  assert.equal(formatRecordName({size:'12"', speed:RPM_33}), '12″ LP');
  assert.equal(formatRecordName(null), '');
});

test('formatSpeedText: 45 or 33⅓, nothing else', () => {
  assert.equal(formatSpeedText(RPM_45), '45');
  assert.equal(formatSpeedText(RPM_33), '33⅓');
});

test('formatChipText: "size · speed", empty for no format', () => {
  assert.equal(formatChipText({size:'7"', speed:RPM_45}), '7" · 45');
  assert.equal(formatChipText({size:'12"', speed:RPM_33}), '12" · 33⅓');
  assert.equal(formatChipText(null), '');
});

test('sideCapacitySec: the table\'s own four capacities, falling back to an LP\'s own 22 minutes', () => {
  assert.equal(sideCapacitySec({size:'7"', speed:RPM_45}), SEVEN_INCH_MAX_SEC);
  assert.equal(sideCapacitySec({size:'10"', speed:RPM_45}), TEN_INCH_MAX_SEC);
  assert.equal(sideCapacitySec({size:'12"', speed:RPM_45}), TWELVE_SINGLE_MAX_SEC);
  assert.equal(sideCapacitySec({size:'12"', speed:RPM_33}), 22 * 60);
  assert.equal(sideCapacitySec(null), TWELVE_SINGLE_MAX_SEC);
});

test('sideFullness: 0..1, clamped, matching the format\'s own capacity', () => {
  const lp = {size:'12"', speed:RPM_33};
  assert.equal(sideFullness(0, lp), 0);
  assert.equal(sideFullness(22 * 60, lp), 1);
  assert.equal(sideFullness(44 * 60, lp), 1); // clamped, never past full
  assert.ok(Math.abs(sideFullness(11 * 60, lp) - 0.5) < 0.001);
});

// AU11 (docs/16_AUDIO.md §5): the short wire code a record's own
// automatic format is published as -- one code per table cell, round-
// tripping through formatFromWireCode() back to the same {size, speed}
// shape every other reader in this file already uses.
test('formatWireCode: one code per table cell', () => {
  assert.equal(formatWireCode({size:'7"', speed:RPM_45}), '7-45');
  assert.equal(formatWireCode({size:'10"', speed:RPM_45}), '10-45');
  assert.equal(formatWireCode({size:'12"', speed:RPM_45}), '12-45');
  assert.equal(formatWireCode({size:'12"', speed:RPM_33}), '12-33');
  assert.equal(formatWireCode(null), null);
});

test('formatFromWireCode: decodes each known code back to its format', () => {
  assert.deepEqual(formatFromWireCode('7-45'), {size:'7"', speed:RPM_45});
  assert.deepEqual(formatFromWireCode('10-45'), {size:'10"', speed:RPM_45});
  assert.deepEqual(formatFromWireCode('12-45'), {size:'12"', speed:RPM_45});
  assert.deepEqual(formatFromWireCode('12-33'), {size:'12"', speed:RPM_33});
});

test('formatFromWireCode: an unrecognized or missing code reads as unknown, not a guess', () => {
  assert.equal(formatFromWireCode('garbage'), null);
  assert.equal(formatFromWireCode(null), null);
  assert.equal(formatFromWireCode(undefined), null);
});

test('formatWireCode/formatFromWireCode: round-trips every value formatForLongestSide can produce', () => {
  for(const longest of [0, 60, SEVEN_INCH_MAX_SEC, SEVEN_INCH_MAX_SEC + 1, TEN_INCH_MAX_SEC,
    TEN_INCH_MAX_SEC + 1, TWELVE_SINGLE_MAX_SEC, TWELVE_SINGLE_MAX_SEC + 1]){
    const f = formatForLongestSide(longest);
    assert.deepEqual(formatFromWireCode(formatWireCode(f)), f);
  }
});
