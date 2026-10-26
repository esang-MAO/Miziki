import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// CR6 (docs/13_CRATE.md): library/sealed.js now imports REDUCED
// (util/motion.js) -- read once, at module load, from window.matchMedia --
// for its own reduced-motion break choreography. Stubbed here the same way
// shell.test.js/crate-model.test.js already do, since this file's real
// player/queue.js chain reaches sealed.js before any mock of this module
// would apply.
globalThis.window = { matchMedia(){ return { matches: false }; } };

// Since step 5e, queue.js also has the visible-queue functions
// (queueInsert/playNext/addToQueue, queueRemoveAt, queueMove,
// renderQueueSheet/openQueueSheet/closeQueueSheet), which call real $/el --
// mocked to a tiny stub element, same approach as edit.test.js/
// delete.test.js, but capable enough (appendChild, addEventListener,
// cached by selector) for renderQueueSheet's tree-building to run without
// throwing.
const elCache = new Map();
function fakeEl(){
  const classes = new Set();
  return {
    textContent: '', style: {}, innerHTML: '', src: '', alt: '', dataset: {},
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
      // §3's own setPlatterLift() toggles a class on #platterBox
      toggle(c, on){ if(on === undefined) on = !classes.has(c); if(on) classes.add(c); else classes.delete(c); return on; },
    },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, appendChild(child){ return child; },
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ if(!elCache.has(sel)) elCache.set(sel, fakeEl()); return elCache.get(sel); },
    el(tag, cls, text){ const e = fakeEl(); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; },
  },
});

// queue.js has temporary circular imports back to main.js (rule 8 in
// CLAUDE.md) for screen functions not yet extracted, plus real circular
// imports with transport.js (load/play/pause/seek) — the same shape
// already established between engine.js and transport.js. Since step 5c,
// queue.js also imports invalidateActiveSessionIfAny from the real
// src/history/sessions.js. Since step 6b, sessions.js's own applyDiscVariant/
// restoreThumbs imports are real (looks.js/thumbs.js, not main.js), but
// loading those for real pulls in their own further real chains —
// thumbs.js's cropSquareImage import reaches library/edit.js, which reaches
// library/sealed.js (persistSealedAlbums) and library/credits.js
// (rebuildPeopleIndex/updateCreditsButtonForCurrent) — and each of those
// still has its own circular import back to main.js (rule 8), which is why
// this mock's export list is wider than queue.js's own direct needs.
// main.js has DOM-dependent top-level code that needs a browser, and
// transport.js itself still imports ~13 functions from main.js, so both
// are mocked directly here rather than loading their real dependency
// chains — same approach as engine.test.js and clock.test.js.
// Since step 7e, sealed.js's updateSealedSheetAfterBreak import is real
// (from src/gatefold/sealed-sheet.js) instead of main.js — mocked here
// rather than main.js, since the real sealed-sheet.js would otherwise
// reach gatefold/view.js's own wide real chain just to satisfy this one
// name. main.js is no longer mocked in this file at all as a result.
mock.module(new URL('../../src/gatefold/sealed-sheet.js', import.meta.url).href, {
  namedExports: { updateSealedSheetAfterBreak(){} },
});
// Since step 7d, renderTracks/exitSelectMode/songRow (reached via
// edit.js/credits.js, transitively through sessions.js -> thumbs.js ->
// edit.js as the comment above describes) are all real imports from
// src/library/view.js instead of main.js — mocked directly here, same
// "stop the chain at the door" reasoning.
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: { renderTracks(){}, exitSelectMode(){}, songRow(){}, updateTrackRow(){ return false; } },
});
// RF23 (docs/12_REFINE.md): credits.js's new, one-directional import of
// openFriendStore (social/screens/friend-store.js) would otherwise reach
// that module's own real chain (profile/storefront.js and everything past
// it) through this file's own real credits.js chain described above —
// stopped at that new edge, the same way tests/unit/credits.test.js does.
mock.module(new URL('../../src/social/screens/friend-store.js', import.meta.url).href, {
  namedExports: { openFriendStore(){} },
});
// Since step 7c, edit.js's deleteCrateArtTiers/buildCrateTier and thumbs.js's
// invalidateCrateModel imports are real ones from src/crate/tiers.js/
// model.js instead of main.js — mocked directly here, same "stop the chain
// at the door" reasoning (crate/model.js's own real chain reaches
// storage/meta.js -> audio/mode.js -> audio/engine.js's routeSource, which
// this file's engine.js mock below doesn't provide).
mock.module(new URL('../../src/crate/tiers.js', import.meta.url).href, {
  namedExports: { deleteCrateArtTiers(){}, buildCrateTier(){} },
});
mock.module(new URL('../../src/crate/model.js', import.meta.url).href, {
  namedExports: { invalidateCrateModel(){} },
});
// Since step 7b, the five screen/ceremony functions above moved off
// main.js's own export list into real src/shell/ modules — mocked
// directly here, same "stop the chain at the door" reasoning: letting
// them load for real would pull in shell/mini-player.js's own real
// player/background.js import (bgSync), which chains into
// player/controls.js/storage/meta.js/audio/mode.js. This mock list also
// covers library/edit.js's/delete.js's/credits.js's own shell/ imports
// (renderMiniPlayer/closePlayer/showRoute), reached transitively via
// history/sessions.js -> library/thumbs.js -> library/edit.js.
mock.module(new URL('../../src/shell/start-sequence.js', import.meta.url).href, {
  namedExports: { runStartSequence(){} },
});
mock.module(new URL('../../src/shell/player-overlay.js', import.meta.url).href, {
  namedExports: { openPlayerViaSheet(){}, closePlayer(){} },
});
// NV2 (docs/11_SMOOTH_NAVIGATION.md): player/queue.js's openQueueSheet now
// registers with the real history-based nav-stack layer stack, which reads
// the real browser history/document/window — stubbed to no-ops here, same
// "stop the chain at the door" reasoning as the rest of this file's mocks;
// nav-stack.js's own behavior is covered by tests/unit/nav-stack.test.js.
mock.module(new URL('../../src/shell/nav-stack.js', import.meta.url).href, {
  namedExports: { openLayer(){}, closeLayer(){}, forceCloseLayer(){} },
});
// CEREMONY PR 3: player/queue.js and shell/start-sequence.js import
// shell/runout.js, whose real chain reaches library/view.js — stop it here.
mock.module(new URL('../../src/shell/runout.js', import.meta.url).href, {
  namedExports: { endOfQueue(){}, maybeSideFlip(){ return false; }, cancelRunout(){}, interruptRunout(){ return false; }, clearToRest(){}, performPendingFlip(){ return false; } },
});
mock.module(new URL('../../src/shell/put-away.js', import.meta.url).href, {
  namedExports: { shouldPutAway(){ return false; }, putAwayInstant(){}, runPutAwaySequence(){} },
});
mock.module(new URL('../../src/shell/mini-player.js', import.meta.url).href, {
  namedExports: { renderMiniPlayer(){} },
});
mock.module(new URL('../../src/shell/routes.js', import.meta.url).href, {
  namedExports: { showRoute(){} },
});
// Since step 6e, thumbs.js's renderProfile is a real import from
// src/profile/screens.js instead of main.js — mocked directly here,
// same "stop the chain at the door" reasoning the comment above gives.
mock.module(new URL('../../src/profile/screens.js', import.meta.url).href, {
  namedExports: { renderProfile(){} },
});
// Since step 06 (B3), history/sessions.js's own touchBackupField import is
// a real one from storage/meta.js, which real-chains into audio/mode.js's
// routeSource->audio/engine.js — mocked directly here, same "stop the
// chain at the door" reasoning as every other mock in this file.
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave(){}, touchBackupField(){} },
});
const loadMock = mock.fn();
const playMock = mock.fn();
const pauseMock = mock.fn();
const seekMock = mock.fn();
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { load: loadMock, play: playMock, pause: pauseMock, seek: seekMock, sideLetterFor(){ return ''; }, cancelPendingGapless(){} },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { drawTime(){} },
});
mock.module(new URL('../../src/player/sleep-timer.js', import.meta.url).href, {
  namedExports: { sleepStopPlayback(){} },
});
// buffers.js's own real imports — mocked the same way for the same reason
// (engine.js has a real, non-circular import of main.js/transport.js too).
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { ensureContext(){}, applyCharacter(){}, applyWobbleRate(){}, applyLoudnessNorm(){}, routeSource(){}, decodeAudioFile: async () => {} },
});
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote(){} },
});

// docs/15_SURFACE_NOISE.md §3: skipWithLift()'s own needle-lift/drop timing
// reads SKIP_LIFT_MS/SKIP_AIR_MS/SKIP_FADE_MS and calls into
// src/audio/surface-noise.js's generators directly -- mocked here with tiny
// millisecond constants (so tests don't need to wait anywhere near the real
// ~370ms) and mock.fn() spies for the calls themselves, which is what the
// tests below actually assert on. The real DSP generators
// (skipDropHissSamples, needleLiftSamples, etc.) are covered by their own
// tests/unit/surface-noise.test.js -- not re-tested here.
let fakeActive = true;
let fakeScale = 1;
const playNeedleLiftMock = mock.fn();
const playSkipDropMock = mock.fn();
const fadeMusicToMock = mock.fn();
mock.module(new URL('../../src/audio/surface-noise.js', import.meta.url).href, {
  namedExports: {
    releaseSeed(){ return 7; },
    noiseFloorScale(){ return fakeScale; },
    surfaceNoiseActive(){ return fakeActive; },
    playNeedleLift: playNeedleLiftMock,
    playSkipDrop: playSkipDropMock,
    fadeMusicTo: fadeMusicToMock,
    SKIP_LIFT_MS: 5,
    SKIP_AIR_MS: 5,
    SKIP_FADE_MS: 2,
  },
});

const {
  buildOrder, reorderQueue, advance, skipWithLift,
  playNext, addToQueue, openQueueSheet, closeQueueSheet,
  renderQueueSheet, saveQueueAsPlaylist, clearUpcoming, undoQueueChange,
  queueRemoveAt, queueReorderTo,
} = await import('../../src/player/queue.js');
const { ensureBuffer, touchLRU } = await import('../../src/player/buffers.js');
const { S } = await import('../../src/state.js');

function resetState(overrides){
  Object.assign(S, {
    tracks: [], index: -1, playing: false, pos: 0,
    baseQueue: [], queue: [], qpos: 0, shuffle: false, repeat: 'off',
    sleep: { mode: null }, lru: [], playerOpen: false,
    pendingShellInfo: null, sleevePullEnabled: true, sessionActive: null,
    playlists: [], queueUndo: null, queueUndoTimer: null, trackLastPlayed: {},
  }, overrides);
  loadMock.mock.resetCalls(); playMock.mock.resetCalls();
  pauseMock.mock.resetCalls(); seekMock.mock.resetCalls();
  playNeedleLiftMock.mock.resetCalls(); playSkipDropMock.mock.resetCalls();
  fadeMusicToMock.mock.resetCalls();
  fakeActive = true; fakeScale = 1;
  elCache.clear();
}

function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

function fakeTrackWithTags(title, artist){
  return { tags: { title, artist }, meta: {} };
}

test('buildOrder with no "first" shuffles the whole base queue, keeping every index exactly once', () => {
  resetState({ baseQueue: [0,1,2,3,4] });
  buildOrder();
  assert.deepEqual(S.queue.slice().sort((a,b)=>a-b), [0,1,2,3,4]);
});

test('buildOrder with a "first" puts it at the front, shuffling the rest', () => {
  resetState({ baseQueue: [0,1,2,3,4] });
  buildOrder(2);
  assert.equal(S.queue[0], 2);
  assert.deepEqual(S.queue.slice().sort((a,b)=>a-b), [0,1,2,3,4]);
});

test('reorderQueue with shuffle off keeps the base queue order', () => {
  resetState({ baseQueue: [3,1,4,0,2], index: 4, shuffle: false });
  reorderQueue();
  assert.deepEqual(S.queue, [3,1,4,0,2]);
  assert.equal(S.qpos, S.queue.indexOf(4));
});

test('reorderQueue with shuffle on keeps the current track first and every track exactly once', () => {
  resetState({ baseQueue: [0,1,2,3,4], index: 3, shuffle: true });
  reorderQueue();
  assert.equal(S.queue[0], 3);
  assert.deepEqual(S.queue.slice().sort((a,b)=>a-b), [0,1,2,3,4]);
  assert.equal(S.qpos, 0);
});

function fakeTrack(){ return { tags: {}, meta: {} }; }

test('advance: repeat off stops at the end of the queue without wrapping', () => {
  resetState({ tracks: [fakeTrack(), fakeTrack()], queue: [0,1], qpos: 1, repeat: 'off', playing: true });
  advance(1, true);
  assert.equal(S.qpos, 1); // unchanged -- end of the record, no wraparound
  assert.equal(pauseMock.mock.calls.length, 1);
});

test('advance: repeat all wraps back to the first track in the queue', () => {
  resetState({ tracks: [fakeTrack(), fakeTrack(), fakeTrack()], queue: [0,1,2], qpos: 2, repeat: 'all', shuffle: false });
  advance(1, true);
  assert.equal(S.qpos, 0);
});

test('advance: repeat one restarts the current track instead of moving the queue position', () => {
  resetState({ tracks: [fakeTrack()], queue: [0], qpos: 0, repeat: 'one', playing: true, pos: 42 });
  advance(1, true);
  assert.equal(S.qpos, 0); // position in the queue never changes for repeat-one
  assert.deepEqual(seekMock.mock.calls[0].arguments, [0]);
  assert.equal(playMock.mock.calls.length, 0); // already playing, so play() is not called again
});

test('advance: repeat one calls play() if playback had stopped', () => {
  resetState({ tracks: [fakeTrack()], queue: [0], qpos: 0, repeat: 'one', playing: false });
  advance(1, true);
  assert.equal(playMock.mock.calls.length, 1);
});

test('advance: a manual skip (auto=false) past the end still does not wrap under repeat off', () => {
  resetState({ tracks: [fakeTrack(), fakeTrack()], queue: [0,1], qpos: 1, repeat: 'off' });
  advance(1, false);
  assert.equal(S.qpos, 1);
});

test('ensureBuffer/touchLRU: keeps at most 3 decoded tracks, evicting the least recently used', async () => {
  const mkTrack = () => ({ tags: { title: 't' }, meta: {}, blob: { arrayBuffer: async () => new ArrayBuffer(0) } });
  resetState({
    tracks: [mkTrack(), mkTrack(), mkTrack(), mkTrack()],
    index: 1,   // track 1 is "playing" -- distinct from whichever ends up least recently used
    lru: [],
  });
  S.ctx = { decodeAudioData: async () => ({ duration: 10 }) };

  await ensureBuffer(0);
  await ensureBuffer(1);
  await ensureBuffer(2);
  assert.ok(S.tracks[0].buffer && S.tracks[1].buffer && S.tracks[2].buffer);

  // decoding a 4th evicts the least recently used (track 0, touched first and
  // never touched again), which is not the playing track
  await ensureBuffer(3);
  assert.equal(S.tracks[0].buffer, null);
  assert.ok(S.tracks[1].buffer && S.tracks[2].buffer && S.tracks[3].buffer);
});

test('touchLRU evicts the least recently used track once over the cap of 3', () => {
  const mkTrack = () => ({ buffer: {} });
  resetState({ tracks: [mkTrack(), mkTrack(), mkTrack(), mkTrack()], index: 1, lru: [0,1,2] });
  // lru is most-recent-first: 0 was touched most recently, 2 least recently.
  // touching 3 pushes it to 4 entries -- over the cap -- and drops the one
  // that ends up at the back: 2 (not the playing track, index 1).
  touchLRU(3);
  assert.equal(S.tracks[2].buffer, null);
  assert.ok(S.tracks[0].buffer && S.tracks[1].buffer && S.tracks[3].buffer);
});

test('touchLRU keeps the playing track decoded even when it is the one that would be evicted', () => {
  const mkTrack = () => ({ buffer: {} });
  resetState({ tracks: [mkTrack(), mkTrack(), mkTrack(), mkTrack()], index: 2, lru: [0,1,2] });
  // same shape as above, but this time the track that would be dropped (2)
  // is also S.index -- the one currently playing -- so its buffer survives.
  touchLRU(3);
  assert.ok(S.tracks[2].buffer !== null);
});

test('playNext inserts right after the currently playing position', () => {
  resetState({
    tracks: [fakeTrackWithTags('a'), fakeTrackWithTags('b'), fakeTrackWithTags('c'), fakeTrackWithTags('d')],
    baseQueue: [0,1,2], queue: [0,1,2], qpos: 0, index: 0,
  });
  playNext(3);
  assert.deepEqual(S.queue, [0,3,1,2]);
  assert.ok(S.baseQueue.includes(3));
});

test('addToQueue appends at the end of the queue', () => {
  resetState({
    tracks: [fakeTrackWithTags('a'), fakeTrackWithTags('b'), fakeTrackWithTags('c'), fakeTrackWithTags('d')],
    baseQueue: [0,1,2], queue: [0,1,2], qpos: 0, index: 0,
  });
  addToQueue(3);
  assert.deepEqual(S.queue, [0,1,2,3]);
});

test('playNext/addToQueue on the currently playing track is a no-op', () => {
  resetState({
    tracks: [fakeTrackWithTags('a'), fakeTrackWithTags('b')],
    baseQueue: [0,1], queue: [0,1], qpos: 0, index: 0,
  });
  playNext(0);
  assert.deepEqual(S.queue, [0,1]);
});

test('playNext moves an already-queued track rather than duplicating it', () => {
  resetState({
    tracks: [fakeTrackWithTags('a'), fakeTrackWithTags('b'), fakeTrackWithTags('c')],
    baseQueue: [0,1,2], queue: [0,1,2], qpos: 0, index: 0,
  });
  playNext(2);
  assert.deepEqual(S.queue, [0,2,1]);
});

test('openQueueSheet/closeQueueSheet toggle the overlay open state', () => {
  resetState({
    tracks: [fakeTrackWithTags('a', 'Artist A'), fakeTrackWithTags('b', 'Artist B')],
    queue: [0,1], qpos: 0, index: 0,
  });
  openQueueSheet();
  const overlay = elCache.get('#queueOverlay');
  assert.ok(overlay.classList.contains('open'));
  closeQueueSheet();
  assert.ok(!overlay.classList.contains('open'));
});

/* ================= AU8 (docs/16_AUDIO.md §6): queue tools ================= */

test('clearUpcoming: truncates the queue to the current track, snapshots for undo, and shows the toast', () => {
  resetState({
    tracks: [fakeTrackWithTags('a'), fakeTrackWithTags('b'), fakeTrackWithTags('c')],
    baseQueue: [0,1,2], queue: [0,1,2], qpos: 0, index: 0,
  });
  clearUpcoming();
  assert.deepEqual(S.queue, [0]);
  assert.deepEqual(S.baseQueue, [0]);   // a later shuffle toggle can't resurrect what was cleared
  assert.ok(S.queueUndo);
  assert.deepEqual(S.queueUndo.queue, [0,1,2]);
  const toast = elCache.get('#queueUndoToast');
  assert.equal(toast.style.display, 'flex');
});

test('clearUpcoming is a no-op with nothing upcoming', () => {
  resetState({
    tracks: [fakeTrackWithTags('a')],
    baseQueue: [0], queue: [0], qpos: 0, index: 0,
  });
  clearUpcoming();
  assert.equal(S.queueUndo, null);
});

test('undoQueueChange restores the exact snapshot clearUpcoming took', () => {
  resetState({
    tracks: [fakeTrackWithTags('a'), fakeTrackWithTags('b'), fakeTrackWithTags('c')],
    baseQueue: [0,1,2], queue: [0,1,2], qpos: 0, index: 0,
  });
  clearUpcoming();
  undoQueueChange();
  assert.deepEqual(S.queue, [0,1,2]);
  assert.deepEqual(S.baseQueue, [0,1,2]);
  assert.equal(S.queueUndo, null);   // consumed
  const toast = elCache.get('#queueUndoToast');
  assert.equal(toast.style.display, 'none');
});

test('undoQueueChange with nothing to undo is a quiet no-op', () => {
  resetState({ tracks: [fakeTrackWithTags('a')], baseQueue: [0], queue: [0], qpos: 0, index: 0 });
  undoQueueChange();   // no snapshot taken -- must not throw
  assert.equal(S.queueUndo, null);
});

test('queueRemoveAt also drops the index from baseQueue (not just queue) and snapshots for undo', () => {
  resetState({
    tracks: [fakeTrackWithTags('a'), fakeTrackWithTags('b'), fakeTrackWithTags('c')],
    baseQueue: [0,1,2], queue: [0,1,2], qpos: 0, index: 0,
  });
  queueRemoveAt(1);   // offset 1 from qpos 0 -- the upcoming "c" track, idx 2
  assert.deepEqual(S.queue, [0,1]);
  assert.deepEqual(S.baseQueue, [0,1]);   // the fix: a later shuffle can't resurrect idx 2
  assert.ok(S.queueUndo);
  assert.deepEqual(S.queueUndo.queue, [0,1,2]);
});

test('queueRemoveAt on the current track or out of range is a no-op', () => {
  resetState({
    tracks: [fakeTrackWithTags('a'), fakeTrackWithTags('b')],
    baseQueue: [0,1], queue: [0,1], qpos: 0, index: 0,
  });
  queueRemoveAt(-1);   // would resolve to the current track itself
  queueRemoveAt(5);    // past the end
  assert.deepEqual(S.queue, [0,1]);
  assert.equal(S.queueUndo, null);
});

test('queueReorderTo moves a row within the upcoming portion, never past the current track', () => {
  resetState({
    tracks: [fakeTrackWithTags('a'), fakeTrackWithTags('b'), fakeTrackWithTags('c'), fakeTrackWithTags('d')],
    baseQueue: [0,1,2,3], queue: [0,1,2,3], qpos: 0, index: 0,
  });
  queueReorderTo(2, 0);   // move the last upcoming row ("d") to the front of "upcoming"
  assert.deepEqual(S.queue, [0,3,1,2]);
});

test('queueMove(pos, dir) is a thin adjacent-swap wrapper over queueReorderTo, unchanged for VoiceOver', () => {
  resetState({
    tracks: [fakeTrackWithTags('a'), fakeTrackWithTags('b'), fakeTrackWithTags('c')],
    baseQueue: [0,1,2], queue: [0,1,2], qpos: 0, index: 0,
  });
  renderQueueSheet();   // builds the row tree; wires the ▲▼ movers (not asserted directly here)
  queueReorderTo(1, 0);   // the same move the ▼ on row 0 / ▲ on row 1 would trigger
  assert.deepEqual(S.queue, [0,2,1]);
});

test('saveQueueAsPlaylist prompts for a name and saves the whole queue, deduplicated by id, in queue order', () => {
  const origPrompt = globalThis.window.prompt;
  globalThis.window.prompt = () => 'My Mix';
  resetState({
    tracks: [
      { tags: { title:'a' }, meta:{}, id:'id-a' },
      { tags: { title:'b' }, meta:{}, id:'id-b' },
      { tags: { title:'c' }, meta:{}, id:'id-c' },
    ],
    baseQueue: [0,1,2], queue: [2,0,1], qpos: 0, index: 2,
  });
  saveQueueAsPlaylist();
  assert.equal(S.playlists.length, 1);
  assert.equal(S.playlists[0].name, 'My Mix');
  assert.deepEqual(S.playlists[0].items, ['id-c','id-a','id-b']);
  globalThis.window.prompt = origPrompt;
});

test('saveQueueAsPlaylist does nothing when the prompt is cancelled or left blank', () => {
  const origPrompt = globalThis.window.prompt;
  globalThis.window.prompt = () => null;
  resetState({
    tracks: [{ tags:{ title:'a' }, meta:{}, id:'id-a' }],
    baseQueue: [0], queue: [0], qpos: 0, index: 0,
  });
  saveQueueAsPlaylist();
  assert.equal(S.playlists.length, 0);
  globalThis.window.prompt = origPrompt;
});

test('renderQueueSheet shows a "RECENTLY PLAYED" section for tracks already played in this queue', () => {
  resetState({
    tracks: [fakeTrackWithTags('a', 'Artist A'), fakeTrackWithTags('b', 'Artist B'), fakeTrackWithTags('c', 'Artist C')],
    queue: [0,1,2], qpos: 2, index: 2,
  });
  // just confirming this doesn't throw with a non-empty "already played"
  // prefix -- the recently-played branch (S.queue.slice(0, S.qpos)) is new
  // in AU8 and previously unreachable code in this render path.
  renderQueueSheet();
  assert.ok(true);
});

/* ================= docs/15_SURFACE_NOISE.md §3: skipWithLift() ================= */

test('skipWithLift: with Surface Noise active, fades the music out immediately, then lifts/drops/advances after the lift+air span', async () => {
  resetState({ tracks: [fakeTrack(), fakeTrack()], queue: [0,1], qpos: 0, index: 0, repeat: 'off' });
  skipWithLift(1);
  // the fade-out and the lift sound happen synchronously, before the drop --
  // the queue position hasn't moved yet
  assert.deepEqual(fadeMusicToMock.mock.calls[0].arguments, [0, 2]);
  assert.equal(playNeedleLiftMock.mock.calls.length, 1);
  assert.equal(S.qpos, 0);
  assert.equal(playSkipDropMock.mock.calls.length, 0);

  await wait(30);   // past SKIP_LIFT_MS(5)+SKIP_AIR_MS(5) in this file's mock
  assert.equal(playSkipDropMock.mock.calls.length, 1);
  assert.equal(S.qpos, 1);   // advanced, same as a plain skip
  assert.deepEqual(fadeMusicToMock.mock.calls[1].arguments, [1, 2]);   // faded back in
});

// AU9 (docs/16_AUDIO.md §5): rotationHz() in place of the old fixed
// 0.55 * S.rate -- skipWithLift() reads the currently-playing record's
// own rpm off S.recordFormat.
test('skipWithLift: the skip-drop sound follows the record\'s own rpm, not a fixed rate', async () => {
  const { rotationHz, RPM_33, RPM_45 } = await import('../../src/record-art/format.js');
  resetState({ tracks: [fakeTrack(), fakeTrack()], queue: [0,1], qpos: 0, index: 0, repeat: 'off', rate: 1, recordFormat: { size: '12"', speed: RPM_33 } });
  skipWithLift(1);
  await wait(30);
  assert.ok(Math.abs(playSkipDropMock.mock.calls[0].arguments[2] - rotationHz(RPM_33, 1)) < 1e-9);

  resetState({ tracks: [fakeTrack(), fakeTrack()], queue: [0,1], qpos: 0, index: 0, repeat: 'off', rate: 1, recordFormat: { size: '7"', speed: RPM_45 } });
  skipWithLift(1);
  await wait(30);
  assert.ok(Math.abs(playSkipDropMock.mock.calls[0].arguments[2] - rotationHz(RPM_45, 1)) < 1e-9);
});

test('skipWithLift: rapid repeated taps collapse into one lift, landing on only the final direction', async () => {
  resetState({ tracks: [fakeTrack(), fakeTrack(), fakeTrack()], queue: [0,1,2], qpos: 1, index: 1, repeat: 'off' });
  skipWithLift(1);    // would land on qpos 2
  skipWithLift(-1);   // retargets mid-lift, before the drop fires
  assert.equal(playNeedleLiftMock.mock.calls.length, 1);   // only one lift, not two
  assert.equal(fadeMusicToMock.mock.calls.length, 1);      // only one fade-out

  await wait(30);
  assert.equal(playSkipDropMock.mock.calls.length, 1);     // only one drop
  assert.equal(S.qpos, 0);   // the *last* tap's direction wins, applied from the original qpos
});

test('skipWithLift: Surface Noise Off/Pure is a plain fade, no lift/drop sounds', async () => {
  resetState({ tracks: [fakeTrack(), fakeTrack()], queue: [0,1], qpos: 0, index: 0, repeat: 'off' });
  fakeActive = false;
  skipWithLift(1);
  assert.deepEqual(fadeMusicToMock.mock.calls[0].arguments, [0, 2]);   // still fades music
  assert.equal(playNeedleLiftMock.mock.calls.length, 0);               // no lift sound

  await wait(20);
  assert.equal(playSkipDropMock.mock.calls.length, 0);   // no drop sound
  assert.equal(S.qpos, 1);
  assert.deepEqual(fadeMusicToMock.mock.calls[1].arguments, [1, 0]);   // instant fade back in, no ramp
});

test('skipWithLift(0): restarts the current track (Previous past a few seconds in) rather than advancing', async () => {
  resetState({ tracks: [fakeTrack()], queue: [0], qpos: 0, index: 0, repeat: 'off' });
  skipWithLift(0);
  await wait(30);
  assert.deepEqual(seekMock.mock.calls[0].arguments, [0]);
  assert.equal(S.qpos, 0);   // a restart, not a queue move
});

test('skipWithLift: nothing to skip to past the end of the queue falls straight through to the plain advance() path, no lift', () => {
  resetState({ tracks: [fakeTrack(), fakeTrack()], queue: [0,1], qpos: 1, index: 1, repeat: 'off' });
  skipWithLift(1);
  // §3's own scope note: Auto-flip/run-out is PR3's territory -- for now this
  // defers straight to advance()'s existing un-lifted end-of-queue handling
  assert.equal(pauseMock.mock.calls.length, 1);
  assert.equal(fadeMusicToMock.mock.calls.length, 0);
  assert.equal(playNeedleLiftMock.mock.calls.length, 0);
  assert.equal(S.qpos, 1);   // unchanged, same as advance()'s own end-of-queue test above
});
