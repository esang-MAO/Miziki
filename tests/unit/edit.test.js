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

const persistSealedAlbumsMock = mock.fn();
mock.module(new URL('../../src/main.js', import.meta.url).href, {
  namedExports: {
    applyDiscVariant(){}, renderTracks(){}, renderMiniPlayer(){},
    deleteCrateArtTiers: async () => {}, buildCrateTier: async () => {},
    persistSealedAlbums: persistSealedAlbumsMock, exitSelectMode(){},
  },
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
  assert.equal(await overlays.get('t1'), undefined);
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
  const { overlays } = await import('../../src/storage/repo.js');
  assert.equal(await overlays.get('t1'), undefined);
  DB.db.close();
});

test('undoLastEdit: a second call with no pending undo is a no-op', async () => {
  await openFresh();
  resetState({ tracks: [] });
  await undoLastEdit(); // S.lastUndo is null -- should return immediately, not throw
  DB.db.close();
});
