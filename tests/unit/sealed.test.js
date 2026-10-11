import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// sealed.js has a temporary circular import back to main.js (rule 8 in
// CLAUDE.md) for the sealed sheet's own UI and the library screen render,
// neither extracted yet — mocked to no-ops rather than pulling in a
// browser.
const updateSealedSheetAfterBreakMock = mock.fn();
const renderTracksMock = mock.fn();
mock.module(new URL('../../src/main.js', import.meta.url).href, {
  namedExports: {
    updateSealedSheetAfterBreak: updateSealedSheetAfterBreakMock,
  },
});
// Since step 7d, sealed.js's renderTracks import is real (from
// src/library/view.js) instead of main.js — mocked directly here, since
// the real view.js would otherwise reach back into library/sealed.js
// itself (a real circular pair) plus favorites.js/credits.js/search.js/
// edit.js/delete.js and crate/view.js's own wide chains.
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: { renderTracks: renderTracksMock },
});
// history/achievements.js's real import chain (via history/sessions.js)
// reaches library/thumbs.js for thumbURL/persistable/restoreThumbs —
// mocked here the same way tags.test.js/credits.test.js do, so thumbs.js's
// own further chain (library/edit.js, which reaches library/sealed.js
// itself and library/credits.js) never has to load.
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { restoreThumbs: async () => {}, thumbURL: {}, persistable(rec){ return rec; } },
});

const {
  isAlbumSealed, breakSeal, restoreSealedAlbums,
} = await import('../../src/library/sealed.js');
const { topAlbums, topTracks } = await import('../../src/history/achievements.js');
const { S } = await import('../../src/state.js');

function resetState(overrides){
  Object.assign(S, {
    sealedRecords: true, sealed: new Set(),
    sessionCounts: {}, albumLastPlayed: {}, albumDisplay: {},
    trackPlayCounts: {}, trackLastPlayed: {}, trackDisplay: {},
  }, overrides);
  updateSealedSheetAfterBreakMock.mock.resetCalls();
  renderTracksMock.mock.resetCalls();
}

test('isAlbumSealed is true right after import (the album id is in S.sealed)', () => {
  resetState({ sealed: new Set(['a1']) });
  assert.equal(isAlbumSealed('a1'), true);
  assert.equal(isAlbumSealed('a2'), false);
});

test('isAlbumSealed is false for every album when the sealed-records feature is off', () => {
  resetState({ sealedRecords: false, sealed: new Set(['a1']) });
  assert.equal(isAlbumSealed('a1'), false);
});

test('breakSeal clears the seal once, updates the sheet and re-renders the library', () => {
  resetState({ sealed: new Set(['a1']) });
  breakSeal('a1');
  assert.equal(isAlbumSealed('a1'), false);
  assert.equal(updateSealedSheetAfterBreakMock.mock.calls.length, 1);
  assert.deepEqual(updateSealedSheetAfterBreakMock.mock.calls[0].arguments, ['a1']);
  assert.equal(renderTracksMock.mock.calls.length, 1);
});

test('breaking an already-broken seal does nothing', () => {
  resetState({ sealed: new Set() });   // a1 was never sealed, or already broken
  breakSeal('a1');
  assert.equal(updateSealedSheetAfterBreakMock.mock.calls.length, 0);
  assert.equal(renderTracksMock.mock.calls.length, 0);
});

test('restoreSealedAlbums grandfathers to "none sealed" when storage has no saved row', async () => {
  // No fake-indexeddb in this file -- without a real `indexedDB` global,
  // DB.ok (src/storage/idb.js) stays false and meta.get() resolves null by
  // design (storage unavailable means every call quietly no-ops), which is
  // the exact case restoreSealedAlbums's own comment calls out: no
  // sealedAlbums row at all means this feature hasn't run here yet, so
  // nothing existing is sealed.
  resetState({ sealed: new Set(['stale']) });
  await restoreSealedAlbums();
  assert.deepEqual([...S.sealed], []);
});

test('topAlbums: orders by session count, ties broken by most recently played', () => {
  resetState({
    sessionCounts: { a1: 2, a2: 5, a3: 5 },
    albumLastPlayed: { a1: 100, a2: 50, a3: 200 },
    albumDisplay: { a1: { name: 'One' }, a2: { name: 'Two' }, a3: { name: 'Three' } },
  });
  const top = topAlbums(2);
  assert.deepEqual(top.map(a => a.albumId), ['a3', 'a2']);   // a3/a2 tie on count, a3 played more recently
});

test('topAlbums: an unknown album id still gets a display fallback', () => {
  resetState({ sessionCounts: { orphan: 1 } });
  const top = topAlbums(1);
  assert.deepEqual(top[0].display, { name: 'orphan', artist: '', art: null });
});

test('topTracks: orders by play count, ties broken by most recently played', () => {
  resetState({
    trackPlayCounts: { t1: 3, t2: 3, t3: 1 },
    trackLastPlayed: { t1: 10, t2: 20, t3: 999 },
    trackDisplay: { t1: { title: 'A' }, t2: { title: 'B' }, t3: { title: 'C' } },
  });
  const top = topTracks(3);
  assert.deepEqual(top.map(t => t.trackKey), ['t2', 't1', 't3']);
});
