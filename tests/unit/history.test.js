import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { DB } from '../../src/storage/idb.js';

// played.js imports from the real src/history/sessions.js (sessionTrackComplete,
// persistTrackPlayCounts, persistTrackMetalEligiblePlays), which in turn needs
// applyDiscVariant/restoreThumbs from main.js; played.js itself also needs a
// few more main.js names directly (persistTrackLastPlayed, snapshotAlbumDisplay,
// snapshotTrackDisplay, checkAlbumAchievementAndCollection). clear.js needs a
// further few (persistAlbumDisplay, persistTrackDisplay, pruneThumbs,
// renderProfile). main.js has DOM-dependent top-level code that needs a
// browser, so it's mocked directly here with the union of everything the real
// chain asks of it — same approach as queue.test.js/tags.test.js.
// clear.js also calls $('#route-profile') (util/dom.js), which needs a real
// `document` global -- mocked to a no-op stub rather than pulling in a DOM.
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: { $(){ return null; }, el(){ return null; } },
});

const checkAlbumAchievementAndCollectionMock = mock.fn();
mock.module(new URL('../../src/main.js', import.meta.url).href, {
  namedExports: {
    persistTrackLastPlayed: async () => {}, snapshotAlbumDisplay(){}, snapshotTrackDisplay(){},
    applyDiscVariant(){}, checkAlbumAchievementAndCollection: checkAlbumAchievementAndCollectionMock,
    restoreThumbs: async () => {},
    persistAlbumDisplay: async () => {}, persistTrackDisplay: async () => {},
    pruneThumbs: async () => {}, renderProfile(){},
  },
});

const { addPlayedRange, playedCoverage, checkTrackCompletion } = await import('../../src/history/played.js');
const { clearListeningHistory } = await import('../../src/history/clear.js');
const { S } = await import('../../src/state.js');

function resetState(overrides){
  Object.assign(S, {
    tracks: [], index: -1, curPlayed: [], curTrackDone: false, sessionActive: null,
    sessions: {}, sessionCounts: {}, metalEligibleSessions: {}, rareUnlocked: {},
    albumLastPlayed: {}, albumDisplay: {}, albumLookPref: {},
    achievements: {}, collection: {},
    trackPlayCounts: {}, trackMetalEligiblePlays: {}, trackLastPlayed: {}, trackDisplay: {},
  }, overrides);
  checkAlbumAchievementAndCollectionMock.mock.resetCalls();
}

function fakeTrack(overrides){
  return Object.assign({
    id: 't1', duration: 100,
    tags: { title: 'T', artist: 'A', album: 'Al', albumArtist: 'A', track: 1, disc: 0 },
    details: {},
  }, overrides);
}

// -- addPlayedRange / playedCoverage ----------------------------------------

test('addPlayedRange: contiguous playback merges into one interval', () => {
  resetState();
  addPlayedRange(0, 10);
  addPlayedRange(10, 20);
  addPlayedRange(20, 30);
  assert.equal(S.curPlayed.length, 1);
  assert.equal(playedCoverage(), 30);
});

test('addPlayedRange: a scrub-skip leaves a real gap, not counted', () => {
  resetState();
  addPlayedRange(0, 10);
  addPlayedRange(50, 60); // scrubbed far ahead -- a real gap
  assert.equal(S.curPlayed.length, 2);
  assert.equal(playedCoverage(), 20); // 10 + 10, the gap itself isn't counted
});

test('addPlayedRange: overlapping replays are not double-counted', () => {
  resetState();
  addPlayedRange(0, 10);
  addPlayedRange(5, 15);  // overlaps the first by 5s
  addPlayedRange(3, 8);   // fully inside the merged range already
  assert.equal(playedCoverage(), 15); // union is [0,15], not 10+10+5
});

test('addPlayedRange: ranges within the 0.05s joining tolerance merge; just outside it do not', () => {
  resetState();
  addPlayedRange(0, 10);
  addPlayedRange(10.05, 15); // exactly at the tolerance -- joins
  assert.equal(S.curPlayed.length, 1);
  assert.equal(playedCoverage(), 15);

  resetState();
  addPlayedRange(0, 10);
  addPlayedRange(10.06, 15); // just past the tolerance -- a real gap
  assert.equal(S.curPlayed.length, 2);
  assert.ok(playedCoverage() < 15);
});

test('addPlayedRange: a backwards or empty range is a no-op', () => {
  resetState();
  addPlayedRange(10, 10);
  addPlayedRange(10, 5);
  assert.equal(S.curPlayed.length, 0);
});

// -- checkTrackCompletion ----------------------------------------------------

test('checkTrackCompletion: counts once at >=95% coverage', () => {
  resetState();
  const t = fakeTrack({ duration: 100 });
  addPlayedRange(0, 95);
  checkTrackCompletion(t);
  assert.equal(S.curTrackDone, true);
  assert.equal(S.trackPlayCounts['a|al|t'] !== undefined, true);
  assert.equal(checkAlbumAchievementAndCollectionMock.mock.calls.length, 1);
});

test('checkTrackCompletion: never counts twice for the same play-through', () => {
  resetState();
  const t = fakeTrack({ duration: 100 });
  addPlayedRange(0, 95);
  checkTrackCompletion(t);
  const countAfterFirst = S.trackPlayCounts['a|al|t'];
  addPlayedRange(95, 100); // keeps playing past the 95% mark
  checkTrackCompletion(t); // S.curTrackDone is already true -- no-op
  assert.equal(S.trackPlayCounts['a|al|t'], countAfterFirst);
  assert.equal(checkAlbumAchievementAndCollectionMock.mock.calls.length, 1);
});

test('checkTrackCompletion: never counts below 95% coverage, even if playback reached the end', () => {
  resetState();
  const t = fakeTrack({ duration: 100 });
  addPlayedRange(80, 100); // reached the end, but only 20% actually played (scrubbed past the rest)
  checkTrackCompletion(t);
  assert.equal(S.curTrackDone, false);
  assert.equal(S.trackPlayCounts['a|al|t'], undefined);
  assert.equal(checkAlbumAchievementAndCollectionMock.mock.calls.length, 0);
});

test('checkTrackCompletion: a track with no duration never completes', () => {
  resetState();
  const t = fakeTrack({ duration: 0 });
  addPlayedRange(0, 50);
  checkTrackCompletion(t);
  assert.equal(S.curTrackDone, false);
});

// -- clearListeningHistory ----------------------------------------------------

function freshIndexedDB(){
  const factory = new IDBFactory();
  globalThis.indexedDB = factory;
  return factory;
}
function resetDB(){ DB.db = null; DB.ok = false; }
async function openFresh(){
  freshIndexedDB();
  resetDB();
  const { storage } = await import('../../src/storage/repo.js');
  await storage.open();
}

test('clearListeningHistory: full scope wipes session/play counters and leaves the library, edits and playlists alone', async () => {
  await openFresh();
  resetState({
    tracks: [fakeTrack({ id:'t1' })],
    sessionCounts: { al1: 3 }, metalEligibleSessions: { al1: 2 }, rareUnlocked: { al1: true },
    albumLastPlayed: { al1: Date.now() }, albumDisplay: { al1: {name:'x'} }, albumLookPref: { al1: 'rare' },
    achievements: { al1: { albumId:'al1', tier:2 } }, collection: { al1: { albumId:'al1' } },
    sessions: { al1: { albumId:'al1' } },
    trackPlayCounts: { tk1: 5 }, trackMetalEligiblePlays: { tk1: 3 }, trackLastPlayed: { tk1: Date.now() },
    trackDisplay: { tk1: {name:'y'} },
  });
  // library/edits/playlists/settings are not S.* fields this function touches at all --
  // confirm it leaves the library (S.tracks) and an arbitrary "setting" untouched
  S.libraryLayout = 'crate'; S.favorites = ['t1'];

  await clearListeningHistory(false);

  assert.deepEqual(S.sessionCounts, {});
  assert.deepEqual(S.metalEligibleSessions, {});
  assert.deepEqual(S.rareUnlocked, {});
  assert.deepEqual(S.albumLastPlayed, {});
  assert.deepEqual(S.albumDisplay, {});
  assert.deepEqual(S.albumLookPref, {});
  assert.deepEqual(S.achievements, {});
  assert.deepEqual(S.collection, {});
  assert.deepEqual(S.sessions, {});
  assert.equal(S.sessionActive, null);
  assert.deepEqual(S.trackPlayCounts, {});
  assert.deepEqual(S.trackMetalEligiblePlays, {});
  assert.deepEqual(S.trackLastPlayed, {});
  assert.deepEqual(S.trackDisplay, {});

  // untouched by this function
  assert.equal(S.tracks.length, 1);
  assert.equal(S.libraryLayout, 'crate');
  assert.deepEqual(S.favorites, ['t1']);

  DB.db.close();
});

test('clearListeningHistory: orphaned-only scope drops only identities no longer in the library', async () => {
  await openFresh();
  resetState({
    tracks: [fakeTrack({ id:'t1', tags:{title:'T', artist:'A', album:'Al', albumArtist:'A', track:1, disc:0} })],
    // albumKey() is normKey(album) alone ("al" for this track); trackIdentityKey()
    // is normKey(artist)|albumKey|normKey(title) ("a|al|t" for this track)
    sessionCounts: { al: 3, goneAlbum: 7 },
    albumLastPlayed: { al: 1, goneAlbum: 1 },
    achievements: {}, collection: {}, sessions: {},
    trackPlayCounts: { 'a|al|t': 2, 'gone|key|x': 9 },
  });

  await clearListeningHistory(true);

  // the still-in-library album/track identity survives
  assert.ok('al' in S.sessionCounts);
  assert.ok('a|al|t' in S.trackPlayCounts);
  // the orphaned ones (no longer in S.tracks) are dropped
  assert.ok(!('goneAlbum' in S.sessionCounts));
  assert.ok(!('gone|key|x' in S.trackPlayCounts));

  DB.db.close();
});
