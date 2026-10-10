import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// search.js calls real $/el (util/dom.js) and, in a couple of spots, the
// bare `document` global directly (openSortMenu's document.createElement,
// highlightMatches' createDocumentFragment/createTextNode) -- both stubbed
// rather than pulling in a real DOM, same approach as credits.test.js. It
// also has a real import of setQueue from player/queue.js, which pulls in
// queue.js's own main.js/transport.js/clock.js/sleep-timer.js/audio-engine.js
// chain -- all mocked directly here, same as tags.test.js/credits.test.js, on
// top of search.js's own direct main.js imports (queueSave, renderTracks,
// groupRow, songRow) and its real imports of favorites.js/credits.js.
const elCache = new Map();
function fakeEl(){
  const classes = new Set();
  const kids = [];
  return {
    textContent: '', style: {}, innerHTML: '', src: '', alt: '', value: '',
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
    },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, appendChild(child){ kids.push(child); return child; },
    querySelector(){ return fakeEl(); },
    children: kids,
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ if(!elCache.has(sel)) elCache.set(sel, fakeEl()); return elCache.get(sel); },
    el(tag, cls, text){ const e = fakeEl(); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; },
  },
});
globalThis.document = {
  createElement(){ return fakeEl(); },
  createTextNode(text){ return { nodeType: 3, textContent: text }; },
  createDocumentFragment(){ return fakeEl(); },
  activeElement: null,
};

const groupRowMock = mock.fn((label, sub, idx, onTap) => fakeEl());
const songRowMock = mock.fn((i) => fakeEl());
const queueSaveMock = mock.fn();
const renderTracksMock = mock.fn();
mock.module(new URL('../../src/main.js', import.meta.url).href, {
  namedExports: {
    queueSave: queueSaveMock, renderTracks: renderTracksMock,
    groupRow: groupRowMock, songRow: songRowMock,
    runStartSequence(){}, openPlayerViaSheet(){},
    shouldPutAway(){ return false; }, putAwayInstant(){}, runPutAwaySequence(){},
    applyDiscVariant(){}, restoreThumbs: async () => {},
    closePlayer(){}, showRoute(){}, REDUCED: false,
  },
});
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { load(){}, play(){}, pause(){}, seek(){} },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { drawTime(){} },
});
mock.module(new URL('../../src/player/sleep-timer.js', import.meta.url).href, {
  namedExports: { sleepStopPlayback(){} },
});
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { ensureContext(){} },
});
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote(){} },
});

const {
  parseSearchQuery, searchLibrary, librarySortComparator, sortAlbumGroups,
  highlightMatches, renderSearchResults, renderSearchChips, updateSearchChipsVisibility,
} = await import('../../src/library/search.js');
const { S } = await import('../../src/state.js');
const { emptyDetails } = await import('../../src/library/tags/index.js');

function fakeTrack(overrides){
  return {
    id: Math.random().toString(36),
    tags: { title: 'Title', artist: 'Artist', album: 'Album', albumArtist: 'Artist', track: 1, disc: 1 },
    details: emptyDetails(), meta: { codec: 'FLAC', rate: 44100, bits: 16 },
    addedAt: 0,
    ...overrides,
  };
}

function resetState(overrides){
  Object.assign(S, {
    tracks: [], librarySort: 'artist', trackLastPlayed: {}, albumLastPlayed: {},
    sessionCounts: {}, trackPlayCounts: {}, view: { mode: 'albums', group: null, artistAlbum: null },
    albumSort: {}, albumOrder: {}, playlists: [],
  }, overrides);
  elCache.clear();
  groupRowMock.mock.resetCalls();
  songRowMock.mock.resetCalls();
  queueSaveMock.mock.resetCalls();
  renderTracksMock.mock.resetCalls();
}

test('parseSearchQuery splits a known field token from free text', () => {
  const parsed = parseSearchQuery('artist:Prince purple');
  assert.deepEqual(parsed.fields, [{ key: 'artist', value: 'Prince' }]);
  assert.equal(parsed.text, 'purple');
});

test('parseSearchQuery treats an unknown field name as plain text', () => {
  const parsed = parseSearchQuery('notareal:thing rain');
  assert.deepEqual(parsed.fields, []);
  assert.equal(parsed.text, 'notareal:thing rain');
});

test('parseSearchQuery combines multiple fields', () => {
  const parsed = parseSearchQuery('artist:Prince year:1984');
  assert.deepEqual(parsed.fields.map(f => f.key).sort(), ['artist', 'year']);
});

test('searchLibrary: free text matches title, artist and album independently', () => {
  resetState({ tracks: [
    fakeTrack({ tags: { title: 'Purple Rain', artist: 'Prince', album: 'Purple Rain', albumArtist: 'Prince', track:1, disc:1 } }),
    fakeTrack({ tags: { title: 'Kiss', artist: 'Prince', album: 'Parade', albumArtist: 'Prince', track:1, disc:1 } }),
  ] });
  const results = searchLibrary('purple');
  assert.deepEqual(results.songs, [0]);
  assert.deepEqual(results.albums, ['Purple Rain']);
});

test('searchLibrary: artist: field narrows by exact-ish artist match', () => {
  resetState({ tracks: [
    fakeTrack({ tags: { title: 'A', artist: 'Prince', album: 'X', albumArtist: 'Prince', track:1, disc:1 } }),
    fakeTrack({ tags: { title: 'B', artist: 'Madonna', album: 'Y', albumArtist: 'Madonna', track:1, disc:1 } }),
  ] });
  const results = searchLibrary('artist:prince');
  assert.deepEqual(results.songs, [0]);
});

test('searchLibrary: is:favorite smart filter delegates to favorites.js', () => {
  resetState({ tracks: [fakeTrack(), fakeTrack()] });
  // toggle the first track as a favorite via the real playlist shape
  S.playlists.push({ name: 'Favorites', items: [0], system: 'favorites' });
  const results = searchLibrary('is:favorite');
  assert.deepEqual(results.songs, [0]);
});

test('searchLibrary: year: field supports exact, comparison and range tokens', () => {
  resetState({ tracks: [
    fakeTrack({ details: { ...emptyDetails(), year: 1999 } }),
    fakeTrack({ details: { ...emptyDetails(), year: 2010 } }),
  ] });
  assert.deepEqual(searchLibrary('year:1999').songs, [0]);
  assert.deepEqual(searchLibrary('year:>2000').songs, [1]);
  assert.deepEqual(searchLibrary('year:1990-2000').songs, [0]);
});

test('searchLibrary: rate:/bits: fields support numeric comparisons with a k suffix', () => {
  resetState({ tracks: [
    fakeTrack({ meta: { codec: 'FLAC', rate: 44100, bits: 16 } }),
    fakeTrack({ meta: { codec: 'FLAC', rate: 96000, bits: 24 } }),
  ] });
  assert.deepEqual(searchLibrary('rate:>=90k').songs, [1]);
  assert.deepEqual(searchLibrary('bits:16').songs, [0]);
});

test('searchLibrary: an unknown field name is treated as plain text, not a filter', () => {
  resetState({ tracks: [fakeTrack({ tags: { title: 'notareal:thing', artist: 'Artist', album: 'Album', albumArtist: 'Artist', track:1, disc:1 } })] });
  assert.deepEqual(searchLibrary('notareal:thing').songs, [0]);
});

test('searchLibrary: credit: field matches people credited on the track', () => {
  resetState({ tracks: [
    fakeTrack({ details: { ...emptyDetails(), producers: ['Jimmy Jam'] } }),
    fakeTrack(),
  ] });
  assert.deepEqual(searchLibrary('credit:jimmy').songs, [0]);
});

test('librarySortComparator: "added" sorts newest first', () => {
  resetState({ librarySort: 'added', tracks: [fakeTrack({ addedAt: 1 }), fakeTrack({ addedAt: 2 })] });
  const order = [0, 1].sort(librarySortComparator());
  assert.deepEqual(order, [1, 0]);
});

test('librarySortComparator: "sessions" falls back to session counts by album', () => {
  resetState({
    librarySort: 'sessions',
    tracks: [
      fakeTrack({ tags: { title: 'A', artist: 'X', album: 'Alpha', albumArtist: 'X', track:1, disc:1 } }),
      fakeTrack({ tags: { title: 'B', artist: 'X', album: 'Beta', albumArtist: 'X', track:1, disc:1 } }),
    ],
  });
  S.sessionCounts = { alpha: 1, beta: 5 };
  const order = [0, 1].sort(librarySortComparator());
  assert.deepEqual(order, [1, 0]);
});

test('sortAlbumGroups: "album" sorts groups alphabetically by album name', () => {
  resetState({
    librarySort: 'album',
    tracks: [
      fakeTrack({ tags: { title: 'A', artist: 'X', album: 'Zeta', albumArtist: 'X', track:1, disc:1 } }),
      fakeTrack({ tags: { title: 'B', artist: 'X', album: 'Alpha', albumArtist: 'X', track:1, disc:1 } }),
    ],
  });
  const groups = sortAlbumGroups([['Zeta', [0]], ['Alpha', [1]]]);
  assert.deepEqual(groups.map(g => g[0]), ['Alpha', 'Zeta']);
});

test('highlightMatches wraps a case-insensitive match and leaves the rest as plain text nodes', () => {
  const frag = highlightMatches('Purple Rain', 'rain');
  assert.equal(frag.children.length, 2);   // "Purple " text node + <mark>Rain</mark>
});

test('renderSearchResults shows a "no matches" note when nothing matches', () => {
  resetState({ tracks: [fakeTrack()] });
  const host = fakeEl();
  renderSearchResults(host, 'zzzznomatch');
  assert.match(host.children[0].textContent, /No matches/);
});

test('renderSearchResults groups song results and calls songRow for each', () => {
  resetState({ tracks: [fakeTrack({ tags: { title: 'Purple Rain', artist: 'Prince', album: 'Purple Rain', albumArtist: 'Prince', track:1, disc:1 } })] });
  const host = fakeEl();
  renderSearchResults(host, 'purple');
  assert.equal(songRowMock.mock.calls.length, 1);
});

test('renderSearchChips renders a chip per field key and smart filter', () => {
  resetState({ tracks: [fakeTrack()] });
  renderSearchChips();
  const host = elCache.get('#searchChips');
  assert.ok(host.children.length > 0);
});

test('updateSearchChipsVisibility hides chips once the search box has text', () => {
  resetState({ tracks: [fakeTrack()] });
  elCache.set('#librarySearch', fakeEl());
  elCache.set('#searchChips', fakeEl());
  const input = elCache.get('#librarySearch');
  const chips = elCache.get('#searchChips');
  input.value = 'something';
  globalThis.document.activeElement = input;
  updateSearchChipsVisibility();
  assert.equal(chips.style.display, 'none');
});
