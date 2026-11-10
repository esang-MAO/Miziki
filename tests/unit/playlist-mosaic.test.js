// LB3 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 3): the playlist mosaic
// cover's pure selection logic -- which albumKeys land in which cell for
// 0/1/2/3/4+ distinct records, and which CSS layout each count maps to.
// Fixture tracks are plain {tags:{album}} objects; keyFn here is just
// t => t.tags.album, so these tests never touch record-art/tiers.js's
// real albumKey() (which normalizes/strips punctuation) -- that's covered
// implicitly by any call site that passes the real one, not this file's
// job to re-prove.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distinctAlbumKeysInOrder, mosaicCells, mosaicLayout } from '../../src/library/playlist-mosaic.js';

const keyFn = t => t.tags.album;
function track(album){ return { tags: { album } }; }

test('distinctAlbumKeysInOrder: empty playlist', () => {
  assert.deepEqual(distinctAlbumKeysInOrder([], [], keyFn), []);
});

test('distinctAlbumKeysInOrder: one record, several tracks', () => {
  const tracks = [track('A'), track('A'), track('A')];
  assert.deepEqual(distinctAlbumKeysInOrder([0, 1, 2], tracks, keyFn), ['A']);
});

test('distinctAlbumKeysInOrder: first occurrence order, not sorted', () => {
  const tracks = [track('C'), track('A'), track('C'), track('B')];
  assert.deepEqual(distinctAlbumKeysInOrder([0, 1, 2, 3], tracks, keyFn), ['C', 'A', 'B']);
});

test('distinctAlbumKeysInOrder: caps at the first four distinct records', () => {
  const tracks = [track('A'), track('B'), track('C'), track('D'), track('E'), track('F')];
  assert.deepEqual(distinctAlbumKeysInOrder([0, 1, 2, 3, 4, 5], tracks, keyFn), ['A', 'B', 'C', 'D']);
});

test('distinctAlbumKeysInOrder: skips indices with no resolved track (forgotten)', () => {
  const tracks = [track('A'), undefined, track('B')];
  assert.deepEqual(distinctAlbumKeysInOrder([0, 2], tracks, keyFn), ['A', 'B']);
});

test('mosaicCells: 0 is empty', () => {
  assert.deepEqual(mosaicCells([]), []);
});

test('mosaicCells: 1 is a single cell', () => {
  assert.deepEqual(mosaicCells(['A']), ['A']);
});

test('mosaicCells: 2 stays two cells', () => {
  assert.deepEqual(mosaicCells(['A', 'B']), ['A', 'B']);
});

test('mosaicCells: 3 repeats the first into a fourth cell', () => {
  assert.deepEqual(mosaicCells(['A', 'B', 'C']), ['A', 'B', 'C', 'A']);
});

test('mosaicCells: 4 tiles one cover per cell', () => {
  assert.deepEqual(mosaicCells(['A', 'B', 'C', 'D']), ['A', 'B', 'C', 'D']);
});

test('mosaicLayout maps each distinct count to its own shape', () => {
  assert.equal(mosaicLayout(0), 'empty');
  assert.equal(mosaicLayout(1), 'single');
  assert.equal(mosaicLayout(2), 'diagonal');
  assert.equal(mosaicLayout(3), 'grid');
  assert.equal(mosaicLayout(4), 'grid');
  assert.equal(mosaicLayout(10), 'grid');
});
