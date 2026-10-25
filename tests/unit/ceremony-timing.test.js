// CEREMONY PR 3 (docs/CEREMONY.md §2-§4): the pure timing and side-split
// decisions behind the run-out groove, the side flip and the record change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANGE_TIMELINE, GROOVE, FLIP, changeLandsAt, grooveThumpTimes, splitSides, sideTurn,
  WAIT_TIMEOUT_MS, runoutWaitMs, sideLengthsFor, albumFormatFor,
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
  // the first one found (k=2) wins.
  const s = splitSides([0,1,2,3,4], durTracks([600,600,600,600,600]), true);
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

// docs/15_SURFACE_NOISE.md §4, Auto-flip Off: how long the record waits
// before the needle lifts on its own.
test('runoutWaitMs: short and normal are finite, until-lift waits forever', () => {
  assert.equal(runoutWaitMs('short'), WAIT_TIMEOUT_MS.short);
  assert.equal(runoutWaitMs('normal'), WAIT_TIMEOUT_MS.normal);
  assert.equal(runoutWaitMs('until-lift'), null);
  assert.ok(WAIT_TIMEOUT_MS.short < WAIT_TIMEOUT_MS.normal);
});

test('runoutWaitMs: an unrecognized value falls back to normal, the same default S.runoutLength has', () => {
  assert.equal(runoutWaitMs('bogus'), WAIT_TIMEOUT_MS.normal);
  assert.equal(runoutWaitMs(undefined), WAIT_TIMEOUT_MS.normal);
});
