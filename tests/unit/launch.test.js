import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// src/launch/intro.js reads/writes CSS custom properties on
// document.documentElement at module load (LAUNCH_ANIM's --launch-*
// durations) and window.innerWidth/innerHeight inside updateLaunchScale --
// stubbed here rather than pulling in a real DOM, same "stub only what a
// browser would otherwise provide" approach idb.test.js/shell.test.js use.
globalThis.document = { documentElement: { style: { setProperty(){} } } };
// crate/tiers.js's own crateArtCache (imported here for makeLaunchCard,
// read-only) needs artwork/storage.repo real -- mocked directly since this
// file only wants the pure math/resolution helpers below, not the image
// pipeline, the usual "stop the chain at the door" reasoning.
mock.module(new URL('../../src/crate/tiers.js', import.meta.url).href, {
  namedExports: { crateArtCache: { S: new Map(), L: new Map() } },
});
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave(){} },
});
// library/thumbs.js's thumbURL (imported here for makeLaunchCard, read-only)
// real-chains into library/edit.js -> shell/mini-player.js -> crate/view.js
// for its own renderMiniPlayer/applyCrateMiniInset needs -- mocked directly
// to stop that chain at the door, same reasoning as the crate/tiers.js mock
// above.
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { thumbURL: {} },
});

const {
  resolveLastPlayedAlbum, resolveLastPlayedTrackIndex,
  computeFlickPosition, flickSpeed, sampleStackAlbums,
} = await import('../../src/launch/intro.js');
const { S } = await import('../../src/state.js');

function fakeTrack(id, overrides){
  return Object.assign({
    id, addedAt: 0,
    tags: { title: id, artist: 'Artist', album: 'Album', albumArtist: 'Artist', track: 1, disc: 1 },
  }, overrides);
}

function resetState(overrides){
  Object.assign(S, {
    tracks: [], albumLastPlayed: {}, trackLastPlayed: {},
  }, overrides);
}

test('resolveLastPlayedAlbum: picks the album with the latest S.albumLastPlayed timestamp', () => {
  resetState({
    tracks: [
      fakeTrack('a1', { tags: { title:'A1', artist:'A', album:'Album A', albumArtist:'A', track:1, disc:1 } }),
      fakeTrack('b1', { tags: { title:'B1', artist:'B', album:'Album B', albumArtist:'B', track:1, disc:1 } }),
    ],
    // albumLastPlayed is keyed by albumKey() alone -- normKey() of the album
    // title, not artist+album (see src/record-art/tiers.js's albumKey()).
    albumLastPlayed: { 'album a': 100, 'album b': 200 },
  });
  assert.equal(resolveLastPlayedAlbum(), 'album b');
});

test('resolveLastPlayedAlbum: with no play history, falls back to the most recently added album', () => {
  resetState({
    tracks: [
      fakeTrack('a1', { addedAt: 1, tags: { title:'A1', artist:'A', album:'Album A', albumArtist:'A', track:1, disc:1 } }),
      fakeTrack('b1', { addedAt: 2, tags: { title:'B1', artist:'B', album:'Album B', albumArtist:'B', track:1, disc:1 } }),
    ],
  });
  assert.equal(resolveLastPlayedAlbum(), 'album b');
});

test('resolveLastPlayedAlbum: an empty library resolves to null', () => {
  resetState({});
  assert.equal(resolveLastPlayedAlbum(), null);
});

test('resolveLastPlayedTrackIndex: picks the track with the latest S.trackLastPlayed within that album, falling back to the first', () => {
  resetState({
    tracks: [
      fakeTrack('a1', { tags: { title:'A1', artist:'A', album:'Album A', albumArtist:'A', track:1, disc:1 } }),
      fakeTrack('a2', { tags: { title:'A2', artist:'A', album:'Album A', albumArtist:'A', track:2, disc:1 } }),
    ],
    // trackLastPlayed is keyed by trackIdentityKey(): normKey(artist) +
    // '|' + albumKey() + '|' + normKey(title) (see record-art/tiers.js).
    trackLastPlayed: { 'a|album a|a2': 500 },
  });
  assert.equal(resolveLastPlayedTrackIndex('album a'), 1);
  resetState({
    tracks: [fakeTrack('a1', { tags: { title:'A1', artist:'A', album:'Album A', albumArtist:'A', track:1, disc:1 } })],
  });
  assert.equal(resolveLastPlayedTrackIndex('album a'), 0);
});

test('resolveLastPlayedTrackIndex: an unknown album id resolves to -1', () => {
  resetState({ tracks: [fakeTrack('a1')] });
  assert.equal(resolveLastPlayedTrackIndex('nope'), -1);
});

test('computeFlickPosition: starts at 0, lands exactly on the target at the end of decel', () => {
  const timing = { accelMs: 650, cruiseMs: 800, decelMs: 800 };
  assert.equal(computeFlickPosition(0, 40, timing), 0);
  assert.equal(computeFlickPosition(2250, 40, timing), 40);
});

test('computeFlickPosition: monotonically increasing across the whole scroll', () => {
  const timing = { accelMs: 650, cruiseMs: 800, decelMs: 800 };
  let prev = -Infinity;
  for(let t = 0; t <= 2250; t += 50){
    const pos = computeFlickPosition(t, 40, timing);
    assert.ok(pos >= prev, `expected position at t=${t} (${pos}) >= previous (${prev})`);
    prev = pos;
  }
});

test('flickSpeed: ramps up through accel, holds at 1 through cruise, ramps down through decel to 0', () => {
  const timing = { accelMs: 650, cruiseMs: 800, decelMs: 800 };
  assert.equal(flickSpeed(0, timing), 0);
  assert.equal(flickSpeed(650, timing), 1);
  assert.equal(flickSpeed(1000, timing), 1);
  assert.equal(flickSpeed(1450, timing), 1);
  assert.ok(flickSpeed(1650, timing) < 1 && flickSpeed(1650, timing) > 0);
  assert.equal(flickSpeed(2250, timing), 0);
});

test('sampleStackAlbums: samples down to exactly `cap` entries and always keeps the must-include id', () => {
  const allIds = Array.from({length: 100}, (_, i) => 'album' + i);
  const picked = sampleStackAlbums(allIds, 50, 'album77');
  assert.equal(picked.length, 50);
  assert.ok(picked.includes('album77'));
});
