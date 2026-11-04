import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// GF9 (docs/29_GATEFOLD.md): the long-press track menu's own gesture
// discrimination (long press vs scroll vs tap) and its action wiring.
// Same "stop the chain at the door" mocking gatefold.test.js already does
// for gatefold/view.js's wide, mostly-DOM-touching import graph -- this
// file only needs a few more of its own (library/favorites.js, ui/haptic.js,
// and credits.js's/queue.js's GF9-only exports).
globalThis.window = { matchMedia(){ return { matches: false }; } };
globalThis.document = { documentElement: { style: { setProperty(){} } } };

const openCreditsSheetMock = mock.fn();
const trackHasCreditsContentMock = mock.fn(() => true);
mock.module(new URL('../../src/library/credits.js', import.meta.url).href, {
  namedExports: {
    albumLinerNotes(){ return ''; }, albumCreditRoll(){ return new Map(); },
    albumDynamicsNote(){ return null; }, buildDynamicsNoteEl(){ return {}; },
    openPersonOrArtist(){},
    albumLinerNoteIsOverride(){ return false; }, albumLinerNotesSource(){ return null; },
    setAlbumLinerNoteOverride(){}, clearAlbumLinerNoteOverride(){},
    openCreditsSheet: openCreditsSheetMock, trackHasCreditsContent: trackHasCreditsContentMock,
  },
});
const isFavoriteMock = mock.fn(() => false);
const toggleFavoriteMock = mock.fn();
mock.module(new URL('../../src/library/favorites.js', import.meta.url).href, {
  namedExports: { isFavorite: isFavoriteMock, toggleFavorite: toggleFavoriteMock },
});
const hapticTickMock = mock.fn();
mock.module(new URL('../../src/ui/haptic.js', import.meta.url).href, {
  namedExports: { hapticTick: hapticTickMock },
});
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { thumbURL: {}, restoreThumbs: async () => {}, persistable(rec){ return rec; } },
});
mock.module(new URL('../../src/crate/tiers.js', import.meta.url).href, {
  namedExports: { getCrateArtURL: async () => null },
});
const setQueueMock = mock.fn();
const playNextMock = mock.fn();
const addToQueueMock = mock.fn();
mock.module(new URL('../../src/player/queue.js', import.meta.url).href, {
  namedExports: { setQueue: setQueueMock, playNext: playNextMock, addToQueue: addToQueueMock },
});
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { play(){} },
});
mock.module(new URL('../../src/shell/start-sequence.js', import.meta.url).href, {
  namedExports: { runStartSequence(){} },
});
mock.module(new URL('../../src/shell/player-overlay.js', import.meta.url).href, {
  namedExports: { openPlayerViaSheet(){}, wakeEveningGlance(){} },
});
mock.module(new URL('../../src/shell/handoff.js', import.meta.url).href, {
  namedExports: { runGatefoldHandoff(){} },
});
mock.module(new URL('../../src/library/sealed.js', import.meta.url).href, {
  namedExports: { buildSealOverlay(){ return { }; }, runBreakChoreography: async () => {}, isAlbumSealed(){ return false; }, sealedQuietPlay(){} },
});
mock.module(new URL('../../src/share/sheet.js', import.meta.url).href, {
  namedExports: { openShareSheet(){} },
});
mock.module(new URL('../../src/gatefold/back-cover.js', import.meta.url).href, {
  namedExports: {
    buildBackCoverEl(){ return {}; },
    buildBackCoverImageEl(){ return {}; },
    getAlbumBackCoverBlob(){ return Promise.resolve(null); },
  },
});

function fakeEl(){
  const classes = new Set();
  const listeners = {};
  return {
    textContent: '', style: {}, value: '', innerHTML: '',
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
    },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    appendChild(child){ return child; },
    addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn){
      if(!listeners[type]) return;
      listeners[type] = listeners[type].filter(f => f !== fn);
    },
    fire(type, evt){ (listeners[type] || []).slice().forEach(fn => fn(evt || {})); },
  };
}
const elCache = new Map();
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ if(!elCache.has(sel)) elCache.set(sel, fakeEl()); return elCache.get(sel); },
    el(tag, cls, text){ const e = fakeEl(); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; },
  },
});
let registeredClose = null;
mock.module(new URL('../../src/shell/nav-stack.js', import.meta.url).href, {
  namedExports: {
    openLayer(_id, onClose){ registeredClose = onClose; },
    closeLayer(){ if(registeredClose){ const fn = registeredClose; registeredClose = null; fn(); } },
    forceCloseLayer(){ if(registeredClose){ const fn = registeredClose; registeredClose = null; fn(); } },
  },
});

const {
  wireGatefoldTrackLongPress, openGatefoldTrackMenu, closeGatefoldTrackMenu,
  gatefoldTrackMenuPlayNext, gatefoldTrackMenuAddToQueue, gatefoldTrackMenuToggleFavorite,
  gatefoldTrackMenuOpenCredits, GF_LONG_PRESS_MS,
} = await import('../../src/gatefold/view.js');
const { S } = await import('../../src/state.js');

function resetAll(){
  elCache.clear();
  registeredClose = null;
  openCreditsSheetMock.mock.resetCalls();
  trackHasCreditsContentMock.mock.resetCalls();
  isFavoriteMock.mock.resetCalls();
  toggleFavoriteMock.mock.resetCalls();
  hapticTickMock.mock.resetCalls();
  playNextMock.mock.resetCalls();
  addToQueueMock.mock.resetCalls();
  S.index = -1;
  S.albumSides = false;
  S.tracks = [
    { id: 't0', tags: { title: 'One' }, duration: 180 },
    { id: 't1', tags: { title: 'Two' }, duration: 200 },
  ];
}

test('a tap (no movement) plays, and never opens the menu', async () => {
  resetAll();
  const row = fakeEl();
  const playHandler = mock.fn();
  wireGatefoldTrackLongPress(row, 0, [0, 1], playHandler);
  row.fire('pointerdown', { clientX: 10, clientY: 10 });
  row.fire('pointerup', {});
  row.fire('click', { preventDefault(){} });
  assert.equal(playHandler.mock.calls.length, 1);
  assert.deepEqual(playHandler.mock.calls[0].arguments, [[0, 1], 0]);
  assert.equal(hapticTickMock.mock.calls.length, 0);
});

test('a scroll (movement past ~8px) cancels the long press and never plays on release', async () => {
  resetAll();
  const row = fakeEl();
  const playHandler = mock.fn();
  wireGatefoldTrackLongPress(row, 0, [0, 1], playHandler);
  row.fire('pointerdown', { clientX: 10, clientY: 10 });
  row.fire('pointermove', { clientX: 10, clientY: 40 });   // > 8px vertical -- a scroll
  await new Promise(r => setTimeout(r, GF_LONG_PRESS_MS + 50));
  row.fire('pointerup', {});
  // no click follows a cancelled scroll in the real browser, so none is
  // fired here either -- the assertion is just that nothing played and the
  // menu never opened, i.e. the pending long press was actually cancelled.
  assert.equal(playHandler.mock.calls.length, 0);
  assert.equal(hapticTickMock.mock.calls.length, 0);
  assert.equal(registeredClose, null);
});

test('a completed long press never plays, haptic-ticks, and opens the track menu', async () => {
  resetAll();
  const row = fakeEl();
  const playHandler = mock.fn();
  wireGatefoldTrackLongPress(row, 1, [0, 1], playHandler);
  row.fire('pointerdown', { clientX: 10, clientY: 10 });
  await new Promise(r => setTimeout(r, GF_LONG_PRESS_MS + 50));
  // the browser still delivers a click/pointerup once the finger lifts --
  // the long press must have already suppressed it by then
  row.fire('pointerup', {});
  row.fire('click', { preventDefault(){} });
  assert.equal(playHandler.mock.calls.length, 0);
  assert.equal(hapticTickMock.mock.calls.length, 1);
  assert.equal(elCache.get('#gfTrackMenuTitle').textContent, 'Two');
  assert.ok(registeredClose);   // openLayer registered a close callback
});

test('openGatefoldTrackMenu paints meta, favorite state and credits visibility', () => {
  resetAll();
  isFavoriteMock.mock.mockImplementationOnce(() => true);
  openGatefoldTrackMenu(0, [0, 1]);
  assert.equal(elCache.get('#gfTrackMenuTitle').textContent, 'One');
  assert.equal(elCache.get('#gfTrackMenuMeta').textContent, '3:00');
  assert.equal(elCache.get('#gfTrackMenuFav').textContent, 'Remove from Favorites');
  assert.equal(elCache.get('#gfTrackMenuCredits').style.display, '');
});

test('gatefoldTrackMenuPlayNext calls playNext with this track\'s index and closes the menu', () => {
  resetAll();
  openGatefoldTrackMenu(1, [0, 1]);
  gatefoldTrackMenuPlayNext();
  assert.deepEqual(playNextMock.mock.calls[0].arguments, [1]);
  assert.equal(registeredClose, null);
});

test('gatefoldTrackMenuAddToQueue calls addToQueue with this track\'s index', () => {
  resetAll();
  openGatefoldTrackMenu(0, [0, 1]);
  gatefoldTrackMenuAddToQueue();
  assert.deepEqual(addToQueueMock.mock.calls[0].arguments, [0]);
});

test('gatefoldTrackMenuToggleFavorite toggles this track\'s own id', () => {
  resetAll();
  openGatefoldTrackMenu(1, [0, 1]);
  gatefoldTrackMenuToggleFavorite();
  assert.deepEqual(toggleFavoriteMock.mock.calls[0].arguments, ['t1']);
});

test('gatefoldTrackMenuOpenCredits closes the menu then opens this track\'s read-only credits sheet', () => {
  resetAll();
  openGatefoldTrackMenu(0, [0, 1]);
  gatefoldTrackMenuOpenCredits();
  assert.equal(registeredClose, null);
  assert.equal(openCreditsSheetMock.mock.calls.length, 1);
  assert.equal(openCreditsSheetMock.mock.calls[0].arguments[0], S.tracks[0]);
});

test('closeGatefoldTrackMenu hides the overlay', () => {
  resetAll();
  openGatefoldTrackMenu(0, [0, 1]);
  closeGatefoldTrackMenu();
  assert.equal(elCache.get('#gfTrackMenuOverlay').classList.contains('open'), false);
});
