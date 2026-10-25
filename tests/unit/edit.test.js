import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { DB } from '../../src/storage/idb.js';

// edit.js calls $('#trackName')/etc. unconditionally from showUndoBanner,
// and conditionally from recomputeTrack (only when S.index === the edited
// track) -- mocked to a tiny stub element rather than pulling in a real
// `document`, same approach as history.test.js's util/dom.js mock.
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

// applyDiscVariant/persistSealedAlbums are real imports from looks.js/
// sealed.js now (step 6b), not main.js — mocked on their own modules
// instead, so loading either doesn't pull in its own further real chain
// (sealed.js's circular main.js import, looks.js's real sessions.js import).
mock.module(new URL('../../src/record-art/looks.js', import.meta.url).href, {
  namedExports: { applyDiscVariant(){} },
});
const persistSealedAlbumsMock = mock.fn();
mock.module(new URL('../../src/library/sealed.js', import.meta.url).href, {
  namedExports: { persistSealedAlbums: persistSealedAlbumsMock },
});
// Since step 7d, edit.js's renderTracks/exitSelectMode imports are real
// (from src/library/view.js) instead of main.js — mocked directly here
// (edit.js has no main.js import left at all), since the real view.js
// would otherwise reach back into library/edit.js itself (a real
// circular pair) plus favorites.js/credits.js/search.js/sealed.js/
// delete.js and crate/view.js's own wide chains (including
// shell/put-away.js, which needs more from shell/mini-player.js than
// this file's own mock of it provides).
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: { renderTracks(){}, exitSelectMode(){}, updateTrackRow(){ return false; } },
});
// Since step 7b, edit.js's own renderMiniPlayer import moved off main.js
// into the real src/shell/mini-player.js — mocked there directly instead.
mock.module(new URL('../../src/shell/mini-player.js', import.meta.url).href, {
  namedExports: { renderMiniPlayer(){} },
});

const {
  applyEdit, revertTrack, applyEditWithUndo, undoLastEdit,
} = await import('../../src/library/edit.js');
const { S } = await import('../../src/state.js');

function fakeTrack(overrides){
  return Object.assign({
    id: 't1',
    tags: { title: 'T', artist: 'A', album: 'Al', albumArtist: 'A', track: 1 },
    embeddedTags: { title: 'T', artist: 'A', album: 'Al', albumArtist: 'A', track: 1 },
    embeddedArt: null, art: null, overlayArtBlob: null,
  }, overrides);
}

function resetState(overrides){
  Object.assign(S, {
    tracks: [], index: -1, sealed: new Set(), lastUndo: null, undoTimer: null,
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

test('applyEdit: writes the given fields onto the track and into the overlay store', async () => {
  await openFresh();
  const t = fakeTrack();
  resetState({ tracks: [t] });

  await applyEdit(['t1'], { title: 'New Title' }, null);

  assert.equal(t.tags.title, 'New Title');
  const { overlays } = await import('../../src/storage/repo.js');
  const rec = await overlays.get('t1');
  assert.deepEqual(rec.fields, { title: 'New Title' });
  DB.db.close();
});

test('applyEdit: a second edit merges onto the existing overlay rather than replacing it', async () => {
  await openFresh();
  const t = fakeTrack();
  resetState({ tracks: [t] });

  await applyEdit(['t1'], { title: 'New Title' }, null);
  await applyEdit(['t1'], { artist: 'New Artist' }, null);

  assert.equal(t.tags.title, 'New Title');
  assert.equal(t.tags.artist, 'New Artist');
  const { overlays } = await import('../../src/storage/repo.js');
  const rec = await overlays.get('t1');
  assert.deepEqual(rec.fields, { title: 'New Title', artist: 'New Artist' });
  DB.db.close();
});

test('applyEdit: retagging a sealed album carries the seal over to the new album id', async () => {
  await openFresh();
  const t = fakeTrack({ tags: { title: 'T', artist: 'A', album: 'Al', albumArtist: 'A', track: 1 } });
  resetState({ tracks: [t], sealed: new Set(['al']) });

  await applyEdit(['t1'], { album: 'NewAlbum' }, null);

  assert.ok(!S.sealed.has('al'));
  assert.ok(S.sealed.has('newalbum'));
  assert.equal(persistSealedAlbumsMock.mock.calls.length, 1);
  DB.db.close();
});

test('applyEdit: retagging an unsealed album never touches S.sealed', async () => {
  await openFresh();
  const t = fakeTrack();
  resetState({ tracks: [t], sealed: new Set() });

  await applyEdit(['t1'], { album: 'NewAlbum' }, null);

  assert.equal(S.sealed.size, 0);
  assert.equal(persistSealedAlbumsMock.mock.calls.length, 0);
  DB.db.close();
});

test('revertTrack: clears the overlay and restores the track to its embedded tags', async () => {
  await openFresh();
  const t = fakeTrack({
    tags: { title: 'Edited', artist: 'A', album: 'Al', albumArtist: 'A', track: 1 },
    embeddedTags: { title: 'Original', artist: 'A', album: 'Al', albumArtist: 'A', track: 1 },
  });
  resetState({ tracks: [t] });
  const { overlays } = await import('../../src/storage/repo.js');
  await overlays.put({ id: 't1', fields: { title: 'Edited' } });

  await revertTrack('t1');

  assert.equal(t.tags.title, 'Original');
  // a tombstone, not a plain delete (step 06, B3) — the cross-device merge
  // needs this device's own revert to be able to out-race a stale edit
  // still sitting unsynced elsewhere; fields:null means nothing is applied
  // locally, same effective result as no row at all (loadOverlayFor/
  // applyEdit both already treat a falsy fields as "nothing to apply")
  const rec = await overlays.get('t1');
  assert.equal(rec.fields, null);
  assert.equal(rec.reverted, true);
  DB.db.close();
});

test('applyEditWithUndo + undoLastEdit: undo restores the exact prior overlay when one existed', async () => {
  await openFresh();
  const t = fakeTrack();
  resetState({ tracks: [t] });
  const { overlays } = await import('../../src/storage/repo.js');
  await overlays.put({ id: 't1', fields: { title: 'First Edit' } });
  t.tags.title = 'First Edit';

  await applyEditWithUndo(['t1'], { title: 'Second Edit' }, null);
  assert.equal(t.tags.title, 'Second Edit');

  await undoLastEdit();

  assert.equal(t.tags.title, 'First Edit');
  const rec = await overlays.get('t1');
  assert.deepEqual(rec.fields, { title: 'First Edit' });
  DB.db.close();
});

test('applyEditWithUndo + undoLastEdit: undo clears the overlay entirely when there was none before', async () => {
  await openFresh();
  const t = fakeTrack();
  resetState({ tracks: [t] });

  await applyEditWithUndo(['t1'], { title: 'Only Edit' }, null);
  assert.equal(t.tags.title, 'Only Edit');

  await undoLastEdit();

  assert.equal(t.tags.title, 'T'); // back to embeddedTags
  // a tombstone, not a plain delete — same reasoning as revertTrack's own
  // test above
  const { overlays } = await import('../../src/storage/repo.js');
  const rec = await overlays.get('t1');
  assert.equal(rec.fields, null);
  assert.equal(rec.reverted, true);
  DB.db.close();
});

test('undoLastEdit: a second call with no pending undo is a no-op', async () => {
  await openFresh();
  resetState({ tracks: [] });
  await undoLastEdit(); // S.lastUndo is null -- should return immediately, not throw
  DB.db.close();
});

// select-all bulk metadata editing: genre/year land on t.details (the
// liner-notes/credits object search.js's genre:/year: field matchers and
// the credits sheet read), not t.tags -- splitFields() (edit.js, module-
// private) routes them there while keeping the overlay row itself one flat
// `fields` object, so the cross-device overlay merge needs no change.
test('applyEdit: genre/year land on t.details, not t.tags, for a batch of tracks', async () => {
  await openFresh();
  const t1 = fakeTrack({ id: 't1', details: { genre: '', year: 0 } });
  const t2 = fakeTrack({ id: 't2', details: { genre: '', year: 0 } });
  resetState({ tracks: [t1, t2] });

  await applyEdit(['t1', 't2'], { artist: 'New Artist', genre: 'Jazz', year: 1977 }, null);

  assert.equal(t1.tags.artist, 'New Artist');
  assert.equal(t1.details.genre, 'Jazz');
  assert.equal(t1.details.year, 1977);
  assert.equal(t2.details.genre, 'Jazz');
  assert.equal(t2.details.year, 1977);
  assert.equal(t1.tags.genre, undefined); // never written onto tags
  const { overlays } = await import('../../src/storage/repo.js');
  const rec = await overlays.get('t1');
  // the overlay row itself still carries every field together, unsplit
  assert.deepEqual(rec.fields, { artist: 'New Artist', genre: 'Jazz', year: 1977 });
  DB.db.close();
});

test('applyEdit: a track with no details object yet still gets genre/year applied', async () => {
  await openFresh();
  const t = fakeTrack({ details: null });
  resetState({ tracks: [t] });

  await applyEdit(['t1'], { genre: 'Rock' }, null);

  assert.equal(t.details.genre, 'Rock');
  DB.db.close();
});

test('revertTrack: also restores t.details to the embedded details', async () => {
  await openFresh();
  const t = fakeTrack({
    details: { genre: 'Edited Genre', year: 1999 },
    embeddedDetails: { genre: 'Original Genre', year: 1980 },
  });
  resetState({ tracks: [t] });
  const { overlays } = await import('../../src/storage/repo.js');
  await overlays.put({ id: 't1', fields: { genre: 'Edited Genre', year: 1999 } });

  await revertTrack('t1');

  assert.equal(t.details.genre, 'Original Genre');
  assert.equal(t.details.year, 1980);
  DB.db.close();
});

test('applyEditWithUndo + undoLastEdit: undo restores the prior genre/year', async () => {
  await openFresh();
  const t = fakeTrack({
    details: { genre: 'First Genre', year: 1990 },
    embeddedDetails: { genre: '', year: 0 },
  });
  resetState({ tracks: [t] });
  const { overlays } = await import('../../src/storage/repo.js');
  await overlays.put({ id: 't1', fields: { genre: 'First Genre', year: 1990 } });

  await applyEditWithUndo(['t1'], { genre: 'Second Genre', year: 2000 }, null);
  assert.equal(t.details.genre, 'Second Genre');
  assert.equal(t.details.year, 2000);

  await undoLastEdit();

  assert.equal(t.details.genre, 'First Genre');
  assert.equal(t.details.year, 1990);
  DB.db.close();
});
