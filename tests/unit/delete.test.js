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

const persistSealedAlbumsMock = mock.fn();
mock.module(new URL('../../src/main.js', import.meta.url).href, {
  namedExports: {
    clearSpinDown(){}, deleteCrateArtTiers: async () => {}, persistSealedAlbums: persistSealedAlbumsMock,
    closePlayer(){}, rebuildPeopleIndex(){}, invalidateCrateModel(){}, renderTracks(){}, renderMiniPlayer(){},
    queueSave(){}, applyDiscVariant(){}, restoreThumbs: async () => {},
    // setQueue (real, from player/queue.js) pulls in queue.js's own main.js
    // imports (step 5a) and, via history/sessions.js, applyDiscVariant/
    // restoreThumbs above
    runStartSequence: async () => {}, openPlayerViaSheet(){},
    shouldPutAway(){ return false; }, putAwayInstant(){}, runPutAwaySequence: async () => {},
  },
});
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { stop(){}, load(){}, play(){}, pause(){}, seek(){} },
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

const { countForAlbum, countForArtist, formatBytes, totalLibraryBytes, deleteTracks, forgetLibrary } =
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
    playlists: [{ name:'Favorites', items:[0,1], system:'favorites' }],
    queue: [0,1], baseQueue: [0,1], qpos: 0, index: -1,
  });

  await deleteTracks(['t1']);

  assert.equal(S.tracks.length, 1);
  assert.equal(S.tracks[0].id, 't2');
  assert.equal(S.playlists[0].items.length, 1);
  assert.equal(S.tracks[S.playlists[0].items[0]].id, 't2');
  DB.db.close();
});

// -- forgetLibrary -----------------------------------------------------------

test('forgetLibrary: clears the whole library and every session/metal counter', async () => {
  await openFresh();
  resetState({
    tracks: [fakeTrack({ id:'t1' })],
    sessionCounts: { al: 3 }, rareUnlocked: { al: true }, sessions: { al: {} },
    sealed: new Set(['al']),
  });

  await forgetLibrary();

  assert.equal(S.tracks.length, 0);
  assert.equal(S.index, -1);
  assert.deepEqual(S.playlists, []);
  assert.deepEqual(S.sessionCounts, {});
  assert.deepEqual(S.rareUnlocked, {});
  assert.deepEqual(S.sessions, {});
  assert.equal(S.sealed.size, 0);
  DB.db.close();
});

test('forgetLibrary: keeps achievement/collection thumbnails in meta', async () => {
  await openFresh();
  const { meta } = await import('../../src/storage/repo.js');
  await meta.put('thumb:album:al1', new Blob(['x']));
  resetState({
    tracks: [fakeTrack({ id:'t1' })],
    achievements: { al1: { albumId:'al1', tier:'bronze' } },
  });

  await forgetLibrary();

  const kept = await meta.get('thumb:album:al1');
  assert.ok(kept instanceof Blob);
  DB.db.close();
});

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
