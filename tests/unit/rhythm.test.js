import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASES, RHYTHM_MIN_PLAYS, RHYTHM_VERDICT_THRESHOLD, RHYTHM_AROUND_LABEL,
  computeRhythmShares, rhythmVerdictLabel, bestAlbumPerPhase,
} from '../../src/sundown/rhythm.js';

// DA5 (docs/DAY_ARC.md) — pure functions over plain {phase: count} maps,
// no mocking needed at all (src/sundown/rhythm.js has no imports).

test('computeRhythmShares: every one of the seven phases is present, even with zero plays', () => {
  const { total, shares } = computeRhythmShares({});
  assert.equal(total, 0);
  assert.deepEqual(Object.keys(shares).sort(), PHASES.slice().sort());
  PHASES.forEach(p => assert.equal(shares[p], 0));
});

test('computeRhythmShares: shares are each count over the real total, summing to 1', () => {
  const { total, shares } = computeRhythmShares({ night: 6, morning: 3, golden: 1 });
  assert.equal(total, 10);
  assert.equal(shares.night, 0.6);
  assert.equal(shares.morning, 0.3);
  assert.equal(shares.golden, 0.1);
  assert.equal(shares.dawn, 0);
  const sum = PHASES.reduce((a, p) => a + shares[p], 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('computeRhythmShares: a null/undefined counts object is treated as empty, not thrown on', () => {
  assert.deepEqual(computeRhythmShares(undefined).shares.night, 0);
  assert.deepEqual(computeRhythmShares(null).total, 0);
});

test(`rhythmVerdictLabel: a phase at or above the ${RHYTHM_VERDICT_THRESHOLD} threshold wins its own label`, () => {
  const { shares } = computeRhythmShares({ night: 7, morning: 1, golden: 1, dawn: 1 });
  assert.equal(rhythmVerdictLabel(shares), 'Mostly a night listener');
});

test('rhythmVerdictLabel: the three phases docs/DAY_ARC.md names verbatim', () => {
  assert.equal(rhythmVerdictLabel(computeRhythmShares({ morning: 10 }).shares), 'A morning listener');
  assert.equal(rhythmVerdictLabel(computeRhythmShares({ golden: 10 }).shares), 'Golden-hour leaning');
  assert.equal(rhythmVerdictLabel(computeRhythmShares({ night: 10 }).shares), 'Mostly a night listener');
});

test('rhythmVerdictLabel: every other phase gets its own consistent "Mostly a <phase> listener" label', () => {
  assert.equal(rhythmVerdictLabel(computeRhythmShares({ dawn: 10 }).shares), 'Mostly a dawn listener');
  assert.equal(rhythmVerdictLabel(computeRhythmShares({ midday: 10 }).shares), 'Mostly a midday listener');
  assert.equal(rhythmVerdictLabel(computeRhythmShares({ afternoon: 10 }).shares), 'Mostly an afternoon listener');
  assert.equal(rhythmVerdictLabel(computeRhythmShares({ twilight: 10 }).shares), 'Mostly a twilight listener');
});

test('rhythmVerdictLabel: no phase above the threshold falls through to "Around the clock"', () => {
  // seven phases, spread so the largest share is 1/7 ~= 14%, well under 30%
  const counts = {}; PHASES.forEach(p => { counts[p] = 1; });
  const { shares } = computeRhythmShares(counts);
  assert.equal(rhythmVerdictLabel(shares), RHYTHM_AROUND_LABEL);
});

test('rhythmVerdictLabel: a share sitting exactly on the threshold still wins (>= not >)', () => {
  const shares = {}; PHASES.forEach(p => { shares[p] = 0; });
  shares.golden = RHYTHM_VERDICT_THRESHOLD;
  shares.night = 1 - RHYTHM_VERDICT_THRESHOLD;
  // night is still the larger share overall, so it should win regardless
  assert.equal(rhythmVerdictLabel(shares), 'Mostly a night listener');
  // now make golden alone the largest, exactly at the threshold
  const golden = {}; PHASES.forEach(p => { golden[p] = 0; });
  golden.golden = RHYTHM_VERDICT_THRESHOLD;
  assert.equal(rhythmVerdictLabel(golden), 'Golden-hour leaning');
});

test('rhythmVerdictLabel: no data at all (every share 0) reads "Around the clock", not a crash', () => {
  const shares = {}; PHASES.forEach(p => { shares[p] = 0; });
  assert.equal(rhythmVerdictLabel(shares), RHYTHM_AROUND_LABEL);
  assert.equal(rhythmVerdictLabel(null), RHYTHM_AROUND_LABEL);
});

test('bestAlbumPerPhase: picks the album with the highest count in each phase', () => {
  const out = bestAlbumPerPhase({
    alb1: { night: 5, morning: 1 },
    alb2: { night: 2, morning: 8 },
  });
  assert.equal(out.night, 'alb1');
  assert.equal(out.morning, 'alb2');
});

test('bestAlbumPerPhase: a phase with no plays for any album comes back null', () => {
  const out = bestAlbumPerPhase({ alb1: { night: 3 } });
  assert.equal(out.dawn, null);
  assert.equal(out.golden, null);
});

test('bestAlbumPerPhase: a tie keeps whichever album id sorts first alphabetically', () => {
  const out = bestAlbumPerPhase({ zzz: { night: 4 }, aaa: { night: 4 } });
  assert.equal(out.night, 'aaa');
});

test('bestAlbumPerPhase: empty/missing input never throws', () => {
  assert.deepEqual(Object.values(bestAlbumPerPhase(undefined)), PHASES.map(() => null));
  assert.deepEqual(Object.values(bestAlbumPerPhase({})), PHASES.map(() => null));
});

test('RHYTHM_MIN_PLAYS/RHYTHM_VERDICT_THRESHOLD match the doc\'s own stated values', () => {
  assert.equal(RHYTHM_MIN_PLAYS, 20);
  assert.equal(RHYTHM_VERDICT_THRESHOLD, 0.30);
});
