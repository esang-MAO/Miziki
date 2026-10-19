import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASES, RHYTHM_MIN_PLAYS, RHYTHM_VERDICT_THRESHOLD, RHYTHM_AROUND_LABEL,
  RHYTHM_WINDOW_DAYS, RHYTHM_PRUNE_KEEP_DAYS,
  computeRhythmShares, rhythmVerdictLabel, bestAlbumPerPhase,
  dayKeyFor, windowedPhaseCounts, pruneDayBuckets,
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
  assert.equal(rhythmVerdictLabel(shares), 'Lately, mostly after dark');
});

// RF22 (docs/12_REFINE.md, "words that invite", point 3): reworded from
// "NIGHT LISTENER"-style labels to a sentence said about a season just
// passed — docs/12_REFINE.md's own "Lately, mostly after dark" example.
test('rhythmVerdictLabel: the three phases docs/DAY_ARC.md names verbatim, reworded by RF22', () => {
  assert.equal(rhythmVerdictLabel(computeRhythmShares({ morning: 10 }).shares), 'Lately, mostly a morning listener');
  assert.equal(rhythmVerdictLabel(computeRhythmShares({ golden: 10 }).shares), 'Lately, leaning golden hour');
  assert.equal(rhythmVerdictLabel(computeRhythmShares({ night: 10 }).shares), 'Lately, mostly after dark');
});

test('rhythmVerdictLabel: every other phase gets its own consistent "Lately, mostly <phase>" label', () => {
  assert.equal(rhythmVerdictLabel(computeRhythmShares({ dawn: 10 }).shares), 'Lately, often up with first light');
  assert.equal(rhythmVerdictLabel(computeRhythmShares({ midday: 10 }).shares), 'Lately, mostly midday');
  assert.equal(rhythmVerdictLabel(computeRhythmShares({ afternoon: 10 }).shares), 'Lately, mostly afternoon');
  assert.equal(rhythmVerdictLabel(computeRhythmShares({ twilight: 10 }).shares), 'Lately, mostly at twilight');
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
  assert.equal(rhythmVerdictLabel(shares), 'Lately, mostly after dark');
  // now make golden alone the largest, exactly at the threshold
  const golden = {}; PHASES.forEach(p => { golden[p] = 0; });
  golden.golden = RHYTHM_VERDICT_THRESHOLD;
  assert.equal(rhythmVerdictLabel(golden), 'Lately, leaning golden hour');
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

// ================= RF22 (docs/12_REFINE.md, "words that invite", point 3) =================
// "listening rhythm as a season" — dayKeyFor/windowedPhaseCounts/pruneDayBuckets,
// the windowing primitives src/history/played.js writes through and
// src/profile/rhythm-card.js, src/share/crate-card.js and
// src/sync/backup.js all now read through before ever calling
// computeRhythmShares()/rhythmVerdictLabel().

test('dayKeyFor: a local-calendar YYYY-MM-DD string, from either a Date or epoch ms', () => {
  const d = new Date(2026, 2, 5, 23, 59); // local March 5, 2026, just before midnight
  assert.equal(dayKeyFor(d), '2026-03-05');
  assert.equal(dayKeyFor(d.getTime()), '2026-03-05');
  // zero-padded month/day
  assert.equal(dayKeyFor(new Date(2026, 0, 1)), '2026-01-01');
});

test('windowedPhaseCounts: sums only the buckets within the window, ignoring older ones', () => {
  const now = new Date(2026, 5, 15).getTime(); // June 15, 2026
  const byDay = {
    [dayKeyFor(new Date(2026, 5, 15))]: { night: 3 },       // today -- in
    [dayKeyFor(new Date(2026, 5, 1))]: { night: 2, dawn: 1 }, // 14 days ago -- in
    [dayKeyFor(new Date(2026, 2, 1))]: { night: 100 },      // ~106 days ago -- out
  };
  const out = windowedPhaseCounts(byDay, now, RHYTHM_WINDOW_DAYS);
  assert.deepEqual(out, { night: 5, dawn: 1 });
});

test('windowedPhaseCounts: empty/missing input never throws, reads as every phase absent', () => {
  assert.deepEqual(windowedPhaseCounts(undefined, Date.now(), RHYTHM_WINDOW_DAYS), {});
  assert.deepEqual(windowedPhaseCounts({}, Date.now(), RHYTHM_WINDOW_DAYS), {});
  assert.equal(computeRhythmShares(windowedPhaseCounts(null, Date.now(), RHYTHM_WINDOW_DAYS)).total, 0);
});

test('windowedPhaseCounts: feeds straight into computeRhythmShares/rhythmVerdictLabel like any other counts map', () => {
  const now = Date.now();
  const byDay = { [dayKeyFor(now)]: { golden: 10 } };
  const { shares } = computeRhythmShares(windowedPhaseCounts(byDay, now, RHYTHM_WINDOW_DAYS));
  assert.equal(rhythmVerdictLabel(shares), 'Lately, leaning golden hour');
});

test('pruneDayBuckets: drops buckets older than keepDays, keeps the rest, never mutates the input', () => {
  const now = new Date(2026, 5, 15).getTime();
  const oldKey = dayKeyFor(new Date(2026, 0, 1));   // well past 120 days
  const recentKey = dayKeyFor(new Date(2026, 5, 1)); // 14 days ago
  const byDay = { [oldKey]: { night: 1 }, [recentKey]: { night: 2 } };
  const frozen = JSON.parse(JSON.stringify(byDay));
  const out = pruneDayBuckets(byDay, now, RHYTHM_PRUNE_KEEP_DAYS);
  assert.deepEqual(out, { [recentKey]: { night: 2 } });
  assert.deepEqual(byDay, frozen, 'the input object is never mutated');
});

test('pruneDayBuckets: empty/missing input never throws', () => {
  assert.deepEqual(pruneDayBuckets(undefined, Date.now(), RHYTHM_PRUNE_KEEP_DAYS), {});
  assert.deepEqual(pruneDayBuckets({}, Date.now(), RHYTHM_PRUNE_KEEP_DAYS), {});
});

test('RHYTHM_WINDOW_DAYS/RHYTHM_PRUNE_KEEP_DAYS: the prune window is comfortably wider than the read window', () => {
  assert.equal(RHYTHM_WINDOW_DAYS, 90);
  assert.ok(RHYTHM_PRUNE_KEEP_DAYS > RHYTHM_WINDOW_DAYS);
});
