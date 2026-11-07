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
