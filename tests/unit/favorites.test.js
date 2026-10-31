import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// favorites.js calls $('#playerFavBtn') (util/dom.js) for
// updateFavoriteButtons()'s own display/label update -- FS5
// (docs/25_FROM_SCRATCH.md point 1) moved this from a standalone heart
// button into an overflow-menu-row text label, dropping the old "pop"
// animation along with it (the menu closes on click before it could ever
// play) -- #miniFavBtn was dropped earlier still (RF8, docs/12_REFINE.md:
// the mini-player no longer has its own favorite button, since the
// player already has one) -- and renderTracks/REDUCED
// (circular, rule 8) from main.js -- both mocked to tiny stubs rather than
// pulling in a real `document`, same approach as edit.test.js/delete.test.js.
// Since step 7a, favorites.js's own queueSave import is real (from
// storage/meta.js) instead of main.js -- mocked directly below, since
// meta.js's own real imports (audio/mode.js/engine.js, sundown/location.js,
// player/controls.js, player/background.js, for applyPrefs()) would
// otherwise reach wide chains (e.g. history/sessions.js -> library/thumbs.js
// -> library/edit.js -> library/sealed.js's own circular main.js import)
// this file never needed to stop at the door before.
function fakeEl(){
  const classes = new Set();
  const attrs = {};
  return {
    offsetWidth: 0, style: {}, value: '',
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
    },
    setAttribute(k, v){ attrs[k] = v; }, getAttribute(k){ return attrs[k]; }, textContent: '',
  };
}
// NV3 (docs/11_SMOOTH_NAVIGATION.md): #librarySearch's own fake element is
// shared (not a fresh one per call), so a test can set .value on it to
// exercise libraryShowsFavoriteMembership()'s "is:favorite" branch.
const librarySearchEl = fakeEl();
// FS5 (docs/25_FROM_SCRATCH.md point 1): #playerFavBtn is shared the same
// way, so a test can read back the label updateFavoriteButtons() wrote.
const playerFavBtnEl = fakeEl();
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){
      if(sel === '#librarySearch') return librarySearchEl;
      if(sel === '#playerFavBtn') return playerFavBtnEl;
      return fakeEl();
    },
    el(){ return fakeEl(); },
  },
});
const queueSaveMock = mock.fn();
const renderTracksMock = mock.fn();
// Since step 7d, favorites.js's renderTracks import is real (from
// src/library/view.js) instead of main.js -- mocked directly here, same
// "stop the chain at the door" reasoning as the rest of this file, since
// the real view.js would otherwise reach library/credits.js/search.js/
// sealed.js/edit.js/delete.js and crate/view.js's own wide chains.
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: { renderTracks: renderTracksMock },
});
// Since step 7b, favorites.js's REDUCED import moved off main.js into the
// real src/util/motion.js — mocked there directly instead.
mock.module(new URL('../../src/util/motion.js', import.meta.url).href, {
  namedExports: { REDUCED: false },
});
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave: queueSaveMock, touchBackupField(){} },
});

const { isFavorite, toggleFavorite, updateFavoriteButtons } = await import('../../src/library/favorites.js');
const { S } = await import('../../src/state.js');

function resetState(overrides){
  Object.assign(S, {
    tracks: [
      { id: 'a', tags: { title: 'A' } },
      { id: 'b', tags: { title: 'B' } },
      { id: 'c', tags: { title: 'C' } },
    ],
    index: -1, playlists: [],
    view: { mode: 'songs', group: null, artistAlbum: null, playlist: null, person: null, personReturn: null,
      picking: false, editSelecting: false, crateLooseIdx: null, crateLooseArtist: null },
  }, overrides);
  librarySearchEl.value = '';
  queueSaveMock.mock.resetCalls();
  renderTracksMock.mock.resetCalls();
}

test('isFavorite is false when no favorites playlist exists yet', () => {
  resetState();
  assert.equal(isFavorite('a'), false);
});

test('toggleFavorite creates the system favorites playlist on first use', () => {
  resetState();
  toggleFavorite('a');
  const pl = S.playlists.find(p => p.system === 'favorites');
  assert.ok(pl);
  assert.equal(pl.name, 'Favorites');
  assert.ok(isFavorite('a'));
  assert.equal(isFavorite('b'), false);
});

test('toggleFavorite a second time removes it again', () => {
  resetState();
  toggleFavorite('a');
  assert.ok(isFavorite('a'));
  toggleFavorite('a');
  assert.equal(isFavorite('a'), false);
});

test('toggleFavorite adopts an existing user playlist literally named "Favorites" rather than duplicating it', () => {
  resetState({ playlists: [{ name: 'Favorites', items: [], system: undefined }] });
  toggleFavorite('a');
  assert.equal(S.playlists.length, 1);
  assert.equal(S.playlists[0].system, 'favorites');
  assert.ok(isFavorite('a'));
});

// NV3 (docs/11_SMOOTH_NAVIGATION.md): songRow() never shows favorite status
// at all, so toggling it only re-renders the library when the visible
// list's own membership actually depends on favorite status — the
// Favorites playlist itself, or an active "is:favorite" search. Every
// other view (the common case) always saves, but skips the render outright.
test('toggleFavorite always persists; only re-renders when the visible list depends on favorite status', () => {
  resetState();
  toggleFavorite('b');
  assert.equal(queueSaveMock.mock.calls.length, 1);
  assert.equal(renderTracksMock.mock.calls.length, 0, 'Songs view never shows favorite status -- no render needed');

  resetState({ playlists: [{ name: 'Favorites', items: [], system: 'favorites' }], view: { playlist: 0 } });
  toggleFavorite('b');
  assert.equal(renderTracksMock.mock.calls.length, 1, 'viewing the Favorites playlist itself does need a render');

  resetState();
  librarySearchEl.value = 'is:favorite';
  toggleFavorite('b');
  assert.equal(renderTracksMock.mock.calls.length, 1, 'an active is:favorite search does need a render');
});

test('toggleFavorite on an id not currently in the library still favorites it (F3 spec: reconnects later)', () => {
  resetState();
  toggleFavorite('missing');
  // playlist items are track ids now, not positions (step 02) -- favoriting
  // a track whose file isn't in the library this session (e.g. it was
  // forgotten, not deleted) still records the id; it just renders hidden
  // until a matching file is imported again
  assert.ok(isFavorite('missing'));
  const pl = S.playlists.find(p => p.system === 'favorites');
  assert.ok(pl);
  assert.deepEqual(pl.items, ['missing']);
});

// Playlist items (including favorites) are track ids, not positions (F3
// spec, step 02) -- there's no index lookup left in this module at all.
test('isFavorite reads S.playlists by track id directly', () => {
  resetState();
  toggleFavorite('b');
  assert.ok(isFavorite('b'));
  assert.equal(isFavorite('a'), false);
});

test('updateFavoriteButtons reflects favorite state for the current track', () => {
  resetState({ index: 0 });
  assert.equal(isFavorite('a'), false);
  updateFavoriteButtons();
  assert.equal(playerFavBtnEl.getAttribute('aria-pressed'), 'false');
  assert.equal(playerFavBtnEl.textContent, '♡ Favorite');
  toggleFavorite('a');
  updateFavoriteButtons();
  assert.equal(playerFavBtnEl.getAttribute('aria-pressed'), 'true');
  // FS5 (docs/25_FROM_SCRATCH.md point 1): a real label now, not a bare
  // glyph -- the menu row this moved into needs text, not an icon alone.
  assert.equal(playerFavBtnEl.textContent, '♥ Favorite');
});
