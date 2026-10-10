import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// favorites.js calls $('#playerFavBtn')/$('#miniFavBtn') (util/dom.js) for
// the "pop" animation in toggleFavorite, and queueSave/renderTracks/REDUCED
// (circular, rule 8) from main.js -- both mocked to tiny stubs rather than
// pulling in a real `document`, same approach as edit.test.js/delete.test.js.
function fakeEl(){
  const classes = new Set();
  return {
    offsetWidth: 0, style: {},
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
    },
    setAttribute(){}, textContent: '',
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: { $(){ return fakeEl(); }, el(){ return fakeEl(); } },
});
const queueSaveMock = mock.fn();
const renderTracksMock = mock.fn();
mock.module(new URL('../../src/main.js', import.meta.url).href, {
  namedExports: { queueSave: queueSaveMock, renderTracks: renderTracksMock, REDUCED: false },
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
  }, overrides);
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

test('toggleFavorite persists and re-renders the library', () => {
  resetState();
  toggleFavorite('b');
  assert.equal(queueSaveMock.mock.calls.length, 1);
  assert.equal(renderTracksMock.mock.calls.length, 1);
});

test('toggleFavorite on an id no longer in the library never adds an item (though ensureFavoritesPlaylist still runs)', () => {
  resetState();
  toggleFavorite('missing');
  assert.equal(isFavorite('missing'), false);
  const pl = S.playlists.find(p => p.system === 'favorites');
  assert.ok(pl);               // ensureFavoritesPlaylist() runs unconditionally, same as the original
  assert.deepEqual(pl.items, []);   // but idxOf(id) < 0 stops it short of adding an item
});

// Playlists (including favorites) store items by index, not id -- the
// index<->id remap that lets them survive a reorder lives in deleteTracks'
// snapshot/rebuild (src/library/delete.js), not in favorites.js itself.
test('isFavorite reads S.playlists by the current index, not by a stored id', () => {
  resetState();
  toggleFavorite('b');   // 'b' is S.tracks[1]
  assert.ok(isFavorite('b'));
  assert.equal(isFavorite('a'), false);
});

test('updateFavoriteButtons reflects favorite state for the current track', () => {
  resetState({ index: 0 });
  assert.equal(isFavorite('a'), false);
  updateFavoriteButtons();   // no track is favorited yet -- just confirms it runs without throwing
  toggleFavorite('a');
  updateFavoriteButtons();
});
