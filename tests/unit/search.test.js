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
  const listeners = {};
  return {
    textContent: '', style: {}, innerHTML: '', src: '', alt: '', value: '', dataset: {},
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
    },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    addEventListener(type, fn){ (listeners[type] ||= []).push(fn); },
    appendChild(child){ kids.push(child); return child; },
    querySelector(){ return fakeEl(); },
    querySelectorAll(){ return []; },
    children: kids, listeners,
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

const groupRowMock = mock.fn((_label, _sub, _idx, _onTap) => fakeEl());
const songRowMock = mock.fn((_i) => fakeEl());
const artistRowMock = mock.fn((_artist, _idx, _onTap) => fakeEl());
const playlistMosaicArtMock = mock.fn((_pl, _present) => fakeEl());
const queueSaveMock = mock.fn();
const renderTracksMock = mock.fn();
const openAlbumFromLibraryMock = mock.fn();
// Since step 7d, search.js's renderTracks/groupRow/songRow imports are
// real (from src/library/view.js) instead of main.js — mocked directly
// here, same "stop the chain at the door" reasoning as the rest of this
// file, since the real view.js would otherwise reach back into
// library/search.js itself (a real circular pair) plus favorites.js/
// credits.js/sealed.js/edit.js/delete.js and crate/view.js's own wide
// chains. LB9 adds artistRow/playlistMosaicArt to that same real-import/
// mocked-here pair, for the Artists/Playlists result rows.
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: {
    renderTracks: renderTracksMock,
    groupRow: groupRowMock, songRow: songRowMock, artistRow: artistRowMock,
    playlistMosaicArt: playlistMosaicArtMock,
    openAlbumFromLibrary: openAlbumFromLibraryMock,
  },
});
// Since step 7b, favorites.js's REDUCED, credits.js's closePlayer/showRoute
// and queue.js's runStartSequence/openPlayerViaSheet/shouldPutAway/
// putAwayInstant/runPutAwaySequence all moved off main.js into real
// src/shell/ (or src/util/motion.js) modules — mocked there directly
// instead, same "stop the chain at the door" reasoning as the rest of
// this file's comments.
mock.module(new URL('../../src/util/motion.js', import.meta.url).href, {
  namedExports: { REDUCED: false },
});
mock.module(new URL('../../src/shell/player-overlay.js', import.meta.url).href, {
  namedExports: { closePlayer(){}, openPlayerViaSheet(){}, wakeEveningGlance(){} },
});
mock.module(new URL('../../src/shell/routes.js', import.meta.url).href, {
  namedExports: { showRoute(){} },
});
mock.module(new URL('../../src/shell/start-sequence.js', import.meta.url).href, {
  namedExports: { runStartSequence(){} },
});
// CEREMONY PR 3: player/queue.js and shell/start-sequence.js import
// shell/runout.js, whose real chain reaches library/view.js — stop it here.
mock.module(new URL('../../src/shell/runout.js', import.meta.url).href, {
  namedExports: { endOfQueue(){}, maybeSideFlip(){ return false; }, cancelRunout(){}, interruptRunout(){ return false; }, clearToRest(){}, performPendingFlip(){ return false; }, stopAtRecordEndCeremony(){} },
});
mock.module(new URL('../../src/shell/put-away.js', import.meta.url).href, {
  namedExports: { shouldPutAway(){ return false; }, putAwayInstant(){}, runPutAwaySequence(){} },
});
// Since step 7a, search.js's own queueSave import is real (from
// storage/meta.js) instead of main.js — mocked directly here, same "stop
// the chain at the door" reasoning as the rest of this file.
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave: queueSaveMock, touchBackupField(){} },
});
// applyDiscVariant/restoreThumbs are real imports from looks.js/thumbs.js
// now (step 6b, reached via the real history/sessions.js the setQueue
// chain below pulls in) — mocked on their own modules so neither's
// further real chain (thumbs.js reaches library/edit.js, which reaches
// library/sealed.js) has to load.
mock.module(new URL('../../src/record-art/looks.js', import.meta.url).href, {
  namedExports: { applyDiscVariant(){} },
});
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { restoreThumbs: async () => {}, persistable(rec){ return rec; } },
});
// RF23 (docs/12_REFINE.md): credits.js's new, one-directional import of
// openFriendStore (social/screens/friend-store.js) would otherwise reach
// that module's own real chain (profile/storefront.js and everything past
// it) via search.js's own real credits.js import — stopped at that new
// edge, the same way tests/unit/credits.test.js does.
mock.module(new URL('../../src/social/screens/friend-store.js', import.meta.url).href, {
  namedExports: { openFriendStore(){} },
});
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { load(){}, play(){}, pause(){}, pauseAndRest(){}, seek(){}, sideLetterFor(){ return ''; }, cancelPendingGapless(){} },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { drawTime(){}, updateFocusStatusLine(){} },
});
mock.module(new URL('../../src/player/sleep-timer.js', import.meta.url).href, {
  namedExports: { sleepStopPlayback(){} },
});
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { ensureContext(){}, decodeAudioFile: async () => {} },
});
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote(){} },
});

const {
  parseSearchQuery, searchLibrary, librarySortComparator, sortAlbumGroups,
  highlightMatches, renderSearchResults, renderSearchFilters, updateSearchChipsVisibility,
  resultsForFilter, searchHintText, pickTopResult, getSearchFilter, setSearchFilter, resetSearchFilter,
  SEARCH_TYPE_FILTERS,
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
  artistRowMock.mock.resetCalls();
  playlistMosaicArtMock.mock.resetCalls();
  queueSaveMock.mock.resetCalls();
  renderTracksMock.mock.resetCalls();
  resetSearchFilter();
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
  const first = fakeTrack();
  resetState({ tracks: [first, fakeTrack()] });
  // playlist items are track ids, not positions (F3 spec, step 02) —
  // favorite the first track via the real playlist shape
  S.playlists.push({ name: 'Favorites', items: [first.id], system: 'favorites' });
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
  const wrap = host.children[0];
  assert.match(wrap.children[0].textContent, /Nothing in your library matches "zzzznomatch"/);
});

test('renderSearchResults groups song results and calls songRow for each', () => {
  resetState({ tracks: [fakeTrack({ tags: { title: 'Purple Rain', artist: 'Prince', album: 'Purple Rain', albumArtist: 'Prince', track:1, disc:1 } })] });
  const host = fakeEl();
  renderSearchResults(host, 'purple');
  assert.equal(songRowMock.mock.calls.length, 1);
});

// LB9 point 3: artists/playlists get their own row renderers (round
// photo / mosaic), reused from library/view.js rather than rebuilt here.
test('renderSearchResults calls artistRow for an artist match and playlistMosaicArt for a playlist match', () => {
  resetState({
    tracks: [fakeTrack({ tags: { title: 'Song', artist: 'Theo', album: 'X', albumArtist: 'Theo', track:1, disc:1 } })],
    playlists: [{ name: 'Theo faves', items: [] }],
  });
  const host = fakeEl();
  renderSearchResults(host, 'theo');
  assert.equal(artistRowMock.mock.calls.length, 1);
  assert.equal(playlistMosaicArtMock.mock.calls.length, 1);
});

// decision 14: "the typed syntax still works when typed" -- a field-only
// query never matches a playlist by name (LB9's own judgment call, see
// search.js's searchLibrary() comment).
test('searchLibrary: a plain-text query matches a playlist by name; a field: query never does', () => {
  resetState({
    tracks: [fakeTrack({ tags: { title: 'Song', artist: 'Prince', album: 'X', albumArtist: 'Prince', track:1, disc:1 } })],
    playlists: [{ name: 'Road trip', items: [] }],
  });
  assert.deepEqual(searchLibrary('road').playlists, [0]);
  assert.deepEqual(searchLibrary('artist:prince').playlists, []);
});

// ---- LB9 point 2: the type filter chips + the field-syntax hint line ----

test('SEARCH_TYPE_FILTERS lists All first, then the four real types', () => {
  assert.deepEqual(SEARCH_TYPE_FILTERS.map(f => f.key), ['all', 'songs', 'albums', 'artists', 'playlists']);
});

test('getSearchFilter/setSearchFilter/resetSearchFilter track the active type filter', () => {
  assert.equal(getSearchFilter(), 'all');
  setSearchFilter('artists');
  assert.equal(getSearchFilter(), 'artists');
  resetSearchFilter();
  assert.equal(getSearchFilter(), 'all');
});

test('resultsForFilter picks out one type\'s own list, and null for "all"', () => {
  const results = { songs: [1], albums: ['A'], artists: ['B'], playlists: [2] };
  assert.deepEqual(resultsForFilter(results, 'songs'), [1]);
  assert.deepEqual(resultsForFilter(results, 'playlists'), [2]);
  assert.equal(resultsForFilter(results, 'all'), null);
});

test('searchHintText: null with no fields, "Searching key: value" joined by ", " with fields', () => {
  assert.equal(searchHintText([]), null);
  assert.equal(searchHintText([{ key: 'artist', value: 'Theo' }]), 'Searching artist: Theo');
  assert.equal(
    searchHintText([{ key: 'artist', value: 'Theo' }, { key: 'year', value: '1984' }]),
    'Searching artist: Theo, year: 1984',
  );
});

test('renderSearchFilters renders one chip per type filter', () => {
  resetState({ tracks: [fakeTrack()] });
  renderSearchFilters();
  const host = elCache.get('#searchChips');
  assert.equal(host.children.length, SEARCH_TYPE_FILTERS.length);
});

test('tapping a filter chip switches the active filter and re-renders', () => {
  resetState({ tracks: [fakeTrack()] });
  renderSearchFilters();
  const host = elCache.get('#searchChips');
  const artistsChip = host.children.find(c => c.textContent === 'Artists');
  artistsChip.listeners.click[0]();
  assert.equal(getSearchFilter(), 'artists');
  assert.equal(renderTracksMock.mock.calls.length, 1);
});

// chips (and the hint line) are hidden until the field has text, same
// gating RF8's old field-key chips used.
test('updateSearchChipsVisibility shows chips once the search box has text, hides them (and the hint) when empty', () => {
  resetState({ tracks: [fakeTrack()] });
  elCache.set('#librarySearch', fakeEl());
  elCache.set('#searchChips', fakeEl());
  elCache.set('#searchHint', fakeEl());
  const input = elCache.get('#librarySearch');
  const chips = elCache.get('#searchChips');
  const hint = elCache.get('#searchHint');

  input.value = '';
  updateSearchChipsVisibility();
  assert.equal(chips.style.display, 'none');
  assert.equal(hint.style.display, 'none');

  input.value = 'something';
  updateSearchChipsVisibility();
  assert.equal(chips.style.display, 'flex');

  input.value = '';
  updateSearchChipsVisibility();
  assert.equal(chips.style.display, 'none');
});

// ---- LB9: "Top result" selection ----------------------------------------

function lookup(type, item){
  if(type === 'songs') return { 1: 'Purple Rain', 2: 'Kiss' }[item];
  if(type === 'playlists') return { 0: 'Road trip' }[item];
  return item;
}

test('pickTopResult: null with no text query (a field-only search has no Top result)', () => {
  assert.equal(pickTopResult({ albums: ['A'], artists: [], playlists: [], songs: [] }, '', lookup), null);
});

test('pickTopResult: an exact match wins outright, even over a higher-priority type\'s own partial match', () => {
  const results = { albums: ['Purple Rainstorm'], artists: ['Prince'], playlists: [], songs: [1] };
  // "Prince" is an exact artist match; "Purple Rainstorm" only partially
  // matches "purple" and would otherwise win on type priority alone.
  const top = pickTopResult(results, 'Prince', lookup);
  assert.deepEqual(top, { type: 'artists', ref: 'Prince' });
});

test('pickTopResult: falls back to the highest-priority non-empty type (albums, artists, playlists, songs)', () => {
  assert.deepEqual(
    pickTopResult({ albums: [], artists: ['Prince'], playlists: [0], songs: [1] }, 'x', lookup),
    { type: 'artists', ref: 'Prince' },
  );
  assert.deepEqual(
    pickTopResult({ albums: [], artists: [], playlists: [0], songs: [1] }, 'x', lookup),
    { type: 'playlists', ref: 0 },
  );
  assert.deepEqual(
    pickTopResult({ albums: [], artists: [], playlists: [], songs: [1] }, 'x', lookup),
    { type: 'songs', ref: 1 },
  );
});

test('pickTopResult: null when every category is empty', () => {
  assert.equal(pickTopResult({ albums: [], artists: [], playlists: [], songs: [] }, 'x', lookup), null);
});
