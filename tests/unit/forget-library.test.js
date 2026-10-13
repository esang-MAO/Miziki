import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { DB } from '../../src/storage/idb.js';

// forgetLibrary() (src/library/delete.js) needs the same mock scaffolding
// delete.test.js already uses to load without a browser -- see that file's
// own comments for the full "stop the chain at the door" reasoning. This
// file additionally calls clearListeningHistory() (src/history/clear.js,
// one test) and persistSessionCounts() (src/history/sessions.js, real and
// already reachable through delete.js's own invalidateActiveSessionIfAny
// import) directly, so the thumbs.js mock gains the two persist* exports
// clear.js needs, and profile/screens.js is mocked too (clear.js's own
// real import, step 6e).
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

globalThis.MizikiSocial = { stopSpinning(){}, libraryChanged(){}, getClient(){ return null; } };

mock.module(new URL('../../src/record-art/looks.js', import.meta.url).href, {
  namedExports: { applyDiscVariant(){} },
});
mock.module(new URL('../../src/library/sealed.js', import.meta.url).href, {
  namedExports: { persistSealedAlbums(){} },
});
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: {
    restoreThumbs: async () => {}, pruneThumbs: async () => {},
    persistAlbumDisplay: async () => {}, persistTrackDisplay: async () => {},
  },
});
mock.module(new URL('../../src/crate/tiers.js', import.meta.url).href, {
  // buildCrateTier: step 07 (B4) added it to sync/backup.js's own real
  // import of this module (library/edit.js -> sync/backup.js -> here) --
  // sync/backup.js itself isn't mocked in this file (its whole real import
  // chain is DOM-free, so there's nothing to stop at the door), so this
  // mock has to satisfy both its own caller's need and backup.js's.
  namedExports: { deleteCrateArtTiers: async () => {}, buildCrateTier: async () => {} },
});
mock.module(new URL('../../src/crate/model.js', import.meta.url).href, {
  namedExports: { invalidateCrateModel(){} },
});
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: { renderTracks(){}, songRow(){} },
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
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave(){}, touchBackupField(){} },
});
mock.module(new URL('../../src/profile/screens.js', import.meta.url).href, {
  namedExports: { persistTrackLastPlayed: async () => {}, renderProfile(){} },
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
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { ensureContext: async () => {} },
});
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote(){} },
});

const { forgetLibrary } = await import('../../src/library/delete.js');
const { idOf, idxOf } = await import('../../src/library/model.js');
const { tracks, overlays, artwork, meta, sessions, achievements, collection } =
  await import('../../src/storage/repo.js');
const { persistSessionCounts } = await import('../../src/history/sessions.js');
const { clearListeningHistory } = await import('../../src/history/clear.js');
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
    playerOpen: false, metalEligibleSessions: {}, albumLastPlayed: {}, albumDisplay: {},
    albumLookPref: {}, trackPlayCounts: {}, trackMetalEligiblePlays: {}, trackLastPlayed: {},
    trackDisplay: {},
    // DA5 (docs/DAY_ARC.md)
    phasePlayCounts: {}, albumPhaseCounts: {},
  }, overrides);
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

test('forgetLibrary: empties the tracks store and leaves meta/sessions/overlays/achievements/collection alone', async () => {
  await openFresh();
  await tracks.put({ id: 't1', tags: fakeTrack().tags });
  await meta.put('trackPlayCounts', { k1: 5 });
  await meta.put('sessionCounts', { al: 3 });
  await meta.put('rareUnlocked', { al: true });
  await meta.put('prefs', { mode: 'vinyl' });
  await meta.put('playlists', [{ name: 'Faves', items: ['t1'], system: undefined }]);
  await meta.put('albumOrder', { Al: ['t1'] });
  await sessions.put({ albumId: 'al', invalidated: false, tracksCompleted: [], expectedOrder: [], startedAt: 1, lastActivityAt: 1 });
  await achievements.put({ albumId: 'al', tier: 'bronze' });
  await collection.put({ albumId: 'al' });
  await overlays.put({ id: 't1', fields: { title: 'Edited' } });
  await artwork.put({ id: 't1', blob: new Blob(['cover']) });
  resetState({ tracks: [fakeTrack({ id: 't1' })], index: 0, sealed: new Set(['al']) });

  await forgetLibrary();

  assert.equal(S.tracks.length, 0);
  assert.equal((await tracks.all()).length, 0);
  assert.deepEqual(await meta.get('trackPlayCounts'), { k1: 5 });
  assert.deepEqual(await meta.get('sessionCounts'), { al: 3 });
  assert.deepEqual(await meta.get('rareUnlocked'), { al: true });
  assert.deepEqual(await meta.get('prefs'), { mode: 'vinyl' });
  assert.deepEqual(await meta.get('playlists'), [{ name: 'Faves', items: ['t1'], system: undefined }]);
  assert.deepEqual(await meta.get('albumOrder'), { Al: ['t1'] });
  assert.equal((await sessions.all()).length, 1);
  assert.equal((await achievements.all()).length, 1);
  assert.equal((await collection.all()).length, 1);
  assert.equal((await overlays.get('t1')).fields.title, 'Edited');
  assert.ok((await artwork.get('t1')).blob instanceof Blob);
  // sealed/broken-seal state is in-memory only (S.sealed) and is never
  // touched by forgetLibrary (F3 spec: "kept and reconnected")
  assert.ok(S.sealed.has('al'));

  DB.db.close();
});

test('forgetLibrary: DA5 phasePlayCounts/albumPhaseCounts are never touched (not even referenced by src/library/delete.js at all)', async () => {
  await openFresh();
  await meta.put('phasePlayCounts', { night: 7 });
  await meta.put('albumPhaseCounts', { al: { night: 7 } });
  resetState({
    tracks: [fakeTrack({ id: 't1' })], index: 0,
    phasePlayCounts: { night: 7 }, albumPhaseCounts: { al: { night: 7 } },
  });

  await forgetLibrary();

  assert.deepEqual(S.phasePlayCounts, { night: 7 });
  assert.deepEqual(S.albumPhaseCounts, { al: { night: 7 } });
  assert.deepEqual(await meta.get('phasePlayCounts'), { night: 7 });
  assert.deepEqual(await meta.get('albumPhaseCounts'), { al: { night: 7 } });

  DB.db.close();
});

test('forgetLibrary: no write-back -- a persist afterward writes the current value, never a stale or lost one', async () => {
  await openFresh();
  await meta.put('sessionCounts', { al: 3 });
  resetState({ tracks: [fakeTrack({ id: 't1' })], sessionCounts: { al: 3 } });

  await forgetLibrary();

  // forgetLibrary() never resets S.sessionCounts, so it's still exactly
  // what it was -- the step 5d regression was the in-memory value getting
  // reset to {} while the DB was cleared, so a later save could write {}
  // back over a value that had, in the meantime, moved on
  assert.deepEqual(S.sessionCounts, { al: 3 });
  assert.deepEqual(await meta.get('sessionCounts'), { al: 3 });

  // life goes on after Forget: another session completes for this album
  S.sessionCounts.al = 4;
  await persistSessionCounts();

  assert.deepEqual(await meta.get('sessionCounts'), { al: 4 });

  DB.db.close();
});

test('forgetLibrary: reconnect -- a playlist\'s ids resolve again once matching tracks are re-added', async () => {
  await openFresh();
  const t1 = fakeTrack({ id: 't1' });
  const t2 = fakeTrack({ id: 't2', tags: { title: 'B', artist: 'A', album: 'Al', albumArtist: 'A', track: 2 } });
  const t3 = fakeTrack({ id: 't3', tags: { title: 'C', artist: 'A', album: 'Al', albumArtist: 'A', track: 3 } });
  await overlays.put({ id: 't2', fields: { title: 'Edited B' } });
  await artwork.put({ id: 't2', blob: new Blob(['cover']) });
  resetState({
    tracks: [t1, t2, t3],
    playlists: [{ name: 'Faves', items: ['t1', 't2', 't3'], system: 'favorites' }],
  });

  await forgetLibrary();

  // the playlist's ids survive Forget untouched, even with nothing in
  // S.tracks to resolve them to right now
  assert.deepEqual(S.playlists[0].items, ['t1', 't2', 't3']);
  assert.equal(idxOf('t1'), -1);

  // re-import: the same three files come back with the same ids
  S.tracks = [fakeTrack({ id: 't1' }), fakeTrack({ id: 't2' }), fakeTrack({ id: 't3' })];

  const present = S.playlists[0].items.map(idxOf).filter(i => i >= 0);
  assert.deepEqual(present, [0, 1, 2]); // back in their saved order

  // the custom cover and edit on t2 were never touched by Forget either
  assert.equal((await overlays.get('t2')).fields.title, 'Edited B');
  assert.ok((await artwork.get('t2')).blob instanceof Blob);

  DB.db.close();
});

test('forgetLibrary: partial re-add -- only the reconnected track shows, the rest stay hidden and aren\'t lost', async () => {
  await openFresh();
  resetState({
    tracks: [fakeTrack({ id: 't1' }), fakeTrack({ id: 't2' }), fakeTrack({ id: 't3' })],
    playlists: [{ name: 'Faves', items: ['t1', 't2', 't3'], system: 'favorites' }],
  });

  await forgetLibrary();
  S.tracks = [fakeTrack({ id: 't2' })];   // only one of the three files comes back

  const present = S.playlists[0].items.map(idxOf).filter(i => i >= 0);
  assert.deepEqual(present, [0]);
  assert.equal(idOf(present[0]), 't2');
  // t1 and t3 are hidden (not resolved), but still recorded -- not dropped
  // on account of t2's own reconnect
  assert.deepEqual(S.playlists[0].items, ['t1', 't2', 't3']);

  DB.db.close();
});

test('clearListeningHistory still resets stats exactly as before (full scope)', async () => {
  await openFresh();
  resetState({
    tracks: [fakeTrack({ id: 't1' })],
    sessionCounts: { al: 3 }, rareUnlocked: { al: true }, sessions: { al: {} },
  });

  await clearListeningHistory(false);

  assert.deepEqual(S.sessionCounts, {});
  assert.deepEqual(S.rareUnlocked, {});
  assert.deepEqual(S.sessions, {});
  // the library itself is untouched by clearing history
  assert.equal(S.tracks.length, 1);

  DB.db.close();
});
