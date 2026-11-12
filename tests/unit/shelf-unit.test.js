import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shelfUnitCubes, shelfUnitRows, dedupeCrateItems } from '../../src/profile/shelf-unit.js';

function item(id){ return {id, name: id, artist: 'A'}; }

// CO5 (docs/37_COLOUR.md, recommendation 6): "seven spines a cube" -- was
// 10, dropped once a spine also carries a printed label needing real
// width.
test('shelfUnitCubes: packs plain spines seven to a cube', () => {
  const items = Array.from({length: 23}, (_, i) => item('t' + i));
  const cubes = shelfUnitCubes(items, []);
  assert.deepEqual(cubes.map(c => c.length), [7, 7, 7, 2]);
});

// Wall & Labels follow-up (Ken, 2026-11-08): "each record being put in its
// own square" -- a face-out item gets a whole cube to itself, never
// shared with spines, so it fills the cell instead of sitting squeezed
// alongside other covers.
test('shelfUnitCubes: a face-out item gets a whole cube to itself, breaking the spine run around it', () => {
  const items = [item('a'), item('face'), item('b'), item('c')];
  const cubes = shelfUnitCubes(items, ['face']);
  assert.deepEqual(cubes.map(c => c.map(e => e.item.id)), [['face'], ['a', 'b', 'c']]);
  assert.equal(cubes[0][0].isFace, true);
});

test('shelfUnitCubes: two face-out items each get their own cube, never share one', () => {
  const items = [item('face1'), item('face2'), item('a')];
  const cubes = shelfUnitCubes(items, ['face1', 'face2']);
  assert.deepEqual(cubes.map(c => c.map(e => e.item.id)), [['face1'], ['face2'], ['a']]);
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

test('shelfUnitCubes: several face-out items float to the front cubes in rank order, plain spines keep their relative order after', () => {
  const items = [item('a'), item('rank4'), item('b'), item('rank5'), item('c')];
  const cubes = shelfUnitCubes(items, ['rank4', 'rank5']);
  assert.deepEqual(cubes.map(c => c.map(e => e.item.id)), [['rank4'], ['rank5'], ['a', 'b', 'c']]);
});

// UN15 point 3 ("rows that grow"): rows = clamp(ceil(cubesNeeded/2), 1, 3).
test('shelfUnitRows: one or two cubes need one row', () => {
  assert.equal(shelfUnitRows(0), 1);
  assert.equal(shelfUnitRows(1), 1);
  assert.equal(shelfUnitRows(2), 1);
});

test('shelfUnitRows: three or four cubes need two rows', () => {
  assert.equal(shelfUnitRows(3), 2);
  assert.equal(shelfUnitRows(4), 2);
});

test('shelfUnitRows: five or six cubes need three rows, and it never grows past three', () => {
  assert.equal(shelfUnitRows(5), 3);
  assert.equal(shelfUnitRows(6), 3);
  assert.equal(shelfUnitRows(7), 3);
});

// UN15 point 1 (bug): crateFlatAlbumOrder() walks the crate's sections in a
// row, so an album in more than one section arrived once per section.
test('dedupeCrateItems: an album in three sections yields one item', () => {
  const crateItems = [
    {albumId: 'alpha', idx: [0], album: 'Alpha', artist: 'A'},
    {albumId: 'alpha', idx: [0], album: 'Alpha', artist: 'A'},
    {albumId: 'alpha', idx: [0], album: 'Alpha', artist: 'A'},
  ];
  const out = dedupeCrateItems(crateItems);
  assert.equal(out.length, 1);
  assert.equal(out[0].albumId, 'alpha');
});

test('dedupeCrateItems: keeps the first appearance, drops later repeats', () => {
  const crateItems = [
    {albumId: 'alpha', idx: [0], album: 'Alpha', artist: 'A'},
    {albumId: 'beta', idx: [1], album: 'Beta', artist: 'B'},
    {albumId: 'alpha', idx: [2], album: 'Alpha', artist: 'A'},
  ];
  const out = dedupeCrateItems(crateItems);
  assert.deepEqual(out.map(it => it.albumId), ['alpha', 'beta']);
  assert.deepEqual(out[0].idx, [0]);
});

test('dedupeCrateItems: distinct albums each keep their own item', () => {
  const crateItems = [
    {albumId: 'alpha', idx: [0], album: 'Alpha', artist: 'A'},
    {albumId: 'beta', idx: [0], album: 'Beta', artist: 'B'},
  ];
  assert.deepEqual(dedupeCrateItems(crateItems).map(it => it.albumId), ['alpha', 'beta']);
});
