import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZOETROPE_STILL_THRESHOLD,
  frameSlotDeg,
  strobeTickHz,
  quantizeRingAngleDeg,
  shouldQuantize,
  zoetropeRingAngleDeg,
} from '../../src/record-art/zoetrope-motion.js';

// nominal rps for 33⅓ and 45, the same shape record-art/format.js's rotationHz(rpm, 1) gives
const RPS_33 = 33.333 / 60;
const RPS_45 = 45 / 60;

test('PRESSINGS_110 PR6: frameSlotDeg is 360/N', () => {
  assert.equal(frameSlotDeg(12), 30);
  assert.equal(frameSlotDeg(16), 22.5);
  assert.equal(frameSlotDeg(24), 15);
  assert.equal(frameSlotDeg(32), 11.25);
});

test('PRESSINGS_110 PR6: strobeTickHz matches the spec\'s named tick rates', () => {
  // 33⅓: 0.556 rps × 12 = 6.7 ticks/s
  assert.ok(Math.abs(strobeTickHz(RPS_33, 12) - 6.7) < 0.05);
  // 45: 0.75 rps × 16 = 12 ticks/s
  assert.equal(strobeTickHz(RPS_45, 16), 12);
  // Rainfall's own wider frame counts (24 LP / 32 45)
  assert.ok(Math.abs(strobeTickHz(RPS_33, 24) - 13.3) < 0.1);
  assert.equal(strobeTickHz(RPS_45, 32), 24);
});

test('PRESSINGS_110 PR6: quantizeRingAngleDeg snaps down to the nearest slot boundary', () => {
  assert.equal(quantizeRingAngleDeg(0, 12), 0);
  assert.equal(quantizeRingAngleDeg(29.9, 12), 0);
  assert.equal(quantizeRingAngleDeg(30, 12), 30);
  assert.equal(quantizeRingAngleDeg(47, 12), 30);
  assert.equal(quantizeRingAngleDeg(719.9, 12), 690);
});

test('PRESSINGS_110 PR6: quantizeRingAngleDeg handles large, unbounded accumulated angles', () => {
  // the real disc angle accumulates without wrapping (player/clock.js's own S.angle) —
  // the quantizer must still resolve correctly at a large cumulative value
  assert.equal(quantizeRingAngleDeg(36047, 12), 36030);
});

test('PRESSINGS_110 PR6: shouldQuantize follows the ~70% still threshold', () => {
  assert.equal(shouldQuantize(RPS_33, RPS_33), true); // full speed
  assert.equal(shouldQuantize(RPS_33 * 0.9, RPS_33), true);
  assert.equal(shouldQuantize(RPS_33 * ZOETROPE_STILL_THRESHOLD, RPS_33), true); // exactly at threshold
  assert.equal(shouldQuantize(RPS_33 * 0.69, RPS_33), false);
  assert.equal(shouldQuantize(RPS_33 * 0.5, RPS_33), false);
  assert.equal(shouldQuantize(RPS_33, 0), false); // guard against a zero/unknown nominal rate
});

test('PRESSINGS_110 PR6: zoetropeRingAngleDeg quantizes in Vinyl at or above the still threshold', () => {
  const angle = zoetropeRingAngleDeg({
    realAngleDeg: 47, frameCount: 12, actualRps: RPS_33, nominalRps: RPS_33, mode: 'vinyl', reducedMotion: false,
  });
  assert.equal(angle, 30);
});

test('PRESSINGS_110 PR6: zoetropeRingAngleDeg goes continuous below the still threshold', () => {
  const angle = zoetropeRingAngleDeg({
    realAngleDeg: 47, frameCount: 12, actualRps: RPS_33 * 0.5, nominalRps: RPS_33, mode: 'vinyl', reducedMotion: false,
  });
  assert.equal(angle, 47);
});

test('PRESSINGS_110 PR6: zoetropeRingAngleDeg is always continuous in Pure, regardless of speed', () => {
  const angle = zoetropeRingAngleDeg({
    realAngleDeg: 47, frameCount: 12, actualRps: 0, nominalRps: RPS_33, mode: 'pure', reducedMotion: false,
  });
  assert.equal(angle, 47);
});

test('PRESSINGS_110 PR6: zoetropeRingAngleDeg is always continuous under reduced motion, in either mode', () => {
  const vinyl = zoetropeRingAngleDeg({
    realAngleDeg: 47, frameCount: 12, actualRps: RPS_33, nominalRps: RPS_33, mode: 'vinyl', reducedMotion: true,
  });
  const pure = zoetropeRingAngleDeg({
    realAngleDeg: 47, frameCount: 12, actualRps: RPS_33, nominalRps: RPS_33, mode: 'pure', reducedMotion: true,
  });
  assert.equal(vinyl, 47);
  assert.equal(pure, 47);
});
