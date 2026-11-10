// LB9 (docs/36A_LIBRARY_AND_LAUNCH.md point 4): the Add to playlist sheet.
// isTrackInPlaylist() is the one pure decision ("already in"), tested
// directly with plain fixtures; the sheet itself (src/library/
// add-to-playlist.js) is tested with a minimal fake DOM, same shape as
// tests/unit/playlist-sheet.test.js's own fakeEl() -- openPlaylistNameSheet
// (library/playlist-sheet.js) and nav-stack's openLayer/closeLayer are
// mocked so this file only exercises add-to-playlist.js's own logic.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

function fakeEl(){
  const listeners = {};
  return {
    children: [], style: {}, dataset: {}, value: '', hidden: false, disabled: false,
    textContent: '', className: '', _html: '',
    get innerHTML(){ return this._html; },
    set innerHTML(v){ this._html = v; this.children = []; },
    classList: {
      add(){}, remove(){}, contains(){ return false; },
    },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    appendChild(c){ this.children.push(c); return c; },
    addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
    dispatch(type, ev = {}){ (listeners[type] || []).forEach(fn => fn(ev)); },
    focus(){},
    listeners,
  };
}
const elCache = new Map();
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ if(!elCache.has(sel)) elCache.set(sel, fakeEl()); return elCache.get(sel); },
    el(tag, cls, text){ const e = fakeEl(); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; },
  },
});

const closeLayerMock = mock.fn();
const openLayerMock = mock.fn();
mock.module(new URL('../../src/shell/nav-stack.js', import.meta.url).href, {
  namedExports: { openLayer: openLayerMock, closeLayer: closeLayerMock },
});
const openPlaylistNameSheetMock = mock.fn(async () => null);
mock.module(new URL('../../src/library/playlist-sheet.js', import.meta.url).href, {
  namedExports: { openPlaylistNameSheet: openPlaylistNameSheetMock },
});

const {
  isTrackInPlaylist, openAddToPlaylistSheet,
} = await import('../../src/library/add-to-playlist.js');
const { S, touchBackupMembership, touchBackupKey } = await import('../../src/state.js');

function fakeTrack(id, overrides){
  return Object.assign({ id, tags: { title: 'Song', artist: 'Prince' } }, overrides);
}

function resetState(overrides){
  Object.assign(S, { playlists: [] }, overrides);
  elCache.clear();
  closeLayerMock.mock.resetCalls();
  openLayerMock.mock.resetCalls();
  openPlaylistNameSheetMock.mock.resetCalls();
}

// ---- isTrackInPlaylist: the pure "already in" decision --------------------

test('isTrackInPlaylist: true once the track id is in the playlist\'s items', () => {
  const pl = { name: 'Road trip', items: ['a', 'b'] };
  assert.equal(isTrackInPlaylist(pl, 'a'), true);
  assert.equal(isTrackInPlaylist(pl, 'z'), false);
});

test('isTrackInPlaylist: false for a null/undefined playlist (never throws)', () => {
  assert.equal(isTrackInPlaylist(null, 'a'), false);
  assert.equal(isTrackInPlaylist(undefined, 'a'), false);
});

// ---- openAddToPlaylistSheet: the sheet's own DOM -------------------------

test('openAddToPlaylistSheet renders the caption and one row per playlist, "New playlist…" first', () => {
  resetState({ playlists: [{ name: 'Road trip', items: [] }, { name: 'Focus', items: [] }] });
  const t = fakeTrack('song1', { tags: { title: 'Kiss', artist: 'Prince' } });
  const mosaicArt = mock.fn(() => fakeEl());
  openAddToPlaylistSheet(t, { mosaicArt, queueSave(){} });

  assert.equal(elCache.get('#addToPlCaption').textContent, 'Kiss · Prince');
  const body = elCache.get('#addToPlBody');
  // "New playlist…" + a divider + one row per playlist
  assert.equal(body.children[0].textContent, 'New playlist…');
  assert.equal(body.children.length, 2 + S.playlists.length);
  assert.equal(mosaicArt.mock.calls.length, S.playlists.length);
});

test('openAddToPlaylistSheet: a playlist already holding the track is disabled and marked "Already in"', () => {
  resetState({ playlists: [{ name: 'Has it', items: ['song1'] }, { name: 'Does not', items: [] }] });
  const t = fakeTrack('song1');
  openAddToPlaylistSheet(t, { mosaicArt: () => fakeEl(), queueSave(){} });
  const body = elCache.get('#addToPlBody');
  const [, , hasItRow, doesNotRow] = body.children;
  assert.equal(hasItRow.disabled, true);
  assert.ok(hasItRow.children.some(c => c.textContent === 'Already in'));
  assert.equal(doesNotRow.disabled, false);
});

test('tapping an eligible playlist row adds the track, closes the sheet and shows the "Added to {name}" toast', () => {
  resetState({ playlists: [{ name: 'Road trip', items: [] }] });
  elCache.set('#plAddToast', fakeEl());
  elCache.set('#plAddToastText', fakeEl());
  const t = fakeTrack('song1');
  const queueSave = mock.fn();
  openAddToPlaylistSheet(t, { mosaicArt: () => fakeEl(), queueSave });
  const body = elCache.get('#addToPlBody');
  const row = body.children[2]; // New playlist…, divider, then the one real playlist
  row.listeners.click[0]();

  assert.deepEqual(S.playlists[0].items, ['song1']);
  assert.equal(queueSave.mock.calls.length, 1);
  assert.equal(closeLayerMock.mock.calls.length, 1);
  assert.equal(elCache.get('#plAddToastText').textContent, 'Added to Road trip');
  assert.equal(elCache.get('#plAddToast').style.display, 'flex');
});

test('tapping "New playlist…" opens the name sheet and, on a name, creates the playlist and adds the track', async () => {
  resetState({ playlists: [] });
  elCache.set('#plAddToast', fakeEl());
  elCache.set('#plAddToastText', fakeEl());
  openPlaylistNameSheetMock.mock.mockImplementationOnce(async () => 'Focus');
  const t = fakeTrack('song1');
  const queueSave = mock.fn();
  openAddToPlaylistSheet(t, { mosaicArt: () => fakeEl(), queueSave });
  const body = elCache.get('#addToPlBody');
  await body.children[0].listeners.click[0]();

  assert.equal(S.playlists.length, 1);
  assert.equal(S.playlists[0].name, 'Focus');
  assert.deepEqual(S.playlists[0].items, ['song1']);
  assert.equal(closeLayerMock.mock.calls.length, 1);
  assert.equal(elCache.get('#plAddToastText').textContent, 'Added to Focus');
});

test('tapping "New playlist…" and closing the name sheet without a name adds nothing', async () => {
  resetState({ playlists: [] });
  openPlaylistNameSheetMock.mock.mockImplementationOnce(async () => null);
  const t = fakeTrack('song1');
  openAddToPlaylistSheet(t, { mosaicArt: () => fakeEl(), queueSave(){} });
  const body = elCache.get('#addToPlBody');
  await body.children[0].listeners.click[0]();

  assert.equal(S.playlists.length, 0);
  assert.equal(closeLayerMock.mock.calls.length, 0);
});

void touchBackupMembership; void touchBackupKey; // real state.js exports, used indirectly via add-to-playlist.js
