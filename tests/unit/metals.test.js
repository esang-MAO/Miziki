import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// resolveLook (record-art/looks.js) has a real circular import with
// history/sessions.js (persistAlbumLookPref) and a real import of
// library/thumbs.js's restoreThumbs — loading thumbs.js for real would
// reach library/edit.js and, through that, library/sealed.js/credits.js,
// each circularly importing main.js (rule 8 in CLAUDE.md). Mocking just
// thumbs.js's one export stops that chain at the door, the same approach
// tags.test.js/credits.test.js/search.test.js use.
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { restoreThumbs: async () => {}, persistable: rec => rec, thumbURL: {}, pruneThumbs: async () => {} },
});

const {
  albumMetalFor, trackMetalFor, ALBUM_METAL_THRESHOLDS, TRACK_METAL_THRESHOLDS,
} = await import('../../src/record-art/metals.js');
const { resolveLook } = await import('../../src/record-art/looks.js');
const { albumKey } = await import('../../src/record-art/tiers.js');
const { S } = await import('../../src/state.js');

function resetState(overrides){
  Object.assign(S, {
    metalEligibleSessions: {}, trackMetalEligiblePlays: {}, rareUnlocked: {}, albumLookPref: {},
  }, overrides);
}

const albumBronze = ALBUM_METAL_THRESHOLDS.find(l => l.name === 'bronze').sessions;
const albumSilver = ALBUM_METAL_THRESHOLDS.find(l => l.name === 'silver').sessions;
const albumGold = ALBUM_METAL_THRESHOLDS.find(l => l.name === 'gold').sessions;
const albumPlatinum = ALBUM_METAL_THRESHOLDS.find(l => l.name === 'platinum').sessions;
const trackGold = TRACK_METAL_THRESHOLDS.find(l => l.name === 'gold').plays;
const trackPlatinum = TRACK_METAL_THRESHOLDS.find(l => l.name === 'platinum').plays;

test('albumMetalFor: below the bronze threshold is no metal at all', () => {
  resetState({ metalEligibleSessions: { a1: albumBronze - 1 } });
  assert.equal(albumMetalFor('a1'), null);
});

test('albumMetalFor: exactly at each threshold earns that tier', () => {
  resetState({ metalEligibleSessions: { a1: albumBronze } });
  assert.equal(albumMetalFor('a1'), 'bronze');
  resetState({ metalEligibleSessions: { a1: albumSilver } });
  assert.equal(albumMetalFor('a1'), 'silver');
  resetState({ metalEligibleSessions: { a1: albumGold } });
  assert.equal(albumMetalFor('a1'), 'gold');
  resetState({ metalEligibleSessions: { a1: albumPlatinum } });
  assert.equal(albumMetalFor('a1'), 'platinum');
});

test('albumMetalFor: just below silver/gold/platinum stays at the rung below', () => {
  resetState({ metalEligibleSessions: { a1: albumSilver - 1 } });
  assert.equal(albumMetalFor('a1'), 'bronze');
  resetState({ metalEligibleSessions: { a1: albumGold - 1 } });
  assert.equal(albumMetalFor('a1'), 'silver');
  resetState({ metalEligibleSessions: { a1: albumPlatinum - 1 } });
  assert.equal(albumMetalFor('a1'), 'gold');
});

test('albumMetalFor: an album with no counter at all is no metal', () => {
  resetState();
  assert.equal(albumMetalFor('unknown-album'), null);
});

test('trackMetalFor: below the gold threshold is no metal at all', () => {
  resetState({ trackMetalEligiblePlays: { t1: trackGold - 1 } });
  assert.equal(trackMetalFor('t1'), null);
});

test('trackMetalFor: exactly at gold and platinum earns that tier', () => {
  resetState({ trackMetalEligiblePlays: { t1: trackGold } });
  assert.equal(trackMetalFor('t1'), 'gold');
  resetState({ trackMetalEligiblePlays: { t1: trackPlatinum } });
  assert.equal(trackMetalFor('t1'), 'platinum');
});

test('trackMetalFor: just below platinum stays at gold', () => {
  resetState({ trackMetalEligiblePlays: { t1: trackPlatinum - 1 } });
  assert.equal(trackMetalFor('t1'), 'gold');
});

function fakeTrack(overrides){
  return Object.assign({
    tags: { album: 'Al', artist: 'Ar', albumArtist: 'Ar', title: 'T' },
    meta: { lossless: false }, art: 'blob:fake',
  }, overrides);
}
const album = fakeTrack();
const albumId = albumKey(album);   // normalized 'album', not artist+album — see tiers.js

test('resolveLook: rareUnlocked overrides an earned metal and the plain variant', () => {
  resetState({
    rareUnlocked: { [albumId]: true },
    metalEligibleSessions: { [albumId]: albumPlatinum },
  });
  assert.equal(resolveLook(album), 'rare');
});

test('resolveLook: with no rare unlock, an earned metal wins over the plain variant', () => {
  resetState({ metalEligibleSessions: { [albumId]: albumGold } });
  assert.equal(resolveLook(album), 'metal');
});

test('resolveLook: a saved look preference wins when it is still available', () => {
  resetState({
    rareUnlocked: { [albumId]: true },
    metalEligibleSessions: { [albumId]: albumGold },
    albumLookPref: { [albumId]: 'metal' },
  });
  assert.equal(resolveLook(album), 'metal');
});

test('resolveLook: a saved preference for a look no longer available falls back', () => {
  resetState({
    rareUnlocked: { [albumId]: true },
    albumLookPref: { [albumId]: 'metal' },   // no metal earned this time
  });
  assert.equal(resolveLook(album), 'rare');
});

test('resolveLook: nothing earned on a tier-1 track falls back to the plain variant', () => {
  resetState();
  assert.equal(resolveLook(album), 'variant');
});
