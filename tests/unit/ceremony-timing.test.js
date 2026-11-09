// CEREMONY PR 3 (docs/CEREMONY.md §2-§4): the pure timing and side-split
// decisions behind the run-out groove, the side flip and the record change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANGE_TIMELINE, GROOVE, FLIP, changeLandsAt, grooveThumpTimes, splitSides, sideTurn,
  sideLengthsFor, albumFormatFor, discGroupsFor, sideBoundaryAt, isLastSideEnd,
} from '../../src/shell/ceremony-timing.js';

test('the change timeline: new sleeve arrives at 1200 ms over 700 ms, landing at 1900 ms', () => {
  assert.equal(CHANGE_TIMELINE.arriveStart, 1200);
  assert.equal(CHANGE_TIMELINE.arriveMs, 700);
  assert.equal(changeLandsAt(), 1900);
});

test('the change phases run in order, and the outgoing sleeve overlaps the arrival', () => {
  const t = CHANGE_TIMELINE;
  assert.ok(t.spinDown[0] === 0 && t.spinDown[1] <= t.slideIn[0]);
  assert.ok(t.lift[0] < t.lift[1] && t.lift[1] <= t.slideIn[0]);
  assert.ok(t.slideIn[1] <= t.sleeveExit[0]);
  assert.ok(t.arriveStart > t.sleeveExit[0] && t.arriveStart < t.sleeveExit[1]);
});

test('changeLandsAt follows a custom timeline', () => {
  assert.equal(changeLandsAt({arriveStart: 100, arriveMs: 50}), 150);
});

test('groove and flip constants match the spec', () => {
  assert.equal(GROOVE.ms, 2500);
  assert.equal(GROOVE.fadeInMs, 150);
  assert.ok(Math.abs(GROOVE.thumpEverySec - 60 / (100 / 3)) < 0.01);
  assert.equal(FLIP.liftMs + FLIP.turnMs, 700);
  assert.ok(FLIP.grooveMs < GROOVE.ms);
});

test('grooveThumpTimes: one per revolution, starting half a revolution in', () => {
  assert.deepEqual(grooveThumpTimes(2.9, 1.8), [0.9, 2.7]);
  assert.deepEqual(grooveThumpTimes(0.5, 1.8), []);
  assert.deepEqual(grooveThumpTimes(0, 1.8), []);
  assert.deepEqual(grooveThumpTimes(2, 0), []);
  for(const t of grooveThumpTimes(10)) assert.ok(t < 10);
});

const tracks = n => Array.from({length:n}, () => ({tags:{}}));
const durTracks = durs => durs.map(d => ({tags:{}, duration:d}));

// AU9 (docs/16_AUDIO.md §5): "one track: a single side, no flip. Two
// tracks: A and B. Three or more: balanced by time."
test('splitSides: off, or a single track, means no sides', () => {
  assert.equal(splitSides([0,1,2,3], tracks(4), false), null);
  assert.equal(splitSides([0], tracks(1), true), null);
  assert.equal(splitSides(null, tracks(0), true), null);
});

test('splitSides: two tracks are always A and B, regardless of length', () => {
  const s = splitSides([0,1], durTracks([600, 60]), true);
  assert.deepEqual(s.map(x => x.label), ['SIDE A', 'SIDE B']);
  assert.deepEqual(s[0].idx, [0]);
  assert.deepEqual(s[1].idx, [1]);
});

test('splitSides: three or more tracks balance by time, keeping order', () => {
  // k=1: |100-400|=300; k=2: |200-300|=100 -- best cut at k=2
  const s = splitSides([0,1,2], durTracks([100, 100, 300]), true);
  assert.deepEqual(s[0].idx, [0,1]);
  assert.deepEqual(s[1].idx, [2]);
});

test('splitSides: a very uneven track still finds the closest balance', () => {
  // k=1:|10-520|=510; k=2:|510-20|=490; k=3:|520-10|=510 -- best at k=2
  const s = splitSides([0,1,2,3], durTracks([10, 500, 10, 10]), true);
  assert.deepEqual(s[0].idx, [0,1]);
  assert.deepEqual(s[1].idx, [2,3]);
});

test('splitSides: an exact tie keeps the earlier cut, deterministically', () => {
  // five equal-length tracks: k=2 and k=3 both give a diff of 1 unit --
  // the first one found (k=2) wins. 60s each (not 600s): a two-side split
  // of this album stays well under CC5's 22-min double-LP cap, so this
  // keeps testing the tie-break itself rather than tripping into a
  // computed double LP -- that's its own test below.
  const s = splitSides([0,1,2,3,4], durTracks([60,60,60,60,60]), true);
  assert.deepEqual(s[0].idx, [0,1]);
  assert.deepEqual(s[1].idx, [2,3,4]);
});

// Followup (Ken, "double albums as four sides (A-D) instead of one side
// per disc"): each disc now gets the same time-balanced split a single
// disc already gets, flattened into one continuous A/B/C/... sequence --
// a double album with at least two tracks per disc reads as four sides.
test('splitSides: a double album (2 discs, 2 tracks each) reads as four sides, A-D', () => {
  const t = [1,1,2,2].map(d => ({tags:{disc:d}}));
  const s = splitSides([0,1,2,3], t, true);
  assert.deepEqual(s.map(x => x.label), ['SIDE A', 'SIDE B', 'SIDE C', 'SIDE D']);
  assert.deepEqual(s[0].idx, [0]);
  assert.deepEqual(s[1].idx, [1]);
  assert.deepEqual(s[2].idx, [2]);
  assert.deepEqual(s[3].idx, [3]);
});

test('splitSides: a disc with fewer than two tracks of its own stays one side, not split', () => {
  // disc 1 has three tracks (balances by time), disc 2 has just one --
  // can't be split, so it's its own whole side rather than producing a
  // spurious extra empty group.
  const t = [...[100,100,300].map(d => ({tags:{disc:1}, duration:d})),
    {tags:{disc:2}, duration: 200}];
  const s = splitSides([0,1,2,3], t, true);
  assert.deepEqual(s.map(x => x.label), ['SIDE A', 'SIDE B', 'SIDE C']);
  assert.deepEqual(s[0].idx, [0,1]);
  assert.deepEqual(s[1].idx, [2]);
  assert.deepEqual(s[2].idx, [3]);
});

// GF4 (docs/29_GATEFOLD.md point 1/2): one group per disc, each holding
// every track index on that disc together (not split into sides) -- the
// gatefold's own sleeve-pocket count and "Disc N" tracklist eyebrow both
// read off this, independent of splitSides()'s own A/B/C/D side split.
test('discGroupsFor: a single-disc album is one group holding every track', () => {
  const t = [1,1,1].map(d => ({tags:{disc:d}}));
  assert.deepEqual(discGroupsFor([0,1,2], t), [{disc:1, idx:[0,1,2]}]);
});

test('discGroupsFor: a double album is two groups, one per disc', () => {
  const t = [1,1,2,2].map(d => ({tags:{disc:d}}));
  assert.deepEqual(discGroupsFor([0,1,2,3], t), [{disc:1, idx:[0,1]}, {disc:2, idx:[2,3]}]);
});

test('discGroupsFor: a disc with a single track still gets its own group', () => {
  const t = [...[1,1].map(d => ({tags:{disc:d}})), {tags:{disc:2}}];
  assert.deepEqual(discGroupsFor([0,1,2], t), [{disc:1, idx:[0,1]}, {disc:2, idx:[2]}]);
});

test('discGroupsFor: no track indices returns no groups', () => {
  assert.deepEqual(discGroupsFor(null, []), []);
  assert.deepEqual(discGroupsFor([], []), []);
});

// CC5 (docs/34_CARE_AND_CONTROL.md): "a single-disc album whose two-side
// split puts either side over 22 min becomes a double LP" -- 4 sides,
// two virtual discs, computed the same way for everyone from the track
// lengths alone, same as every other format decision in this file.
test('splitSides: a 70-minute single disc becomes a computed double LP, four sides', () => {
  // eight equal 525s (8:45) tracks, 4200s (70 min) total. The plain
  // 2-way split (four tracks a side) would put each side at 2100s
  // (35 min), over the 22-min cap -- so this becomes 4 sides instead,
  // two tracks each (1050s/17:30, comfortably under the cap).
  const t = durTracks(new Array(8).fill(525));
  const s = splitSides([0,1,2,3,4,5,6,7], t, true);
  assert.deepEqual(s.map(x => x.label), ['SIDE A', 'SIDE B', 'SIDE C', 'SIDE D']);
  assert.deepEqual(s.map(x => x.idx), [[0,1],[2,3],[4,5],[6,7]]);
});

test('splitSides: a 40-minute single disc stays at two sides, no double LP', () => {
  // four equal 600s (10 min) tracks, 2400s (40 min) total -- the plain
  // 2-way split puts each side at 1200s (20 min), under the cap, so this
  // stays the ordinary two sides.
  const s = splitSides([0,1,2,3], durTracks([600,600,600,600]), true);
  assert.deepEqual(s.map(x => x.label), ['SIDE A', 'SIDE B']);
  assert.deepEqual(s.map(x => x.idx), [[0,1],[2,3]]);
});

// Box-set follow-up to CC5 (Ken, 2026-11-09): a single track that's over
// the cap all by itself can't be fixed by splitting further -- any side
// holding it stays over cap at every tier, so the escalation climbs all
// the way to the 8-side hard cap (4 discs) rather than stopping at 4.
// Track order and the total duration must still be preserved exactly.
test('splitSides: a single dominating track can\'t be split small enough -- escalates to the 8-side hard cap', () => {
  const durs = [100,300,3000,300,100,100,300,100];
  const s = splitSides([0,1,2,3,4,5,6,7], durTracks(durs), true);
  assert.equal(s.length, 8);
  assert.deepEqual(s.map(x => x.label), ['SIDE A','SIDE B','SIDE C','SIDE D','SIDE E','SIDE F','SIDE G','SIDE H']);
  assert.deepEqual(s.flatMap(x => x.idx), [0,1,2,3,4,5,6,7]);
  assert.equal(s.reduce((sum, side) => sum + side.idx.reduce((a, i) => a + durs[i], 0), 0), durs.reduce((a, d) => a + d, 0));
});

test('discGroupsFor: a computed double LP (4 sides) reports two virtual discs, 1 and 2', () => {
  const t = durTracks(new Array(8).fill(525));
  assert.deepEqual(discGroupsFor([0,1,2,3,4,5,6,7], t), [
    { disc: 1, idx: [0,1,2,3] },
    { disc: 2, idx: [4,5,6,7] },
  ]);
});

// Box-set follow-up to CC5 (Ken, 2026-11-09, "cap the number of discs to
// 4"): once a double LP (4 sides) still has a side over the 22-min cap,
// escalation tries 6 sides next, stopping there once every side gets
// under cap -- three discs, not four.
test('splitSides: a long album escalates to 6 sides (three discs) when 4 sides is still over cap but 6 gets under it', () => {
  // 24 equal 300s tracks, 7200s (120 min) total: the 4-way split
  // (6 tracks/side, 1800s) is still over the 22-min (1320s) cap, but the
  // 6-way split (4 tracks/side, 1200s) gets under it, so escalation
  // stops there.
  const t = durTracks(new Array(24).fill(300));
  const idx = t.map((_, i) => i);
  const s = splitSides(idx, t, true);
  assert.equal(s.length, 6);
  assert.deepEqual(s.map(x => x.idx.length), [4,4,4,4,4,4]);
  assert.deepEqual(s.flatMap(x => x.idx), idx);
});

test('discGroupsFor: a 6-side computed split reports three virtual discs', () => {
  const t = durTracks(new Array(24).fill(300));
  const idx = t.map((_, i) => i);
  const groups = discGroupsFor(idx, t);
  assert.deepEqual(groups.map(g => g.disc), [1,2,3]);
  assert.deepEqual(groups.map(g => g.idx.length), [8,8,8]);
  assert.deepEqual(groups.flatMap(g => g.idx), idx);
});

// Box-set follow-up to CC5 (Ken, 2026-11-09): the hard cap -- 8 sides,
// four discs -- is the last tier tried, whether or not it actually gets
// every side under cap (see the single-dominating-track test above for
// the "still over cap" case; this one gets under cap exactly at the
// ceiling).
test('splitSides: a very long album escalates all the way to the 8-side hard cap (four discs) when 6 sides is still over cap', () => {
  // 48 equal 200s tracks, 9600s (160 min) total: 2-way (4800s/side),
  // 4-way (2400s/side) and 6-way (1600s/side) are all still over the
  // 22-min cap; only the hard-capped 8-way split (1200s/side) gets
  // under it.
  const t = durTracks(new Array(48).fill(200));
  const idx = t.map((_, i) => i);
  const s = splitSides(idx, t, true);
  assert.equal(s.length, 8);
  assert.deepEqual(s.map(x => x.idx.length), [6,6,6,6,6,6,6,6]);
  assert.deepEqual(s.flatMap(x => x.idx), idx);
});

test('discGroupsFor: an 8-side computed split reports four virtual discs, never more', () => {
  const t = durTracks(new Array(48).fill(200));
  const idx = t.map((_, i) => i);
  const groups = discGroupsFor(idx, t);
  assert.deepEqual(groups.map(g => g.disc), [1,2,3,4]);
  assert.deepEqual(groups.map(g => g.idx.length), [12,12,12,12]);
  assert.deepEqual(groups.flatMap(g => g.idx), idx);
});

test('discGroupsFor: an under-cap single disc stays one group, not a double LP', () => {
  assert.deepEqual(discGroupsFor([0,1,2,3], durTracks([600,600,600,600])), [{ disc: 0, idx: [0,1,2,3] }]);
});

test('sideLengthsFor: a computed double LP gives four time-balanced lengths', () => {
  const t = durTracks(new Array(8).fill(525));
  assert.deepEqual(sideLengthsFor([0,1,2,3,4,5,6,7], t), [1050, 1050, 1050, 1050]);
});

test('sideTurn: only the last track of a side onto the first of the next', () => {
  const s = splitSides([0,1,2,3], durTracks([600,600,600,600]), true);
  assert.deepEqual(sideTurn(s, 1, 2), {from:'A', to:'B'});
  assert.equal(sideTurn(s, 0, 1), null);
  assert.equal(sideTurn(s, 1, 3), null);
  assert.equal(sideTurn(s, 3, 0), null);
  assert.equal(sideTurn(null, 1, 2), null);
});

// Followup: a three-disc album with two equal (here: unmeasured, so tied)
// tracks per disc now reads as six sides (A-F), not three -- the turn
// from the last track of disc 2's own second side (D) onto the first
// track of disc 3's own first side (E) is a real side-flip.
test('sideTurn: D to E on a three-disc album, each disc split into two sides', () => {
  const t = [1,1,2,2,3,3].map(d => ({tags:{disc:d}}));
  const s = splitSides([0,1,2,3,4,5], t, true);
  assert.deepEqual(s.map(x => x.label), ['SIDE A','SIDE B','SIDE C','SIDE D','SIDE E','SIDE F']);
  assert.deepEqual(sideTurn(s, 3, 4), {from:'D', to:'E'});
});

// AU9 (docs/16_AUDIO.md §5): the format table applies "whether or not the
// Sides setting is on" -- sideLengthsFor()/albumFormatFor() never take an
// enabled flag at all.
test('sideLengthsFor: a single track is one side, no split', () => {
  assert.deepEqual(sideLengthsFor([0], durTracks([200])), [200]);
});

test('sideLengthsFor: a double album gives four side lengths, two time-balanced per disc', () => {
  // disc 1: [100,200] -> only cut is k=1, lengths [100,200]
  // disc 2: a single track (duration 50) can't be split -- one length
  const t = [1,1,2].map((d, i) => ({tags:{disc:d}, duration: [100,200,50][i]}));
  assert.deepEqual(sideLengthsFor([0,1,2], t), [100, 200, 50]);
});

test('sideLengthsFor: a single disc balances by time', () => {
  assert.deepEqual(sideLengthsFor([0,1,2], durTracks([100,100,300])), [200, 300]);
});

test('albumFormatFor: a 7-minute single side reads as a 7" at 45', () => {
  assert.deepEqual(albumFormatFor([0], durTracks([400]), 'auto'), { size: '7"', speed: 45 });
});

test('albumFormatFor: a long LP side reads as a 12" at 33⅓, override skips that', () => {
  const trackIdx = [0], t = durTracks([20 * 60]);
  assert.deepEqual(albumFormatFor(trackIdx, t, 'auto').speed, 33.333);
  assert.deepEqual(albumFormatFor(trackIdx, t, '45'), { size: '12"', speed: 45 });
  assert.deepEqual(albumFormatFor(trackIdx, t, '33'), { size: '12"', speed: 33.333 });
});

// GS5 (docs/30_GROOVES_AND_SHELF.md): isLastSideEnd() -- is curIdx the
// very last track of the album's own last side.
test('isLastSideEnd: null splits is never a last-side end', () => {
  assert.equal(isLastSideEnd(null, 5), false);
  assert.equal(isLastSideEnd([], 5), false);
});

test('isLastSideEnd: true only at the last track of the final side', () => {
  const splits = [{label:'SIDE A', idx:[0,1,2]}, {label:'SIDE B', idx:[3,4]}];
  assert.equal(isLastSideEnd(splits, 4), true);   // last track, side B
  assert.equal(isLastSideEnd(splits, 3), false);  // side B's first track
  assert.equal(isLastSideEnd(splits, 2), false);  // side A's own last track
});

test('isLastSideEnd: a one-side release is its own last side', () => {
  const splits = [{label:'SIDE A', idx:[0,1,2]}];
  assert.equal(isLastSideEnd(splits, 2), true);
  assert.equal(isLastSideEnd(splits, 0), false);
});

// GS2 (docs/30_GROOVES_AND_SHELF.md): sideBoundaryAt() finds which side (if
// any) just finished, given the count of tracks completed so far.
test('sideBoundaryAt: no sides (null) means never a boundary', () => {
  assert.equal(sideBoundaryAt(null, 1), null);
  assert.equal(sideBoundaryAt(null, 0), null);
});

test('sideBoundaryAt: a two-track album boundaries at 1 (A) and 2 (B)', () => {
  const s = splitSides([0,1], durTracks([600, 60]), true);
  assert.equal(sideBoundaryAt(s, 1), 'A');
  assert.equal(sideBoundaryAt(s, 2), 'B');
});

test('sideBoundaryAt: a count strictly inside a side is not a boundary', () => {
  const s = splitSides([0,1,2,3], durTracks([600,600,600,600]), true);
  assert.equal(sideBoundaryAt(s, 1), null);
  assert.equal(sideBoundaryAt(s, 2), 'A');
  assert.equal(sideBoundaryAt(s, 3), null);
  assert.equal(sideBoundaryAt(s, 4), 'B');
});

test('sideBoundaryAt: a count past the album\'s own last track is not a boundary', () => {
  const s = splitSides([0,1], durTracks([600, 60]), true);
  assert.equal(sideBoundaryAt(s, 3), null);
});
