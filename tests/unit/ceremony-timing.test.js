// CEREMONY PR 3 (docs/CEREMONY.md §2-§4): the pure timing and side-split
// decisions behind the run-out groove, the side flip and the record change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANGE_TIMELINE, GROOVE, FLIP, changeLandsAt, grooveThumpTimes, splitSides, sideTurn,
  WAIT_TIMEOUT_MS, runoutWaitMs,
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

test('splitSides: off, or fewer than 4 tracks, means no sides', () => {
  assert.equal(splitSides([0,1,2,3], tracks(4), false), null);
  assert.equal(splitSides([0,1,2], tracks(3), true), null);
  assert.equal(splitSides(null, tracks(0), true), null);
});

test('splitSides: one disc splits at the midpoint, the extra track on side A', () => {
  const s = splitSides([0,1,2,3,4], tracks(5), true);
  assert.deepEqual(s.map(x => x.label), ['SIDE A', 'SIDE B']);
  assert.deepEqual(s[0].idx, [0,1,2]);
  assert.deepEqual(s[1].idx, [3,4]);
});

test('splitSides: several discs give one side per disc', () => {
  const t = [1,1,2,2,3].map(d => ({tags:{disc:d}}));
  const s = splitSides([0,1,2,3,4], t, true);
  assert.deepEqual(s.map(x => x.label), ['SIDE A', 'SIDE B', 'SIDE C']);
  assert.deepEqual(s[2].idx, [4]);
});

test('sideTurn: only the last track of a side onto the first of the next', () => {
  const s = splitSides([0,1,2,3], tracks(4), true);
  assert.deepEqual(sideTurn(s, 1, 2), {from:'A', to:'B'});
  assert.equal(sideTurn(s, 0, 1), null);
  assert.equal(sideTurn(s, 1, 3), null);
  assert.equal(sideTurn(s, 3, 0), null);
  assert.equal(sideTurn(null, 1, 2), null);
});

test('sideTurn: B to C on a three-disc album', () => {
  const t = [1,1,2,2,3,3].map(d => ({tags:{disc:d}}));
  const s = splitSides([0,1,2,3,4,5], t, true);
  assert.deepEqual(sideTurn(s, 3, 4), {from:'B', to:'C'});
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
