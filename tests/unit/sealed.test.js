import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// CR6 (docs/13_CRATE.md): sealed.js now imports REDUCED (util/motion.js)
// for runBreakChoreography()'s reduced-motion fade -- REDUCED is read once,
// at module load, from window.matchMedia, so it's stubbed here the same
// way shell.test.js/crate-model.test.js already do, before anything
// imports the real sealed.js.
globalThis.window = { matchMedia(){ return { matches: false }; } };

// CR6 (docs/13_CRATE.md): buildSealOverlay() calls el() (util/dom.js) and
// the bare document.createDocumentFragment() global directly -- both
// stubbed to a tiny, DOM-free fake rather than pulling in a real document,
// same shape search.test.js/search-filter.test.js already use. Used only
// by the "overlay markup carries no accent colour" test below.
function fakeSealEl(){
  const classes = new Set();
  const kids = [];
  return {
    textContent: '', style: {},
    classList: { add(...cs){ cs.forEach(c => classes.add(c)); }, remove(){}, contains(c){ return classes.has(c); } },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    addEventListener(){},
    appendChild(child){ kids.push(child); return child; },
    children: kids,
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(){ return null; },
    el(tag, cls, text){ const e = fakeSealEl(); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; },
  },
});
globalThis.document = { createDocumentFragment(){ return fakeSealEl(); } };

// Since step 7d, sealed.js's renderTracks import is real (from
// src/library/view.js) instead of main.js — mocked directly here, since
// the real view.js would otherwise reach back into library/sealed.js
// itself (a real circular pair) plus favorites.js/credits.js/search.js/
// edit.js/delete.js and crate/view.js's own wide chains.
const renderTracksMock = mock.fn();
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: { renderTracks: renderTracksMock, songRow(){}, groupRow(){} },
});
// Since step 7e, sealed.js's updateSealedSheetAfterBreak import is real
// (from src/gatefold/sealed-sheet.js) instead of main.js — mocked here,
// since the real sealed-sheet.js would otherwise reach back into
// gatefold/view.js's own wide real chain (shell/start-sequence.js,
// shell/player-overlay.js, shell/handoff.js, player/transport.js and
// more) just to satisfy this one name. sealed.js no longer imports
// anything from main.js at all.
const updateSealedSheetAfterBreakMock = mock.fn();
mock.module(new URL('../../src/gatefold/sealed-sheet.js', import.meta.url).href, {
  namedExports: { updateSealedSheetAfterBreak: updateSealedSheetAfterBreakMock },
});
// history/achievements.js's real import chain (via history/sessions.js)
// reaches library/thumbs.js for thumbURL/persistable/restoreThumbs —
// mocked here the same way tags.test.js/credits.test.js do, so thumbs.js's
// own further chain (library/edit.js, which reaches library/sealed.js
// itself and library/credits.js) never has to load.
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { restoreThumbs: async () => {}, thumbURL: {}, persistable(rec){ return rec; }, pruneThumbs: async () => {} },
});

const {
  isAlbumSealed, breakSeal, restoreSealedAlbums, buildSealOverlay,
} = await import('../../src/library/sealed.js');
const { topAlbums, topTracks, topAlbumsInWindow } = await import('../../src/history/achievements.js');
const { dayKeyFor } = await import('../../src/sundown/rhythm.js');
// RF4 (docs/12_REFINE.md): record-art/metals.js is a leaf beyond S/$ (and
// albumMetalFor() itself never calls $) -- safe to import directly here,
// no extra mocking needed, for the "metal is justified by the count shown"
// test below.
const { albumMetalFor, ALBUM_METAL_THRESHOLDS } = await import('../../src/record-art/metals.js');
const { S } = await import('../../src/state.js');

function resetState(overrides){
  Object.assign(S, {
    sealedRecords: true, sealed: new Set(),
    sessionCounts: {}, albumLastPlayed: {}, albumDisplay: {},
    trackPlayCounts: {}, trackLastPlayed: {}, trackDisplay: {},
    mergedStats: null, metalEligibleSessions: {}, albumPlayCountsByDay: {},
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

// QC2 (docs/24_QUIET_COUNTS.md): topAlbumsInWindow() — the Season share
// card's "most played this season" selection, windowed by day (unlike
// topAlbums()'s lifetime sessionCounts) and capped to n.
test('topAlbumsInWindow: top n by plays in the window, ties broken by most recently played', () => {
  const today = dayKeyFor(Date.now());
  resetState({
    albumPlayCountsByDay: { [today]: { a1: 2, a2: 5, a3: 5 } },
    albumLastPlayed: { a1: 100, a2: 50, a3: 200 },
    albumDisplay: { a1: { name: 'One' }, a2: { name: 'Two' }, a3: { name: 'Three' } },
  });
  const top = topAlbumsInWindow(2, 90);
  assert.deepEqual(top.map(a => a.albumId), ['a3', 'a2']);
  assert.equal(top[0].name, 'Three');
});

test('topAlbumsInWindow: fewer albums than n just returns what there is', () => {
  const today = dayKeyFor(Date.now());
  resetState({ albumPlayCountsByDay: { [today]: { a1: 1 } }, albumDisplay: { a1: { name: 'Solo' } } });
  const top = topAlbumsInWindow(3, 90);
  assert.equal(top.length, 1);
  assert.equal(top[0].albumId, 'a1');
});

test('topAlbumsInWindow: plays outside the window don\'t count', () => {
  const longAgo = dayKeyFor(Date.now() - 200 * 24 * 60 * 60 * 1000);
  resetState({ albumPlayCountsByDay: { [longAgo]: { orphan: 9 } } });
  assert.deepEqual(topAlbumsInWindow(3, 90), []);
});

test('topAlbumsInWindow: an unknown album id (no S.albumDisplay entry) still gets a display fallback', () => {
  const today = dayKeyFor(Date.now());
  resetState({ albumPlayCountsByDay: { [today]: { orphan: 1 } } });
  const top = topAlbumsInWindow(1, 90);
  assert.equal(top[0].name, 'orphan');
  assert.equal(top[0].artist, '');
  assert.equal(top[0].art, null);
});

test('topAlbumsInWindow: nothing in the window at all is an empty list, not a thrown error', () => {
  resetState({ albumPlayCountsByDay: {} });
  assert.deepEqual(topAlbumsInWindow(3, 90), []);
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

// RF4 (docs/12_REFINE.md): "one number for sessions" -- once a pull has
// merged cross-device totals into S.mergedStats, topAlbums()/topTracks()
// read it instead of this device's own (possibly lower, possibly stale)
// local counter, so a device that's only played an album twice itself but
// synced with one that's played it 5 times shows 5, the same number every
// other signed-in device and (once a surface for it exists) a friend would
// see -- never the local-only count.
test('topAlbums: reads the merged cross-device total when one exists, not the local count', () => {
  resetState({
    sessionCounts: { a1: 2 },   // this device's own count -- lower than the real total
    mergedStats: { sessionCounts: { a1: 5 }, trackPlayCounts: {} },
    albumLastPlayed: { a1: 100 },
    albumDisplay: { a1: { name: 'One' } },
  });
  const top = topAlbums(1);
  assert.equal(top[0].albumId, 'a1');
  assert.equal(top[0].count, 5, 'the merged total, not the local 2');
});

test('topTracks: reads the merged cross-device total when one exists, not the local count', () => {
  resetState({
    trackPlayCounts: { t1: 1 },
    mergedStats: { sessionCounts: {}, trackPlayCounts: { t1: 9 } },
    trackDisplay: { t1: { title: 'A' } },
  });
  const top = topTracks(1);
  assert.equal(top[0].trackKey, 't1');
  assert.equal(top[0].count, 9, 'the merged total, not the local 1');
});

// RF4, point 4: "add a test that a metal shown on a device is always
// justified by the counts that device displays." topAlbums() (the number
// a device shows) and albumMetalFor() (the metal it shows for the same
// album) must read from the *same* source -- both the merged total once
// one exists, both the local counter otherwise -- or a device could show
// a metal its own displayed count doesn't actually earn (e.g. a stale
// local count justified gold while the merged, displayed count has
// dropped back under threshold after a history-clear merge). This
// exercises both functions together, against the same S, for both sources.
test('a metal shown is always justified by the session count the same device displays (local)', () => {
  const gold = ALBUM_METAL_THRESHOLDS.find(l => l.name === 'gold').sessions;
  resetState({
    sessionCounts: { a1: gold }, metalEligibleSessions: { a1: gold },
    albumDisplay: { a1: { name: 'One' } },
  });
  const shownCount = topAlbums(1)[0].count;
  assert.equal(shownCount, gold);
  assert.equal(albumMetalFor('a1'), 'gold');
  assert.ok(shownCount >= gold, 'the displayed count actually meets the shown tier\'s own threshold');
});
test('a metal shown is always justified by the session count the same device displays (merged)', () => {
  const gold = ALBUM_METAL_THRESHOLDS.find(l => l.name === 'gold').sessions;
  resetState({
    // local counters deliberately stale/lower -- a device that hasn't
    // played this album much itself, but has synced with one that has
    sessionCounts: { a1: 1 }, metalEligibleSessions: { a1: 1 },
    mergedStats: { sessionCounts: { a1: gold }, metalEligibleSessions: { a1: gold } },
    albumDisplay: { a1: { name: 'One' } },
  });
  const shownCount = topAlbums(1)[0].count;
  assert.equal(shownCount, gold, 'topAlbums shows the merged count, not the stale local one');
  assert.equal(albumMetalFor('a1'), 'gold', 'and the metal shown is earned by that same merged count');
  assert.ok(shownCount >= gold);
});

// CR6 (docs/13_CRATE.md), point 6: "add a check that the overlay markup
// carries no accent colour" -- "the film carries the message; no orange"
// (docs/design/crate/README.md). buildSealOverlay() only ever sets plain
// class names (seal-wrap/seal-film/seal-edge/seal-crease/seal-date-tag/
// seal-strip/seal-strip-text/seal-strip-tab) and text content -- never an
// inline style or a class name naming --accent/--miziki-orange/accent
// itself -- so this walks the whole built fragment and asserts none of
// that appears anywhere, rather than trying to resolve each class's own
// external stylesheet rule (out of reach for a DOM-free unit test). It
// also confirms the old orange "NEW dot" class (seal-sticker) is gone.
function collectClassNames(node, out){
  if(node.className) out.push(node.className);
  for(const child of node.children || []) collectClassNames(child, out);
}
test('buildSealOverlay: the overlay markup carries no accent colour and no orange "NEW" sticker', () => {
  const frag = buildSealOverlay(278, 'a1', Date.now());
  const classNames = [];
  collectClassNames(frag, classNames);
  assert.ok(classNames.length > 0, 'sanity: the overlay actually built something');
  for(const cls of classNames){
    assert.doesNotMatch(cls, /accent/i, `class "${cls}" must not name an accent colour`);
    assert.doesNotMatch(cls, /seal-sticker/, `the old orange "NEW" sticker class must be gone, found "${cls}"`);
  }
});
