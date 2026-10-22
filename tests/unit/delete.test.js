import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { DB } from '../../src/storage/idb.js';

// delete.js calls $('#platterBox')/etc. (always, inside deleteTracks/
// forgetLibrary) -- mocked to a tiny stub element, same approach as
// edit.test.js/history.test.js. It also has real imports (transport.js,
// player/queue.js, sleep-timer.js, clock.js, history/sessions.js) whose
// own chains need more of main.js's DOM-dependent top level -- all of it
// mocked directly, the same "stop the chain at the door" approach as
// queue.test.js/tags.test.js.
// queue.js's own real chain now reaches skipWithLift(), which imports
// REDUCED from util/motion.js -- read once, at module load, from
// window.matchMedia.
globalThis.window = { matchMedia(){ return { matches: false }; } };

function fakeEl(){
  const classes = new Set();
  return {
    textContent: '', style: {},
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
    },
    setAttribute(){}, removeAttribute(){}, src: '',
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: { $(){ return fakeEl(); }, el(){ return fakeEl(); } },
});

globalThis.MizikiSocial = { stopSpinning(){}, libraryChanged(){} };

// applyDiscVariant/persistSealedAlbums are real imports from looks.js/
// sealed.js now (step 6b, both delete.js's own direct imports and, via
// history/sessions.js, the chain setQueue below pulls in) — mocked on
// their own modules so neither's further real chain (sealed.js's circular
// main.js import, looks.js's real sessions.js import) has to load. Same
// reasoning for thumbs.js's restoreThumbs (sessions.js's other real
// import, step 6b) — mocking just that one export stops thumbs.js's own
// chain (which reaches library/edit.js and, through that, credits.js)
// from loading. pruneThumbs is delete.js's own direct import since step 02
// (forgetLibrary() calls it) — mocked as a no-op for the same "stop the
// chain at the door" reason; its own correctness (which thumbnails survive)
// is already covered by history.test.js's clearListeningHistory tests, the
// other caller of the same function.
mock.module(new URL('../../src/record-art/looks.js', import.meta.url).href, {
  namedExports: { applyDiscVariant(){} },
});
const persistSealedAlbumsMock = mock.fn();
mock.module(new URL('../../src/library/sealed.js', import.meta.url).href, {
  namedExports: { persistSealedAlbums: persistSealedAlbumsMock },
});
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { restoreThumbs: async () => {}, pruneThumbs: async () => {} },
});
// Since step 7c, delete.js's deleteCrateArtTiers/invalidateCrateModel
// imports are real ones from src/crate/tiers.js/model.js instead of
// main.js — mocked directly here, same "stop the chain at the door"
// reasoning (crate/model.js's own real chain reads window.devicePixelRatio
// via crate/constants.js at module load, which there's no browser for).
mock.module(new URL('../../src/crate/tiers.js', import.meta.url).href, {
  namedExports: { deleteCrateArtTiers: async () => {} },
});
mock.module(new URL('../../src/crate/model.js', import.meta.url).href, {
  namedExports: { invalidateCrateModel(){} },
});
// Since step 7d, delete.js's own renderTracks import, and credits.js's
// renderTracks/songRow imports (reached via delete.js's real
// rebuildPeopleIndex import, step 5e), are all real ones from
// src/library/view.js instead of main.js — mocked directly here, same
// "stop the chain at the door" reasoning as the rest of this file, since
// the real view.js would otherwise reach back into library/delete.js
// itself (a real circular pair) plus library/edit.js's own
// crate/tiers.js needs (buildCrateTier, which this file's crate/tiers.js
// mock above doesn't provide) and favorites.js/search.js/sealed.js.
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: { renderTracks(){}, songRow(){} },
});
// RF23 (docs/12_REFINE.md): credits.js's new, one-directional import of
// openFriendStore (social/screens/friend-store.js) would otherwise reach
// that module's own real chain (profile/storefront.js and everything past
// it) via delete.js's own real rebuildPeopleIndex import — stopped at that
// new edge, the same way tests/unit/credits.test.js does.
mock.module(new URL('../../src/social/screens/friend-store.js', import.meta.url).href, {
  namedExports: { openFriendStore(){} },
});
// Since step 7b, clearSpinDown/closePlayer/renderMiniPlayer (delete.js's own
// imports), runStartSequence/openPlayerViaSheet/shouldPutAway/putAwayInstant/
// runPutAwaySequence (setQueue's chain, via player/queue.js) and showRoute
// (credits.js's chain, via rebuildPeopleIndex) all moved off main.js into
// real src/shell/ modules — mocked there directly instead, same "stop the
// chain at the door" reasoning the rest of this file's comments give.
// CEREMONY PR 3: player/queue.js and shell/start-sequence.js import
// shell/runout.js, whose real chain reaches library/view.js — stop it here.
mock.module(new URL('../../src/shell/runout.js', import.meta.url).href, {
  namedExports: { endOfQueue(){}, maybeSideFlip(){ return false; }, cancelRunout(){}, interruptRunout(){ return false; }, clearToRest(){} },
});
mock.module(new URL('../../src/shell/put-away.js', import.meta.url).href, {
  namedExports: {
    clearSpinDown(){},
    shouldPutAway(){ return false; }, putAwayInstant(){}, runPutAwaySequence: async () => {},
  },
});
mock.module(new URL('../../src/shell/player-overlay.js', import.meta.url).href, {
  namedExports: { closePlayer(){}, openPlayerViaSheet(){} },
});
mock.module(new URL('../../src/shell/mini-player.js', import.meta.url).href, {
  namedExports: { renderMiniPlayer(){} },
});
mock.module(new URL('../../src/shell/start-sequence.js', import.meta.url).href, {
  namedExports: { runStartSequence: async () => {} },
});
mock.module(new URL('../../src/shell/routes.js', import.meta.url).href, {
  namedExports: { showRoute(){} },
});
// Since step 7a, delete.js's own queueSave import is real (from
// storage/meta.js) instead of main.js — mocked directly here, same "stop
// the chain at the door" reasoning as the rest of this file, since
// meta.js's own real imports (audio/mode.js, player/controls.js,
// player/background.js, for applyPrefs()) would otherwise reach the same
// wide chains already stopped above.
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave(){}, touchBackupField(){} },
});
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { stop(){}, load(){}, play(){}, pause(){}, seek(){}, sideLetterFor(){ return ''; } },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { drawTime(){} },
});
mock.module(new URL('../../src/player/sleep-timer.js', import.meta.url).href, {
  namedExports: { stopSleepState(){}, sleepStopPlayback(){} },
});
// setQueue's own real import chain (player/queue.js -> buffers.js ->
// audio/engine.js) needs these stopped at the door too, same as
// tags.test.js/queue.test.js.
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { ensureContext: async () => {} },
});
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote(){} },
});

const { countForAlbum, countForArtist, formatBytes, totalLibraryBytes, deleteTracks } =
  await import('../../src/library/delete.js');
const { S } = await import('../../src/state.js');

function fakeTrack(overrides){
  return Object.assign({
    id: 't1', sizeBytes: 1000, art: null,
    tags: { title: 'T', artist: 'A', album: 'Al', albumArtist: 'A', track: 1 },
  }, overrides);
}

function resetState(overrides){
  Object.assign(S, {
    tracks: [], index: -1, playlists: [], albumOrder: {}, queue: [], baseQueue: [], qpos: 0,
    sealed: new Set(), achievements: {}, collection: {}, sessions: {}, sessionCounts: {},
    rareUnlocked: {}, sessionActive: null, curPlayed: [], curTrackDone: false, lru: [],
    playerOpen: false,
  }, overrides);
  persistSealedAlbumsMock.mock.resetCalls();
}

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

// -- pure helpers --------------------------------------------------------

test('countForAlbum / countForArtist count only matching tracks', () => {
  resetState({
    tracks: [
      fakeTrack({ id:'t1', tags:{ title:'A', artist:'X', album:'Same', albumArtist:'X', track:1 } }),
      fakeTrack({ id:'t2', tags:{ title:'B', artist:'X', album:'Same', albumArtist:'X', track:2 } }),
      fakeTrack({ id:'t3', tags:{ title:'C', artist:'Y', album:'Other', albumArtist:'Y', track:1 } }),
    ],
  });
  assert.equal(countForAlbum('Same'), 2);
  assert.equal(countForAlbum('Other'), 1);
  assert.equal(countForArtist('X'), 2);
  assert.equal(countForArtist('Y'), 1);
});

test('formatBytes formats across units', () => {
  assert.equal(formatBytes(0), '0 MB');
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});

test('totalLibraryBytes sums every track\'s sizeBytes', () => {
  resetState({
    tracks: [fakeTrack({ id:'t1', sizeBytes: 100 }), fakeTrack({ id:'t2', sizeBytes: 250 })],
  });
  assert.equal(totalLibraryBytes(), 350);
});

// -- deleteTracks ----------------------------------------------------------

test('deleteTracks: removes the given tracks and nothing else', async () => {
  await openFresh();
  resetState({
    tracks: [fakeTrack({ id:'t1' }), fakeTrack({ id:'t2', tags:{ title:'B', artist:'A', album:'Al', albumArtist:'A', track:2 } })],
    index: -1,
  });

  await deleteTracks(['t1']);

  assert.equal(S.tracks.length, 1);
  assert.equal(S.tracks[0].id, 't2');
  DB.db.close();
});

test('deleteTracks: dropping an album\'s last track un-seals it and persists the change', async () => {
  await openFresh();
  const t = fakeTrack({ id:'t1' });
  resetState({ tracks: [t], sealed: new Set(['al']) });

  await deleteTracks(['t1']);

  assert.ok(!S.sealed.has('al'));
  assert.equal(persistSealedAlbumsMock.mock.calls.length, 1);
  DB.db.close();
});

test('deleteTracks: deleting a non-last track from a sealed album leaves the seal alone', async () => {
  await openFresh();
  resetState({
    tracks: [
      fakeTrack({ id:'t1' }),
      fakeTrack({ id:'t2', tags:{ title:'B', artist:'A', album:'Al', albumArtist:'A', track:2 } }),
    ],
    sealed: new Set(['al']),
  });

  await deleteTracks(['t1']);

  assert.ok(S.sealed.has('al'));
  assert.equal(persistSealedAlbumsMock.mock.calls.length, 0);
  DB.db.close();
});

test('deleteTracks: deleting the currently-playing track clears S.index', async () => {
  await openFresh();
  resetState({ tracks: [fakeTrack({ id:'t1' })], index: 0 });

  await deleteTracks(['t1']);

  assert.equal(S.index, -1);
  assert.equal(S.tracks.length, 0);
  DB.db.close();
});

test('deleteTracks: an empty id list is a no-op', async () => {
  await openFresh();
  const t = fakeTrack({ id:'t1' });
  resetState({ tracks: [t] });

  await deleteTracks([]);

  assert.equal(S.tracks.length, 1);
  DB.db.close();
});

test('deleteTracks: playlist/queue entries referencing a deleted track are dropped, others survive by identity', async () => {
  await openFresh();
  const t1 = fakeTrack({ id:'t1' });
  const t2 = fakeTrack({ id:'t2', tags:{ title:'B', artist:'A', album:'Al', albumArtist:'A', track:2 } });
  resetState({
    tracks: [t1, t2],
    // playlist items are track ids, not positions (F3 spec, step 02)
    playlists: [{ name:'Favorites', items:['t1','t2'], system:'favorites' }],
    queue: [0,1], baseQueue: [0,1], qpos: 0, index: -1,
  });

  await deleteTracks(['t1']);

  assert.equal(S.tracks.length, 1);
  assert.equal(S.tracks[0].id, 't2');
  assert.deepEqual(S.playlists[0].items, ['t2']);
  DB.db.close();
});

// forgetLibrary() has its own dedicated test file —
// tests/unit/forget-library.test.js — since step 02 (F3 spec) gave it
// enough new behavior (and enough reconnect-after-reimport scenarios) to
// outgrow this file's "one function, a couple of cases" shape.

// -- findAllDuplicateGroups (src/library/duplicate-scan.js) ------------------
// Pure and import-free beyond S/tiers.js, so it's tested here alongside
// deleteTracks (the function it hands its "keep newest only" choice to)
// rather than opening a fourth mock-heavy test file for one function.

const { findAllDuplicateGroups } = await import('../../src/library/duplicate-scan.js');

test('findAllDuplicateGroups: groups tracks sharing the same artist+album+title identity', () => {
  resetState({
    tracks: [
      fakeTrack({ id:'t1', tags:{ title:'Same', artist:'A', album:'Al', albumArtist:'A', track:1 } }),
      fakeTrack({ id:'t2', tags:{ title:'Same', artist:'A', album:'Al', albumArtist:'A', track:1 } }),
      fakeTrack({ id:'t3', tags:{ title:'Different', artist:'A', album:'Al', albumArtist:'A', track:2 } }),
    ],
  });
  const groups = findAllDuplicateGroups();
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 2);
});

test('findAllDuplicateGroups: a library with no duplicates returns no groups', () => {
  resetState({
    tracks: [
      fakeTrack({ id:'t1', tags:{ title:'A', artist:'X', album:'Al', albumArtist:'X', track:1 } }),
      fakeTrack({ id:'t2', tags:{ title:'B', artist:'X', album:'Al', albumArtist:'X', track:2 } }),
    ],
  });
  assert.deepEqual(findAllDuplicateGroups(), []);
});
