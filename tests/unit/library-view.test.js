import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// view.js calls real $/el (util/dom.js) for every row/screen it builds --
// mocked to a capable stub (classList, appendChild, innerHTML, cached by
// selector, and a real addEventListener that records the handler so a
// test can invoke it), same shape as queue.test.js's renderQueueSheet
// stub. It also has real circular imports with library/credits.js/
// favorites.js/search.js/sealed.js/edit.js/delete.js and crate/view.js
// (each of those modules imports renderTracks/songRow/groupRow back from
// here) -- all mocked directly rather than loaded for real, the usual
// "stop the chain at the door" reasoning, since none of them are the
// subject of this test.
const elCache = new Map();
function fakeEl(){
  const classes = new Set();
  const kids = [];
  const listeners = {};
  return {
    textContent: '', style: {}, innerHTML: '', src: '', alt: '', value: '', dataset: {},
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      toggle(c, on){ if(on === undefined) on = !classes.has(c); if(on) classes.add(c); else classes.delete(c); },
      contains(c){ return classes.has(c); },
    },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    addEventListener(type, fn){ listeners[type] = fn; },
    fire(type, ev){ if(listeners[type]) listeners[type](ev || {}); },
    appendChild(child){ kids.push(child); return child; },
    querySelector(){ return fakeEl(); },
    querySelectorAll(){ return []; },
    children: kids,
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ if(!elCache.has(sel)) elCache.set(sel, fakeEl()); return elCache.get(sel); },
    el(tag, cls, text){ const e = fakeEl(); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; },
  },
});
globalThis.document = { querySelectorAll(){ return []; } };

mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { fmt(s){ return String(s); } },
});
const setQueueMock = mock.fn();
mock.module(new URL('../../src/player/queue.js', import.meta.url).href, {
  namedExports: { setQueue: setQueueMock },
});
mock.module(new URL('../../src/library/credits.js', import.meta.url).href, {
  namedExports: {
    trackHasCreditsContent(){ return false; }, albumLinerNotes(){ return ''; },
    albumCreditRoll(){ return new Map(); }, creditRow(){ return fakeEl(); },
    renderPersonView(){},
  },
});
mock.module(new URL('../../src/library/favorites.js', import.meta.url).href, {
  namedExports: { isFavorite(){ return false; } },
});
const queueSaveMock = mock.fn();
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave: queueSaveMock, touchBackupField(){} },
});
mock.module(new URL('../../src/storage/repo.js', import.meta.url).href, {
  namedExports: { overlays: { get: async () => null }, artwork: { get: async () => null } },
});
const applyEditMock = mock.fn(async () => {});
const showUndoBannerMock = mock.fn();
mock.module(new URL('../../src/library/edit.js', import.meta.url).href, {
  namedExports: { applyEdit: applyEditMock, showUndoBanner: showUndoBannerMock },
});
mock.module(new URL('../../src/library/delete.js', import.meta.url).href, {
  namedExports: {
    countForAlbum(){ return 0; }, countForArtist(){ return 0; },
    deleteAlbum(){}, deleteArtist(){},
  },
});
mock.module(new URL('../../src/library/sealed.js', import.meta.url).href, {
  namedExports: { isAlbumSealed(){ return false; } },
});
mock.module(new URL('../../src/library/search.js', import.meta.url).href, {
  namedExports: {
    librarySortBar(){ return fakeEl(); }, librarySortComparator(){ return () => 0; },
    sortAlbumGroups(groups){ return groups; }, renderSearchResults(){},
  },
});
const renderCrateMock = mock.fn();
const centerEmptyStateMock = mock.fn();
mock.module(new URL('../../src/crate/view.js', import.meta.url).href, {
  namedExports: { centerEmptyState: centerEmptyStateMock, renderCrate: renderCrateMock },
});
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote(){} },
});
mock.module(new URL('../../src/shell/header.js', import.meta.url).href, {
  namedExports: {
    updateLibTabsForLayout(){}, updateHeaderActionsAvailability(){}, refreshLibraryTools(){},
  },
});

const view = await import('../../src/library/view.js');
const {
  songRow, groupRow, enterSelectMode, exitSelectMode, closeRowMenu,
  openConfirmDelete, closeConfirmDelete, renderTracks,
} = view;
const { S } = await import('../../src/state.js');

function fakeTrack(id, overrides){
  return Object.assign({
    id, art: null, meta: { codec: 'FLAC', lossless: true },
    tags: { title: id, artist: 'Artist', album: 'Album', albumArtist: 'Artist', track: 1, disc: 1 },
  }, overrides);
}

function resetState(overrides){
  elCache.clear();
  setQueueMock.mock.resetCalls(); queueSaveMock.mock.resetCalls();
  renderCrateMock.mock.resetCalls(); centerEmptyStateMock.mock.resetCalls();
  Object.assign(S, {
    tracks: [], index: -1,
    view: { mode: 'songs', group: null, playlist: null, artistAlbum: null, person: null, personReturn: null,
      crateLoose: null, crateLooseIdx: null, crateLooseArtist: null, editSelecting: false, picking: false },
    editSelection: new Set(), playlists: [], albumSort: {}, albumOrder: {},
    libraryLayout: 'list', lastUndo: null,
  }, overrides);
}

test('enterSelectMode/exitSelectMode toggle S.view.editSelecting and clear the selection', () => {
  resetState({ tracks: [fakeTrack('a')] });
  enterSelectMode();
  assert.equal(S.view.editSelecting, true);
  S.editSelection.add('a');
  exitSelectMode();
  assert.equal(S.view.editSelecting, false);
  assert.equal(S.editSelection.size, 0);
});

test('closeRowMenu clears rowMenuTrackId (exported read-only for main.js\'s wiring)', () => {
  resetState({ tracks: [fakeTrack('a')] });
  closeRowMenu();
  assert.equal(view.rowMenuTrackId, null);
});

test('openConfirmDelete/closeConfirmDelete set and clear confirmDeleteAction', () => {
  resetState({});
  const action = () => {};
  openConfirmDelete('song', 1, 'Track', action);
  assert.equal(view.confirmDeleteAction, action);
  closeConfirmDelete();
  assert.equal(view.confirmDeleteAction, null);
});

test('renderTracks: empty library shows the empty state and centers it', () => {
  resetState({ tracks: [] });
  renderTracks();
  assert.equal(centerEmptyStateMock.mock.callCount(), 1);
});

test('renderTracks: songs mode renders one row per track', () => {
  resetState({ tracks: [fakeTrack('a'), fakeTrack('b')] });
  renderTracks();
  const host = elCache.get('#libBody');
  const ul = host.children.find(c => c && c.className === 'tracklist');
  assert.ok(ul, 'a <ul class="tracklist"> of track rows should have been appended to #libBody');
  assert.equal(ul.children.length, 2);
});

test('renderTracks: crate mode delegates to renderCrate() and skips the songs list', () => {
  resetState({ tracks: [fakeTrack('a')], view: { mode: 'crate', group: null, playlist: null } });
  renderTracks();
  assert.equal(renderCrateMock.mock.callCount(), 1);
});

test('songRow: clicking a row calls setQueue with its own queue/position', () => {
  resetState({ tracks: [fakeTrack('a'), fakeTrack('b')] });
  const q = [0, 1];
  const row = songRow(1, q, 1);
  assert.equal(row.dataset.id, 'b');
  row.fire('click');
  assert.equal(setQueueMock.mock.callCount(), 1);
  assert.deepEqual(setQueueMock.mock.calls[0].arguments, [q, 1, true]);
});

test('groupRow: tapping the row calls the provided onTap', () => {
  resetState({ tracks: [fakeTrack('a')] });
  let tapped = false;
  const row = groupRow('Album', '1 track', [0], () => { tapped = true; });
  row.fire('click');
  assert.equal(tapped, true);
});
