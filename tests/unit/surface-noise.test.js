// docs/15_SURFACE_NOISE.md §1: the Surface Noise generators.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  releaseSeed, noiseFloorScale, hissSamples, crackleSamples, popSamples,
  rotationWobble, leadInSamples, runoutNoiseSamples, underMusicSamples,
  needleDropSamples, needleLiftSamples,
  startLeadIn, startRunoutNoise, startUnderMusicBed, playNeedleDrop, playNeedleLift,
} from '../../src/audio/surface-noise.js';
import { S } from '../../src/state.js';

const SR = 8000;

test('releaseSeed is the same for the same release+side, different for a different one', () => {
  assert.equal(releaseSeed('abc', 'A'), releaseSeed('abc', 'A'));
  assert.notEqual(releaseSeed('abc', 'A'), releaseSeed('abc', 'B'));
  assert.notEqual(releaseSeed('abc', 'A'), releaseSeed('xyz', 'A'));
  assert.ok(releaseSeed('abc', 'A') > 0);
});

test('noiseFloorScale: Off is always silent; Well-loved is louder than Subtle; a cleaner pressing is quieter', () => {
  assert.equal(noiseFloorScale('off', 1), 0);
  assert.ok(noiseFloorScale('well-loved', 1) > noiseFloorScale('subtle', 1));
  assert.ok(noiseFloorScale('subtle', 3) < noiseFloorScale('subtle', 1));
  assert.ok(noiseFloorScale('well-loved', 3) <= noiseFloorScale('well-loved', 1));
});

test('hiss/crackle/pop samples are as long as asked, and silent for zero duration', () => {
  assert.equal(hissSamples(SR, 1, 1).length, SR);
  assert.equal(hissSamples(SR, 0, 1).length, 0);
  assert.equal(crackleSamples(SR, 1, 1).length, SR);
  assert.equal(popSamples(SR, 1, 1).length, SR);
});

test('the same seed gives the same hiss/crackle, a different seed a different one', () => {
  const a = hissSamples(SR, 0.5, 7), b = hissSamples(SR, 0.5, 7), c = hissSamples(SR, 0.5, 9);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  const ca = crackleSamples(SR, 0.5, 7), cb = crackleSamples(SR, 0.5, 7), cc = crackleSamples(SR, 0.5, 9);
  assert.deepEqual(ca, cb);
  assert.notDeepEqual(ca, cc);
});

test('a louder levelDb produces a louder hiss', () => {
  const quiet = hissSamples(SR, 1, 3, -60);
  const loud = hissSamples(SR, 1, 3, -30);
  const peak = s => Math.max(...Array.from(s, Math.abs));
  assert.ok(peak(loud) > peak(quiet));
});

test('rotationWobble oscillates around 1, scaled slower by a lower rateHz', () => {
  const fast = rotationWobble(SR, SR, 0.55);
  const slow = rotationWobble(SR, SR, 0.2);
  assert.ok(Math.max(...fast) > 1 && Math.min(...fast) < 1);
  // half a second in, the slower rotation has moved less far from 1 than the faster one
  assert.ok(Math.abs(slow[SR/2] - 1) < Math.abs(fast[SR/2] - 1));
});

test('leadInSamples is silent (and still the right length) with scale 0, fades in from silence otherwise', () => {
  const silent = leadInSamples(SR, 2, 7, 0);
  assert.equal(silent.length, Math.floor(SR * 2));
  assert.ok(silent.every(x => x === 0));
  const s = leadInSamples(SR, 2, 7, 1);
  assert.equal(Math.abs(s[0]), 0);
  const early = Math.max(...Array.from(s.slice(0, 50), Math.abs));
  const mid = Math.max(...Array.from(s.slice(SR, SR + 50), Math.abs));
  assert.ok(early < mid);
  // and fades back down over its own tail, for the crossfade into track 1
  const late = Math.max(...Array.from(s.slice(-50), Math.abs));
  assert.ok(late < mid);
});

test('runoutNoiseSamples and underMusicSamples are deterministic and the right length', () => {
  assert.equal(runoutNoiseSamples(SR, 3, 7, 1).length, Math.floor(SR * 3));
  assert.deepEqual(runoutNoiseSamples(SR, 1, 7, 1), runoutNoiseSamples(SR, 1, 7, 1));
  assert.equal(underMusicSamples(SR, 2, 7).length, Math.floor(SR * 2));
});

test('needleDropSamples/needleLiftSamples are short, non-empty and decay toward silence', () => {
  const drop = needleDropSamples(SR), lift = needleLiftSamples(SR);
  assert.ok(drop.length > 0 && lift.length > 0);
  const peak = s => Math.max(...Array.from(s, Math.abs));
  assert.ok(peak(drop) > 0 && peak(lift) > 0);
  const tail = s => Math.max(...Array.from(s.slice(-10), Math.abs));
  assert.ok(tail(drop) < peak(drop));
  assert.ok(tail(lift) < peak(lift));
});

test('every runtime starter is a safe no-op without an audio graph, or in Pure/Off', () => {
  S.ctx = null; S.nodes = null;
  startLeadIn(1, 7, 1).stop();
  startRunoutNoise(1, 7, 1).stop();
  startUnderMusicBed(7, 1).stop();
  playNeedleDrop();
  playNeedleLift();

  S.ctx = {}; S.nodes = { wobble: {} }; S.mode = 'pure'; S.surfaceNoise = 'subtle';
  startLeadIn(1, 7, 1).stop();
  playNeedleDrop();

  S.mode = 'vinyl'; S.surfaceNoise = 'off';
  startRunoutNoise(1, 7, 1).stop();
  playNeedleLift();

  S.ctx = null; S.nodes = null; S.mode = 'vinyl'; S.surfaceNoise = 'subtle';
});

test('startUnderMusicBed is a no-op when the setting itself is off, even with a scale', () => {
  S.surfaceNoiseUnderMusic = false;
  assert.doesNotThrow(() => startUnderMusicBed(7, 1).stop());
});
