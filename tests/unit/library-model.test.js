import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byName, trackSort, groupBy, allIdx, albumTracks, idOf, idxOf } from '../../src/library/model.js';
import { S } from '../../src/state.js';

function track(id, overrides){
  return { id, tags: { disc: 1, track: 1, title: '', artist: '', album: '', ...overrides } };
}

test('byName compares case- and accent-insensitively, with natural number order', () => {
  assert.equal(byName('abba', 'ABBA'), 0);
  assert.equal(byName('café', 'cafe'), 0);
  assert.ok(byName('Track 2', 'Track 10') < 0);
  assert.ok(byName('Track 10', 'Track 2') > 0);
});

test('trackSort orders by disc, then track number, then title', () => {
  S.tracks = [
    track('a', { disc: 2, track: 1, title: 'Z' }),
    track('b', { disc: 1, track: 2, title: 'A' }),
    track('c', { disc: 1, track: 1, title: 'B' }),
    track('d', { disc: 1, track: 1, title: 'A' }),
  ];
  const order = [0,1,2,3].sort(trackSort);
  assert.deepEqual(order, [3,2,1,0]); // d (1,1,A) < c (1,1,B) < b (1,2,A) < a (2,1,Z)
});

test('groupBy groups by the given tag key without losing any track', () => {
  S.tracks = [
    track('a', { album: 'Beta' }),
    track('b', { album: 'Alpha' }),
    track('c', { album: 'Alpha' }),
  ];
  const groups = groupBy('album');
  assert.deepEqual(groups.map(([k]) => k), ['Alpha', 'Beta']); // sorted by byName
  const total = groups.reduce((n, [,idx]) => n + idx.length, 0);
  assert.equal(total, S.tracks.length);
  const alpha = groups.find(([k]) => k === 'Alpha')[1];
  assert.deepEqual(alpha.slice().sort(), [1,2]);
});

test('allIdx returns every track index in order', () => {
  S.tracks = [track('a'), track('b'), track('c')];
  assert.deepEqual(allIdx(), [0,1,2]);
});

test('albumTracks: auto mode sorts by trackSort (disc/track/title)', () => {
  S.tracks = [
    track('a', { album: 'X', disc: 1, track: 2, title: 'Second' }),
    track('b', { album: 'X', disc: 1, track: 1, title: 'First' }),
    track('c', { album: 'Y', disc: 1, track: 1, title: 'Other album' }),
  ];
  S.albumSort = {}; S.albumOrder = {};
  assert.deepEqual(albumTracks('X'), [1,0]);
});

test('albumTracks: title mode sorts by title via byName', () => {
  S.tracks = [
    track('a', { album: 'X', title: 'Zeta' }),
    track('b', { album: 'X', title: 'Alpha' }),
  ];
  S.albumSort = { X: 'title' }; S.albumOrder = {};
  assert.deepEqual(albumTracks('X'), [1,0]);
});

test('albumTracks: manual mode keeps saved order and appends newly added tracks', () => {
  S.tracks = [
    track('a', { album: 'X', disc: 1, track: 1, title: 'A' }),
    track('b', { album: 'X', disc: 1, track: 2, title: 'B' }),
  ];
  S.albumSort = { X: 'manual' };
  S.albumOrder = { X: [1,0] }; // saved order: b, a
  assert.deepEqual(albumTracks('X'), [1,0]);
  // a new track for the album appears without a saved position — gets appended
  S.tracks.push(track('c', { album: 'X', disc: 1, track: 3, title: 'C' }));
  assert.deepEqual(albumTracks('X'), [1,0,2]);
});

test('albumTracks: manual mode drops tracks no longer in the album', () => {
  S.tracks = [track('a', { album: 'X' })];
  S.albumSort = { X: 'manual' };
  S.albumOrder = { X: [0, 99] }; // 99 no longer exists in the base set
  assert.deepEqual(albumTracks('X'), [0]);
});

test('idOf returns the track id at an index, or null out of range', () => {
  S.tracks = [track('a'), track('b')];
  assert.equal(idOf(0), 'a');
  assert.equal(idOf(1), 'b');
  assert.equal(idOf(5), null);
});

test('idxOf returns the index for a track id, or -1 if missing', () => {
  S.tracks = [track('a'), track('b')];
  assert.equal(idxOf('b'), 1);
  assert.equal(idxOf('nope'), -1);
});
