import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shelfUnitCubes } from '../../src/profile/shelf-unit.js';

function item(id){ return {id, name: id, artist: 'A'}; }

test('shelfUnitCubes: packs plain spines ten to a cube', () => {
  const items = Array.from({length: 23}, (_, i) => item('t' + i));
  const cubes = shelfUnitCubes(items, []);
  assert.deepEqual(cubes.map(c => c.length), [10, 10, 3]);
});

test('shelfUnitCubes: a face-out item counts as 3 spines worth of capacity', () => {
  const items = [item('a'), item('face'), item('b'), item('c')];
  const cubes = shelfUnitCubes(items, ['face']);
  assert.equal(cubes.length, 1);
  assert.equal(cubes[0].find(e => e.item.id === 'face').isFace, true);
});

test('shelfUnitCubes: an empty crate returns no cubes', () => {
  assert.deepEqual(shelfUnitCubes([], []), []);
});

// Wall & Labels follow-up (Ken, 2026-11-08): renderShelfUnit() only keeps
// the first SHELF_UNIT_CUBES cubes -- a pinned face-out item sitting deep
// in a large crate's natural order must not get truncated away, so it's
// floated to the front instead of staying wherever the crate order put it.
test('shelfUnitCubes: a face-out item floats to the front, even deep in a large crate', () => {
  const items = [...Array.from({length: 70}, (_, i) => item('t' + i)), item('pinned')];
  const cubes = shelfUnitCubes(items, ['pinned']);
  assert.equal(cubes[0].some(e => e.item.id === 'pinned'), true);
});

test('shelfUnitCubes: several face-out items float in rank order, plain spines keep their relative order after them', () => {
  const items = [item('a'), item('rank4'), item('b'), item('rank5'), item('c')];
  const cubes = shelfUnitCubes(items, ['rank4', 'rank5']);
  assert.deepEqual(cubes[0].map(e => e.item.id), ['rank4', 'rank5', 'a', 'b', 'c']);
});
