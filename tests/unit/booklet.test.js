// GF10 (docs/29_GATEFOLD.md): booklet-page detection at import (pure) and
// the small artwork-store CRUD over the pages themselves.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// addBookletPages()/bookletPages() go through storage/repo.js's artwork
// store (real IndexedDB) and history/sessions.js's persistAlbumBookletPages
// (meta store) -- both mocked to in-memory stand-ins, the same "stop the
// chain at the door" reasoning tests/unit/gatefold-back-cover.test.js
// already uses for the sibling back-cover artwork rows.
const artworkStore = new Map();
mock.module(new URL('../../src/storage/repo.js', import.meta.url).href, {
  namedExports: {
    artwork: {
      get(id){ return Promise.resolve(artworkStore.get(id) || null); },
      put(rec){ artworkStore.set(rec.id, rec); return Promise.resolve(); },
    },
  },
});
const persistCalls = [];
mock.module(new URL('../../src/history/sessions.js', import.meta.url).href, {
  namedExports: { persistAlbumBookletPages(){ persistCalls.push(1); return Promise.resolve(); } },
});

const {
  isBookletPageCandidate, groupBookletCandidatesByAlbumFolder,
  bookletPageArtworkId, bookletPageCount, bookletPages, addBookletPages,
} = await import('../../src/library/booklet.js');
const { S } = await import('../../src/state.js');

function resetAll(){
  artworkStore.clear();
  persistCalls.length = 0;
  S.albumBookletPages = {};
}

test('isBookletPageCandidate: a booklet/scans/artwork subfolder beside the audio matches', () => {
  resetAll();
  assert.equal(isBookletPageCandidate('scan1.jpg', 'Low Tide Hymnal/booklet/scan1.jpg'), true);
  assert.equal(isBookletPageCandidate('02.png', 'Low Tide Hymnal/scans/02.png'), true);
  assert.equal(isBookletPageCandidate('cover.webp', 'Low Tide Hymnal/artwork/cover.webp'), true);
});

test('isBookletPageCandidate: a booklet-prefixed name matches with or without folder info', () => {
  resetAll();
  assert.equal(isBookletPageCandidate('booklet-01.jpg', 'Low Tide Hymnal/booklet-01.jpg'), true);
  assert.equal(isBookletPageCandidate('BOOKLET_02.PNG', ''), true);   // case-insensitive, flat pick
});

test('isBookletPageCandidate: an unrelated image or any audio/other file never matches', () => {
  resetAll();
  assert.equal(isBookletPageCandidate('cover.jpg', 'Low Tide Hymnal/cover.jpg'), false);
  assert.equal(isBookletPageCandidate('scan1.jpg', 'Low Tide Hymnal/liner/scan1.jpg'), false);
  assert.equal(isBookletPageCandidate('track01.flac', 'Low Tide Hymnal/booklet/track01.flac'), false);
});

test('groupBookletCandidatesByAlbumFolder: groups by the album folder and sorts each group by name', () => {
  resetAll();
  const groups = groupBookletCandidatesByAlbumFolder([
    { name: 'b.jpg', relativePath: 'Album A/booklet/b.jpg' },
    { name: 'a.jpg', relativePath: 'Album A/booklet/a.jpg' },
    { name: 'booklet-02.jpg', relativePath: 'Album B/booklet-02.jpg' },
    { name: 'booklet-01.jpg', relativePath: 'Album B/booklet-01.jpg' },
  ]);
  assert.deepEqual([...groups.keys()].sort(), ['Album A', 'Album B']);
  assert.deepEqual(groups.get('Album A').map(c => c.name), ['a.jpg', 'b.jpg']);
  assert.deepEqual(groups.get('Album B').map(c => c.name), ['booklet-01.jpg', 'booklet-02.jpg']);
});

test('bookletPageArtworkId: zero-padded so lexical and numeric order agree', () => {
  resetAll();
  assert.equal(bookletPageArtworkId('al1', 0), 'booklet:al1:0000');
  assert.equal(bookletPageArtworkId('al1', 12), 'booklet:al1:0012');
});

test('addBookletPages then bookletPages: stores in order, appends after existing pages', async () => {
  resetAll();
  await addBookletPages('al1', ['blobA', 'blobB']);
  assert.equal(bookletPageCount('al1'), 2);
  assert.equal(persistCalls.length, 1);
  let pages = await bookletPages('al1');
  assert.deepEqual(pages.map(p => p.blob), ['blobA', 'blobB']);

  await addBookletPages('al1', ['blobC']);
  assert.equal(bookletPageCount('al1'), 3);
  pages = await bookletPages('al1');
  assert.deepEqual(pages.map(p => p.blob), ['blobA', 'blobB', 'blobC']);
});

test('addBookletPages: a no-op call (no blobs) never touches the count or persists', async () => {
  resetAll();
  await addBookletPages('al1', []);
  assert.equal(bookletPageCount('al1'), 0);
  assert.equal(persistCalls.length, 0);
});
