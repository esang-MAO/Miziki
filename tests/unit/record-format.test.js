// AU9 (docs/16_AUDIO.md §5): the pure 45 RPM leaf -- side splitting, the
// format table, the personal override, and the rotation helper. No
// imports in the module under test, so none in this file either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RPM_33, RPM_45, SEVEN_INCH_MAX_SEC, TWELVE_SINGLE_MAX_SEC,
  bestSideCut, sideLengthsFromDurations, formatForLongestSide, recordFormat,
  albumRecordFormat, rotationHz,
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

test('formatForLongestSide: the table\'s three boundaries', () => {
  assert.deepEqual(formatForLongestSide(0), { size: '7"', speed: RPM_45 });
  assert.deepEqual(formatForLongestSide(SEVEN_INCH_MAX_SEC), { size: '7"', speed: RPM_45 });
  assert.deepEqual(formatForLongestSide(SEVEN_INCH_MAX_SEC + 1), { size: '12"', speed: RPM_45 });
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

test('recordFormat: 45 still sizes itself from the table', () => {
  assert.deepEqual(recordFormat(100, '45'), { size: '7"', speed: RPM_45 });
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
