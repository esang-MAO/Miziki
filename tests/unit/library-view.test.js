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
// NV3 (docs/11_SMOOTH_NAVIGATION.md): matches() and queryAll() below make
// querySelector/querySelectorAll real (searching the fake tree rather than
// always returning a fresh unrelated element) -- needed for updateTrackRow()
// and renderTracks()'s own anchor-preserving wrapper to find an existing
// row by its own data-id and patch its real children, same as the browser.
// The existing tests above this never relied on querySelector's result, so
// this is additive, not a behavior change for them.
function matches(elm, sel){
  let m = sel.match(/^([a-zA-Z]*)\[data-id="([^"]*)"\]$/);
  if(m) return (!m[1] || elm.tagName === m[1].toUpperCase()) && !!elm.dataset && elm.dataset.id === m[2];
  m = sel.match(/^([a-zA-Z]*)\[data-id\]$/);
  if(m) return (!m[1] || elm.tagName === m[1].toUpperCase()) && !!elm.dataset && elm.dataset.id !== undefined;
  if(sel.startsWith('.')) return !!(elm.classList && elm.classList.contains(sel.slice(1)));
  return elm.tagName === sel.toUpperCase();
}
function queryAll(root, sel){
  const out = [];
  (function walk(node){
    (node.children || []).forEach(child => {
      if(matches(child, sel)) out.push(child);
      walk(child);
    });
  })(root);
  return out;
}
const focusCalls = [];
function fakeEl(tag){
  const classes = new Set();
  const kids = [];
  const listeners = {};
  const attrs = {};
  const node = {
    tagName: (tag || 'div').toUpperCase(),
    textContent: '', style: {}, src: '', alt: '', value: '', dataset: {}, parent: null,
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      toggle(c, on){ if(on === undefined) on = !classes.has(c); if(on) classes.add(c); else classes.delete(c); },
      contains(c){ return classes.has(c); },
    },
    setAttribute(name, val){ attrs[name] = String(val); },
    removeAttribute(name){ delete attrs[name]; },
    getAttribute(name){ return name in attrs ? attrs[name] : null; },
    addEventListener(type, fn){ listeners[type] = fn; },
    fire(type, ev){ if(listeners[type]) listeners[type](ev || {}); },
    appendChild(child){ child.parent = node; kids.push(child); return child; },
    replaceWith(next){
      if(!node.parent) return;
      const i = node.parent.children.indexOf(node);
      if(i >= 0) node.parent.children[i] = next;
      next.parent = node.parent;
    },
    querySelector(sel){ return queryAll(node, sel)[0] || null; },
    querySelectorAll(sel){ return queryAll(node, sel); },
    contains(other){
      let n = other;
      while(n){ if(n === node) return true; n = n.parent; }
      return false;
    },
    children: kids,
    // NV3: position derives from the row's own index among its siblings --
    // enough to simulate "this row moved because the list above it
    // changed" without a real layout engine. Every row's bottom is > 0
    // (same as a real row that's at least partially on screen), so
    // captureScrollAnchor()'s "first visible row" search always lands on
    // whichever row is first in its list, same as a real freshly-opened tab.
    getBoundingClientRect(){
      const top = (node.parent && node.parent.children) ? node.parent.children.indexOf(node) * 50 : 0;
      return { top, bottom: top + 1 };
    },
    focus(){ focusCalls.push(node); },
  };
  // real DOM semantics for `el.innerHTML = ''`: clears the children this
  // fake tree actually tracks, since updateTrackRow() (library/view.js)
  // relies on that to replace a row's own name content in place.
  Object.defineProperty(node, 'innerHTML', {
    get(){ return kids.length ? '…' : ''; },
    set(v){ if(v === '') kids.length = 0; },
  });
  return node;
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ if(!elCache.has(sel)) elCache.set(sel, fakeEl()); return elCache.get(sel); },
    el(tag, cls, text){
      const e = fakeEl(tag);
      if(cls){ e.className = cls; cls.split(/\s+/).forEach(c => c && e.classList.add(c)); }
      if(text !== undefined) e.textContent = text;
      return e;
    },
  },
});
// Ken, 2026-10-22: the Library scroll lock -- renderTracks() now also calls
// updateLibBodyInset() (this same module), which reads
// document.getElementById('#route-library') to confirm the Library route
// is actually on screen before touching #libBody's own style. Not "on" by
// default, the same "not the active route" default every other test here
// already assumes, so updateLibBodyInset() is a no-op unless a test
// explicitly marks the route as on.
const routeLibraryEl = fakeEl('route-library');
globalThis.document = {
  querySelectorAll(){ return []; },
  activeElement: null,
  documentElement: fakeEl('html'),
  getElementById(id){ return id === 'route-library' ? routeLibraryEl : null; },
};
globalThis.getComputedStyle = () => ({ getPropertyValue(){ return ''; } });
// NV3: captureScrollAnchor()/restoreScrollAnchor() (library/view.js) read
// window.scrollBy -- a mock.fn so a test can assert on it.
const scrollByMock = mock.fn();
globalThis.window = { scrollBy: scrollByMock, scrollTo(){}, innerHeight: 800 };

const setQueueMock = mock.fn();
const playNextMock = mock.fn();
const addToQueueMock = mock.fn();
mock.module(new URL('../../src/player/queue.js', import.meta.url).href, {
  // LI6 (docs/35_LEAD_IN.md): view.js's syncQueueOrder() now also calls
  // setQueueList()/setQpos() — not exercised by any test in this file, so
  // no-op stubs are enough just to satisfy the static import.
  // UN3 (docs/36_UNIFORMITY.md): the row menu's own Play next/Add to
  // queue actions now call these directly (library/view.js), instead of
  // src/wiring/library-view.js wiring per-id buttons.
  namedExports: {
    setQueue: setQueueMock, setQueueList(){}, setQpos(){},
    playNext: playNextMock, addToQueue: addToQueueMock,
  },
});
const openCreditsSheetMock = mock.fn();
mock.module(new URL('../../src/library/credits.js', import.meta.url).href, {
  namedExports: {
    trackHasCreditsContent(){ return false; }, albumLinerNotes(){ return ''; },
    albumCreditRoll(){ return new Map(); }, creditRow(){ return fakeEl(); },
    renderPersonView(){},
    // library/connected.js (the artist page's Connected shelf) imports these
    isLibraryArtist(){ return false; }, openPersonOrArtist(){},
    // UN3: the row menu's own "Credits and notes" item
    openCreditsSheet: openCreditsSheetMock,
  },
});
const toggleFavoriteMock = mock.fn();
mock.module(new URL('../../src/library/favorites.js', import.meta.url).href, {
  namedExports: { isFavorite(){ return false; }, toggleFavorite: toggleFavoriteMock },
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
const openEditSheetMock = mock.fn();
mock.module(new URL('../../src/library/edit.js', import.meta.url).href, {
  namedExports: {
    applyEdit: applyEditMock, showUndoBanner: showUndoBannerMock,
    // UN3 (docs/36_UNIFORMITY.md): the row menu's own "Edit info" item
    openEditSheet: openEditSheetMock,
  },
});
const deleteTracksMock = mock.fn(async () => {});
mock.module(new URL('../../src/library/delete.js', import.meta.url).href, {
  namedExports: {
    countForAlbum(){ return 0; }, countForArtist(){ return 0; },
    deleteAlbum(){}, deleteArtist(){},
    // UN3: the row menu's own "Remove from library…" item
    deleteTracks: deleteTracksMock,
  },
});
mock.module(new URL('../../src/library/sealed.js', import.meta.url).href, {
  namedExports: { isAlbumSealed(){ return false; } },
});
// CR9 (docs/13_CRATE.md): view.js's new real import of thumbURL (for the
// Artists/Playlists fanned-cover rows) would otherwise reach the real
// library/thumbs.js -> profile/screens.js chain -- the usual "stop the
// chain at the door" move, same as every other mock above.
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { thumbURL: {} },
});
mock.module(new URL('../../src/library/search.js', import.meta.url).href, {
  namedExports: {
    librarySortBar(){ return fakeEl(); }, librarySortComparator(){ return () => 0; },
    sortAlbumGroups(groups){ return groups; }, renderSearchResults(){},
    // NV6 (docs/11_SMOOTH_NAVIGATION.md): renderTracks()'s own new fast
    // path, tried before the full rebuild below -- false here means "not
    // handled," the same as the real function whenever there's no prior
    // search query to refine, which is always true in this test file.
    filterSearchInPlace(){ return false; },
  },
});
const renderCrateMock = mock.fn();
const centerEmptyStateMock = mock.fn();
const openCrateAlbumMock = mock.fn();
mock.module(new URL('../../src/crate/view.js', import.meta.url).href, {
  namedExports: { centerEmptyState: centerEmptyStateMock, renderCrate: renderCrateMock, openCrateAlbum: openCrateAlbumMock },
});
// the artist page's local shelves (docs/21_ARTIST_PAGE.md)
mock.module(new URL('../../src/library/artist-shelves.js', import.meta.url).href, {
  namedExports: { appendMostSpun(){}, appendArtistHistory(){}, appendPressings(){} },
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
  openConfirmDelete, closeConfirmDelete, renderTracks, updateTrackRow,
  updateLibBodyInset, selectAllVisible, moverCtl,
} = view;
const { S } = await import('../../src/state.js');
const { $ } = await import('../../src/util/dom.js'); // the mocked, cached-by-selector stub above

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
  scrollByMock.mock.resetCalls(); openCrateAlbumMock.mock.resetCalls();
  focusCalls.length = 0;
  globalThis.document.activeElement = null;
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

test('selectAllVisible: selects every currently-rendered track, then clears on a second tap', () => {
  resetState({ tracks: [fakeTrack('a'), fakeTrack('b'), fakeTrack('c')] });
  enterSelectMode();
  renderTracks(); // Songs mode renders one row per track into #libBody

  selectAllVisible();
  assert.deepEqual([...S.editSelection].sort(), ['a', 'b', 'c']);
  assert.equal($('#selectAll').textContent, 'Select none');

  selectAllVisible();
  assert.equal(S.editSelection.size, 0);
  assert.equal($('#selectAll').textContent, 'Select all');
});

test('selectAllVisible: a partial selection is completed to "every visible", not cleared', () => {
  resetState({ tracks: [fakeTrack('a'), fakeTrack('b')] });
  enterSelectMode();
  renderTracks();
  S.editSelection.add('a');

  selectAllVisible();

  assert.deepEqual([...S.editSelection].sort(), ['a', 'b']);
});

test('selectAllVisible: an empty library is a no-op', () => {
  resetState({ tracks: [] });
  enterSelectMode();
  renderTracks();
  selectAllVisible();
  assert.equal(S.editSelection.size, 0);
});

// UN3 (docs/36_UNIFORMITY.md): rowMenuTrackId is gone -- openRowMenu()'s
// own closures now carry the track/id directly, so closeRowMenu() has no
// module state left to clear. This just proves it's a quiet no-op.
test('closeRowMenu is a quiet no-op (no module state left to clear)', () => {
  resetState({ tracks: [fakeTrack('a')] });
  assert.doesNotThrow(() => closeRowMenu());
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

test('renderTracks (NV6, docs/11_SMOOTH_NAVIGATION.md): past the chunk threshold, the first screenful renders synchronously and the rest arrive in background chunks', async () => {
  const tracks = [];
  for(let i = 0; i < 450; i++) tracks.push(fakeTrack('t' + i));
  resetState({ tracks });
  renderTracks();
  const host = elCache.get('#libBody');
  const ul = host.children.find(c => c && c.className === 'tracklist');
  assert.ok(ul, 'the <ul> is appended up front, even before every row is in it');
  // CR9 (docs/13_CRATE.md): every fakeTrack shares the same artist
  // ('Artist'), so Songs' own new letter-head/rail feature (which kicks
  // in past 200 tracks, sorted by artist here since there's no explicit
  // sort override) inserts exactly one <li class="letter-head"> ahead of
  // the very first row -- one extra node, not a per-chunk one, since the
  // bucket key never changes across these 450 same-artist tracks.
  assert.equal(ul.children.length, 61, 'only the first screenful (plus one letter head) renders before renderTracks() returns');
  // Node has no requestIdleCallback -- the module falls back to setTimeout,
  // so flushing pending timers is how the rest of the chunks actually run.
  for(let guard = 0; guard < 20 && ul.children.length < 451; guard++){
    await new Promise(r => setTimeout(r, 0));
  }
  assert.equal(ul.children.length, 451, 'every row (plus the one letter head) eventually arrives');
});

test('renderTracks (NV6): a still-running chunk job stops once a newer render starts, instead of appending into a list nobody is looking at', async () => {
  const tracks = [];
  for(let i = 0; i < 450; i++) tracks.push(fakeTrack('t' + i));
  resetState({ tracks });
  renderTracks();
  const firstHost = elCache.get('#libBody');
  const firstUl = firstHost.children.find(c => c && c.className === 'tracklist');
  assert.equal(firstUl.children.length, 61); // CR9: +1 letter head, see the test above
  renderTracks(); // a second render starts before the first one's chunks finished
  const secondUl = firstHost.children.find(c => c && c.className === 'tracklist');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(firstUl.children.length, 61, 'the old, abandoned <ul> never grows past its first screenful');
  assert.ok(secondUl.children.length >= 61, 'the new render keeps making progress');
});

test('renderTracks: crate mode delegates to renderCrate() and skips the songs list', () => {
  resetState({ tracks: [fakeTrack('a')], view: { mode: 'crate', group: null, playlist: null } });
  renderTracks();
  assert.equal(renderCrateMock.mock.callCount(), 1);
});

// GF12 (docs/29_GATEFOLD.md) point 1: the Albums tab's drill-down opens
// the gatefold (via crate/view.js's openCrateAlbum()) instead of setting
// v.group and rendering the retired renderAlbumDetail() in its place.
test('renderTracks: the Albums tab opens the gatefold through openCrateAlbum() instead of drilling into v.group', () => {
  resetState({
    tracks: [fakeTrack('a', { tags: { title: 'a', artist: 'Artist', album: 'Album', albumArtist: 'Artist', track: 1, disc: 1 } })],
    view: { mode: 'albums', group: null, playlist: null },
  });
  renderTracks();
  const host = elCache.get('#libBody');
  const row = queryAll(host, '.grouprow')[0];
  assert.ok(row, 'the Albums tab should render one grouprow per album');
  row.fire('click');
  assert.equal(openCrateAlbumMock.mock.callCount(), 1);
  const item = openCrateAlbumMock.mock.calls[0].arguments[0];
  assert.equal(item.album, 'Album');
  assert.equal(item.artist, 'Artist');
  assert.deepEqual(item.idx, [0]);
  assert.equal(S.view.group, null, 'v.group is never set from the Albums tab any more');
});

// GF12 (docs/29_GATEFOLD.md) point 2: moverCtl() is now the one move
// implementation shared by playlist manual reordering and the gatefold's
// own "Track order" mode (buildGatefoldTracklist()'s opts.reorder) — this
// is what "manual order survives the move" rests on, so it's tested here
// directly rather than only indirectly through either caller.
test('moverCtl: moving an item down then back up leaves the list correctly reordered each time, and reports the mutated list to the caller', () => {
  resetState({ tracks: [fakeTrack('a'), fakeTrack('b'), fakeTrack('c')] });
  const list = ['a', 'b', 'c'];
  let reported = null;
  const ctl = moverCtl(list, 0, ord => { reported = ord.slice(); });
  const [, downBtn] = ctl.children;
  downBtn.fire('click', { stopPropagation(){} });
  assert.deepEqual(list, ['b', 'a', 'c'], 'moving "a" down one swaps it with "b"');
  assert.deepEqual(reported, ['b', 'a', 'c'], 'the caller is handed the same mutated order');
  assert.equal(queueSaveMock.mock.callCount(), 1);

  // "a" is now at index 1 -- move it back up, and the list should return
  // to its original order (the move survives a full round trip).
  const ctl2 = moverCtl(list, 1, ord => { reported = ord.slice(); });
  const [upBtn2] = ctl2.children;
  upBtn2.fire('click', { stopPropagation(){} });
  assert.deepEqual(list, ['a', 'b', 'c'], 'moving it back up restores the original order');
  assert.deepEqual(reported, ['a', 'b', 'c']);
});

// GF12 point 1: an artist's own album drill-down opens the gatefold the
// same way, instead of setting v.artistAlbum.
test('renderTracks: an artist\'s album shelf opens the gatefold through openCrateAlbum() instead of drilling into v.artistAlbum', () => {
  resetState({
    tracks: [
      fakeTrack('a', { tags: { title: 'a', artist: 'Artist', album: 'Album One', albumArtist: 'Artist', track: 1, disc: 1 } }),
      fakeTrack('b', { tags: { title: 'b', artist: 'Artist', album: 'Album Two', albumArtist: 'Artist', track: 1, disc: 1 } }),
    ],
    view: { mode: 'artists', group: 'Artist', artistAlbum: null, playlist: null },
  });
  renderTracks();
  const host = elCache.get('#libBody');
  const sleeves = queryAll(host, '.shelf-sleeve');
  assert.equal(sleeves.length, 2, 'an artist with multiple albums shows a shelf, one sleeve per album');
  sleeves[0].fire('click');
  assert.equal(openCrateAlbumMock.mock.callCount(), 1);
  assert.equal(S.view.artistAlbum, null, 'v.artistAlbum is never set from the artist shelf any more');
});

// Ken, 2026-10-22: the Library scroll lock (shell/routes.js's showRoute())
// means #libBody can no longer rely on page scroll -- updateLibBodyInset()
// is what gives it its own internal scroll region instead.
test('updateLibBodyInset: a no-op when Library isn\'t the route on screen', () => {
  resetState({ tracks: [fakeTrack('a')] });
  routeLibraryEl.classList.remove('on');
  const host = elCache.get('#libBody') || (() => { const h = fakeEl(); elCache.set('#libBody', h); return h; })();
  host.style.maxHeight = 'untouched';
  updateLibBodyInset();
  assert.equal(host.style.maxHeight, 'untouched');
});

test('updateLibBodyInset: gives #libBody a scrollable max-height in Songs/Artists/Playlists view', () => {
  resetState({ tracks: [fakeTrack('a')], view: { mode: 'songs', group: null, playlist: null } });
  routeLibraryEl.classList.add('on');
  updateLibBodyInset();
  const host = elCache.get('#libBody');
  assert.ok(host.style.maxHeight.endsWith('px'));
  assert.equal(host.style.overflowY, 'auto');
  routeLibraryEl.classList.remove('on');
});

test('updateLibBodyInset: Crate view is exempt -- it already fits itself to the viewport (applyCrateMiniInset) and never relied on page scroll', () => {
  resetState({ tracks: [fakeTrack('a')], view: { mode: 'crate', group: null, playlist: null } });
  routeLibraryEl.classList.add('on');
  const host = elCache.get('#libBody') || (() => { const h = fakeEl(); elCache.set('#libBody', h); return h; })();
  host.style.maxHeight = '400px';
  host.style.overflowY = 'auto';
  updateLibBodyInset();
  assert.equal(host.style.maxHeight, '');
  assert.equal(host.style.overflowY, '');
  routeLibraryEl.classList.remove('on');
});

test('updateLibBodyInset: a live search over Crate still needs its own scroll, since search results render into #libBody regardless of view mode', () => {
  resetState({ tracks: [fakeTrack('a')], view: { mode: 'crate', group: null, playlist: null } });
  routeLibraryEl.classList.add('on');
  const search = elCache.get('#librarySearch') || (() => { const h = fakeEl(); elCache.set('#librarySearch', h); return h; })();
  search.value = 'a';
  updateLibBodyInset();
  const host = elCache.get('#libBody');
  assert.ok(host.style.maxHeight.endsWith('px'));
  assert.equal(host.style.overflowY, 'auto');
  routeLibraryEl.classList.remove('on');
  search.value = '';
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

test('songRow: a kept row\'s click handler reads its position in `queue` live, not the position it was built with (NV6, docs/11_SMOOTH_NAVIGATION.md)', () => {
  // library/search.js's own in-place search-result filtering narrows a
  // shared `queue` array in place (splice), rather than rebuilding rows,
  // so every row it keeps has to find its own *current* slot at click
  // time -- this is the mechanism that makes that safe: songRow() never
  // bakes `pos` into the click handler, it looks up queue.indexOf(i).
  resetState({ tracks: [fakeTrack('a'), fakeTrack('b'), fakeTrack('c')] });
  const q = [0, 1, 2];
  const row = songRow(2, q, 2); // built when track 'c' was at position 2
  q.splice(0, 1); // track 'a' (index 0) no longer matches -- 'c' is now at position 1
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

// --- NV3 (docs/11_SMOOTH_NAVIGATION.md) -----------------------------------

test('updateTrackRow: patches just the one row -- title/art/duration, aria-current, and the picked class -- and nothing else', () => {
  resetState({ tracks: [fakeTrack('a'), fakeTrack('b')] });
  renderTracks();
  const host = elCache.get('#libBody');
  const ul = host.children.find(c => c && c.className === 'tracklist');
  const [rowA, rowB] = ul.children;

  S.tracks[0].tags.title = 'A (edited)';
  S.tracks[0].art = 'blob:new-art';
  const ok = updateTrackRow('a');

  assert.equal(ok, true);
  assert.equal(ul.children.length, 2, 'no row was added or removed');
  assert.equal(ul.children[0], rowA, 'the row was patched in place, not replaced');
  assert.equal(ul.children[1], rowB, 'the other row was never touched');
  assert.equal(rowA.querySelector('.t-name').querySelector('b').textContent, 'A (edited)');
  assert.equal(rowA.querySelector('.t-art').tagName, 'IMG');
  assert.equal(rowA.querySelector('.t-art').src, 'blob:new-art');
  // row b's own content is exactly as renderTracks() first built it
  assert.equal(rowB.querySelector('.t-name').querySelector('b').textContent, 'b');
});

test('updateTrackRow: moves the now-playing marker between rows without touching anything else', () => {
  resetState({ tracks: [fakeTrack('a'), fakeTrack('b')], index: 0 });
  renderTracks();
  const host = elCache.get('#libBody');
  const ul = host.children.find(c => c && c.className === 'tracklist');
  const [rowA, rowB] = ul.children;
  assert.equal(rowA.getAttribute('aria-current'), 'true');
  assert.equal(rowB.getAttribute('aria-current'), null);

  S.index = 1;   // player/transport.js's load() does this before calling updateTrackRow twice
  assert.equal(updateTrackRow('a'), true);   // the row losing the marker
  assert.equal(updateTrackRow('b'), true);   // the row gaining it
  assert.equal(rowA.getAttribute('aria-current'), null);
  assert.equal(rowB.getAttribute('aria-current'), 'true');
});

test('updateTrackRow: returns false when the row isn\'t currently on screen (e.g. the id doesn\'t exist)', () => {
  resetState({ tracks: [fakeTrack('a')] });
  renderTracks();
  assert.equal(updateTrackRow('nope'), false);
});

test('renderTracks: anchor-preserving rebuild scrolls the first visible row back to the same screen position', () => {
  resetState({ tracks: [fakeTrack('a'), fakeTrack('b')] });
  renderTracks();   // 'a' is first in its own <ul> (index 0 among siblings)
  scrollByMock.mock.resetCalls();
  // a track lands ahead of 'a' in draw order, pushing its row down by
  // exactly one row's worth of height (50px, this fake's own unit) --
  // without the anchor-preserving wrapper, this rebuild would otherwise
  // read as the list silently jumping under the user's thumb.
  S.tracks.unshift(fakeTrack('z'));
  renderTracks();
  assert.equal(scrollByMock.mock.callCount(), 1);
  assert.deepEqual(scrollByMock.mock.calls[0].arguments, [0, 50]);
});

test('renderTracks: anchor-preserving rebuild restores focus to the same row\'s own focused control', () => {
  resetState({ tracks: [fakeTrack('a'), fakeTrack('b')] });
  renderTracks();
  const host = elCache.get('#libBody');
  const oldUl = host.children.find(c => c && c.className === 'tracklist');
  const editBtn = oldUl.children[0].querySelector('.t-edit');
  globalThis.document.activeElement = editBtn;
  S.tracks.unshift(fakeTrack('z'));
  renderTracks();   // rebuilds a whole new <ul> -- the old one above is stale now
  const newUl = host.children.find(c => c && c.className === 'tracklist');
  const newRowA = newUl.children[1]; // 'a' is now second, after the prepended 'z'
  const newEditBtn = newRowA.querySelector('.t-edit');
  assert.ok(focusCalls.includes(newEditBtn), 'the new row\'s own equivalent control should have received focus');
});
